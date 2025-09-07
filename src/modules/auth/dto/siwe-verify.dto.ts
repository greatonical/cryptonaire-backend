import { IsString } from 'class-validator';

export class SiweVerifyDto {
  @IsString()
  message!: string;

  @IsString()
  signature!: string;
}