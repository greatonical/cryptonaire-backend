import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GameService } from '@modules/game/game.service';
import { StartSessionDto } from '@modules/game/dto/start-session.dto';
import { SubmitAttemptDto } from '@modules/game/dto/submit-attempt.dto';
import { ContinuePenaltyDto } from '@modules/game/dto/continue-penalty.dto';

@UseGuards(JwtAuthGuard)
@Controller('game')
export class GameController {
  constructor(private readonly game: GameService) {}

  @Post('session/start')
  async startSession(@CurrentUser() user: any, @Body() dto: StartSessionDto) {
    return this.game.startSession(user.uid, dto);
  }

  @Get('status')
  async getStatus(@CurrentUser() user: any) {
    return this.game.getStatus(user.uid);
  }

  // MUST be GET to match the frontend client
  @Get('question/next')
  async nextQuestion(@CurrentUser() user: any) {
    return this.game.nextQuestion(user.uid);
  }

  @Post('attempt/submit')
  async submitAttempt(@CurrentUser() user: any, @Body() dto: SubmitAttemptDto) {
    return this.game.submitAttempt(user.uid, dto);
  }

  @Post('session/walk-away')
  async walkAway(@CurrentUser() user: any) {
    return this.game.walkAway(user.uid);
  }

  @Post('session/continue')
  async continueWithPenalty(@CurrentUser() user: any, @Body() dto: ContinuePenaltyDto) {
    return this.game.continueWithPenalty(user.uid, dto.reason);
  }

   @Post('session/reset-points')
  async resetPoints(@CurrentUser() user: any) {
    return this.game.resetPointsToZero(user.uid);
  }

  @Post('session/end')
  async endSession(@CurrentUser() user: any) {
    return this.game.endSession(user.uid);
  }
}