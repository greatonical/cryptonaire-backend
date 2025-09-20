import { Injectable } from "@nestjs/common";
import { PrismaService } from "@infra/prisma.service";
import { RedisService } from "@infra/redis.service";
import { weeklyKey } from "@modules/leaderboard/leaderboard.constants";
import { AdminService } from "@modules/admin/admin.service";

type RewardToken = "USDC" | "ETH";
type AllocationMode = "equal" | "weighted";
type RewardStatus = "ineligible" | "pending" | "processing" | "paid" | "failed";

@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly admin: AdminService, // kept for admin round logic reuse
  ) {}

  // ---- Public summary/history ----
  async getUserWeeklySummary(userId: string) {
    const { weekId, startISO, endISO } = this.getCurrentISOWeekInfo();

    // Find round (open/finalized/processing…)
    const round = await this.prisma.rewardRound.findUnique({ where: { weekId } });

    // Rank & points from Redis weekly leaderboard (if available)
    let rank: number | null = null;
    let points: number | null = null;
    try {
      const key = weeklyKey(weekId);
      const r = await this.redis.raw.zrevrank(key, userId);
      const s = await this.redis.raw.zscore(key, userId);
      rank = r !== null ? Number(r) + 1 : null;
      points = s !== null ? Math.round(Number(s)) : null;
    } catch {
      // ignore redis errors
    }

    // If allocation exists and marked paid/sent -> include payoutRef
    const alloc = await this.prisma.rewardAllocation.findUnique({
      where: { weekId_userId: { weekId, userId } },
    });

    const token: RewardToken = (round?.rewardToken as RewardToken) ?? (process.env.REWARD_TOKEN as RewardToken) ?? "USDC";
    const mode: AllocationMode = (round?.status ? (round as any).allocationMode : process.env.REWARD_ALLOCATION_MODE) as AllocationMode ?? "equal";
    const poolTotal = round?.totalPoolWei ? this.human(round.totalPoolWei, token) : (process.env.REWARD_TOTAL_POOL_WEI ? this.human(process.env.REWARD_TOTAL_POOL_WEI, token) : "0");

    // Status heuristics
    let status: RewardStatus = "ineligible";
    if (round) {
      if (alloc?.payoutState === "sent" || alloc?.payoutState === "claimed") status = "paid";
      else if (alloc?.payoutState === "failed") status = "failed";
      else if (round.status === "finalized") status = "processing";
      else status = "pending";
    }

    // Simple estimate (mirrors frontend expectations)
    let estimate: string | null = null;
    if (round && rank && points !== null) {
      if (mode === "equal") {
        // equal split among top N
        const topN = Number(process.env.REWARD_TOP_N ?? 10);
        estimate = rank <= topN ? this.human((BigInt(round.totalPoolWei) / BigInt(topN)).toString(), token) : null;
      } else {
        // weighted (approximate using current score share)
        const totalScore = await this.redis.raw.zcard(weeklyKey(weekId)); // count, not sum (lightweight)
        // For simplicity, if we don't have total score, fallback to null
        if (totalScore) {
          // NOTE: true weighted needs sum of scores; keeping simple for MVP
          estimate = null;
        }
      }
    }

    const payoutRef = alloc?.txHash
      ? { type: "onchain" as const, txHash: alloc.txHash }
      : null;

    return {
      weekStartISO: startISO,
      weekEndISO: endISO,
      poolToken: token,
      poolTotal,
      allocationMode: mode,
      rank,
      points,
      estimate,
      status,
      payoutRef,
    };
  }

  async getUserPayoutHistory(userId: string, cursor?: string, limit = 20) {
    // cursor is previous weekId; fetch strictly older
    const where: any = { userId };
    if (cursor) where.weekId = { lt: Number(cursor) };

    const rows = await this.prisma.rewardAllocation.findMany({
      where,
      orderBy: { weekId: "desc" },
      take: limit + 1,
    });

    

    const items = await Promise.all(rows.slice(0, limit).map(async (row) => {
      const round = await this.prisma.rewardRound.findUnique({ where: { weekId: row.weekId } });
      const token: RewardToken = (round?.rewardToken as RewardToken) ?? "USDC";
      const { startISO, endISO } = this.isoWeekFromId(row.weekId);
      return {
        weekStartISO: startISO,
        weekEndISO: endISO,
        token,
        amount: this.human(row.amountWei, token),
        status: (row.payoutState === "sent" ? "paid" : (row.payoutState as RewardStatus)) ?? "pending",
        ref: row.txHash ? { type: "onchain" as const, txHash: row.txHash } : undefined,
        createdAt: row.claimedAt?.toISOString(),
      };
    }));

    const nextCursor = rows.length > limit ? String(rows[limit]!.weekId) : null;
    return { items, nextCursor };
  }

  getPolicy() {
    return {
      scheduleCron: process.env.REWARD_WEEKLY_CRON ?? "5 0 * * 1",
      topN: Number(process.env.REWARD_TOP_N ?? 10),
      token: (process.env.REWARD_TOKEN as RewardToken) ?? "USDC",
      notes: "Top players are rewarded weekly. Distribution occurs automatically after the week closes.",
    };
  }

  // ---- Helpers ----
  private human(wei: string, token: RewardToken) {
    const decimals = token === "ETH" ? 18 : 6;
    const s = wei.replace(/^0+/, "") || "0";
    if (s === "0") return "0";
    const pad = decimals - s.length + 1;
    const whole = pad > 0 ? "0" : s.slice(0, s.length - decimals);
    const frac = pad > 0 ? "0".repeat(pad) + s : s.slice(-decimals);
    return `${whole}.${frac}`.replace(/\.?0+$/, "");
  }

  private getCurrentISOWeekInfo() {
    const now = new Date();
    return this.isoWeekFromDate(now);
  }

  private isoWeekFromDate(d: Date) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
    const year = date.getUTCFullYear();
    const weekId = year * 100 + weekNo;

    // compute week range Mon..Mon
    const monday = new Date(date);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
    const nextMon = new Date(monday);
    nextMon.setUTCDate(monday.getUTCDate() + 7);

    return {
      weekId,
      startISO: monday.toISOString().slice(0, 10),
      endISO: nextMon.toISOString().slice(0, 10),
    };
  }

  private isoWeekFromId(weekId: number) {
    const year = Math.floor(weekId / 100);
    const week = weekId % 100;
    // Monday of week:
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dow = simple.getUTCDay();
    const ISOmonday = new Date(simple);
    const diff = (dow <= 4 ? 1 : 8) - dow; // move to Monday
    ISOmonday.setUTCDate(simple.getUTCDate() + diff);
    const nextMon = new Date(ISOmonday);
    nextMon.setUTCDate(ISOmonday.getUTCDate() + 7);
    return {
      startISO: ISOmonday.toISOString().slice(0, 10),
      endISO: nextMon.toISOString().slice(0, 10),
    };
  }
}