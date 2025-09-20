import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { AdminGuard } from "@common/guards/admin.guard";
import { QuestionsService } from "./questions.service";
import {
  CreateQuestionDto,
  GenerateQuestionsDto,
  UpdateQuestionDto,
} from "@modules/admin/dto/question.dto";
import { Throttle } from "@nestjs/throttler";

// @UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/questions")
export class QuestionsAdminController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  async createQuestion(@Body() dto: CreateQuestionDto) {
    return this.questions.createQuestion(dto);
  }

  @Post(":id")
  async updateQuestion(@Param("id") id: string, @Body() dto: UpdateQuestionDto) {
    return this.questions.updateQuestion(id, dto);
  }

  @Post(":id/activate")
  async activateQuestion(@Param("id") id: string) {
    return this.questions.setQuestionActive(id, true);
  }

  @Post(":id/deactivate")
  async deactivateQuestion(@Param("id") id: string) {
    return this.questions.setQuestionActive(id, false);
  }

  @Throttle({ default: { limit: 30, ttl: 60 } })
  @Post("generate")
  async generateQuestions(@Body() dto: GenerateQuestionsDto) {
    return this.questions.generateQuestions(dto.provider, dto.prompt, dto.count, dto.category, dto.difficulty);
  }
}