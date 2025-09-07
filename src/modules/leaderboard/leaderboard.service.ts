import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { ALL_TIME_KEY, getCurrentWeekId, weeklyKey } from '@modules/leaderboard/leaderboard.constants';

type ZItem = { member: string; score: number };

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  // ----- writers (used by Game) -----
  async addScore(userId: string, delta: number) {
    if (!delta) return;
    const r = this.redis.raw;
    const wk = getCurrentWeekId();
    await r.zincrby(weeklyKey(wk), delta, userId);
    await r.zincrby(ALL_TIME_KEY, delta, userId);
  }

  // ----- readers -----
  async getWeeklyTop(params: { cursor?: number; limit?: number; weekId?: number }) {
    const weekId = params.weekId ?? getCurrentWeekId();
    const key = weeklyKey(weekId);
    return this.readTop(key, params.cursor ?? 0, params.limit ?? 20, weekId);
  }

  async getAllTimeTop(params: { cursor?: number; limit?: number }) {
    return this.readTop(ALL_TIME_KEY, params.cursor ?? 0, params.limit ?? 20);
  }

  async getMyRanks(userId: string, weekId?: number) {
    const r = this.redis.raw;
    const wk = weekId ?? getCurrentWeekId();

    const [wRank, wScore, aRank, aScore] = await Promise.all([
      r.zrevrank(weeklyKey(wk), userId),
      r.zscore(weeklyKey(wk), userId),
      r.zrevrank(ALL_TIME_KEY, userId),
      r.zscore(ALL_TIME_KEY, userId),
    ]);

    return {
      weekly: wRank === null ? null : { rank: wRank + 1, score: Number(wScore ?? 0), weekId: wk },
      allTime: aRank === null ? null : { rank: aRank + 1, score: Number(aScore ?? 0) },
    };
  }

  // ----- internals -----
  private async readTop(key: string, cursor: number, limit: number, weekId?: number) {
    const r = this.redis.raw;

    // FETCH scores + total count
    const [arr, total] = await Promise.all([
      r.zrevrange(key, cursor, cursor + limit - 1, 'WITHSCORES'),
      r.zcard(key),
    ]);

    const entries: ZItem[] = [];
    for (let i = 0; i < arr.length; i += 2) {
      entries.push({ member: arr[i]!, score: Number(arr[i + 1]!) });
    }

    // Batch fetch user info
    const ids = entries.map((e) => e.member);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, walletAddress: true, profile: { select: { username: true, avatarUrl: true, country: true } } },
    });
    const map = new Map(users.map((u) => [u.id, u]));

    // Format with ranks
    const items = entries.map((e, idx) => {
      const rank = cursor + idx + 1;
      const u = map.get(e.member);
      return {
        rank,
        userId: e.member,
        score: e.score,
        walletAddress: u?.walletAddress ?? null,
        username: u?.profile?.username ?? null,
        avatarUrl: u?.profile?.avatarUrl ?? null,
        country: u?.profile?.country ?? null,
      };
    });

    const nextCursor = cursor + items.length < total ? cursor + items.length : null;

    return { weekId, total, cursor, limit, items, nextCursor };
  }
}