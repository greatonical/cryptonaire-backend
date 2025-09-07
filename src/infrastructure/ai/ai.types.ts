export type AIProviderName = 'gemini' | 'groq' | 'deepseek';

export type GeneratedQuestion = {
  category: 'beginner' | 'defi' | 'protocols' | 'nfts' | 'security' | 'daos';
  difficulty: 1 | 2 | 3;
  avgTimeToAnswerMs: number;
  body: {
    text: string;
    options: [string, string, string, string];
    correct_index: 0 | 1 | 2 | 3;
  };
  source: 'ai';
  active: true;
};

export interface AIProvider {
  generate(opts: {
    prompt: string;
    count: number;
    category: GeneratedQuestion['category'];
    difficulty: GeneratedQuestion['difficulty'];
  }): Promise<GeneratedQuestion[]>;
}