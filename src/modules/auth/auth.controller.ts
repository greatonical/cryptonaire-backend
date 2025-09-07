import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SiweService } from '@modules/auth/siwe.service';
import { AuthService } from '@modules/auth/auth.service';
import { SiweChallengeDto } from '@modules/auth/dto/siwe-challenge.dto';
import { SiweVerifyDto } from '@modules/auth/dto/siwe-verify.dto';
import { JwtAuthGuard } from '@common/guards/jwt.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly siwe: SiweService, private readonly auth: AuthService) {}

  @Post('siwe/challenge')
  async siweChallenge(@Body() dto: SiweChallengeDto) {
    return this.siwe.createChallenge(dto.walletAddress);
  }

  @Post('siwe/verify')
  async siweVerify(@Body() dto: SiweVerifyDto) {
    const { address } = await this.siwe.verify(dto.message, dto.signature);
    let farcasterUserId: string | undefined;
    try {
      const parsed = JSON.parse(dto.message);
      const res = parsed?.resources?.find?.((r: string) => r.startsWith('farcaster://user/'));
      if (res) farcasterUserId = res.split('/').pop();
    } catch {}
    const user = await this.auth.upsertUserByWallet(address, farcasterUserId);
    const token = await this.auth.issueJwt(user);
    return { token, user: { id: user.id, walletAddress: user.walletAddress, farcasterUserId: user.farcasterUserId } };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: any) {
    return { user };
  }
}