import { Module } from "@nestjs/common";
import { GameController } from "@modules/game/game.controller";
import { GameService } from "@modules/game/game.service";
import { PrismaService } from "@infra/prisma.service";
import { RedisService } from "@infra/redis.service";
import { QuestionsService } from "../question/questions.service";
import { AdminService } from "../admin/admin.service";

@Module({
  controllers: [GameController],
  providers: [
    GameService,
    PrismaService,
    RedisService,
    QuestionsService,
    AdminService,
  ],
})
export class GameModule {}
