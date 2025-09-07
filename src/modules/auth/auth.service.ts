import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

function readPrivateKey() {
  const key = process.env.JWT_PRIVATE_KEY;
  if (!key) throw new Error('JWT_PRIVATE_KEY missing');
  return key.replace(/\\n/g, '\n');
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertUserByWallet(address: string, farcasterUserId?: string) {
    const walletAddress = address.toLowerCase();
    const user = await this.prisma.user.upsert({
      where: { walletAddress },
      update: { farcasterUserId: farcasterUserId ?? undefined },
      create: { walletAddress, farcasterUserId: farcasterUserId ?? null }
    });
    if (!await this.prisma.profile.findUnique({ where: { userId: user.id } })) {
      await this.prisma.profile.create({ data: { userId: user.id } });
    }
    return user;
  }

  async issueJwt(user: { id: string; walletAddress: string; farcasterUserId?: string | null; jwtVersion: number }) {
    const { SignJWT, importPKCS8 } = await import('jose'); // ESM-only

    const privateKeyPem = readPrivateKey();
    const alg = 'RS256';
    const key = await importPKCS8(privateKeyPem, alg);
    const now = Math.floor(Date.now() / 1000);
    const ttl = Number(process.env.JWT_TTL_MINUTES || 20) * 60;
    const payload = {
      sub: user.walletAddress,
      uid: user.id,
      fc_id: user.farcasterUserId ?? undefined,
      jwt_version: user.jwtVersion,
      iat: now
    };
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg })
      .setIssuer(process.env.JWT_ISSUER || 'https://cryptonaire.app')
      .setAudience(process.env.JWT_AUDIENCE || 'cryptonaire')
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .sign(key);

    return token;
  }
}