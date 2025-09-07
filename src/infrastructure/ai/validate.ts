import type { GeneratedQuestion } from './ai.types.js';

export function validateGenerated(input: unknown): GeneratedQuestion[] {
  if (!Array.isArray(input)) throw new Error('AI: expected an array');
  const out: GeneratedQuestion[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') throw new Error('AI: item not object');

    const { category, difficulty, avgTimeToAnswerMs, body, source, active } = item as any;

    if (!['beginner','defi','protocols','nfts','security','daos'].includes(category)) {
      throw new Error('AI: invalid category');
    }
    if (![1,2,3].includes(Number(difficulty))) throw new Error('AI: invalid difficulty');
    if (typeof avgTimeToAnswerMs !== 'number' || avgTimeToAnswerMs < 5000 || avgTimeToAnswerMs > 60000) {
      throw new Error('AI: invalid avgTimeToAnswerMs');
    }
    if (!body || typeof body !== 'object') throw new Error('AI: missing body');
    if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('AI: invalid body.text');
    if (!Array.isArray(body.options) || body.options.length !== 4) throw new Error('AI: options must be length 4');
    if (body.options.some((o: any) => typeof o !== 'string' || !o.trim())) {
      throw new Error('AI: invalid option');
    }
    if (![0,1,2,3].includes(Number(body.correct_index))) throw new Error('AI: invalid correct_index');

    if (source !== 'ai' || active !== true) throw new Error('AI: source must be "ai" and active=true');

    out.push({
      category,
      difficulty,
      avgTimeToAnswerMs,
      body: {
        text: body.text,
        options: body.options,
        correct_index: body.correct_index
      },
      source,
      active
    } as GeneratedQuestion);
  }

  return out;
}