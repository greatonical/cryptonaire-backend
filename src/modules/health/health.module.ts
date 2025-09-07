import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { BullmqService } from '@infra/queues/bullmq.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService, BullmqService],
})
export class HealthModule {}