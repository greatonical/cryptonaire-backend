import type { AIProviderName, AIProvider } from './ai.types';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepseekProvider } from './providers/deepseek.provider';

export function createAIProvider(name?: AIProviderName): AIProvider {
  const chosen = (name || process.env.AI_PROVIDER || 'gemini') as AIProviderName;
  switch (chosen) {
    case 'gemini':
      return new GeminiProvider(process.env.GEMINI_API_KEY || '', process.env.GEMINI_MODEL);
    case 'groq':
      return new GroqProvider(process.env.GROQ_API_KEY || '', process.env.GROQ_MODEL);
    case 'deepseek':
      return new DeepseekProvider(process.env.DEEPSEEK_API_KEY || '', process.env.DEEPSEEK_API_BASE, process.env.DEEPSEEK_MODEL);
    default:
      throw new Error(`Unknown AI provider: ${chosen}`);
  }
}