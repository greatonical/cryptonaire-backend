import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { HealthModule } from '@modules/health/health.module';
import { AuthModule } from '@modules/auth/auth.module';
import { GameModule } from '@modules/game/game.module';
import { LeaderboardModule } from '@modules/leaderboard/leaderboard.module';
import { AdminModule } from '@modules/admin/admin.module';
import { PayoutsModule } from '@modules/payouts/payouts.module';
import { PrismaService } from '@infra/prisma.service';
import { ProfileModule } from './modules/profile/profile.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { QuestionsModule } from './modules/question/questions.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        autoLogging: true,
        quietReqLogger: false,
        serializers: { req(req) { return { id: req.id, method: req.method, url: req.url }; } },
      },
    }),
    ThrottlerModule.forRoot([{
      ttl: 60, // seconds
      limit: 300, // global: 300 req/min default
    }]),
    HealthModule,
    AuthModule,
    GameModule,
    LeaderboardModule,
    AdminModule,
    PayoutsModule,
    ProfileModule,
    RewardsModule,
    QuestionsModule
  ],
  providers: [
    PrismaService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}