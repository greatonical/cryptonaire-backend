import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { uid?: string } | undefined;
    const adminHeader = req.headers['x-admin-token'];
    const token = Array.isArray(adminHeader) ? adminHeader[0] : adminHeader;

    // Backdoor for ops/CI if configured
    if (token && process.env.ADMIN_API_TOKEN && token === process.env.ADMIN_API_TOKEN) {
      return true;
    }

    if (!user?.uid) throw new ForbiddenException('Not authenticated');
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.uid } });
    if (!dbUser) throw new ForbiddenException('User not found');
    if (dbUser.status === 'blocked' || dbUser.status === 'suspended') {
      throw new ForbiddenException('Account restricted');
    }
    if (dbUser.role !== 'admin') throw new ForbiddenException('Admin only');
    return true;
  }
}