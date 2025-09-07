import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class SubmitAttemptDto {
  @IsString()
  @IsNotEmpty()
  attemptToken!: string;

  @IsInt()
  @Min(0)
  @Max(3)
  selectedIndex!: number;
}