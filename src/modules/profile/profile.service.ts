import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string) {
    const p = await this.prisma.profile.findUnique({ where: { userId } });
    if (p) return p;
    // create empty on first read
    return this.prisma.profile.create({ data: { userId } });
  }

  async updateMyProfile(userId: string, data: { username?: string; avatarUrl?: string; country?: string }) {
    await this.prisma.profile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    return this.getMyProfile(userId);
  }
}