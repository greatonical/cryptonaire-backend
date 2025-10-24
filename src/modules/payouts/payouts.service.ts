import { Injectable, Logger } from '@nestjs/common';
import { BullmqService } from '@infra/queues/bullmq.service';
import { PrismaService } from '@infra/prisma.service';
import type { DispatchWeekJob, PayoutMode, SendAllocationJob } from '@infra/payouts/payout.types';
import { CustodialPayoutProvider } from '@infra/payouts/payout.provider.custodial';
import { OnchainPayoutProvider } from '@infra/payouts/payout.provider.onchain';
import { RedisService } from '@infra/redis.service';
import { weeklyKey, getCurrentWeekId } from '@modules/leaderboard/leaderboard.constants';

const log = new Logger('Payouts');

function getMode(env?: string): PayoutMode {
  const m = (env || process.env.PAYOUT_MODE || 'custodial').toLowerCase();
  return m === 'onchain' ? 'onchain' : 'custodial';
}

function getPrevWeekId(): number {
  const d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  return getCurrentWeekId(d);
}

function allocEqual(totalWei: bigint, winners: { userId: string; walletAddress: string }[]) {
  const n = BigInt(winners.length || 1);
  const share = totalWei / n;
  const arr = winners.map((w) => ({ userId: w.userId, walletAddress: w.walletAddress, amountWei: share.toString() }));
  const used = share * n;
  const rem = totalWei - used;
  if (rem > 0n && arr.length) arr[0]!.amountWei = (BigInt(arr[0]!.amountWei) + rem).toString();
  return arr;
}

function allocWeighted(totalWei: bigint, entries: { userId: string; walletAddress: string; score: number }[]) {
  const sum = entries.reduce((a, e) => a + e.score, 0) || 1;
  let acc = 0n;
  const out = entries.map((e) => {
    const portion = BigInt(Math.floor((e.score / sum) * Number(totalWei)));
    acc += portion;
    return { userId: e.userId, walletAddress: e.walletAddress, amountWei: portion.toString() };
  });
  const rem = totalWei - acc;
  if (rem > 0n && out.length) out[0]!.amountWei = (BigInt(out[0]!.amountWei) + rem).toString();
  return out;
}

@Injectable()
export class PayoutsService {
  private enabled = (process.env.BULLMQ_ENABLED ?? 'false').toLowerCase() === 'true';

  constructor(
    private readonly bull: BullmqService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      log.warn('BullMQ is DISABLED. Payouts will run inline when triggered.');
      return;
    }

    // If BullmqService didn’t create a connection/queue, do not crash.
    if (!this.bull.connection) {
      log.error('BullMQ enabled but no connection found. Disabling queue workers.');
      this.enabled = false;
      return;
    }

    // Dynamically import only when enabled (keeps runtime light when disabled)
    const { Worker } = await import('bullmq');

    this.bull.payoutsWorker = new Worker(
      'payouts',
      async (job) => {
        if (job.name === 'weeklyClose') return this.processWeeklyClose();
        if (job.name === 'dispatchWeek') return this.processDispatchWeek(job.data as DispatchWeekJob);
        if (job.name === 'sendAllocation') return this.processSendAllocation(job.data as SendAllocationJob);
        return null;
      },
      { connection: this.bull.connection, concurrency: 5 },
    );

    // Schedule weekly close (Monday 00:05 UTC by default)
    const cron = process.env.REWARD_WEEKLY_CRON || '5 0 * * 1';
    await this.bull.payoutsQueue?.add(
      'weeklyClose',
      {},
      { repeat: { pattern: cron, tz: 'UTC' }, jobId: 'weeklyClose' },
    );

    log.log('Payouts worker initialized (BullMQ enabled).');
  }

  /**
   * Public: enqueue dispatch OR run inline if BullMQ is disabled.
   */
  async enqueueDispatchWeek(weekId: number, mode?: PayoutMode) {
    if (this.enabled && this.bull.payoutsQueue) {
      await this.bull.payoutsQueue.add(
        'dispatchWeek',
        { weekId, mode },
        { jobId: `dispatch:${weekId}`, removeOnComplete: true, removeOnFail: false },
      );
      return { ok: true, queued: true };
    }

    // Inline execution fallback when queues are disabled
    log.warn('BullMQ disabled — dispatching payouts inline.');
    await this.processDispatchWeek({ weekId, mode });
    return { ok: true, queued: false };
  }

  // ============= Weekly automation =============
  private async processWeeklyClose() {
    const weekId = getPrevWeekId(); // close previous ISO week
    log.log(`Weekly close for weekId=${weekId}`);

    // Ensure round exists or create
    const token = (process.env.REWARD_TOKEN || 'USDC') as 'USDC' | 'ETH';
    const totalPoolWei = process.env.REWARD_TOTAL_POOL_WEI || '0';
    const mode = (process.env.REWARD_ALLOCATION_MODE || 'equal') as 'equal' | 'weighted';
    const topN = Number(process.env.REWARD_TOP_N || 10);

    const round = await this.prisma.rewardRound.upsert({
      where: { weekId },
      update: { rewardToken: token, totalPoolWei },
      create: { weekId, rewardToken: token, totalPoolWei, status: 'open' },
    });

    // Grab top N from Redis
    const arr = await this.redis.raw.zrevrange(weeklyKey(weekId), 0, topN - 1, 'WITHSCORES');
    const entries: { userId: string; score: number }[] = [];
    for (let i = 0; i < arr.length; i += 2) entries.push({ userId: arr[i]!, score: Number(arr[i + 1]!) });

    if (entries.length === 0) {
      log.warn(`No winners for week ${weekId}; skipping allocations`);
      return { ok: true, weekId, winners: 0 };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: entries.map((e) => e.userId) } },
      select: { id: true, walletAddress: true },
    });
    const map = new Map(users.map((u) => [u.id, u.walletAddress]));

    const winners = entries
      .map((e) => ({ userId: e.userId, walletAddress: map.get(e.userId) || '', score: e.score }))
      .filter((w) => w.walletAddress);

    const totalWei = BigInt(totalPoolWei || '0');
    const allocations =
      mode === 'weighted'
        ? allocWeighted(totalWei, winners)
        : allocEqual(totalWei, winners.map((w) => ({ userId: w.userId, walletAddress: w.walletAddress })));

    // Write allocations (idempotent)
    await this.prisma.$transaction(async (tx) => {
      await tx.rewardAllocation.deleteMany({ where: { weekId } });
      for (const a of allocations) {
        await tx.rewardAllocation.create({
          data: {
            weekId,
            userId: a.userId,
            walletAddress: a.walletAddress,
            amountWei: a.amountWei,
            payoutState: 'pending',
          },
        });
      }
    });

    // Dispatch step: queue if enabled, inline otherwise
    if (this.enabled && this.bull.payoutsQueue) {
      await this.bull.payoutsQueue.add(
        'dispatchWeek',
        { weekId },
        { jobId: `dispatch:${weekId}`, removeOnComplete: true, removeOnFail: false },
      );
    } else {
      log.warn('BullMQ disabled — dispatching payouts inline after weekly close.');
      await this.processDispatchWeek({ weekId });
    }

    return { ok: true, weekId, winners: allocations.length, token, mode };
  }

  // ============= Fan-out & send =============
  private async processDispatchWeek(data: DispatchWeekJob) {
    const mode = getMode(data.mode);
    log.log(`Dispatching payouts for week ${data.weekId} in mode=${mode}`);

    const rows = await this.prisma.rewardAllocation.findMany({
      where: { weekId: data.weekId, payoutState: { in: ['pending', 'failed'] } },
      select: { id: true },
    });

    for (const r of rows) {
      if (this.enabled && this.bull.payoutsQueue) {
        await this.bull.payoutsQueue.add(
          'sendAllocation',
          { weekId: data.weekId, allocationId: r.id, mode },
          { jobId: `alloc:${r.id}`, removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      } else {
        // Inline sending fallback
        await this.processSendAllocation({ weekId: data.weekId, allocationId: r.id, mode });
      }
    }
    return { count: rows.length };
  }

  private async processSendAllocation(data: SendAllocationJob) {
    const mode = getMode(data.mode);

    const alloc = await this.prisma.rewardAllocation.findUnique({
      where: { id: data.allocationId },
      include: { round: true },
    });

    if (!alloc) {
      log.warn(`Allocation ${data.allocationId} not found`);
      return;
    }
    if (!['pending', 'failed'].includes(alloc.payoutState)) {
      log.log(`Allocation ${alloc.id} in state ${alloc.payoutState}, skipping`);
      return;
    }

    const token = (alloc.round?.rewardToken || 'USDC') as 'USDC' | 'ETH';
    const to = alloc.walletAddress;
    const amountWei = alloc.amountWei;

    try {
      let idOrHash: string;
      if (mode === 'custodial') {
        const c = new CustodialPayoutProvider();
        idOrHash = await c.sendTransfer(token, to, amountWei);
      } else {
        const o = new OnchainPayoutProvider();
        idOrHash = token === 'ETH' ? await o.sendEth(to, amountWei) : await o.sendUsdc(to, amountWei);
      }

      await this.prisma.rewardAllocation.update({
        where: { id: alloc.id },
        data: { payoutState: 'sent', txHash: idOrHash },
      });
      return { id: alloc.id, ref: idOrHash, mode, token };
    } catch (e: any) {
      await this.prisma.rewardAllocation.update({
        where: { id: alloc.id },
        data: { payoutState: 'failed' },
      });
      log.error(`Payout failed for ${alloc.id}: ${e?.message || e}`);
      throw e;
    }
  }
}