import type { AIProvider, GeneratedQuestion } from '../ai.types';
import { buildQuestionPrompt } from '../prompts';
import { validateGenerated } from '../validate';

export class DeepseekProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
    private readonly model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  ) {
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY missing');
  }

  async generate(opts: { prompt: string; count: number; category: any; difficulty: any }): Promise<GeneratedQuestion[]> {
    const prompt = buildQuestionPrompt({
      category: opts.category, difficulty: opts.difficulty, count: opts.count, seedPrompt: opts.prompt
    });

    // TODO: Replace with real DeepSeek call when ready
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a strict JSON generator. Return only JSON.' },
        { role: 'user', content: prompt }
      ]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`DeepSeek error: ${res.status} ${txt}`);
    }

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error('DeepSeek returned non-JSON content'); }
    return validateGenerated(json);
  }
}