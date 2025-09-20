import { Module } from "@nestjs/common";
import { RewardsController } from "./rewards.controller";
import { RewardsAdminController } from "./rewards.admin.controller";
import { RewardsService } from "./rewards.service";
import { PrismaService } from "@infra/prisma.service";
import { RedisService } from "@infra/redis.service";
import { AdminService } from "@modules/admin/admin.service";
import { PayoutsService } from "@modules/payouts/payouts.service";
import { BullmqService } from "@infra/queues/bullmq.service";

@Module({
  controllers: [RewardsController, RewardsAdminController],
  providers: [
    RewardsService,
    PrismaService,
    RedisService,
    AdminService,      // reuse existing admin logic
    PayoutsService,
    BullmqService,
  ],
  exports: [RewardsService],
})
export class RewardsModule {}