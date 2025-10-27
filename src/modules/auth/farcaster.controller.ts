// src/modules/auth/farcaster.controller.ts
// Purpose: Farcaster endpoints for Mini App Quick Auth (verify + quick login)

import { Body, Controller, Post, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { FarcasterService } from './farcaster.service';

@Controller('auth/farcaster')
export class FarcasterController {
  constructor(private readonly svc: FarcasterService) {}

  private getRequestHost(req: Request): string | undefined {
    // Prefer reverse-proxy forwarded host, then Host, then req.hostname
    const xf = (req.headers['x-forwarded-host'] as string) || '';
    const host = (req.headers['host'] as string) || '';
    const h = (xf || host || req.hostname || '').trim();
    return h || undefined;
  }

  /** Verify Quick Auth JWT and return normalized profile */
  @Post('verify')
  async verify(@Req() req: Request, @Body() body: { token?: string }) {
    const token = body?.token;
    if (!token) throw new BadRequestException('token is required');

    const requestHost =
      process.env.PUBLIC_HOSTNAME ||
      this.getRequestHost(req);

    // Service chooses final verify domain from token.aud (allowed-list) unless FARCASTER_DOMAIN is set.
    return this.svc.verifyQuickAuthToken(token, requestHost);
  }

  /** Full login: verify → upsert user → return app JWT */
  @Post('quick')
  async quick(@Req() req: Request, @Body() body: { token?: string }) {
    const token = body?.token;
    if (!token) throw new BadRequestException('token is required');

    const requestHost =
      process.env.PUBLIC_HOSTNAME ||
      this.getRequestHost(req);

    return this.svc.loginWithQuickAuthToken(token, requestHost); // { jwt, userId, walletAddress? }
  }
}