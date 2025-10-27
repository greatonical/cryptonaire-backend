// src/modules/auth/farcaster.controller.ts
// Purpose: Farcaster endpoints for Mini App auth
import { Body, Controller, Post } from '@nestjs/common';
import { FarcasterService } from './farcaster.service';

@Controller('auth/farcaster')
export class FarcasterController {
  constructor(private readonly svc: FarcasterService) {}

  /**
   * Normalize/verify a Farcaster Quick Auth payload.
   * Accepts either { token } or the expanded object { fid, custodyAddress, ... }.
   * Returns a normalized profile { fid, custodyAddress, username?, pfpUrl? }.
   */
  @Post('verify')
  async verify(
    @Body()
    dto:
      | { token: string }
      | {
          fid: number;
          username?: string | null;
          custodyAddress?: string | null;
          pfpUrl?: string | null;
          message?: string;
          signature?: `0x${string}`;
          nonce?: string;
        },
  ) {
    return this.svc.verifyQuickAuth('token' in dto ? dto.token : dto);
  }

  /**
   * Full quick-login: verify → upsert user/profile → issue JWT.
   * Accepts { token } or the expanded payload.
   */
  @Post('quick')
  async quick(
    @Body()
    dto:
      | { token: string }
      | {
          fid: number;
          username?: string | null;
          custodyAddress?: string | null;
          pfpUrl?: string | null;
          message?: string;
          signature?: `0x${string}`;
          nonce?: string;
        },
  ) {
    const profile = await this.svc.verifyQuickAuth('token' in dto ? dto.token : dto);
    const res = await this.svc.loginWithQuickAuth(profile);
    return res; // { jwt, userId, walletAddress }
  }
}