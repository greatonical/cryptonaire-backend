import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { AdminGuard } from "@common/guards/admin.guard";
import { AdminService } from "./admin.service";
import {
  ListUsersDto,
  SetUserRoleDto,
  SetUserStatusDto,
  SetUserVerifiedDto,
} from "./dto/user-management.dto";

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ---------- Users ----------
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
  async setUserVerified(@Param("id") id: string, @Body() dto: SetUserVerifiedDto) {
    return this.admin.setUserVerified(id, dto.verified);
  }

  @Post("users/:id/role")
  async setUserRole(@Param("id") id: string, @Body() dto: SetUserRoleDto) {
    return this.admin.setUserRole(id, dto.role);
  }

  // ---------- Reports / Export ----------
  @Get("reports/engagement")
  async engagement(@Query("from") from?: string, @Query("to") to?: string) {
    return this.admin.engagementReport(from, to);
  }

  @Get("exports/engagement.csv")
  @Header("content-type", "text/csv")
  async exportEngagement(@Query("from") from?: string, @Query("to") to?: string) {
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