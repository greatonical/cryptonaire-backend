import { Module } from '@nestjs/common';
import { AuthController, MiniKitAuthController } from '@modules/auth/auth.controller';
import { SiweService } from '@modules/auth/siwe.service';
import { AuthService } from '@modules/auth/auth.service';
import { PrismaService } from '@infra/prisma.service';
import { JwtStrategy } from '@infra/security/jwt.strategy';
import { FarcasterController } from './farcaster.controller';
import { FarcasterService } from './farcaster.service';

@Module({
  controllers: [AuthController, MiniKitAuthController, FarcasterController],
  providers: [SiweService, AuthService, FarcasterService,PrismaService, JwtStrategy]
})
export class AuthModule {}