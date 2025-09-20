export const STAGES = {
  BASIC: 1,
  MID: 2,
  ADV: 3,
} as const;
export type Stage = typeof STAGES[keyof typeof STAGES];

// Align to your DB categories (see screenshot: 'beginner' | 'defi' | 'advanced')
export const STAGE_CATEGORY: Record<Stage, 'beginner' | 'defi' | 'advanced'> = {
  [STAGES.BASIC]: 'beginner',
  [STAGES.MID]: 'defi',
  [STAGES.ADV]: 'advanced',
} as const;

export const STAGE_POINTS: Record<Stage, number> = {
  [STAGES.BASIC]: 10,
  [STAGES.MID]: 20,
  [STAGES.ADV]: 30,
};

export const STAGE_QUESTIONS_REQUIRED: Record<Stage, number> = {
  [STAGES.BASIC]: 5,
  [STAGES.MID]: 5,
  [STAGES.ADV]: 5,
};

export const STAGE_PASS_THRESHOLD: Record<Stage, number> = {
  [STAGES.BASIC]: 3,
  [STAGES.MID]: 3,
  [STAGES.ADV]: 3,
};

export const STAGE_PENALTY: Record<Stage, number> = {
  [STAGES.BASIC]: 2,
  [STAGES.MID]: 3,
  [STAGES.ADV]: 5,
};

export const DAILY_QUOTA_SECONDS = 60 * 60; // 1 hour