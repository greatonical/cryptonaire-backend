import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { RewardsService } from "./rewards.service";
import { CurrentUser } from "@common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("rewards")
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get("summary/me")
  async mySummary(@CurrentUser() user: { sub: string }) {
    return this.rewards.getUserWeeklySummary(user.sub);
  }

  @Get("history")
  async myHistory(
    @CurrentUser() user: { sub: string },
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
  ) {
    const limit = Math.min(Number(limitStr ?? 20) || 20, 100);
    return this.rewards.getUserPayoutHistory(user.sub, cursor, limit);
  }

  @Get("policy")
  async policy() {
    return this.rewards.getPolicy();
  }
}