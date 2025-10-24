import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Queue, Worker, QueueEvents, type JobsOptions } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

@Injectable()
export class BullmqService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BullmqService.name);

  private enabled = false;
  private initialized = false;

  connection!: IORedis;
  payoutsQueue!: Queue;
  payoutsWorker!: Worker | undefined;
  payoutsEvents!: QueueEvents | undefined;

  async onModuleInit() {
    this.enabled = (process.env.BULLMQ_ENABLED ?? 'false').toLowerCase() === 'true';

    if (!this.enabled) {
      this.log.warn('BullMQ is DISABLED (BULLMQ_ENABLED!=true). Skipping Redis connections and queue setup.');
      return;
    }

    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL missing for BullMQ');

    const redisOpts: RedisOptions = {
      // BullMQ requires this to be null
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 10_000,
      lazyConnect: false,
    };

    this.connection = new IORedis(url, redisOpts);

    // NOTE: Create the queue only; QueueEvents/Worker are chatty. Add them back only when needed.
    this.payoutsQueue = new Queue('payouts', { connection: this.connection });

    // If/when you re-enable processing later:
    // this.payoutsEvents = new QueueEvents('payouts', { connection: this.connection });
    // this.payoutsWorker = new Worker('payouts', async (job) => { ... }, { connection: this.connection });

    this.initialized = true;
    this.log.log('BullMQ enabled and initialized.');
  }

  async onModuleDestroy() {
    if (!this.initialized) return;
    await Promise.allSettled([
      this.payoutsWorker?.close(),
      this.payoutsEvents?.close(),
      this.payoutsQueue?.close(),
      this.connection?.quit(),
    ]);
  }

  /**
   * Public API: call this instead of touching Queue directly.
   * When BullMQ is disabled, this is a no-op to avoid breaking callers.
   */
  async enqueuePayout(data: unknown, opts?: JobsOptions) {
    if (!this.enabled || !this.initialized) {
      this.log.debug('enqueuePayout() called while BullMQ disabled — no-op.');
      return;
    }
    await this.payoutsQueue.add('payout', data, opts);
  }
}