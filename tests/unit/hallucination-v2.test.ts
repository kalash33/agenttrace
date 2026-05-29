/**
 * Unit Tests — Hallucination Detection v2
 *
 * Tests all four detection layers added in v2:
 *   Layer 1 — Numeric exact-match (SemEval-2024)
 *   Layer 2 — Negation flip detection
 *   Layer 3 — Bigram overlap grounding
 *   Layer 4 — Expanded claim markers
 *
 * Also tests verifyIntegrity() on Store for hash-chain validation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { AgentTrace } from '../../src/guard.js';
import { Store } from '../../src/store.js';
import type { GuardedResult, PipelineResult, Trace } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(output: string) {
  return { async run(_: string) { return output; } };
}

function tmpPath() {
  return `/tmp/agenttrace-v2-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`;
}

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: `trace-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date().toISOString(),
    originalInput: 'test input',
    steps: [],
    lastAction: 'run()',
    ...overrides,
  };
}

function makeResult(overrides: Partial<GuardedResult> = {}): GuardedResult {
  return {
    auditId: 'default-id',
    blocked: false,
    riskLevel: 'LOW',
    auditTrail: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    pipelineId: `pipe_${Math.random().toString(36).slice(2, 14)}`,
    pipelineName: 'test-pipeline',
    stages: [],
    shortCircuited: false,
    totalDurationMs: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Layer 1: Numeric Exact-Match ─────────────────────────────────────────────

describe('Hallucination v2 — Layer 1: Numeric Exact-Match', () => {
  it('blocks when a numeric value in a factual claim is NOT in context (CRITICAL severity)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Patient medication: Metformin 500mg twice daily.'],
    });

    // Agent hallucinates: says 5000mg instead of 500mg
    const result = await guard.guardFn(
      async () => 'According to the patient record, the dose is 5000mg daily.',
      'check medication'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
    const v = result.violations?.find(v => v.rule === 'block_hallucination');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('CRITICAL');
    expect(v?.description).toContain('5000mg');
  });

  it('passes when the numeric value exactly matches context', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Standard dose: Metformin 500mg twice daily.'],
    });

    const result = await guard.guardFn(
      async () => 'According to the formulary, the dose is 500mg daily.',
      'check medication'
    ) as GuardedResult;

    expect(result.blocked).toBe(false);
  });

  it('allows 1% tolerance for numeric values (e.g., 499.5mg vs 500mg)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      // Context uses same words as claim so bigram overlap passes, isolating numeric check
      context: ['According to the formulary, the dose is 500mg daily in the morning.'],
    });

    // 499.5 is within 1% of 500 — should pass numeric check
    const result = await guard.guardFn(
      async () => 'According to the formulary, the dose is 499.5mg daily in the morning.',
      'check'
    ) as GuardedResult;

    // 499.5mg vs 500mg: |499.5-500|/500 = 0.1% → within 1% tolerance → passes
    expect(result.blocked).toBe(false);
  });

  it('blocks when dollar amounts differ significantly (10x hallucination)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Maximum refund is $500.'],
    });

    const result = await guard.guardFn(
      async () => 'According to policy, the maximum refund is $5000.',
      'check refund'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
    const v = result.violations?.find(v => v.rule === 'block_hallucination');
    expect(v?.severity).toBe('CRITICAL');
  });

  it('blocks when percentage is hallucinated', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The interest rate is 3.5%.'],
    });

    const result = await guard.guardFn(
      async () => 'According to the document, the rate is 35%.',
      'check rate'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('does NOT flag small numbers (under 10) without units — too common to be meaningful', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The process has 3 steps.'],
    });

    // "5 steps" vs "3 steps" — small numbers, no unit — should not trigger numeric check
    const result = await guard.guardFn(
      async () => 'According to the guide, the process has 5 steps.',
      'check steps'
    ) as GuardedResult;

    // Should NOT be a CRITICAL numeric violation (may still fail bigram check, but not numeric)
    const v = result.violations?.find(v => v.severity === 'CRITICAL');
    expect(v).toBeUndefined();
  });
});

// ─── Layer 2: Negation Flip Detection ────────────────────────────────────────

describe('Hallucination v2 — Layer 2: Negation Flip Detection', () => {
  it('blocks when agent negates a required approval stated in context', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Refunds over $200 require supervisor approval.'],
    });

    const result = await guard.guardFn(
      async () => 'Based on the policy, no approval is needed for any refund amount.',
      'check policy'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
    const v = result.violations?.find(v => v.rule === 'block_hallucination');
    expect(v).toBeDefined();
    // Violation should mention contradiction (either 'negation' or 'contradict')
    expect(v?.description).toMatch(/negation|contradict|grounded/i);
  });

  it('blocks when agent says "no limit" but context specifies a maximum', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The maximum transaction limit is $10,000 per day.'],
    });

    const result = await guard.guardFn(
      async () => 'According to the policy, there is no limit on daily transactions.',
      'check limits'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('passes when agent correctly states a requirement that exists in context', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Manager approval is required for all purchases over $1000.'],
    });

    const result = await guard.guardFn(
      async () => 'According to policy, manager approval is required for purchases over $1000.',
      'check'
    ) as GuardedResult;

    expect(result.blocked).toBe(false);
  });
});

// ─── Layer 3: Bigram Overlap ──────────────────────────────────────────────────

describe('Hallucination v2 — Layer 3: Bigram Overlap Grounding', () => {
  it('blocks when most bigrams in claim are absent from context', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The server uses PostgreSQL version 14.'],
    });

    // Claim about MongoDB has no overlap with PostgreSQL context
    const result = await guard.guardFn(
      async () => 'According to the specification, the system uses MongoDB version 6 with sharding enabled.',
      'check db'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('passes when agent paraphrases context correctly (bigrams partially match)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The maximum refund is five hundred dollars and requires supervisor sign-off for all amounts.'],
    });

    // Paraphrase using same words — all meaningful tokens present in context
    const result = await guard.guardFn(
      async () => 'According to the refund policy, supervisor sign-off is required and the maximum refund applies to all amounts.',
      'check'
    ) as GuardedResult;

    expect(result.blocked).toBe(false);
  });
});

// ─── Layer 4: Expanded Claim Markers ─────────────────────────────────────────

describe('Hallucination v2 — Layer 4: Expanded Claim Markers', () => {
  it('detects "based on the" as a factual claim marker', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['Company policy: 15 days paid leave per year.'],
    });

    const result = await guard.guardFn(
      async () => 'Based on the company policy, employees receive 45 days paid leave per year.',
      'check policy'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('detects "per the" as a factual claim marker', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['SLA: Response time must be under 200ms.'],
    });

    const result = await guard.guardFn(
      async () => 'Per the SLA, response time must be under 2000ms.',
      'check sla'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('detects "as stated in" as a factual claim marker when content is not in context', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      // Context does NOT contain 'optional' - agent inverts the rule
      context: ['The document: All users must use two-factor authentication without exception.'],
    });

    const result = await guard.guardFn(
      // 'as stated in' marker + content NOT in context ("optional" directly contradicts "must")
      async () => 'As stated in the document, two-factor authentication is completely optional.',
      'check auth'
    ) as GuardedResult;

    expect(result.blocked).toBe(true);
  });

  it('does NOT flag non-claim sentences (questions, conditionals)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The API endpoint is /v1/users.'],
    });

    // No claim markers — just a statement of suggestion
    const result = await guard.guardFn(
      async () => 'You might want to check the endpoint. Consider using /v2/users if needed.',
      'check'
    ) as GuardedResult;

    expect(result.blocked).toBe(false);
  });
});

// ─── No Context = No Check ────────────────────────────────────────────────────

describe('Hallucination v2 — Context Requirement', () => {
  it('returns no violations when no context provided (cannot check)', async () => {
    const guard = new AgentTrace({
      rules: ['block_hallucination'],
      // No context provided
    });

    const result = await guard.guardFn(
      async () => 'According to the data, the value is 99999.',
      'check'
    ) as GuardedResult;

    expect(result.blocked).toBe(false);
    expect(result.violations ?? []).toHaveLength(0);
  });
});

// ─── Store: Hash-Chained Audit Trail ─────────────────────────────────────────

describe('Store v2 — Hash-Chained Audit Trail', () => {
  it('writes row_hash and prev_hash fields to every record', () => {
    const store = new Store(tmpPath());
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));

    const raw = fs.readFileSync((store as unknown as { filePath: string }).filePath, 'utf8');
    const record = JSON.parse(raw.trim());

    expect(typeof record.row_hash).toBe('string');
    expect(record.row_hash).toHaveLength(64);  // SHA-256 hex
    expect(typeof record.prev_hash).toBe('string');
    expect(record.prev_hash).toHaveLength(64);
  });

  it('first record has genesis prev_hash (all zeros)', () => {
    const store = new Store(tmpPath());
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));

    const raw = fs.readFileSync((store as unknown as { filePath: string }).filePath, 'utf8');
    const record = JSON.parse(raw.trim());

    expect(record.prev_hash).toBe('0'.repeat(64));
  });

  it('second record prev_hash equals first record row_hash', () => {
    const store = new Store(tmpPath());
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));

    const raw = fs.readFileSync((store as unknown as { filePath: string }).filePath, 'utf8');
    const [line1, line2] = raw.trim().split('\n');
    const r1 = JSON.parse(line1!);
    const r2 = JSON.parse(line2!);

    expect(r2.prev_hash).toBe(r1.row_hash);
  });

  it('sequence numbers are monotonically increasing', () => {
    const store = new Store(tmpPath());
    for (let i = 0; i < 5; i++) {
      store.save(makeTrace({ id: `t${i}` }), makeResult({ auditId: `t${i}` }));
    }

    const raw = fs.readFileSync((store as unknown as { filePath: string }).filePath, 'utf8');
    const records = raw.trim().split('\n').map(l => JSON.parse(l));
    const seqs = records.map((r: { seq: number }) => r.seq);

    expect(seqs).toEqual([0, 1, 2, 3, 4]);
  });

  it('verifyIntegrity() returns intact=true for unmodified file', () => {
    const store = new Store(tmpPath());
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));
    store.save(makeTrace({ id: 't3' }), makeResult({ auditId: 't3' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_1' }));

    const report = store.verifyIntegrity();

    expect(report.intact).toBe(true);
    expect(report.brokenLinks).toHaveLength(0);
    expect(report.sequenceGaps).toHaveLength(0);
    expect(report.totalRecords).toBe(4);
  });

  it('verifyIntegrity() detects a tampered record (broken row_hash)', () => {
    const filePath = tmpPath();
    const store = new Store(filePath);
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));

    // Tamper: read file, modify content of first record, write back
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.trim().split('\n');
    const r1 = JSON.parse(lines[0]!);
    r1.blocked = true;  // ← tampered field
    lines[0] = JSON.stringify(r1);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');

    const report = store.verifyIntegrity();

    expect(report.intact).toBe(false);
    expect(report.brokenLinks.length).toBeGreaterThan(0);
  });

  it('verifyIntegrity() detects a broken chain when prev_hash does not match', () => {
    const filePath = tmpPath();
    const store = new Store(filePath);
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));

    // Tamper: break the chain by setting wrong prev_hash on record 2
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.trim().split('\n');
    const r2 = JSON.parse(lines[1]!);
    r2.prev_hash = 'a'.repeat(64);  // ← wrong prev_hash
    lines[1] = JSON.stringify(r2);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');

    const report = store.verifyIntegrity();

    expect(report.intact).toBe(false);
    // Should flag both the broken chain AND the broken row_hash (since we modified r2)
    expect(report.brokenLinks.length).toBeGreaterThan(0);
  });

  it('verifyIntegrity() marks legacy records (pre-v2) without failing them', () => {
    const filePath = tmpPath();

    // Write a legacy record (no hash fields)
    const legacyRecord = {
      id: 'legacy-trace',
      started_at: new Date().toISOString(),
      input: 'test',
      steps: [],
      blocked: false,
      risk_level: 'LOW',
      explanation: null,
      reason: null,
      violations: null,
      result: null,
      created_at: new Date().toISOString(),
      // No: seq, prev_hash, row_hash
    };
    fs.writeFileSync(filePath, JSON.stringify(legacyRecord) + '\n', 'utf8');

    const store = new Store(filePath);
    const report = store.verifyIntegrity();

    expect(report.legacyRecords).toBe(1);
    expect(report.intact).toBe(true);  // Legacy records don't break the integrity check
  });
});
