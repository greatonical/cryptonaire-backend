// src/modules/auth/farcaster.service.ts
// Purpose: Farcaster Mini App auth helpers (verify -> upsert -> JWT)
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';
import { JwtService } from '@nestjs/jwt';

type QuickAuthProfile = {
  fid: number;
  custodyAddress: string;
  username?: string | null;
  pfpUrl?: string | null;
};

@Injectable()
export class FarcasterService {
  protected readonly log = new Logger(FarcasterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify a Quick Auth token (e.g., Neynar) and return normalized profile.
   * Replace the stub with the official SDK call as needed.
   */
  async verifyQuickAuthToken(token: string): Promise<QuickAuthProfile> {
    try {
      // TODO: Replace with real verification via Neynar/Hubs:
      // const client = new NeynarClient(process.env.NEYNAR_API_KEY!);
      // const p = await client.verifyQuickAuthToken(token);
      // return { fid: p.fid, custodyAddress: p.custody_address, username: p.username, pfpUrl: p.pfp_url };

      // Stub: expect a JSON string for local dev
      const p = JSON.parse(token);
      if (!p?.fid || !p?.custodyAddress) throw new Error('Invalid token payload');
      return {
        fid: Number(p.fid),
        custodyAddress: String(p.custodyAddress),
        username: p.username ?? null,
        pfpUrl: p.pfpUrl ?? null,
      };
    } catch (e: any) {
      this.log.error(`QuickAuth token verify failed: ${e?.message ?? e}`);
      throw new BadRequestException('Invalid Farcaster token');
    }
  }

  /**
   * Accepts either a string token or expanded object (with optional EVM signature).
   * Best-effort signature verification (if provided), otherwise just normalizes.
   */
  async verifyQuickAuth(
    dtoOrToken:
      | string
      | {
          fid: number;
          custodyAddress?: string | null;
          username?: string | null;
          pfpUrl?: string | null;
          message?: string;
          signature?: `0x${string}`;
          nonce?: string;
        },
  ): Promise<QuickAuthProfile> {
    if (typeof dtoOrToken === 'string') {
      return this.verifyQuickAuthToken(dtoOrToken);
    }

    const { fid, custodyAddress, username, pfpUrl, message, signature } = dtoOrToken;
    if (!fid || !custodyAddress) {
      throw new BadRequestException('Missing fid or custodyAddress');
    }

    // OPTIONAL: EVM signature check if provided (skipped if viem missing)
    if (message && signature) {
      try {
        const { verifyMessage, isAddress } = await import('viem');
        if (!isAddress(custodyAddress)) throw new Error('Invalid address');
        const ok = await verifyMessage({
          address: custodyAddress as `0x${string}`,
          message,
          signature,
        });
        if (!ok) throw new Error('Invalid signature');
      } catch (e) {
        this.log.warn(`Signature verify skipped/failed: ${(e as any)?.message ?? e}`);
      }
    }

    return {
      fid: Number(fid),
      custodyAddress: String(custodyAddress),
      username: username ?? null,
      pfpUrl: pfpUrl ?? null,
    };
  }

  /**
   * Upsert user linking farcasterUserId and wallet address; syncs Profile.
   */
  async upsertFromFarcaster(dto: QuickAuthProfile) {
    const fidStr = String(dto.fid);
    const addr = dto.custodyAddress.toLowerCase();

    const user = await this.prisma.user.upsert({
      where: { farcasterUserId: fidStr },
      update: { walletAddress: addr },
      create: { walletAddress: addr, farcasterUserId: fidStr },
      select: { id: true, walletAddress: true, jwtVersion: true, role: true },
    });

    await this.prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        username: dto.username ?? undefined,
        avatarUrl: dto.pfpUrl ?? undefined,
      },
      create: {
        userId: user.id,
        username: dto.username ?? null,
        avatarUrl: dto.pfpUrl ?? null,
      },
    });

    return user;
  }

  async issueJwt(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, jwtVersion: true, role: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const payload = { sub: user.id, v: user.jwtVersion, role: user.role };
    return this.jwt.signAsync(payload);
    // Configure JwtModule in your AuthModule:
    // JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' } })
  }

  async loginWithQuickAuth(profile: QuickAuthProfile) {
    const user = await this.upsertFromFarcaster(profile);
    const jwt = await this.issueJwt(user.id);
    return { jwt, userId: user.id, walletAddress: user.walletAddress };
  }
}