// src/modules/auth/farcaster.service.ts
// Purpose: Verify Farcaster Quick Auth tokens with host allow-list, upsert user,
// and issue app JWT via AuthService (keeps AuthService signature unchanged).

import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { createClient, Errors } from '@farcaster/quick-auth';
import { AuthService } from '@modules/auth/auth.service';

@Injectable()
export class FarcasterService {
  private readonly log = new Logger('FarcasterService');
  private readonly quick = createClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService, // use standard JWT issuer
  ) {}

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
    const noScheme = raw.replace(/^https?:\/\//, '');
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
    // If no allow-list configured, default allow in dev, deny in prod
    if (!hosts.length && !suffixes.length) {
      const dev = (process.env.NODE_ENV || 'development') !== 'production';
      return dev;
    }
    return false;
  }

  // -------- public API --------

  /**
   * Verify the Quick Auth JWT and return { fid }.
   * `requestHost` can be provided by the controller, but we primarily trust token.aud.
   */
  async verifyQuickAuthToken(token: string, _requestHost?: string) {
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

      // If FARCASTER_DOMAIN is set (prod), pin to it; otherwise verify against audHost (preview/dev).
      const verifyDomain =
        (process.env.FARCASTER_DOMAIN && this.normalizeHost(process.env.FARCASTER_DOMAIN)) ||
        audHost;

      // Signature + claims verification
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

  /** Verify → upsert user → issue app JWT via AuthService */
  async loginWithQuickAuthToken(token: string, requestHost?: string) {
    const { fid } = await this.verifyQuickAuthToken(token, requestHost);

    // Upsert by farcasterUserId (FID stored as string)
    const user = await this.prisma.user.upsert({
      where: { farcasterUserId: String(fid) },
      update: {},
      create: { farcasterUserId: String(fid) },
      // Select the shape AuthService.issueJwt expects (plus jwtVersion)
      select: { id: true, walletAddress: true, farcasterUserId: true, jwtVersion: true },
    });

    // Build the payload exactly as AuthService.issueJwt currently requires
    const jwt = await this.auth.issueJwt({
      id: user.id,
      jwtVersion: user.jwtVersion,
      // If no wallet yet, provide a safe placeholder string to satisfy the type.
      // If you prefer "", use that instead — whichever your JwtStrategy tolerates.
      walletAddress: user.walletAddress ?? '0x0000000000000000000000000000000000000000',
      farcasterUserId: user.farcasterUserId ?? null,
    });

    return { jwt, userId: user.id, walletAddress: user.walletAddress ?? undefined };
  }
}