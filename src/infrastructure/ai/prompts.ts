export function buildQuestionPrompt(opts: {
  category: 'beginner' | 'defi' | 'protocols' | 'nfts' | 'security' | 'daos';
  difficulty: 1 | 2 | 3;
  count: number;
  seedPrompt: string;
}) {
  const { category, difficulty, count, seedPrompt } = opts;

  // Light guidance to spread questions across the category (helps reduce repeats)
  const subtopicsByCat: Record<typeof category, string> = {
    beginner:
      "wallet basics, public/private keys, seed phrases, on-chain vs off-chain, gas fees, stablecoins, price volatility, scams & phishing, custody types (self vs custodial), transactions & block confirmations",
    defi:
      "AMMs & LPing, impermanent loss, lending/borrowing (collateral & liquidation), stablecoin mechanisms, yield farming, staking vs restaking, DEX vs CEX, slippage, oracle risk",
    protocols:
      "L1 vs L2, rollups (optimistic vs zk), finality, MEV basics, block building, bridges & security assumptions, consensus (PoW/PoS), data availability, validator incentives",
    nfts:
      "NFT metadata & standards (ERC-721/1155), royalties, marketplaces, on-chain vs off-chain storage, minting mechanics, rarity, provenance, scams & safety",
    security:
      "private key management, multisig vs MPC, hardware wallets, phishing & social engineering, rug pulls, re-entrancy, approvals/allowances, best practices for safety",
    daos:
      "governance tokens, quorum & proposals, treasury management, delegation, voting mechanisms, multisig signers, incentive alignment, DAO tooling",
  };

  // Keep it strict: we want pure JSON array back, no prose
  return `
You are a crypto quiz generator. Create ${count} multiple-choice questions for category="${category}", difficulty=${difficulty}.
- Difficulty scale: 1=basic, 2=mid/DeFi-focused, 3=advanced/protocols-level reasoning.
- Each question MUST have EXACTLY 4 options and exactly one correct answer.
- Keep questions concise and unambiguous.
- Cover varied subtopics for this category: ${subtopicsByCat[category]}.
- NO duplicate or near-duplicate questions within this batch.
- AVOID overused intros like "What is a cryptocurrency wallet?", "What is blockchain?", "Which of the following is true about Bitcoin?".
- Do not reuse the same wording across questions; vary the stems and concepts.
- Avoid vendor/project names unless universally known (e.g., Ethereum, Base) and necessary for the concept.

Return ONLY valid JSON (no markdown, no backticks, no trailing commas). The shape MUST be:

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
  }
]

Notes:
- "correct_index" is an integer 0..3 and MUST match the correct option in "options".
- Keep "options" short and mutually exclusive.
- Do not include any explanation field.

Seed context (optional, do NOT copy verbatim): ${seedPrompt}
`.trim();
}