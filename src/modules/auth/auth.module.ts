import { Module } from '@nestjs/common';
import { AuthController } from '@modules/auth/auth.controller';
import { SiweService } from '@modules/auth/siwe.service';
import { AuthService } from '@modules/auth/auth.service';
import { PrismaService } from '@infra/prisma.service';
import { JwtStrategy } from '@infra/security/jwt.strategy';

@Module({
  controllers: [AuthController],
  providers: [SiweService, AuthService, PrismaService, JwtStrategy]
})
export class AuthModule {}