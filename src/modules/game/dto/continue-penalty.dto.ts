import { IsOptional, IsString } from 'class-validator';

export class ContinuePenaltyDto {
  // Optional reason/message
  @IsOptional()
  @IsString()
  reason?: string;
}