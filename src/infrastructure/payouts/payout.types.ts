export type PayoutMode = 'custodial' | 'onchain';

export type SendAllocationJob = {
  weekId: number;
  allocationId: string;
  mode?: PayoutMode;
};

export type DispatchWeekJob = {
  weekId: number;
  mode?: PayoutMode;
};