export function buildQuestionPrompt(opts: {
  category: 'beginner' | 'defi' | 'protocols' | 'nfts' | 'security' | 'daos';
  difficulty: 1 | 2 | 3;
  count: number;
  seedPrompt: string;
}) {
  const { category, difficulty, count, seedPrompt } = opts;

  // Keep it strict: we want pure JSON array back
  return `
You are a crypto quiz generator. Create ${count} multiple-choice questions for category="${category}", difficulty=${difficulty}.
- Difficulty scale: 1=basic, 2=mid/DeFi focused, 3=advanced/protocols-level reasoning.
- Each question must have EXACTLY 4 options and one correct answer.
- Keep questions concise and non-ambiguous.
- Avoid vendor names unless universally known (e.g., Ethereum, Base).

Return ONLY valid JSON (no backticks, no prose). The shape must be:

[
  {
    "category": "${category}",
    "difficulty": ${difficulty},
    "avgTimeToAnswerMs": 25000,
    "body": {
      "text": "Question text?",
      "options": ["A","B","C","D"],
      "correct_index": 0
    },
    "source": "ai",
    "active": true
  },
  ...
]

Seed context (optional): ${seedPrompt}
`.trim();
}