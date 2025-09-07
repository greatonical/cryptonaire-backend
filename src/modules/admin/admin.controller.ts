import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { AdminGuard } from "@common/guards/admin.guard";
import { AdminService } from "./admin.service";
import { BullmqService } from '@infra/queues/bullmq.service';
import {
  ListUsersDto,
  SetUserRoleDto,
  SetUserStatusDto,
  SetUserVerifiedDto,
} from "./dto/user-management.dto";
import {
  AllocateRewardsDto,
  FinalizeRoundDto,
  MarkPayoutDto,
  OpenRewardRoundDto,
  PreviewWinnersDto,
  DispatchRewardsDto,
} from "./dto/rewards.dto";
import {
  CreateQuestionDto,
  GenerateQuestionsDto,
  UpdateQuestionDto,
} from "./dto/question.dto";
import { PayoutsService } from "@modules/payouts/payouts.service";
import { Throttle } from "@nestjs/throttler";

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly payouts: PayoutsService,
    private readonly bull: BullmqService
  ) {}

  // Users
  @Get("users")
  async listUsers(@Query() q: ListUsersDto) {
    const limit = q.limit ? Number(q.limit) : 50;
    return this.admin.listUsers(q.q, q.status, q.role, q.cursor, limit);
  }

  @Post("users/:id/status")
  async setUserStatus(@Param("id") id: string, @Body() dto: SetUserStatusDto) {
    return this.admin.setUserStatus(id, dto.status);
  }

  @Post("users/:id/verified")
  async setUserVerified(
    @Param("id") id: string,
    @Body() dto: SetUserVerifiedDto
  ) {
    return this.admin.setUserVerified(id, dto.verified);
  }

  @Post("users/:id/role")
  async setUserRole(@Param("id") id: string, @Body() dto: SetUserRoleDto) {
    return this.admin.setUserRole(id, dto.role);
  }

  // Questions
  @Post("questions")
  async createQuestion(@Body() dto: CreateQuestionDto) {
    return this.admin.createQuestion(dto);
  }
  @Post("questions/:id")
  async updateQuestion(
    @Param("id") id: string,
    @Body() dto: UpdateQuestionDto
  ) {
    return this.admin.updateQuestion(id, dto);
  }
  @Post("questions/:id/activate")
  async activateQuestion(@Param("id") id: string) {
    return this.admin.setQuestionActive(id, true);
  }
  @Post("questions/:id/deactivate")
  async deactivateQuestion(@Param("id") id: string) {
    return this.admin.setQuestionActive(id, false);
  }

  @Throttle({ default: { limit: 30, ttl: 60 } }) // 30 requests/min for this route
  @Post("questions/generate")
  async generateQuestions(@Body() dto: GenerateQuestionsDto) {
    return this.admin.generateQuestions(
      dto.provider,
      dto.prompt,
      dto.count,
      dto.category,
      dto.difficulty
    );
  }

  @Get('queues/payouts')
async queueStats() {
  const q = this.bull.payoutsQueue;
  const counts = await q.getJobCounts('wait','active','completed','failed','delayed','paused');
  return counts;
}

  // Rewards / allocations
  @Post("rewards/open")
  async openRound(@Body() dto: OpenRewardRoundDto) {
    return this.admin.openRewardRound(
      dto.weekId,
      dto.rewardToken,
      dto.totalPoolWei
    );
  }
  @Get("rewards/preview")
  async preview(@Query() q: PreviewWinnersDto) {
    const items = await this.admin.previewWinners(q.weekId, q.top, q.mode);
    return { weekId: q.weekId, mode: q.mode, items };
  }
  @Post("rewards/allocate")
  async allocate(@Body() dto: AllocateRewardsDto) {
    return this.admin.createAllocations(dto.weekId, dto.allocations);
  }
  @Get("rewards/:weekId")
  async listAllocations(@Param("weekId") weekIdStr: string) {
    return this.admin.listAllocations(Number(weekIdStr));
  }
  @Post("rewards/finalize")
  async finalize(@Body() dto: FinalizeRoundDto) {
    return this.admin.finalizeRound(dto.weekId, dto.merkleRoot);
  }
  @Post("rewards/mark")
  async mark(@Body() dto: MarkPayoutDto) {
    return this.admin.markPayout(
      dto.weekId,
      dto.userId,
      dto.payoutState,
      dto.txHash
    );
  }

  // Dispatch (BullMQ)
  @Post("rewards/dispatch")
  async dispatch(@Body() dto: DispatchRewardsDto) {
    return this.payouts.enqueueDispatchWeek(dto.weekId, dto.mode);
  }

  // Reports / export
  @Get("reports/engagement")
  async engagement(@Query("from") from?: string, @Query("to") to?: string) {
    return this.admin.engagementReport(from, to);
  }

  @Get("exports/engagement.csv")
  @Header("content-type", "text/csv")
  async exportEngagement(
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
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
