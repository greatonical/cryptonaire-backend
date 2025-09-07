import type { AIProvider, GeneratedQuestion } from '../ai.types';
import { buildQuestionPrompt } from '../prompts';
import { validateGenerated } from '../validate';

async function fetchWithTimeout(url: string, init: any, ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(t); }
}

export class GroqProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'
  ) {
    if (!apiKey) throw new Error('GROQ_API_KEY missing');
  }

  async generate(opts: { prompt: string; count: number; category: any; difficulty: any }): Promise<GeneratedQuestion[]> {
    const prompt = buildQuestionPrompt({
      category: opts.category,
      difficulty: opts.difficulty,
      count: opts.count,
      seedPrompt: opts.prompt
    });

    // Groq uses OpenAI-compatible Chat Completions
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a strict JSON generator. Return only JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    };

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq error: ${res.status} ${txt}`);
    }

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Groq returned non-JSON content');
    }
    return validateGenerated(json);
  }
}