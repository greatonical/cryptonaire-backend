import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QuestionBodyDto {
  @IsString() @IsNotEmpty()
  text!: string;

  @IsArray()
  @IsString({ each: true })
  options!: string[];

  @IsInt() @Min(0) @Max(3)
  correct_index!: number;
}

export class CreateQuestionDto {
  @IsString() @IsIn(['beginner', 'defi', 'protocols', 'nfts', 'security', 'daos'])
  category!: string;

  @IsInt() @Min(1) @Max(3)
  difficulty!: number;

  @IsInt() @Min(5000) @Max(60000)
  avgTimeToAnswerMs!: number;

  @ValidateNested() @Type(() => QuestionBodyDto)
  body!: QuestionBodyDto;

  @IsString() @IsIn(['human', 'ai'])
  source!: 'human' | 'ai';

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateQuestionDto {
  @IsOptional() @IsString() @IsIn(['beginner', 'defi', 'protocols', 'nfts', 'security', 'daos'])
  category?: string;

  @IsOptional() @IsInt() @Min(1) @Max(3)
  difficulty?: number;

  @IsOptional() @IsInt() @Min(5000) @Max(60000)
  avgTimeToAnswerMs?: number;

  @IsOptional() @ValidateNested() @Type(() => QuestionBodyDto)
  body?: QuestionBodyDto;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class GenerateQuestionsDto {
  @IsString() @IsIn(['gemini', 'groq'])
  provider!: 'gemini' | 'groq';

  @IsString()
  prompt!: string;

  @IsInt() @Min(1) @Max(50)
  count!: number;

  @IsString() @IsIn(['beginner', 'defi', 'protocols', 'nfts', 'security', 'daos'])
  category!: string;

  @IsInt() @Min(1) @Max(3)
  difficulty!: number;
}