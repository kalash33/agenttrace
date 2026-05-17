/**
 * Example: Wrap a custom agent with AgentGuard.
 *
 * Run with: npx tsx examples/custom-agent.ts
 */

import { AgentGuard } from '../src/index.js';

// ─── Fake "Agent" (replace with your real agent) ──────────────────────────────

const myAgent = {
  run: async (input: string): Promise<{ text: string }> => {
    console.log(`[Agent] Processing: "${input}"`);
    // Simulate agent output — try changing this to include PII or harmful content
    return {
      text: `The customer's refund of $50 has been processed successfully. ` +
            `Transaction ID: TXN-2026-001. ` +
            `Reason: within 30-day return window. Risk: LOW.`,
    };
  },
};

// ─── Guard It ─────────────────────────────────────────────────────────────────

const guard = new AgentGuard({
  rules: [
    'block_pii_leakage',
    'block_financial_advice',
    'block_harmful_content',
    'require_human_approval',
  ],
  explain: !!process.env['ANTHROPIC_API_KEY'],  // only if API key present
  humanApproval: {
    threshold: 1000,
    onApprovalRequired: async ({ description, amount }) => {
      console.log(`\n⚠️  HUMAN APPROVAL REQUIRED`);
      console.log(`   ${description}`);
      console.log(`   Amount: $${amount?.toLocaleString()}`);
      // In a real app: send email, Slack message, UI prompt, etc.
      // For this example, we auto-approve:
      return true;
    },
  },
  debug: true,
  persist: false, // disable SQLite for this example
});

const safeAgent = guard.wrap(myAgent);

// ─── Run It ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  AgentGuard — Custom Agent Example');
  console.log('═══════════════════════════════════════════════\n');

  const result = await safeAgent.run('Process customer refund request');

  console.log('\n─── Guard Result ──────────────────────────────');
  console.log(`  Blocked:     ${result.blocked}`);
  console.log(`  Risk Level:  ${result.riskLevel}`);
  console.log(`  Audit ID:    ${result.auditId}`);
  console.log(`  Steps:       ${result.auditTrail.length}`);

  if (result.explanation) {
    console.log(`\n  Explanation:\n  ${result.explanation}`);
  }
  if (result.blocked && result.reason) {
    console.log(`\n  Reason:\n  ${result.reason}`);
  }

  console.log('\n─── Now test with PII ──────────────────────────');

  const piiAgent = {
    run: async (_: string) => ({
      text: 'Customer: John Doe, email: johndoe@example.com, phone: 555-234-5678',
    }),
  };
  const safePiiAgent = guard.wrap(piiAgent);
  const piiResult = await safePiiAgent.run('Get customer contact info');

  console.log(`  Blocked:    ${piiResult.blocked}`);
  console.log(`  Violations: ${piiResult.violations?.length ?? 0}`);
  piiResult.violations?.forEach((v) => {
    console.log(`    • [${v.severity}] ${v.description}`);
  });
}

main().catch(console.error);
