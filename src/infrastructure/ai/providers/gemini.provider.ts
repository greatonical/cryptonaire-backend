import type { AIProvider, GeneratedQuestion } from '../ai.types';
import { buildQuestionPrompt } from '../prompts';
import { validateGenerated } from '../validate';

async function fetchWithTimeout(url: string, init: any, ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(t); }
}

export class GeminiProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  ) {
    if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  }

  async generate(opts: { prompt: string; count: number; category: any; difficulty: any }): Promise<GeneratedQuestion[]> {
    const prompt = buildQuestionPrompt({
      category: opts.category,
      difficulty: opts.difficulty,
      count: opts.count,
      seedPrompt: opts.prompt
    });

    // Gemini HTTP call (json-only response coerced by our prompt)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95 }
    };

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini error: ${res.status} ${txt}`);
    }

    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned non-JSON content');
    }
    return validateGenerated(json);
  }
}