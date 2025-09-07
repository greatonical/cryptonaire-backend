import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(32)
  username?: string;

  @IsOptional() @IsString() @MaxLength(256)
  avatarUrl?: string;

  @IsOptional() @IsString() @MaxLength(64)
  country?: string;
}