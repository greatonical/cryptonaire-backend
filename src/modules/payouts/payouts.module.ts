import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { BullmqService } from '@infra/queues/bullmq.service';

@Module({
  providers: [PayoutsService, PrismaService, RedisService, BullmqService],
  exports: [PayoutsService, BullmqService],
})
export class PayoutsModule {}