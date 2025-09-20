import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { AdminGuard } from "@common/guards/admin.guard";
import { AdminService } from "@modules/admin/admin.service";
import { PayoutsService } from "@modules/payouts/payouts.service";
import { BullmqService } from "@infra/queues/bullmq.service";
import {
  AllocateRewardsDto,
  FinalizeRoundDto,
  MarkPayoutDto,
  OpenRewardRoundDto,
  PreviewWinnersDto,
  DispatchRewardsDto,
} from "@modules/admin/dto/rewards.dto";

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/rewards")
export class RewardsAdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly payouts: PayoutsService,
    private readonly bull: BullmqService,
  ) {}

  @Post("open")
  async openRound(@Body() dto: OpenRewardRoundDto) {
    return this.admin.openRewardRound(dto.weekId, dto.rewardToken, dto.totalPoolWei);
  }

  @Get("preview")
  async preview(@Query() q: PreviewWinnersDto) {
    const items = await this.admin.previewWinners(q.weekId, q.top, q.mode);
    return { weekId: q.weekId, mode: q.mode, items };
  }

  @Post("allocate")
  async allocate(@Body() dto: AllocateRewardsDto) {
    return this.admin.createAllocations(dto.weekId, dto.allocations);
  }

  @Get(":weekId")
  async listAllocations(@Param("weekId") weekIdStr: string) {
    return this.admin.listAllocations(Number(weekIdStr));
  }

  @Post("finalize")
  async finalize(@Body() dto: FinalizeRoundDto) {
    return this.admin.finalizeRound(dto.weekId, dto.merkleRoot);
  }

  @Post("mark")
  async mark(@Body() dto: MarkPayoutDto) {
    return this.admin.markPayout(dto.weekId, dto.userId, dto.payoutState, dto.txHash);
  }

  @Post("dispatch")
  async dispatch(@Body() dto: DispatchRewardsDto) {
    return this.payouts.enqueueDispatchWeek(dto.weekId, dto.mode);
  }

  @Get("queue")
  async queueStats() {
    const q = this.bull.payoutsQueue;
    return q.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused");
  }

  // Optional: CSV export here if you want it under /admin/rewards/...
  @Get("exports/engagement.csv")
  @Header("content-type", "text/csv")
  async exportEngagement(@Query("from") from?: string, @Query("to") to?: string) {
    // re-use admin service CSV (unchanged)
    const r = await this.admin.engagementReport(from, to);
    const rows = [r];
    return this.admin.toCsv(rows, [
      "window",
      "usersTotal",
      "usersVerified",
      "activeUsers",
      "sessions",
      "avgSessionSec",
      "attempts",
      "correctRatePct",
    ]);
  }
}