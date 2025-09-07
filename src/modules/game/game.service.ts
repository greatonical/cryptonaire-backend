import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { DAILY_QUOTA_SECONDS, STAGE_CATEGORY, STAGE_PASS_THRESHOLD, STAGE_PENALTY, STAGE_POINTS, STAGE_QUESTIONS_REQUIRED, STAGES } from './game.constants';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { ALL_TIME_KEY, getCurrentWeekId, weeklyKey } from '@modules/leaderboard/leaderboard.constants';
import crypto from 'node:crypto';


@Injectable()
export class GameService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    private async bumpLeaderboards(userId: string, delta: number) {
  if (!delta) return;
  const r = this.redis.raw;
  const wk = getCurrentWeekId();
  await r.zincrby(weeklyKey(wk), delta, userId);
  await r.zincrby(ALL_TIME_KEY, delta, userId);
}

  async startSession(userId: string, dto: { clientMeta?: string }) {
    // If an active session exists, return it
    const existing = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const remaining = await this.remainingQuota(userId, existing);
      return { sessionId: existing.id, stageUnlocked: existing.stageUnlocked, dailyQuotaSecondsRemaining: remaining };
    }

    // Check daily quota before creating a new session
    const used = await this.redis.getDailySeconds(userId);
    if (used >= DAILY_QUOTA_SECONDS) throw new ForbiddenException('Daily quota exceeded');

    const session = await this.prisma.quizSession.create({
      data: {
        userId,
        dailyQuotaSecondsRemaining: Math.max(0, DAILY_QUOTA_SECONDS - used),
        state: 'active',
      },
    });
    return { sessionId: session.id, stageUnlocked: session.stageUnlocked, dailyQuotaSecondsRemaining: session.dailyQuotaSecondsRemaining };
  }

  async getStatus(userId: string) {
    const session = await this.prisma.quizSession.findFirst({
      where: { userId, state: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) {
      const used = await this.redis.getDailySeconds(userId);
      return { active: false, dailyQuotaSecondsRemaining: Math.max(0, DAILY_QUOTA_SECONDS - used) };
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

    // Determine current stage for next question
    const stage = await this.decideCurrentStage(session.id, session.stageUnlocked);
    if (!stage) {
      // Completed all stages/questions
      await this.prisma.quizSession.update({ where: { id: session.id }, data: { state: 'completed', endedAt: new Date() } });
      return { done: true, message: 'Session completed' };
    }

    const question = await this.pickRandomQuestion(session.id, stage);
    if (!question) {
      // no available questions left for this stage
      return { done: true, message: 'No more questions available for this stage' };
    }

    // Create Attempt + ephemeral token
    const attempt = await this.prisma.attempt.create({
      data: {
        sessionId: session.id,
        questionId: question.id,
        attemptToken: crypto.randomUUID(),
      },
      select: { id: true, attemptToken: true, startedAt: true },
    });

    // Store token in Redis (30s TTL)
    await this.redis.setAttemptToken(attempt.attemptToken, { userId, attemptId: attempt.id }, 30);

    // Return question without answer
    const body: any = question.body as any;
    const sanitized = { text: body.text, options: body.options };
    return {
      stage,
      question: { id: question.id, body: sanitized, avgTimeToAnswerMs: question.avgTimeToAnswerMs, category: question.category },
      attemptToken: attempt.attemptToken,
      ttlSeconds: 30,
    };
  }

  async submitAttempt(userId: string, dto: SubmitAttemptDto) {
    const session = await this.requireActiveSession(userId);

    // Validate token via Redis
    const tokenData = await this.redis.getAttemptToken(dto.attemptToken);
    if (!tokenData || tokenData.userId !== userId) {
      throw new BadRequestException('Attempt token invalid or expired');
    }

    // Load attempt + question
    const attempt = await this.prisma.attempt.findUnique({ where: { id: tokenData.attemptId } });
    if (!attempt || attempt.sessionId !== session.id) {
      throw new BadRequestException('Attempt not found');
    }
    const question = await this.prisma.question.findUnique({ where: { id: attempt.questionId } });
    if (!question) throw new NotFoundException('Question not found');

    // Compute timeTaken & correctness
    const answeredAt = new Date();
    const timeTakenMs = Math.max(0, answeredAt.getTime() - new Date(attempt.startedAt).getTime());
    const body: any = question.body as any;
    const correct = Number(dto.selectedIndex) === Number(body.correct_index);

    // Points based on stage (derived by category)
    const stage = this.stageFromCategory(question.category);
    const pointsDelta = correct ? STAGE_POINTS[stage] : 0;

    // Update Attempt
    await this.prisma.attempt.update({
      where: { id: attempt.id },
      data: { answeredAt, timeTakenMs, selectedIndex: dto.selectedIndex, correct, pointsDelta },
    });

    await this.bumpLeaderboards(userId, pointsDelta);

    // Update session time & quota
    const seconds = Math.ceil(timeTakenMs / 1000);
    await this.redis.incrDailySeconds(userId, seconds);
    const updated = await this.prisma.quizSession.update({
      where: { id: session.id },
      data: { totalSeconds: { increment: seconds } },
    });

    // Unlock next stage if pass threshold reached
    await this.maybeUnlockNextStage(updated.id, updated.stageUnlocked);

    // Delete token (one-time use)
    await this.redis.delAttemptToken(dto.attemptToken);

    const remaining = await this.remainingQuota(userId, updated);
    const stageState = await this.computeStageState(updated.id);

    // Auto-end on quota exhausted
    if (remaining <= 0) {
      await this.prisma.quizSession.update({ where: { id: updated.id }, data: { state: 'timeout', endedAt: new Date() } });
    }

    return {
      correct,
      pointsDelta,
      timeTakenMs,
      stageState,
      dailyQuotaSecondsRemaining: Math.max(0, remaining),
    };
  }

  async walkAway(userId: string) {
    const session = await this.requireActiveSession(userId);
    await this.prisma.quizSession.update({ where: { id: session.id }, data: { state: 'forfeited', endedAt: new Date() } });
    return { ok: true, state: 'forfeited' };
  }

   async continueWithPenalty(userId: string, reason?: string) {
    const session = await this.requireActiveSession(userId);
    const stage = await this.decideCurrentStage(session.id, session.stageUnlocked) ?? session.stageUnlocked;
    const penalty = -Math.abs(STAGE_PENALTY[stage] ?? 1);

    // Find any question in the stage category to keep FK intact
    const cat = STAGE_CATEGORY[stage];
    const anyQ = await this.prisma.question.findFirst({ where: { category: cat, active: true }, select: { id: true } });
    if (!anyQ) throw new BadRequestException('No question available for penalty attribution');

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
    const session = await this.prisma.quizSession.findFirst({ where: { userId, state: 'active' } });
    if (!session) return { ok: true, state: 'none' };
    await this.prisma.quizSession.update({ where: { id: session.id }, data: { state: 'completed', endedAt: new Date() } });
    return { ok: true, state: 'completed' };
  }

  // ----------------- helpers -----------------

  private async requireActiveSession(userId: string) {
    const session = await this.prisma.quizSession.findFirst({ where: { userId, state: 'active' }, orderBy: { startedAt: 'desc' } });
    if (!session) throw new ForbiddenException('No active session. Start one first.');
    return session;
  }

  private stageFromCategory(category: string): number {
    const c = (category || '').toLowerCase();
    if (c === STAGE_CATEGORY[STAGES.BASIC]) return STAGES.BASIC;
    if (c === STAGE_CATEGORY[STAGES.MID]) return STAGES.MID;
    if (c === STAGE_CATEGORY[STAGES.ADV]) return STAGES.ADV;
    return STAGES.BASIC;
    }

  private async remainingQuota(userId: string, session: { dailyQuotaSecondsRemaining?: number; id: string }) {
    const used = await this.redis.getDailySeconds(userId);
    return Math.max(0, DAILY_QUOTA_SECONDS - used);
  }

  private async decideCurrentStage(sessionId: string, stageUnlocked: number): Promise<number | null> {
    // Determine which stage still has remaining questions
    const state = await this.computeStageState(sessionId);
    // Prefer lowest stage that isn't complete and is <= stageUnlocked
    for (const s of [STAGES.BASIC, STAGES.MID, STAGES.ADV]) {
      const req = STAGE_QUESTIONS_REQUIRED[s];
      const answered = (state.byStage[s]?.answered ?? 0);
      if (s <= stageUnlocked && answered < req) return s;
    }
    // If all answered up to unlocked stages, but next stage unlocked exists, try that
    if (stageUnlocked < STAGES.ADV) {
      const next = stageUnlocked + 1;
      const req = STAGE_QUESTIONS_REQUIRED[next];
      const answered = (state.byStage[next]?.answered ?? 0);
      if (answered < req) return next;
    }
    return null; // done
  }

  private async computeStageState(sessionId: string) {
    const attempts = await this.prisma.attempt.findMany({ where: { sessionId } });
    const byStage: Record<number, { answered: number; correct: number; points: number }> = {
      [STAGES.BASIC]: { answered: 0, correct: 0, points: 0 },
      [STAGES.MID]: { answered: 0, correct: 0, points: 0 },
      [STAGES.ADV]: { answered: 0, correct: 0, points: 0 },
    };
    for (const a of attempts) {
      if (!a.questionId || a.questionId === 'penalty') {
        // count penalty attempt against current unlocked stage points only
        const p = (a.pointsDelta ?? 0);
        // add to latest open stage if needed; to keep logic simple, push to BASIC bucket
        byStage[STAGES.BASIC].points += p;
        continue;
      }
      const q = await this.prisma.question.findUnique({ where: { id: a.questionId } });
      if (!q) continue;
      const s = this.stageFromCategory(q.category);
      if (a.answeredAt) {
        byStage[s].answered += 1;
        if (a.correct) byStage[s].correct += 1;
        byStage[s].points += a.pointsDelta ?? 0;
      }
    }
    return { byStage };
  }

  private async pickRandomQuestion(sessionId: string, stage: number) {
    const cat = STAGE_CATEGORY[stage];
    // get already asked questionIds
    const asked = await this.prisma.attempt.findMany({
      where: { sessionId, questionId: { not: 'penalty' } },
      select: { questionId: true },
    });
    const askedIds = new Set(asked.map(a => a.questionId));

    const pool = await this.prisma.question.findMany({
      where: { active: true, category: cat },
      select: { id: true, body: true, avgTimeToAnswerMs: true, category: true },
      take: 50, // cap
    });
    const candidates = pool.filter(q => !askedIds.has(q.id));
    if (!candidates.length) return null;
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  private async maybeUnlockNextStage(sessionId: string, stageUnlocked: number) {
    if (stageUnlocked >= STAGES.ADV) return;

    // compute current stage pass
    const state = await this.computeStageState(sessionId);
    const currentReq = STAGE_QUESTIONS_REQUIRED[stageUnlocked];
    const currentCorrect = state.byStage[stageUnlocked]?.correct ?? 0;
    const currentAnswered = state.byStage[stageUnlocked]?.answered ?? 0;

    if (currentAnswered >= currentReq && currentCorrect >= STAGE_PASS_THRESHOLD[stageUnlocked]) {
      await this.prisma.quizSession.update({
        where: { id: sessionId },
        data: { stageUnlocked: stageUnlocked + 1 },
      });
    }
  }


  
}