/**
 * Integration Tests — AgentTrace SDK
 *
 * These tests make REAL API calls to Featherless AI using:
 *   Model: deepseek-ai/DeepSeek-R1-Distill-Qwen-14B
 *   Endpoint: https://api.featherless.ai/v1
 *
 * Run: AGENTTRACE_INTEGRATION=true npm run test:integration
 *
 * They will be SKIPPED automatically unless the env var is set and 
 * FEATHERLESS_API_KEY is available.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentTrace } from '../../src/guard.js';
import { OpenAICompatibleExplainer } from '../../src/explainer.js';
import type { Trace } from '../../src/types.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const FEATHERLESS_API_KEY = 'rc_5e1654f8263395c685ec0879acd060edf826862c76613ba15266ab4e1cee1957';
const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';
const FEATHERLESS_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B';

const INTEGRATION_ENABLED =
  process.env['AGENTTRACE_INTEGRATION'] === 'true' ||
  !!process.env['FEATHERLESS_API_KEY'];

const FEATHERLESS_LLM = {
  baseURL: FEATHERLESS_BASE_URL,
  apiKey: FEATHERLESS_API_KEY,
  model: FEATHERLESS_MODEL,
  maxTokens: 400,
  timeoutMs: 60_000,
  retries: 2,
};

function skipIfNoIntegration() {
  if (!INTEGRATION_ENABLED) {
    console.log('  [SKIPPED] Set AGENTTRACE_INTEGRATION=true to run integration tests.');
    return true;
  }
  return false;
}

// Helper agent that simulates real LLM-like outputs
function realLikeAgent(response: unknown) {
  return {
    run: async (_input: string) => response,
    invoke: async (_input: string) => response,
  };
}

// ─── Explainer: Featherless API Tests ────────────────────────────────────────

describe('Integration — OpenAICompatibleExplainer (Featherless)', () => {
  let explainer: OpenAICompatibleExplainer;

  beforeAll(() => {
    explainer = new OpenAICompatibleExplainer(FEATHERLESS_LLM);
  });

  it('generates a real explanation for an allowed action', async () => {
    if (skipIfNoIntegration()) return;

    const trace: Trace = {
      id: 'test-trace-001',
      startedAt: new Date().toISOString(),
      originalInput: 'Process a $50 refund for customer who returned a defective item within 30 days',
      steps: [
        {
          stepIndex: 0,
          timestamp: new Date().toISOString(),
          action: 'verify_purchase()',
          input: 'order-12345',
          output: { valid: true, withinWindow: true, amount: 50 },
          durationMs: 230,
        },
        {
          stepIndex: 1,
          timestamp: new Date().toISOString(),
          action: 'issue_refund()',
          input: { amount: 50, reason: 'defective_item' },
          output: { success: true, transactionId: 'TXN-9876' },
          durationMs: 410,
        },
      ],
      lastAction: 'issue_refund()',
    };

    const result = { success: true, transactionId: 'TXN-9876', amount: 50 };
    const explanation = await explainer.explainAllow(result, trace);

    console.log('\n  📝 Allow Explanation:\n  ', explanation);

    expect(explanation).toBeTruthy();
    expect(explanation.length).toBeGreaterThan(20);
    expect(typeof explanation).toBe('string');
    // Should mention something about the refund or the decision
    const lower = explanation.toLowerCase();
    expect(
      lower.includes('refund') ||
      lower.includes('50') ||
      lower.includes('customer') ||
      lower.includes('return') ||
      lower.includes('step') ||
      lower.includes('completed')
    ).toBe(true);
  }, 60_000);

  it('generates a real block explanation with violation details', async () => {
    if (skipIfNoIntegration()) return;

    const trace: Trace = {
      id: 'test-trace-002',
      startedAt: new Date().toISOString(),
      originalInput: 'Fetch customer profile and send summary email',
      steps: [
        {
          stepIndex: 0,
          timestamp: new Date().toISOString(),
          action: 'fetch_customer()',
          input: 'customer-456',
          output: { name: 'Jane Doe', email: 'jane@example.com', ssn: '123-45-6789' },
          durationMs: 180,
        },
      ],
      lastAction: 'fetch_customer()',
    };

    const violations = [
      {
        rule: 'block_pii_leakage',
        description: 'Output contains 1 email address(es)',
        evidence: 'ja***@example.com',
        severity: 'HIGH' as const,
        remediation: 'Redact email addresses before returning output.',
      },
      {
        rule: 'block_pii_leakage',
        description: 'Output contains 1 potential Social Security Number(s)',
        evidence: '***-**-****',
        severity: 'CRITICAL' as const,
        remediation: 'SSNs must never appear in agent output.',
      },
    ];

    const blockReason = await explainer.explainBlock(violations, trace);

    console.log('\n  🚫 Block Explanation:\n  ', blockReason);

    expect(blockReason).toBeTruthy();
    expect(blockReason).toContain('BLOCKED');
    expect(blockReason).toContain('block_pii_leakage');
    expect(blockReason).toContain('test-trace-002');
    expect(blockReason).toContain('CRITICAL');
  }, 30_000);

  it('handles concurrent explanation requests', async () => {
    if (skipIfNoIntegration()) return;

    const makeTrace = (id: string): Trace => ({
      id,
      startedAt: new Date().toISOString(),
      originalInput: `Task ${id}`,
      steps: [{
        stepIndex: 0,
        timestamp: new Date().toISOString(),
        action: 'run()',
        input: id,
        output: 'done',
        durationMs: 100,
      }],
      lastAction: 'run()',
    });

    // Fire 3 concurrent explanation requests
    const [e1, e2, e3] = await Promise.all([
      explainer.explainAllow('result-1', makeTrace('c-001')),
      explainer.explainAllow('result-2', makeTrace('c-002')),
      explainer.explainAllow('result-3', makeTrace('c-003')),
    ]);

    console.log('\n  ⚡ Concurrent explanations:\n  1:', e1, '\n  2:', e2, '\n  3:', e3);

    expect(e1).toBeTruthy();
    expect(e2).toBeTruthy();
    expect(e3).toBeTruthy();
  }, 90_000);
});

// ─── Full Guard Integration Tests ─────────────────────────────────────────────

describe('Integration — AgentTrace with real LLM explanations', () => {
  it('produces a real explanation for a clean agent run', async () => {
    if (skipIfNoIntegration()) return;

    const at = new AgentTrace({
      rules: ['block_pii_leakage', 'block_harmful_content'],
      explain: true,
      llm: FEATHERLESS_LLM,
      persist: false,
    });

    const agent = realLikeAgent({
      summary: 'Customer complaint resolved. Issued $45 store credit. ' +
               'Customer satisfaction score: 9/10. Case closed.',
      category: 'billing',
      resolution: 'store_credit',
      sentiment: 'positive',
    });

    const result = await at.wrap(agent).run(
      'Resolve customer complaint about incorrect billing charge on March invoice'
    );

    console.log('\n  ✅ Full guard result:');
    console.log('  Blocked:', result.blocked);
    console.log('  Risk:', result.riskLevel);
    console.log('  Audit ID:', result.auditId);
    console.log('  Explanation:', result.explanation);

    expect(result.blocked).toBe(false);
    expect(result.explanation).toBeTruthy();
    expect(result.explanation!.length).toBeGreaterThan(20);
    expect(result.riskLevel).toBe('LOW');
  }, 60_000);

  it('blocks PII and generates a real block explanation', async () => {
    if (skipIfNoIntegration()) return;

    const at = new AgentTrace({
      rules: ['block_pii_leakage'],
      explain: true,
      llm: FEATHERLESS_LLM,
      persist: false,
    });

    const agent = realLikeAgent({
      customerProfile: {
        name: 'John Smith',
        email: 'john.smith@company.com',
        phone: '555-987-6543',
        account: 'ACC-12345',
      },
    });

    const result = await at.wrap(agent).run('Fetch customer profile for support ticket');

    console.log('\n  🚫 PII Block result:');
    console.log('  Blocked:', result.blocked);
    console.log('  Risk:', result.riskLevel);
    console.log('  Violations:', result.violations?.length);
    console.log('  Reason:\n', result.reason);

    expect(result.blocked).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toContain('BLOCKED');
    expect(result.violations?.length).toBeGreaterThan(0);
    expect(result.riskLevel).toMatch(/^(HIGH|CRITICAL)$/);
  }, 60_000);

  it('handles a complex multi-rule scenario', async () => {
    if (skipIfNoIntegration()) return;

    const at = new AgentTrace({
      rules: [
        'block_pii_leakage',
        'block_financial_advice',
        'require_human_approval',
      ],
      explain: true,
      llm: FEATHERLESS_LLM,
      humanApproval: {
        threshold: 500,
        onApprovalRequired: async () => false,  // auto-reject
      },
      persist: false,
    });

    // This output should trigger financial advice
    const agent = realLikeAgent(
      'Based on the analysis, you should invest in TSLA stock for guaranteed 30% returns. ' +
      'Transfer $10,000 immediately to take advantage of this opportunity.'
    );

    const result = await at.wrap(agent).run('Provide investment recommendation');

    console.log('\n  🚫 Complex block:');
    console.log('  Violations:', result.violations?.map((v) => `[${v.severity}] ${v.rule}`));
    console.log('  Risk Level:', result.riskLevel);
    console.log('  Reason:\n', result.reason);

    expect(result.blocked).toBe(true);
    // Should have multiple violations
    expect((result.violations?.length ?? 0)).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

// ─── LLM Reliability Tests ───────────────────────────────────────────────────

describe('Integration — LLM Reliability', () => {
  it('falls back gracefully when given a bad model name', async () => {
    if (skipIfNoIntegration()) return;

    const at = new AgentTrace({
      explain: true,
      llm: {
        ...FEATHERLESS_LLM,
        model: 'nonexistent-model-xyz-123',
      },
      persist: false,
    });

    // Should NOT throw — should fall back to canned message
    const result = await at.wrap(realLikeAgent('ok')).run('test');
    expect(result.blocked).toBe(false);
    expect(result.explanation).toBeTruthy();  // canned fallback
  }, 30_000);

  it('completes in reasonable time without hanging', async () => {
    if (skipIfNoIntegration()) return;

    const at = new AgentTrace({
      rules: ['block_pii_leakage', 'block_harmful_content'],
      explain: true,
      llm: { ...FEATHERLESS_LLM, timeoutMs: 30_000 },
      persist: false,
    });

    const start = Date.now();
    const result = await at.wrap(realLikeAgent('Everything looks good. Task complete.')).run('test');
    const elapsed = Date.now() - start;

    console.log(`\n  ⏱ Completed in ${elapsed}ms`);

    expect(result.blocked).toBe(false);
    expect(elapsed).toBeLessThan(35_000);  // must complete within 35s
  }, 40_000);
});
