export const DAILY_QUOTA_SECONDS = 3600; // 1 hour

export const STAGES = {
  BASIC: 1,
  MID: 2,
  ADV: 3,
} as const;

export const STAGE_QUESTIONS_REQUIRED: Record<number, number> = {
  [STAGES.BASIC]: 5,
  [STAGES.MID]: 5,
  [STAGES.ADV]: 5,
};

export const STAGE_POINTS: Record<number, number> = {
  [STAGES.BASIC]: 1,
  [STAGES.MID]: 2,
  [STAGES.ADV]: 3,
};

// "must pass earlier stage to unlock next"
// Pass rule: >=3 correct out of 5 (tweak later if you want)
export const STAGE_PASS_THRESHOLD: Record<number, number> = {
  [STAGES.BASIC]: 3,
  [STAGES.MID]: 3,
  [STAGES.ADV]: 3,
};

// Penalty when user chooses to continue after a miss
export const STAGE_PENALTY: Record<number, number> = {
  [STAGES.BASIC]: 1,
  [STAGES.MID]: 2,
  [STAGES.ADV]: 3,
};

// Category mapping for questions
export const STAGE_CATEGORY: Record<number, string> = {
  [STAGES.BASIC]: 'beginner',
  [STAGES.MID]: 'defi',
  [STAGES.ADV]: 'protocols',
};