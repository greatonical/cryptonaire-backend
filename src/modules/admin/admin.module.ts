import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '@infra/prisma.service';
import { RedisService } from '@infra/redis.service';
import { PayoutsModule } from '@modules/payouts/payouts.module';

@Module({
  imports: [PayoutsModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, RedisService],
})
export class AdminModule {}