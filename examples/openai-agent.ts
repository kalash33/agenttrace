/**
 * Example: Wrap an OpenAI Assistants / Responses API agent.
 *
 * Run with: OPENAI_API_KEY=sk-... npx tsx examples/openai-agent.ts
 */

import { AgentGuard, createRule } from '../src/index.js';

// ─── OpenAI Agent Wrapper ────────────────────────────────────────────────────
// This pattern works with any OpenAI-compatible call pattern.
// Install openai: npm install openai

async function createOpenAIAgent() {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();

  return {
    invoke: async (input: string) => {
      const response = await client.responses.create({
        model: 'gpt-4o-mini',
        input,
        instructions: 'You are a helpful customer service agent.',
      });
      return {
        text: response.output_text,
        model: 'gpt-4o-mini',
        usage: response.usage,
      };
    },
  };
}

// ─── Custom Rule: No Competitor Mentions ─────────────────────────────────────

const noCompetitorMentions = createRule(
  'no_competitor_mentions',
  async ({ result }) => {
    const text = JSON.stringify(result).toLowerCase();
    const competitors = ['openai-competitor', 'acme-ai', 'rival-corp'];
    for (const c of competitors) {
      if (text.includes(c)) {
        return [
          {
            rule: 'no_competitor_mentions',
            description: `Output mentions competitor: "${c}"`,
            evidence: c,
            severity: 'MEDIUM' as const,
          },
        ];
      }
    }
    return [];
  },
  'Prevents the agent from mentioning competitor products in responses.'
);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env['OPENAI_API_KEY']) {
    console.log('Set OPENAI_API_KEY to run this example.');
    console.log('Simulating with a mock agent instead.\n');

    // Mock for demo
    const mockAgent = {
      invoke: async (input: string) => ({
        text: `I'd be happy to help with: "${input}". Please note I cannot provide personal data.`,
      }),
    };

    const guard = new AgentGuard({
      rules: ['block_pii_leakage', 'block_harmful_content', noCompetitorMentions],
      persist: false,
      debug: true,
    });

    const safe = guard.wrap(mockAgent);
    const result = await safe.invoke('Help me with my account');

    console.log('Result:', result.blocked ? '⛔ BLOCKED' : '✅ ALLOWED');
    console.log('Risk:', result.riskLevel);
    if (result.result) console.log('Output:', (result.result as { text: string }).text);
    return;
  }

  const agent = await createOpenAIAgent();

  const guard = new AgentGuard({
    rules: [
      'block_pii_leakage',
      'block_harmful_content',
      'block_financial_advice',
      noCompetitorMentions,
    ],
    explain: !!process.env['ANTHROPIC_API_KEY'],
    debug: true,
  });

  const safeAgent = guard.wrap(agent);

  const result = await safeAgent.invoke(
    'What is the best way to handle a customer refund request?'
  );

  console.log('\n─── Result ──────────────────────────────────────');
  console.log(`Blocked:    ${result.blocked}`);
  console.log(`Risk Level: ${result.riskLevel}`);
  console.log(`Audit ID:   ${result.auditId}`);
  if (result.explanation) console.log(`Explanation: ${result.explanation}`);
  if (result.result) {
    const r = result.result as { text?: string };
    console.log(`Output:     ${r.text?.slice(0, 200)}`);
  }

  guard.close();
}

main().catch(console.error);
