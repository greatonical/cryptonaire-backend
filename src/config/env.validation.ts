import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  APP_PORT: z.string().transform(Number).default(4000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_TTL_MINUTES: z.string().transform(Number).default(20),
  JWT_VERSION_SEED: z.string().transform(Number).default(1),

  // Chain / payouts
  BASE_CHAIN_ID: z.string().transform(Number).default(8453).optional(),
  BASE_RPC_URL: z.string().optional(),
  USDC_ADDRESS_BASE: z.string().optional(),
  DISTRIBUTOR_PRIVATE_KEY: z.string().optional(),

  PAYOUT_MODE: z.enum(['custodial','onchain']).default('custodial'),
  REWARD_WEEKLY_CRON: z.string().default('5 0 * * 1'),
  REWARD_TOP_N: z.string().transform(Number).default(10),
  REWARD_ALLOCATION_MODE: z.enum(['equal','weighted']).default('equal'),
  REWARD_TOKEN: z.enum(['USDC','ETH']).default('USDC'),
  REWARD_TOTAL_POOL_WEI: z.string().default('0'),

  // Circle
  CIRCLE_API_BASE: z.string().default('https://api.circle.com'),
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_BLOCKCHAIN: z.string().default('BASE'),
  CIRCLE_WALLET_ID: z.string().optional(),
  CIRCLE_USDC_TOKEN_ADDRESS_BASE: z.string().optional(),

  // Admin
  ADMIN_API_TOKEN: z.string().optional(),

  // Docs
  DOCS_ENABLED: z.string().optional(), // 'true'
});

export function validateEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Pretty print first error
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ENV: ${issue.path.join('.')}: ${issue.message}`);
  }
  return parsed.data;
}