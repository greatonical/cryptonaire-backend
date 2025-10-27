// src/modules/auth/farcaster.service.ts
// Purpose: Verify Farcaster Quick Auth tokens, allow-list audiences, upsert user, issue app JWT

import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { createClient, Errors } from '@farcaster/quick-auth';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class FarcasterService {
  private readonly log = new Logger('FarcasterService');
  private readonly quick = createClient();

  constructor(private readonly prisma: PrismaService) {}

  /** Issue your normal app JWT (adapt to your JWT strategy if needed) */
  private signAppJwt(userId: string) {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    return jwt.sign({ sub: userId, uid: userId }, secret, { expiresIn: '30d' });
  }

  // -------- audience helpers --------

  /** Base64url decode */
  private b64urlDecode(s: string): string {
    const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
  }

  /** Extract `aud` (host) from JWT payload without verifying */
  private decodeAudHost(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(this.b64urlDecode(parts[1]!));
      const aud: unknown = payload?.aud;
      if (!aud || typeof aud !== 'string') return null;
      return this.normalizeHost(aud);
    } catch {
      return null;
    }
  }

  private normalizeHost(h: string): string {
    const raw = h.trim().toLowerCase();
    // strip scheme if someone passed it
    const noScheme = raw.replace(/^https?:\/\//, '');
    // strip port
    return noScheme.replace(/:\d+$/, '');
  }

  private getAllowedHosts(): string[] {
    const raw = process.env.FARCASTER_ALLOWED_HOSTS || '';
    return raw
      .split(',')
      .map((s) => this.normalizeHost(s))
      .filter(Boolean);
  }

  private getAllowedSuffixes(): string[] {
    const raw = process.env.FARCASTER_ALLOWED_SUFFIXES || '';
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  private isHostAllowed(audHost: string): boolean {
    const hosts = this.getAllowedHosts();
    const suffixes = this.getAllowedSuffixes();
    if (hosts.length && hosts.includes(audHost)) return true;
    if (suffixes.length && suffixes.some((suf) => audHost.endsWith(suf))) return true;
    // If no allow-list configured, default deny in prod, allow in dev
    if (!hosts.length && !suffixes.length) {
      const dev = (process.env.NODE_ENV || 'development') !== 'production';
      return dev;
    }
    return false;
  }

  // -------- public API --------

  /**
   * Verify the Quick Auth JWT and return a minimal profile { fid }.
   * `requestHost` is optional; we rely primarily on the token's `aud` host.
   */
  async verifyQuickAuthToken(token: string, requestHost?: string) {
    try {
      const audHost = this.decodeAudHost(token);
      if (!audHost) {
        this.log.error('QuickAuth token verify failed: missing/invalid aud');
        throw new UnauthorizedException('Invalid Farcaster token');
      }

      if (!this.isHostAllowed(audHost)) {
        this.log.error(`QuickAuth token verify failed: aud "${audHost}" not allowed`);
        throw new UnauthorizedException('Invalid Farcaster audience');
      }

      // If FARCASTER_DOMAIN is set, pin to it (prod). Otherwise verify against audHost (preview/dev).
      const verifyDomain =
        (process.env.FARCASTER_DOMAIN && this.normalizeHost(process.env.FARCASTER_DOMAIN)) ||
        audHost;

      // This checks signature and standard claims (aud, exp, etc.)
      const payload = await this.quick.verifyJwt({ token, domain: verifyDomain });

      const fid = Number(payload.sub);
      if (!Number.isFinite(fid)) throw new Error('Invalid FID in token');

      return { fid };
    } catch (e: any) {
      if (e instanceof Errors.InvalidTokenError) {
        this.log.error(`QuickAuth token verify failed: ${e.message}`);
        throw new BadRequestException('Invalid Farcaster token');
      }
      if (e instanceof UnauthorizedException) throw e;
      this.log.error('QuickAuth verify error', e);
      throw new BadRequestException('Could not verify Farcaster token');
    }
  }

  /** Verify → upsert user → issue app JWT */
  async loginWithQuickAuthToken(token: string, requestHost?: string) {
    const { fid } = await this.verifyQuickAuthToken(token, requestHost);

    // Upsert by farcasterUserId (FID stored as string)
    const user = await this.prisma.user.upsert({
      where: { farcasterUserId: String(fid) },
      update: {}, // optionally refresh profile fields if you fetch them from Neynar/etc.
      create: { farcasterUserId: String(fid) },
      select: { id: true, walletAddress: true, farcasterUserId: true },
    });

    const jwtToken = this.signAppJwt(user.id);
    return {
      jwt: jwtToken,
      userId: user.id,
      walletAddress: user.walletAddress ?? undefined,
    };
  }
}