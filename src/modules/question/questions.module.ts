import { Module } from "@nestjs/common";
import { QuestionsAdminController } from "./questions.admin.controller";
import { QuestionsService } from "./questions.service";
import { PrismaService } from "@infra/prisma.service";
import { RedisService } from "@infra/redis.service";
import { AdminService } from "@modules/admin/admin.service";

@Module({
  controllers: [QuestionsAdminController],
  providers: [QuestionsService, PrismaService, RedisService, AdminService],
  exports: [QuestionsService],
})
export class QuestionsModule {}