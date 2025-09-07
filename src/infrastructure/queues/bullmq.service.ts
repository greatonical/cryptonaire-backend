import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

@Injectable()
export class BullmqService implements OnModuleInit, OnModuleDestroy {
  connection!: IORedis;
  payoutsQueue!: Queue;
  payoutsWorker!: Worker;
  payoutsEvents!: QueueEvents;

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL missing for BullMQ');

    const redisOpts: RedisOptions = {
      maxRetriesPerRequest: null,   // <-- required by BullMQ
      enableReadyCheck: true,
      // optional niceties:
      connectTimeout: 10000,
      lazyConnect: false,
    };

    // Upstash uses "rediss://"; TLS is handled automatically by ioredis
    this.connection = new IORedis(url, redisOpts);

    this.payoutsQueue = new Queue('payouts', { connection: this.connection });
    this.payoutsEvents = new QueueEvents('payouts', { connection: this.connection });
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.payoutsWorker?.close(),
      this.payoutsEvents?.close(),
      this.payoutsQueue?.close(),
      this.connection?.quit(),
    ]);
  }
}