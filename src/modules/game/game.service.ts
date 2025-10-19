import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import {
  DAILY_QUOTA_SECONDS,
  STAGE_CATEGORY,
  STAGE_PASS_THRESHOLD,
  STAGE_PENALTY,
  STAGE_POINTS,
  STAGE_QUESTIONS_REQUIRED,
  STAGES,
} from './game.constants';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import {
  ALL_TIME_KEY,
  getCurrentWeekId,
  weeklyKey,
} from '@modules/leaderboard/leaderboard.constants';
import crypto from 'node:crypto';
import { QuestionsService } from '../question/questions.service';

// Stage union (1 | 2 | 3) derived from your constants
type Stage = typeof STAGES[keyof typeof STAGES];

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly questions: QuestionsService,
  ) {}

  // ---------- helpers for type-narrowing ----------
  private asStage(n: number): Stage {
    if (n === STAGES.BASIC || n === STAGES.MID || n === STAGES.ADV) {
      return n as Stage;
    }
    // Fallback (shouldn't happen with your flow)
    return STAGES.BASIC;
  }
  // -----------------------------------------------

  // ---------- generation config ----------
  private static readonly MIN_POOL_PER_STAGE = 8;
  private static readonly GEN_PROMPT: Record<Stage, string> = {
    [STAGES.BASIC]:
      'Beginner crypto literacy, fundamentals, wallet basics.',
    [STAGES.MID]:
      'Intermediate DeFi concepts: AMMs, LPing, impermanent loss, lending, stablecoins.',
    [STAGES.ADV]:
      'Advanced protocols & scaling: rollups, L2s, MEV, concentrated liquidity, bridges, security.',
  };
  private getGenProvider(): 'gemini' | 'groq' {
    const p = (process.env.QGEN_PROVIDER || '').toLowerCase();
    return p === 'groq' ? 'groq' : 'gemini';
  }
  // --------------------------------------

  private async bumpLeaderboards(userId: string, delta: number) {
    if (!delta) return;
    const r = this.redis.raw;
    const wk = getCurrentWeekId();
    await r.zincrby(weeklyKey(wk), delta, userId);
    await r.zincrby(ALL_TIME_KEY, delta, userId);
  }

  async startSession(userId: string, _dto: { clientMeta?: string }) {
    const existing = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const remaining = await this.remainingQuota(userId, existing);
      await this.ensurePoolForStage(this.asStage(existing.stageUnlocked));
      return {
        sessionId: existing.id,
        stageUnlocked: existing.stageUnlocked,
        dailyQuotaSecondsRemaining: remaining,
      };
    }

    const used = await this.redis.getDailySeconds(userId);
    if (used >= DAILY_QUOTA_SECONDS)
      throw new ForbiddenException('Daily quota exceeded');

    const session = await this.prisma.quizSession.create({
      data: {
        userId,
        dailyQuotaSecondsRemaining: Math.max(
          0,
          DAILY_QUOTA_SECONDS - used,
        ),
        state: 'active',
      },
    });

    await this.ensurePoolForStage(STAGES.BASIC);
    return {
      sessionId: session.id,
      stageUnlocked: session.stageUnlocked,
      dailyQuotaSecondsRemaining: session.dailyQuotaSecondsRemaining,
    };
  }

  async getStatus(userId: string) {
    const session = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) {
      const used = await this.redis.getDailySeconds(userId);
      return {
        active: false,
        dailyQuotaSecondsRemaining: Math.max(
          0,
          DAILY_QUOTA_SECONDS - used,
        ),
      };
    }
    const stageState = await this.computeStageState(session.id);
    const remaining = await this.remainingQuota(userId, session);
    return {
      active: true,
      sessionId: session.id,
      stageUnlocked: session.stageUnlocked,
      stageState,
      dailyQuotaSecondsRemaining: remaining,
    };
  }

  async nextQuestion(userId: string) {
    const session = await this.requireActiveSession(userId);
    const remaining = await this.remainingQuota(userId, session);
    if (remaining <= 0) throw new ForbiddenException('Daily quota exceeded');

    // 🔀 Randomize stage for this question (no sequential gating)
    const stage = this.randomStage();

    await this.ensurePoolForStage(stage);
    const question = await this.pickRandomQuestion(session.id, stage);
    if (!question) {
      await this.ensurePoolForStage(stage);
      const retry = await this.pickRandomQuestion(session.id, stage);
      if (!retry)
        return {
          done: true,
          message: 'No more questions available for this stage',
        };
      return this.buildAttemptAndResponse(
        session.id,
        userId,
        retry,
        stage,
      );
    }

    return this.buildAttemptAndResponse(
      session.id,
      userId,
      question,
      stage,
    );
  }

  private async buildAttemptAndResponse(
    sessionId: string,
    userId: string,
    question: any,
    stage: Stage,
  ) {
    const attempt = await this.prisma.attempt.create({
      data: {
        sessionId,
        questionId: question.id,
        attemptToken: crypto.randomUUID(),
      },
      select: { id: true, attemptToken: true, startedAt: true },
    });

    // TTL ~= avg question time + safety
    const ttlSeconds =
      Math.ceil((question?.avgTimeToAnswerMs ?? 30000) / 1000) + 5;

    await this.redis.setAttemptToken(
      attempt.attemptToken,
      { userId, attemptId: attempt.id },
      ttlSeconds,
    );

    const body: any = question.body as any;
    const sanitized = { text: body?.text, options: body?.options };
    return {
      stage,
      question: {
        id: question.id,
        body: sanitized,
        avgTimeToAnswerMs: question.avgTimeToAnswerMs,
        category: question.category,
      },
      attemptToken: attempt.attemptToken,
      ttlSeconds,
    };
  }

  async submitAttempt(userId: string, dto: SubmitAttemptDto) {
    const session = await this.requireActiveSession(userId);

    const tokenData = await this.redis.getAttemptToken(dto.attemptToken);
    if (!tokenData || tokenData.userId !== userId)
      throw new BadRequestException('Attempt token invalid or expired');

    const lockKey = `attempt:lock:${tokenData.attemptId}`;
    const lockOk = await this.redis.raw.set(lockKey, '1', 'EX', 5, 'NX');
    if (lockOk !== 'OK')
      throw new BadRequestException('Attempt already processed');

    try {
      const attempt = await this.prisma.attempt.findUnique({
        where: { id: tokenData.attemptId },
      });
      if (!attempt || attempt.sessionId !== session.id)
        throw new BadRequestException('Attempt not found');
      if (attempt.answeredAt)
        throw new BadRequestException('Attempt already answered');
      if (dto.questionId !== attempt.questionId)
        throw new BadRequestException('Question mismatch');

      const question = await this.prisma.question.findUnique({
        where: { id: attempt.questionId },
      });
      if (!question) throw new NotFoundException('Question not found');

      const answeredAt = new Date();
      const timeTakenMs = Math.max(
        0,
        answeredAt.getTime() - new Date(attempt.startedAt).getTime(),
      );
      const body: any = question.body as any;
      const options: any[] = Array.isArray(body?.options)
        ? body.options
        : [];

      if (
        typeof dto.selectedIndex !== 'number' ||
        dto.selectedIndex < 0 ||
        dto.selectedIndex >= options.length
      ) {
        throw new BadRequestException('selectedIndex out of range');
      }

      const correctIndex = Number(body?.correct_index);
      const correct = Number(dto.selectedIndex) === correctIndex;

      const s: Stage = this.stageFromCategory(question.category);
      const pointsDelta = correct ? STAGE_POINTS[s] : 0;

      await this.prisma.attempt.update({
        where: { id: attempt.id },
        data: {
          answeredAt,
          timeTakenMs,
          selectedIndex: dto.selectedIndex,
          correct,
          pointsDelta,
        },
      });

      await this.bumpLeaderboards(userId, pointsDelta);

      const seconds = Math.ceil(timeTakenMs / 1000);
      await this.redis.incrDailySeconds(userId, seconds);
      const updated = await this.prisma.quizSession.update({
        where: { id: session.id },
        data: { totalSeconds: { increment: seconds } },
      });

      await this.maybeUnlockNextStage(
        updated.id,
        this.asStage(updated.stageUnlocked),
      );

      const remaining = await this.remainingQuota(userId, updated);
      const stageState = await this.computeStageState(updated.id);

      const stageComplete =
        (stageState.byStage[s]?.answered ?? 0) >=
          STAGE_QUESTIONS_REQUIRED[s] &&
        (stageState.byStage[s]?.correct ?? 0) >= STAGE_PASS_THRESHOLD[s];

      const gameComplete = [STAGES.BASIC, STAGES.MID, STAGES.ADV].every(
        (st) => {
          const a = stageState.byStage[st]?.answered ?? 0;
          const c = stageState.byStage[st]?.correct ?? 0;
          return (
            a >= STAGE_QUESTIONS_REQUIRED[st] &&
            c >= STAGE_PASS_THRESHOLD[st]
          );
        },
      );

      if (remaining <= 0) {
        await this.prisma.quizSession.update({
          where: { id: updated.id },
          data: { state: 'timeout', endedAt: new Date() },
        });
      }

      const correctOptionId =
        correctIndex >= 0 && correctIndex < options.length
          ? options[correctIndex]?.id ?? ''
          : '';

      const explanation =
        typeof body?.explanation === 'string'
          ? body.explanation
          : body?.explanation ?? undefined;

      return {
        correct,
        correctOptionId,
        explanation,
        stageComplete,
        gameComplete,
        pointsDelta,
        timeTakenMs,
        stageState,
        dailyQuotaSecondsRemaining: Math.max(0, remaining),
      };
    } finally {
      await this.redis.delAttemptToken(dto.attemptToken).catch(() => void 0);
    }
  }

  async walkAway(userId: string) {
    const session = await this.requireActiveSession(userId);
    await this.prisma.quizSession.update({
      where: { id: session.id },
      data: { state: 'forfeited', endedAt: new Date() },
    });
    return { ok: true, state: 'forfeited' };
  }

  async continueWithPenalty(userId: string, reason?: string) {
    const session = await this.requireActiveSession(userId);
    const decided =
      (await this.decideCurrentStage(
        session.id,
        this.asStage(session.stageUnlocked),
      )) ?? this.asStage(session.stageUnlocked);

    const cat = STAGE_CATEGORY[decided];
    const penalty = -Math.abs(STAGE_PENALTY[decided] ?? 1);

    const anyQ = await this.prisma.question.findFirst({
      where: {
        category: { equals: cat, mode: 'insensitive' },
        active: true,
      },
      select: { id: true },
    });
    if (!anyQ)
      throw new BadRequestException(
        'No question available for penalty attribution',
      );

    await this.prisma.attempt.create({
      data: {
        sessionId: session.id,
        questionId: anyQ.id,
        attemptToken: `penalty:${crypto.randomUUID()}`,
        answeredAt: new Date(),
        timeTakenMs: 0,
        selectedIndex: -1,
        correct: false,
        pointsDelta: penalty,
        clientMeta: reason ? { reason, penalty: true } : { penalty: true },
      },
    });

    await this.bumpLeaderboards(userId, penalty);

    const stageState = await this.computeStageState(session.id);
    return { ok: true, penaltyApplied: -penalty, stageState };
  }

  async endSession(userId: string) {
    const session = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
    });
    if (!session) return { ok: true, state: 'none' };
    await this.prisma.quizSession.update({
      where: { id: session.id },
      data: { state: 'completed', endedAt: new Date() },
    });
    return { ok: true, state: 'completed' };
  }

  // Anti-cheat: reset current session points to zero (compensating penalty)
  async resetPointsToZero(userId: string) {
    const session = await this.requireActiveSession(userId);
    const state = await this.computeStageState(session.id);
    const totalPoints =
      (state.byStage[STAGES.BASIC]?.points ?? 0) +
      (state.byStage[STAGES.MID]?.points ?? 0) +
      (state.byStage[STAGES.ADV]?.points ?? 0);

    if (totalPoints <= 0) return { ok: true, reset: false, stageState: state };

    // attribute penalty to any available question (keep FK intact)
    const anyQ = await this.prisma.question.findFirst({ select: { id: true } });
    if (!anyQ) return { ok: true, reset: false, stageState: state };

    await this.prisma.attempt.create({
      data: {
        sessionId: session.id,
        questionId: anyQ.id,
        attemptToken: `reset:${crypto.randomUUID()}`,
        answeredAt: new Date(),
        timeTakenMs: 0,
        selectedIndex: -1,
        correct: false,
        pointsDelta: -Math.abs(totalPoints),
        clientMeta: { antiCheatReset: true },
      },
    });

    await this.bumpLeaderboards(userId, -Math.abs(totalPoints));
    const stageState = await this.computeStageState(session.id);
    return { ok: true, reset: true, stageState };
  }

  // ----------------- helpers -----------------

  private async requireActiveSession(userId: string) {
    const session = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session)
      throw new ForbiddenException('No active session. Start one first.');
    return session;
  }

  private stageFromCategory(category: string): Stage {
    const c = (category || '').trim().toLowerCase();
    if (c === STAGE_CATEGORY[STAGES.BASIC] || c === 'basic' || c === 'beginner')
      return STAGES.BASIC;
    if (
      c === STAGE_CATEGORY[STAGES.MID] ||
      c === 'mid' ||
      c === 'intermediate' ||
      c === 'defi'
    )
      return STAGES.MID;
    if (c === STAGE_CATEGORY[STAGES.ADV] || c === 'adv' || c === 'advanced')
      return STAGES.ADV;
    return STAGES.BASIC;
  }

  private async remainingQuota(
    userId: string,
    _session: { dailyQuotaSecondsRemaining?: number; id: string },
  ) {
    const used = await this.redis.getDailySeconds(userId);
    return Math.max(0, DAILY_QUOTA_SECONDS - used);
  }

  private async decideCurrentStage(
    sessionId: string,
    stageUnlocked: Stage,
  ): Promise<Stage | null> {
    const state = await this.computeStageState(sessionId);
    const order: Stage[] = [STAGES.BASIC, STAGES.MID, STAGES.ADV];

    for (const s of order) {
      const req = STAGE_QUESTIONS_REQUIRED[s];
      const answered = state.byStage[s]?.answered ?? 0;
      if (s <= stageUnlocked && answered < req) return s;
    }

    if (stageUnlocked < STAGES.ADV) {
      const next = (stageUnlocked + 1) as Stage;
      const req = STAGE_QUESTIONS_REQUIRED[next];
      const answered = state.byStage[next]?.answered ?? 0;
      if (answered < req) return next;
    }
    return null;
  }

  // private async computeStageState(sessionId: string) {
  //   const attempts = await this.prisma.attempt.findMany({
  //     where: { sessionId },
  //   });
  //   const byStage: Record<
  //     Stage,
  //     { answered: number; correct: number; points: number }
  //   > = {
  //     [STAGES.BASIC]: { answered: 0, correct: 0, points: 0 },
  //     [STAGES.MID]: { answered: 0, correct: 0, points: 0 },
  //     [STAGES.ADV]: { answered: 0, correct: 0, points: 0 },
  //   };
  //   for (const a of attempts) {
  //     if (!a.questionId || a.questionId === 'penalty') {
  //       const p = a.pointsDelta ?? 0;
  //       byStage[STAGES.BASIC].points += p;
  //       continue;
  //     }
  //     const q = await this.prisma.question.findUnique({
  //       where: { id: a.questionId },
  //     });
  //     if (!q) continue;
  //     const s = this.stageFromCategory(q.category);
  //     if (a.answeredAt) {
  //       byStage[s].answered += 1;
  //       if (a.correct) byStage[s].correct += 1;
  //       byStage[s].points += a.pointsDelta ?? 0;
  //     }
  //   }
  //   return { byStage };
  // }

  private async computeStageState(sessionId: string) {
  // Pull all attempts for the session
  const attempts = await this.prisma.attempt.findMany({
    where: { sessionId },
    select: { questionId: true, answeredAt: true, correct: true, pointsDelta: true },
  });

  // Collect unique questionIds we actually need
  const qids = Array.from(
    new Set(
      attempts
        .filter(a => a.questionId && a.questionId !== 'penalty')
        .map(a => a.questionId as string)
    )
  );

  // Batch-load those questions once
  const questions = await this.prisma.question.findMany({
    where: { id: { in: qids } },
    select: { id: true, category: true },
  });
  const qMap = new Map(questions.map(q => [q.id, q.category]));

  const byStage: Record<Stage, { answered: number; correct: number; points: number }> = {
    [STAGES.BASIC]: { answered: 0, correct: 0, points: 0 },
    [STAGES.MID]:   { answered: 0, correct: 0, points: 0 },
    [STAGES.ADV]:   { answered: 0, correct: 0, points: 0 },
  };

  for (const a of attempts) {
    if (!a.questionId || a.questionId === 'penalty') {
      byStage[STAGES.BASIC].points += a.pointsDelta ?? 0;
      continue;
    }
    const cat = qMap.get(a.questionId as string);
    if (!cat) continue;
    const s = this.stageFromCategory(cat);
    if (a.answeredAt) {
      byStage[s].answered += 1;
      if (a.correct) byStage[s].correct += 1;
      byStage[s].points  += a.pointsDelta ?? 0;
    }
  }

  return { byStage };
}

  private async ensurePoolForStage(stage: Stage) {
    const cat = STAGE_CATEGORY[stage];
    const current = await this.prisma.question.count({
      where: {
        // active: true,
        category: { equals: cat, mode: 'insensitive' },
      },
    });
    this.logger.debug(
      `ensurePoolForStage(${stage}/${cat}): active=${current}`,
    );
    if (current >= GameService.MIN_POOL_PER_STAGE) return;

    const missing = Math.max(0, GameService.MIN_POOL_PER_STAGE - current);
    const lockKey = `qgen:lock:${cat}`;
    const lock = await this.redis.raw.set(lockKey, '1', 'EX', 30, 'NX');
    if (lock !== 'OK') {
      this.logger.debug(
        `ensurePoolForStage: another generator is running for ${cat}`,
      );
      return;
    }

    try {
      const provider = this.getGenProvider();
      const prompt = GameService.GEN_PROMPT[stage] ?? 'Crypto trivia.';
      const difficulty = stage;
      this.logger.debug(
        `Generating ${missing} questions for cat=${cat} via ${provider}`,
      );
      await this.questions.generateQuestions(
        provider,
        prompt,
        missing,
        cat,
        difficulty,
      );
    } catch (e) {
      this.logger.error(`Question generation failed for ${cat}`, e as any);
    } finally {
      // lock auto-expires
    }
  }

  private async pickRandomQuestion(sessionId: string, stage: Stage) {
    const cat = STAGE_CATEGORY[stage];

    // already asked in this session
    const asked = await this.prisma.attempt.findMany({
      where: { sessionId, questionId: { not: 'penalty' } },
      select: { questionId: true },
    });
    const askedIds = asked.map((a) => a.questionId);

    // category-matched pool excluding asked; pick by random skip
    const where = {
      category: { equals: cat, mode: 'insensitive' },
      id: { notIn: askedIds },
    } as const;

    const total = await this.prisma.question.count({ where });
    if (total > 0) {
      const skip = Math.floor(Math.random() * total);
      const [q] = await this.prisma.question.findMany({
        where,
        select: {
          id: true,
          body: true,
          avgTimeToAnswerMs: true,
          category: true,
        },
        skip,
        take: 1,
      });
      if (q) return q;
    }

    // fallback: any question not yet asked
    const whereAny = { id: { notIn: askedIds } } as const;
    const totalAny = await this.prisma.question.count({ where: whereAny });
    if (totalAny === 0) return null;
    const skipAny = Math.floor(Math.random() * totalAny);
    const [anyQ] = await this.prisma.question.findMany({
      where: whereAny,
      select: {
        id: true,
        body: true,
        avgTimeToAnswerMs: true,
        category: true,
      },
      skip: skipAny,
      take: 1,
    });
    return anyQ ?? null;
  }

  private async maybeUnlockNextStage(sessionId: string, stageUnlocked: Stage) {
    if (stageUnlocked >= STAGES.ADV) return;

    const state = await this.computeStageState(sessionId);
    const currentReq = STAGE_QUESTIONS_REQUIRED[stageUnlocked];
    const currentCorrect = state.byStage[stageUnlocked]?.correct ?? 0;
    const currentAnswered = state.byStage[stageUnlocked]?.answered ?? 0;

    if (
      currentAnswered >= currentReq &&
      currentCorrect >= STAGE_PASS_THRESHOLD[stageUnlocked]
    ) {
      await this.prisma.quizSession.update({
        where: { id: sessionId },
        data: { stageUnlocked: (stageUnlocked + 1) as Stage },
      });
      await this.ensurePoolForStage((stageUnlocked + 1) as Stage);
    }
  }

  private randomStage(): Stage {
    const v = Math.floor(Math.random() * 3);
    return v === 0 ? STAGES.BASIC : v === 1 ? STAGES.MID : STAGES.ADV;
  }
}