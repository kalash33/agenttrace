/**
 * Example: Human-in-the-loop approval for high-risk agent actions.
 *
 * Run with: npx tsx examples/with-human-approval.ts
 */

import * as readline from 'node:readline';
import { AgentGuard } from '../src/index.js';

// ─── Terminal Prompt Helper ──────────────────────────────────────────────────

function prompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// ─── Mock Finance Agent ──────────────────────────────────────────────────────

const financeAgent = {
  run: async (task: string): Promise<{ action: string; amount: number; recipient: string }> => {
    // Simulate an agent that processes financial tasks
    if (task.includes('large')) {
      return { action: 'wire_transfer', amount: 15000, recipient: 'supplier-xyz' };
    }
    return { action: 'refund', amount: 75, recipient: 'customer-123' };
  },
};

// ─── Guard with Interactive Approval ─────────────────────────────────────────

const guard = new AgentGuard({
  rules: ['require_human_approval', 'block_pii_leakage'],
  humanApproval: {
    threshold: 500,  // Require approval for anything over $500
    onApprovalRequired: async ({ description, amount, trace }) => {
      console.log('\n╔════════════════════════════════════════╗');
      console.log('║     ⚠️  HUMAN APPROVAL REQUIRED         ║');
      console.log('╠════════════════════════════════════════╣');
      console.log(`║ ${description.padEnd(38)} ║`);
      if (amount) {
        console.log(`║ Amount: $${amount.toLocaleString().padEnd(29)} ║`);
      }
      console.log(`║ Audit ID: ${trace.id.slice(0, 28).padEnd(28)} ║`);
      console.log('╚════════════════════════════════════════╝');

      return prompt('\nApprove this action?');
    },
  },
  debug: false,
  persist: false,
});

const safeAgent = guard.wrap(financeAgent);

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  AgentGuard — Human-in-the-Loop Approval');
  console.log('═══════════════════════════════════════════════\n');

  // Test 1: Small amount — should pass automatically
  console.log('Test 1: Small refund ($75)...');
  const small = await safeAgent.run('Process small customer refund');
  console.log(`  Result: ${small.blocked ? '⛔ BLOCKED' : '✅ ALLOWED'} (Risk: ${small.riskLevel})\n`);

  // Test 2: Large amount — will trigger approval prompt
  console.log('Test 2: Large wire transfer ($15,000)...');
  const large = await safeAgent.run('Process large wire transfer');
  console.log(`  Result: ${large.blocked ? '⛔ BLOCKED' : '✅ ALLOWED'} (Risk: ${large.riskLevel})`);
  if (large.blocked) {
    console.log(`  Reason: ${large.reason?.split('\n')[0]}`);
  }

  console.log('\nDone! All runs stored in .agentguard/traces.db');
}

main().catch(console.error);
