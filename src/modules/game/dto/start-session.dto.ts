import { IsOptional, IsString } from 'class-validator';

export class StartSessionDto {
  // Reserved for future metadata (deviceId, client version, etc.)
  @IsOptional()
  @IsString()
  clientMeta?: string;
}