import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { weeklyKey } from '@modules/leaderboard/leaderboard.constants';
import { AllocationItemDto } from './dto/rewards.dto';
import { createAIProvider } from '@infra/ai/ai.factory';
import type { AIProviderName } from '@infra/ai/ai.types';
import { canonicalizeQuestion, sha256 } from '@common/utils/hash.util';


@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  // ---------- Users ----------
  async listUsers(q?: string, status?: string, role?: string, cursor?: string, limit = 50) {
    const where: any = {};
    if (q) where.OR = [
      { walletAddress: { contains: q, mode: 'insensitive' } },
      { profile: { username: { contains: q, mode: 'insensitive' } } }
    ];
    if (status) where.status = status;
    if (role) where.role = role;

    const users = await this.prisma.user.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { profile: true }
    });

    const nextCursor = users.length > limit ? users[limit]!.id : null;
    if (nextCursor) users.pop();

    return { items: users, nextCursor };
  }

  async setUserStatus(userId: string, status: 'active'|'suspended'|'blocked') {
    const u = await this.prisma.user.update({ where: { id: userId }, data: { status, jwtVersion: { increment: 1 } } });
    return { ok: true, user: { id: u.id, status: u.status } };
  }

  async setUserVerified(userId: string, verified: boolean) {
    const u = await this.prisma.user.update({ where: { id: userId }, data: { verified } });
    return { ok: true, user: { id: u.id, verified: u.verified } };
  }

  async setUserRole(userId: string, role: 'user'|'admin') {
    const u = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    return { ok: true, user: { id: u.id, role: u.role } };
  }

  // ---------- Questions ----------
  async createQuestion(data: {
    category: string; difficulty: number; avgTimeToAnswerMs: number;
    body: any; source: 'human'|'ai'; active?: boolean;
  }) {
    return this.prisma.question.create({ data: { ...data, active: data.active ?? true } });
  }

  async updateQuestion(id: string, data: Partial<{ category: string; difficulty: number; avgTimeToAnswerMs: number; body: any; active: boolean; }>) {
    return this.prisma.question.update({ where: { id }, data });
  }

  async setQuestionActive(id: string, active: boolean) {
    return this.prisma.question.update({ where: { id }, data: { active } });
  }

  // AI generation (stub hooks)
  async generateStubQuestions(provider: 'gemini'|'groq', prompt: string, count: number, category: string, difficulty: number) {
    // TODO: Implement actual calls. For now, return a shaped stub.
    // Example design:
    //  if (provider==='gemini') { const {questions}= await callGemini(prompt, count); ... }
    //  else { const {questions}= await callGroq(prompt, count); ... }
    const generated = Array.from({ length: count }).map((_, i) => ({
      category, difficulty, avgTimeToAnswerMs: 25000,
      body: {
        text: `[AI] ${prompt} Q${i+1}?`,
        options: ['A','B','C','D'],
        correct_index: 0
      },
      source: 'ai' as const,
      active: true
    }));
    const created = await this.prisma.$transaction(
      generated.map(g => this.prisma.question.create({ data: g }))
    );
    return { created: created.length };
  }


async generateQuestions(provider: 'gemini'|'groq', prompt: string, count: number, category: string, difficulty: number) {
  // try chosen provider first, optional fallback to the other
  const primary = provider as AIProviderName;
  const fallback = (primary === 'gemini' ? 'groq' : 'gemini') as AIProviderName;

  let items;
  try {
    items = await createAIProvider(primary).generate({ prompt, count, category: category as any, difficulty: difficulty as any });
  } catch (e) {
    // fallback once
    items = await createAIProvider(fallback).generate({ prompt, count, category: category as any, difficulty: difficulty as any });
  }

  // compute uniqueHash, set active=false for review
  const withHash = items.map(i => {
    const canon = canonicalizeQuestion(i.body.text, i.body.options as any);
    const uniqueHash = sha256(canon);
    return { ...i, uniqueHash, active: false }; // require admin activation
  });

  // upsert only new ones (uniqueHash unique constraint)
  const created = [];
  for (const q of withHash) {
    try {
      const row = await this.prisma.question.create({ data: q });
      created.push(row.id);
    } catch {
      // duplicate: skip
    }
  }
  return { created: created.length, pendingReview: created.length };
}

  // ---------- Rewards / payouts ----------
  async openRewardRound(weekId: number, token: 'USDC'|'ETH', totalPoolWei: string) {
    const exists = await this.prisma.rewardRound.findUnique({ where: { weekId } });
    if (exists) throw new BadRequestException('Reward round already exists');
    await this.prisma.rewardRound.create({ data: { weekId, rewardToken: token, totalPoolWei, status: 'open' } });
    return { ok: true };
  }

  async previewWinners(weekId: number, top: number, mode: 'equal'|'weighted') {
    const r = this.redis.raw;
    const key = weeklyKey(weekId);
    const arr = await r.zrevrange(key, 0, top - 1, 'WITHSCORES');
    const entries: { userId: string; score: number }[] = [];
    for (let i = 0; i < arr.length; i += 2) entries.push({ userId: arr[i]!, score: Number(arr[i+1]!) });

    const users = await this.prisma.user.findMany({ where: { id: { in: entries.map(e=>e.userId) } }, select: { id: true, walletAddress: true } });

    return entries.map(e => ({
      userId: e.userId,
      walletAddress: users.find(u => u.id === e.userId)?.walletAddress ?? '',
      score: e.score
    }));
  }

  allocateEqual(totalWei: bigint, winners: { userId: string; walletAddress: string }[]): AllocationItemDto[] {
    const n = BigInt(winners.length || 1);
    const share = totalWei / n;
    return winners.map(w => ({ userId: w.userId, walletAddress: w.walletAddress, amountWei: share.toString() }));
  }

  allocateWeighted(totalWei: bigint, entries: { userId: string; walletAddress: string; score: number }[]): AllocationItemDto[] {
    const sum = entries.reduce((a, e) => a + e.score, 0) || 1;
    let acc = BigInt(0);
    const out = entries.map((e, i) => {
      const portion = BigInt(Math.floor((e.score / sum) * Number(totalWei)));
      acc += portion;
      return { userId: e.userId, walletAddress: e.walletAddress, amountWei: portion.toString() };
    });
    // distribute remainder to top-1 to keep sum exact
    const remainder = totalWei - acc;
    if (remainder > 0n && out.length > 0) {
      out[0]!.amountWei = (BigInt(out[0]!.amountWei) + remainder).toString();
    }
    return out;
  }

  async createAllocations(weekId: number, allocations: AllocationItemDto[]) {
    const round = await this.prisma.rewardRound.findUnique({ where: { weekId } });
    if (!round) throw new NotFoundException('Round not found');
    if (round.status !== 'open') throw new BadRequestException('Round is not open');

    await this.prisma.$transaction(async (tx) => {
      // wipe previous allocations for idempotency
      await tx.rewardAllocation.deleteMany({ where: { weekId } });
      for (const a of allocations) {
        await tx.rewardAllocation.create({
          data: { weekId, userId: a.userId, walletAddress: a.walletAddress, amountWei: a.amountWei, payoutState: 'pending' }
        });
      }
    });

    return { ok: true, count: allocations.length };
  }

  async listAllocations(weekId: number) {
    const rows = await this.prisma.rewardAllocation.findMany({ where: { weekId }, orderBy: { amountWei: 'desc' } });
    return { weekId, items: rows };
  }

  async finalizeRound(weekId: number, merkleRoot: string) {
    const round = await this.prisma.rewardRound.update({
      where: { weekId }, data: { merkleRoot, status: 'finalized' }
    });
    return { ok: true, round };
  }

  async markPayout(weekId: number, userId: string, payoutState: 'pending'|'claimed'|'sent'|'failed', txHash?: string) {
    const row = await this.prisma.rewardAllocation.update({
      where: { weekId_userId: { weekId, userId } },
      data: { payoutState, txHash: txHash ?? undefined, claimedAt: payoutState === 'claimed' ? new Date() : undefined }
    });
    return { ok: true, item: row };
  }

  // ---------- Reports / Exports ----------
  async engagementReport(fromISO?: string, toISO?: string) {
    const from = fromISO ? new Date(fromISO) : new Date(Date.now() - 7*24*3600*1000);
    const to   = toISO   ? new Date(toISO)   : new Date();

    const [usersTotal, usersVerified, sessions, attempts] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { verified: true } }),
      this.prisma.quizSession.findMany({ where: { startedAt: { gte: from, lte: to } } }),
      this.prisma.attempt.findMany({ where: { startedAt: { gte: from, lte: to } } }),
    ]);

    const uniqueUsers = new Set(sessions.map(s => s.userId));
    const avgSessionSec = sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.totalSeconds || 0), 0) / sessions.length) : 0;
    const correctCount = attempts.filter(a => a.correct).length;
    const correctRate = attempts.length ? Number((correctCount / attempts.length) * 100).toFixed(2) : '0.00';

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      usersTotal,
      usersVerified,
      activeUsers: uniqueUsers.size,
      sessions: sessions.length,
      avgSessionSec,
      attempts: attempts.length,
      correctRatePct: correctRate
    };
  }

  toCsv(objArray: Record<string, any>[], header?: string[]): string {
    if (!objArray.length) return '';
    const cols = header ?? Object.keys(objArray[0]!);
    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const row of objArray) {
      lines.push(cols.map(c => escape(row[c])).join(','));
    }
    return lines.join('\n');
  }

  
}