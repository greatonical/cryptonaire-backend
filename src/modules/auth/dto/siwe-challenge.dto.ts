import { IsEthereumAddress, IsOptional, IsString } from 'class-validator';

export class SiweChallengeDto {
  @IsEthereumAddress()
  walletAddress!: string;

  @IsOptional()
  @IsString()
  farcasterUserId?: string;
}