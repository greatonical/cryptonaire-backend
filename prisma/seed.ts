import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding baseline data...');

  await prisma.question.createMany({
    data: [
      {
        category: 'beginner',
        difficulty: 1,
        avgTimeToAnswerMs: 20000,
        body: {
          text: 'What does DeFi stand for?',
          options: ['Decentralized Finance','Defined Finance','Defiant Finance','Deferred Finance'],
          correct_index: 0
        },
        source: 'human',
        active: true
      },
      {
        category: 'defi',
        difficulty: 2,
        avgTimeToAnswerMs: 25000,
        body: {
          text: 'Which chain is the Cryptonaire rewards paid on initially?',
          options: ['Ethereum','Base','Solana','Polygon'],
          correct_index: 1
        },
        source: 'human',
        active: true
      }
    ]
  }).catch(()=>{});

  console.log('✅ Seed completed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});