import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { BullmqService } from '@infra/queues/bullmq.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly bull: BullmqService
  ) {}

  @Get()
  async basic() {
    return { ok: true, ts: new Date().toISOString() };
  }

  @Get('live')
  live() {
    // liveness = process is up
    return { status: 'live' };
  }

  @Get('ready')
  async ready() {
    // readiness = critical deps okay
    const out: any = { db: false, redis: false, queue: false };

    // DB
    try {
      await this.prisma.$queryRaw`select 1`;
      out.db = true;
    } catch {}

    // Redis
    try {
      const pong = await this.redis.raw.ping();
      out.redis = pong?.toUpperCase() === 'PONG';
    } catch {}

    // Queue
    try {
      out.queue = !!this.bull.payoutsQueue;
    } catch {}

    out.ok = out.db && out.redis && out.queue;
    return out;
  }
}