import { Module } from '@nestjs/common';
import { LeaderboardController } from '@modules/leaderboard/leaderboard.controller';
import { LeaderboardService } from '@modules/leaderboard/leaderboard.service';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';

@Module({
  controllers: [LeaderboardController],
  providers: [LeaderboardService, PrismaService, RedisService],
  exports: [LeaderboardService]
})
export class LeaderboardModule {}