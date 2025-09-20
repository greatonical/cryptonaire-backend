import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitAttemptDto {
  @IsString()
  @IsNotEmpty()
  attemptToken!: string;

  @IsInt()
  @Min(0)
  @Max(3)
  selectedIndex!: number;

    @IsString()
    @IsNotEmpty()
    questionId!: string;
  
    // Omit or send "" on timeout; transform "" → undefined
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (value === '' ? undefined : value))
    optionId?: string;
  
}