import { IsArray, IsInt, IsOptional, IsString, IsIn } from 'class-validator';

export class OpenRewardRoundDto {
  @IsInt()
  weekId!: number;

  @IsString() @IsIn(['USDC','ETH'])
  rewardToken!: 'USDC'|'ETH';

  @IsString()
  totalPoolWei!: string; // BigInt string
}

export class PreviewWinnersDto {
  @IsInt()
  weekId!: number;

  @IsInt()
  top!: number;

  @IsString() @IsIn(['equal','weighted'])
  mode!: 'equal' | 'weighted';
}

export class AllocationItemDto {
  @IsString()
  userId!: string;

  @IsString()
  walletAddress!: string;

  @IsString()
  amountWei!: string;
}

export class AllocateRewardsDto {
  @IsInt()
  weekId!: number;

  @IsArray()
  allocations!: AllocationItemDto[];
}

export class FinalizeRoundDto {
  @IsInt()
  weekId!: number;

  @IsString()
  merkleRoot!: string;
}

export class MarkPayoutDto {
  @IsInt()
  weekId!: number;

  @IsString()
  userId!: string;

  @IsString() @IsIn(['pending','claimed','sent','failed'])
  payoutState!: 'pending'|'claimed'|'sent'|'failed';

  @IsOptional() @IsString()
  txHash?: string;
}

export class DispatchRewardsDto {
  @IsInt()
  weekId!: number;

  @IsOptional() @IsIn(['custodial','onchain'])
  mode?: 'custodial'|'onchain';
}