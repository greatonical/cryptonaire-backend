import { Injectable, UseGuards } from "@nestjs/common";
import { AdminService } from "@modules/admin/admin.service";
import { JwtAuthGuard } from "@app/common/guards/jwt.guard";

@UseGuards(JwtAuthGuard)
@Injectable()
export class QuestionsService {
  constructor(private readonly admin: AdminService) {}

  createQuestion(data: any) {
    return this.admin.createQuestion(data);
  }
  updateQuestion(id: string, data: any) {
    return this.admin.updateQuestion(id, data);
  }
  setQuestionActive(id: string, active: boolean) {
    return this.admin.setQuestionActive(id, active);
  }
  generateQuestions(provider: "gemini" | "groq", prompt: string, count: number, category: string, difficulty: number) {
    return this.admin.generateQuestions(provider, prompt, count, category, difficulty);
  }
}