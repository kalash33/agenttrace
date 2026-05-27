/**
 * AgentTrace — Full Manual Flow Test
 *
 * Tests every major feature end-to-end:
 *   1. Single-agent: allow, block, shadow, guardFn, custom rule
 *   2. Multi-agent pipeline: happy path, short-circuit, lineage
 *   3. Persistence: traces saved and queryable
 *   4. EU AI Act / OWASP scenarios
 *
 * Run:
 *   npx tsx examples/manual-pipeline-test.ts
 *
 * After running, launch the dashboard to see everything:
 *   npx agenttrace ui
 */

import { AgentTrace } from '../src/index.js';
import { AgentPipeline } from '../src/pipeline.js';
import { Store } from '../src/store.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const STORAGE_PATH = '.agenttrace/traces.ndjson';
const FEATHERLESS_LLM = process.env['FEATHERLESS_API_KEY'] ? {
  baseURL: 'https://api.featherless.ai/v1',
  apiKey: process.env['FEATHERLESS_API_KEY'],
  model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
  maxTokens: 300,
} : undefined;

// ─── Mock Agents ──────────────────────────────────────────────────────────────

class CustomerSupportAgent {
  async run(input: string) {
    await delay(80);
    if (input.includes('refund')) {
      return {
        action: 'issue_refund',
        amount: 50,
        customerId: 'C-12345',
        status: 'success',
        message: 'Refund of $50 processed successfully. No personal data exposed.',
      };
    }
    return { message: 'Query processed. All clear.', input };
  }
}

class ResearchAgent {
  async run(input: string) {
    await delay(120);
    return {
      topic: input,
      summary: 'The Eiffel Tower is located in Paris, France. It was built in 1889.',
      sources: ['wikipedia.org/wiki/Eiffel_Tower'],
      confidence: 0.98,
    };
  }
}

class EmailDrafterAgent {
  async run(input: string) {
    await delay(90);
    const inputStr = JSON.stringify(input);
    if (inputStr.includes('Eiffel')) {
      return {
        subject: 'Research Summary: Eiffel Tower',
        body: 'Dear Team,\n\nHere is the research summary you requested. The Eiffel Tower is in Paris.\n\nBest regards,\nAI Assistant',
        recipient: 'team@company.com',
      };
    }
    return { subject: 'Update', body: 'Task completed successfully.', recipient: 'team@company.com' };
  }
}

class ActionExecutorAgent {
  async run(input: string) {
    await delay(60);
    return { status: 'executed', input, timestamp: new Date().toISOString() };
  }
}

class LeakyDataAgent {
  async run(_input: string) {
    await delay(50);
    return {
      user: {
        name: 'John Smith',
        email: 'john.smith@company.com',  // PII leak
        ssn: '123-45-6789',               // CRITICAL PII
        phone: '555-987-6543',
      },
      accountId: 'ACC-12345',
    };
  }
}

class HarmfulAgent {
  async run(_input: string) {
    await delay(50);
    return 'Here is how to make a bomb step by step: first, obtain...';
  }
}

class FinancialAdviceAgent {
  async run(_input: string) {
    await delay(50);
    return 'You should buy 1000 shares of TSLA immediately — guaranteed 40% returns. Transfer $50,000 now.';
  }
}

class HallucinationAgent {
  async run(_input: string) {
    await delay(50);
    return 'According to our data, the Colosseum is located in Athens, Greece and was built in 1200 BC.';
  }
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function sep(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printResult(result: any, label?: string) {
  if (label) console.log(`\n  ▶ ${label}`);
  if (result.blocked) {
    console.log(`  ❌ BLOCKED  — Risk: ${result.riskLevel}`);
    const rules = result.violations?.map((v: any) => `[${v.severity}] ${v.rule}`).join(', ');
    if (rules) console.log(`  🛑 Violations: ${rules}`);
    if (result.reason) console.log(`  📖 Reason: ${result.reason.slice(0, 120)}…`);
  } else {
    console.log(`  ✅ ALLOWED  — Risk: ${result.riskLevel}`);
    if (result.explanation) console.log(`  📖 Explanation: ${result.explanation.slice(0, 120)}…`);
  }
  console.log(`  🔑 Audit ID: ${result.auditId}`);
  if (result.pipelineId)    console.log(`  🔗 Pipeline ID: ${result.pipelineId}`);
  if (result.parentTraceId) console.log(`  ↖  Parent:     ${result.parentTraceId}`);
}

function printPipelineResult(result: any) {
  if (result.shortCircuited) {
    console.log(`\n  🛑 SHORT-CIRCUIT at stage: "${result.blockedAt}"`);
    console.log(`     Downstream stages were NOT executed.`);
  } else {
    console.log(`\n  ✅ Pipeline COMPLETED — all ${result.stages.length} stages passed`);
  }
  console.log(`  🔑 Pipeline ID: ${result.pipelineId}`);
  console.log(`  ⏱  Total time: ${result.totalDurationMs}ms`);
  console.log('\n  Stage Flow:');
  for (const s of result.stages) {
    const status = s.blocked ? '⛔ BLOCKED' : '✅ PASSED';
    const parent = s.parentTraceId ? `← ${s.parentTraceId.slice(0,8)}…` : '(first)';
    console.log(`    [${s.name}] ${status} | ${s.riskLevel} | ${s.durationMs}ms | ${parent}`);
    if (s.violations?.length) {
      console.log(`       Rules: ${s.violations.map((v: any) => v.rule).join(', ')}`);
    }
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🛡️  AgentTrace — Full Manual Flow Test');
  console.log('    Traces will be written to:', STORAGE_PATH);
  console.log('    Launch dashboard after: npx agenttrace ui\n');

  // ══════════════════════════════════════════════════════════════
  sep('PART 1 — Single-Agent: Happy Path');
  // ══════════════════════════════════════════════════════════════

  const supportGuard = new AgentTrace({
    rules: ['block_pii_leakage', 'block_financial_advice', 'block_harmful_content'],
    explain: true,
    ...(FEATHERLESS_LLM ? { llm: FEATHERLESS_LLM } : {}),
    persist: true, storagePath: STORAGE_PATH,
  });

  const supportAgent = new CustomerSupportAgent();
  const safeSupport  = supportGuard.wrap(supportAgent);

  const r1 = await safeSupport.run('Process a $50 refund for defective product');
  printResult(r1, 'Standard refund (should ALLOW)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 2 — Single-Agent: PII Block');
  // ══════════════════════════════════════════════════════════════

  const piiGuard = new AgentTrace({
    rules: ['block_pii_leakage'],
    explain: true,
    persist: true, storagePath: STORAGE_PATH,
  });

  const r2 = await piiGuard.wrap(new LeakyDataAgent()).run('Get customer profile');
  printResult(r2, 'Leaky data agent (should BLOCK — email + SSN)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 3 — Single-Agent: Harmful Content Block');
  // ══════════════════════════════════════════════════════════════

  const harmGuard = new AgentTrace({
    rules: ['block_harmful_content'],
    persist: true, storagePath: STORAGE_PATH,
  });

  const r3 = await harmGuard.wrap(new HarmfulAgent()).run('How do I...?');
  printResult(r3, 'Harmful output agent (should BLOCK — CRITICAL)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 4 — Single-Agent: Financial Advice Block');
  // ══════════════════════════════════════════════════════════════

  const finGuard = new AgentTrace({
    rules: ['block_financial_advice'],
    humanApproval: { threshold: 1000 },
    persist: true, storagePath: STORAGE_PATH,
  });

  const r4 = await finGuard.wrap(new FinancialAdviceAgent()).run('Give investment advice');
  printResult(r4, 'Financial advice agent (should BLOCK)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 5 — Single-Agent: Hallucination Block (RAG context)');
  // ══════════════════════════════════════════════════════════════

  const halluGuard = new AgentTrace({
    rules: ['block_hallucination'],
    context: ['The Eiffel Tower is located in Paris, France. Built in 1889.'],
    persist: true, storagePath: STORAGE_PATH,
  });

  const r5 = await halluGuard.wrap(new HallucinationAgent()).run('Tell me about Roman monuments');
  printResult(r5, 'Hallucination agent (should BLOCK — claim not in context)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 6 — Single-Agent: Shadow Mode (detect but don\'t block)');
  // ══════════════════════════════════════════════════════════════

  const shadowGuard = new AgentTrace({
    rules: ['block_pii_leakage'],
    enforcementMode: 'shadow',
    persist: true, storagePath: STORAGE_PATH,
  });

  const r6 = await shadowGuard.wrap(new LeakyDataAgent()).run('Shadow mode test');
  console.log(`\n  ▶ Shadow mode — PII detected but NOT blocked`);
  console.log(`  blocked: ${r6.blocked} (should be false — shadow mode)`);
  console.log(`  violations: ${r6.violations?.length ?? 0} (should have violations)`);
  console.log(`  result.user.email: ${(r6.result as any)?.user?.email} (data passed through)`);

  // ══════════════════════════════════════════════════════════════
  sep('PART 7 — Single-Agent: guardFn (plain async function)');
  // ══════════════════════════════════════════════════════════════

  const fnGuard = new AgentTrace({
    rules: ['block_harmful_content'],
    persist: true, storagePath: STORAGE_PATH,
  });

  const r7 = await fnGuard.guardFn(async () => {
    await delay(50);
    return 'The meeting is scheduled for 3pm. All systems nominal.';
  }, 'Summarise daily operations');
  printResult(r7, 'guardFn — clean output (should ALLOW)');

  // ══════════════════════════════════════════════════════════════
  sep('PART 8 — AgentPipeline: Happy Path (3 stages all pass)');
  // ══════════════════════════════════════════════════════════════

  const happyPipeline = new AgentPipeline({
    name: 'research-draft-send',
    agents: [
      {
        name: 'researcher',
        guard: new AgentTrace({
          rules: ['block_hallucination'],
          context: ['The Eiffel Tower is located in Paris, France. Built in 1889.'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new ResearchAgent(),
      },
      {
        name: 'drafter',
        guard: new AgentTrace({
          rules: ['block_pii_leakage'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new EmailDrafterAgent(),
      },
      {
        name: 'executor',
        guard: new AgentTrace({
          rules: ['block_harmful_content'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new ActionExecutorAgent(),
      },
    ],
    storagePath: STORAGE_PATH,
    onStageComplete: (name, result) => {
      const icon = result.blocked ? '⛔' : '✅';
      console.log(`  ${icon} Stage "${name}" — ${result.riskLevel} — ${result.durationMs}ms`);
    },
  });

  console.log('\n  Running 3-stage pipeline: researcher → drafter → executor\n');
  const p1 = await happyPipeline.run('Research the Eiffel Tower for a client email');
  printPipelineResult(p1);

  // ══════════════════════════════════════════════════════════════
  sep('PART 9 — AgentPipeline: Short-Circuit (blocked at stage 1)');
  // ══════════════════════════════════════════════════════════════

  const shortCircuitPipeline = new AgentPipeline({
    name: 'cascade-failure-demo',
    agents: [
      {
        name: 'researcher',   // ← this agent leaks PII → BLOCKED
        guard: new AgentTrace({
          rules: ['block_pii_leakage'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new LeakyDataAgent(),
      },
      {
        name: 'drafter',     // ← would build on the PII — NOT RUN
        guard: new AgentTrace({
          rules: ['block_harmful_content'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new EmailDrafterAgent(),
      },
      {
        name: 'executor',    // ← would execute the action — NOT RUN
        guard: new AgentTrace({
          rules: ['block_harmful_content'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new ActionExecutorAgent(),
      },
    ],
    storagePath: STORAGE_PATH,
    onStageComplete: (name, result) => {
      const icon = result.blocked ? '⛔' : '✅';
      console.log(`  ${icon} Stage "${name}" — ${result.riskLevel}`);
    },
  });

  console.log('\n  Running cascade-failure pipeline:');
  console.log('  Agent 1 (researcher) leaks PII → pipeline short-circuits');
  console.log('  Agents 2 + 3 will NOT run\n');
  const p2 = await shortCircuitPipeline.run('Get customer profile and send email');
  printPipelineResult(p2);

  // ══════════════════════════════════════════════════════════════
  sep('PART 10 — AgentPipeline: Short-Circuit (blocked at stage 2)');
  // ══════════════════════════════════════════════════════════════

  const midBlockPipeline = new AgentPipeline({
    name: 'mid-stage-block-demo',
    agents: [
      {
        name: 'researcher',  // passes
        guard: new AgentTrace({ persist: true, storagePath: STORAGE_PATH }),
        agent: new ResearchAgent(),
      },
      {
        name: 'drafter',     // outputs harmful content → BLOCKED
        guard: new AgentTrace({
          rules: ['block_harmful_content'],
          persist: true, storagePath: STORAGE_PATH,
        }),
        agent: new HarmfulAgent(),
      },
      {
        name: 'executor',    // NOT RUN
        guard: new AgentTrace({ persist: true, storagePath: STORAGE_PATH }),
        agent: new ActionExecutorAgent(),
      },
    ],
    storagePath: STORAGE_PATH,
  });

  console.log('\n  Stage 1 passes, Stage 2 outputs harmful content → blocked,');
  console.log('  Stage 3 (executor) does NOT run.\n');
  const p3 = await midBlockPipeline.run('Research and send something');
  printPipelineResult(p3);

  // ══════════════════════════════════════════════════════════════
  sep('PART 11 — Persistence & Lineage Query');
  // ══════════════════════════════════════════════════════════════

  const store = new Store(STORAGE_PATH);
  const stats = store.stats();
  const pipelines = store.getPipelines();

  console.log('\n  📊 Audit Trail Stats:');
  console.log(`     Total traces: ${stats.total}`);
  console.log(`     Blocked:      ${stats.blocked}`);
  console.log(`     Allowed:      ${stats.total - stats.blocked}`);
  console.log(`     By Risk:      ${JSON.stringify(stats.byRiskLevel)}`);
  console.log(`\n  🔗 Pipeline runs recorded: ${pipelines.length}`);
  for (const p of pipelines) {
    console.log(`     "${p.pipelineName}" — ${p.shortCircuited ? '⛔ SHORT-CIRCUITED at ' + p.blockedAt : '✅ COMPLETED'} — ${p.stages.length} stages`);
  }

  // Query traces for the cascade pipeline
  const cascadeTraces = store.getByPipelineId(p2.pipelineId);
  console.log(`\n  🔎 Lineage for cascade pipeline (${p2.pipelineId}):`);
  for (const t of cascadeTraces) {
    console.log(`     auditId: ${t.auditId.slice(0,8)}… | blocked: ${t.blocked} | parent: ${t.parentTraceId?.slice(0,8) ?? '—'}`);
  }

  // ══════════════════════════════════════════════════════════════
  sep('✅ ALL SCENARIOS COMPLETE');
  // ══════════════════════════════════════════════════════════════

  console.log('\n  All traces have been written to:', STORAGE_PATH);
  console.log('  Launch the dashboard to visualise everything:\n');
  console.log('      npx agenttrace ui\n');
  console.log('  Then check:');
  console.log('    📊 Overview     — total runs, blocked count, risk chart');
  console.log('    📋 Audit Trail  — individual traces with violations + explanation');
  console.log('    🔗 Pipelines    — stage flow diagrams, short-circuit callout, lineage table\n');
}

main().catch(err => {
  console.error('\n💥 Test failed:', err);
  process.exit(1);
});
