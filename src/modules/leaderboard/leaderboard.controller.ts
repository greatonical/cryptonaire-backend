import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { LeaderboardService } from '@modules/leaderboard/leaderboard.service';
import { GetLeaderboardDto } from '@modules/leaderboard/dto/get-leaderboard.dto';

@UseGuards(JwtAuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly lb: LeaderboardService) {}

  @Get('weekly')
  async weekly(@Query() q: GetLeaderboardDto) {
    return this.lb.getWeeklyTop({ cursor: q.cursor, limit: q.limit, weekId: q.weekId });
  }

  @Get('all-time')
  async allTime(@Query() q: GetLeaderboardDto) {
    return this.lb.getAllTimeTop({ cursor: q.cursor, limit: q.limit });
  }

  @Get('me')
  async me(@CurrentUser() user: any, @Query() q: GetLeaderboardDto) {
    return this.lb.getMyRanks(user.uid, q.weekId);
  }
}