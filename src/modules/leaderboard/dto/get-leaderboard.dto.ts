import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetLeaderboardDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  cursor?: number = 0;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  // Optional override to view a past week
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  weekId?: number;
}