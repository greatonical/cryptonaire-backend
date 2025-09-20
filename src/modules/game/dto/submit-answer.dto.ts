import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubmitAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  // Omit or send "" on timeout; transform "" → undefined
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  optionId?: string;
}