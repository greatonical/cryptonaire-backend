import { z } from 'zod';

export const VerifyDto = z.object({
  fid: z.string(),
  message: z.string(),
  signature: z.string(),
});
