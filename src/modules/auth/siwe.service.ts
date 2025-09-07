import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

@Injectable()
export class SiweService {
  constructor(private readonly prisma: PrismaService) {}

  async createChallenge(walletAddress: string) {
    const { generateNonce } = await import('siwe'); // ESM-only

    const nonce = generateNonce();
    await this.prisma.siweNonce.create({
      data: { nonce, walletAddress }
    });
    const domain = process.env.SIWE_DOMAIN || 'cryptonaire.app';
    const uri = process.env.SIWE_URI || 'https://cryptonaire.app';
    const chainId = Number(process.env.BASE_CHAIN_ID || 8453);
    const statement = 'Sign in to Cryptonaire';
    return { nonce, domain, uri, chainId, statement };
  }

  async verify(message: string, signature: string) {
    const { SiweMessage } = await import('siwe'); // ESM-only
    const msg = new SiweMessage(message);
    const result = await msg.verify({ signature });
    if (!result.success) {
      throw new BadRequestException('Invalid SIWE signature');
    }
    const expectedDomain = process.env.SIWE_DOMAIN || 'cryptonaire.app';
    const expectedChain = Number(process.env.BASE_CHAIN_ID || 8453);
    if (msg.domain !== expectedDomain) {
      throw new BadRequestException('Invalid domain');
    }
    if (Number(msg.chainId) !== expectedChain) {
      throw new BadRequestException('Invalid chainId');
    }
    const found = await this.prisma.siweNonce.findUnique({ where: { nonce: msg.nonce } });
    if (!found || found.used) {
      throw new BadRequestException('Nonce invalid or used');
    }
    if (found.walletAddress.toLowerCase() != msg.address.toLowerCase()) {
      throw new BadRequestException('Nonce not bound to this wallet');
    }
    await this.prisma.siweNonce.update({ where: { nonce: msg.nonce }, data: { used: true } });

    return { address: msg.address };
  }
}