import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class SetUserStatusDto {
  @IsIn(['active', 'suspended', 'blocked'])
  status!: 'active' | 'suspended' | 'blocked';
}

export class SetUserVerifiedDto {
  @IsBoolean()
  verified!: boolean;
}

export class SetUserRoleDto {
  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';
}

export class ListUsersDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsString()
  status?: 'active' | 'suspended' | 'blocked';

  @IsOptional() @IsString()
  role?: 'user' | 'admin';

  @IsOptional() @IsString()
  cursor?: string;

  @IsOptional() @IsString()
  limit?: string; // parse to number in controller
}