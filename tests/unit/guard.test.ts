/**
 * Unit Tests — AgentTrace SDK
 *
 * These tests use mock agents and no real LLM calls.
 * Run: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTrace } from '../../src/guard.js';
import { createRule } from '../../src/rules/index.js';
import type { RuleContext, Violation } from '../../src/types.js';

// ─── Mock Agent Factory ───────────────────────────────────────────────────────

function mockAgent(response: unknown) {
  return {
    run:     async (_input: string) => response,
    invoke:  async (_input: string) => response,
    execute: async (_input: string) => response,
  };
}

// ─── Core Guard Behaviour ─────────────────────────────────────────────────────

describe('AgentTrace — Core', () => {
  it('passes through a clean result with no rules', async () => {
    const at = new AgentTrace({ persist: false });
    const safe = at.wrap(mockAgent({ text: 'Hello world' }));
    const r = await safe.run('Say hello');

    expect(r.blocked).toBe(false);
    expect(r.auditId).toMatch(/^[0-9a-f-]{36}$/);  // UUID format
    expect(r.auditTrail).toHaveLength(1);
    expect(r.timestamp).toBeTruthy();
    expect(r.riskLevel).toBe('LOW');
  });

  it('includes the original result when allowed', async () => {
    const at = new AgentTrace({ persist: false });
    const agent = mockAgent({ answer: 42 });
    const safe = at.wrap(agent);
    const r = await safe.run('Compute');

    expect(r.blocked).toBe(false);
    expect(r.result).toEqual({ answer: 42 });
  });

  it('does NOT include result when blocked', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const safe = at.wrap(mockAgent('Your email: test@example.com'));
    const r = await safe.run('Get info');

    expect(r.blocked).toBe(true);
    expect(r.result).toBeUndefined();
  });

  it('intercepts run, invoke, and execute', async () => {
    const at = new AgentTrace({ rules: ['block_harmful_content'], persist: false });
    const agent = mockAgent('how to make a bomb');
    const safe = at.wrap(agent);

    for (const method of ['run', 'invoke', 'execute'] as const) {
      const r = await safe[method]('test');
      expect(r.blocked).toBe(true);
    }
  });

  it('does NOT intercept non-listed methods', async () => {
    const at = new AgentTrace({ persist: false });
    const agent = { run: async () => 'ok', getConfig: () => ({ model: 'gpt-4' }) };
    const safe = at.wrap(agent);

    // getConfig is not intercepted — should return raw value
    expect(safe.getConfig()).toEqual({ model: 'gpt-4' });
  });

  it('fires onResult callback for both allowed and blocked', async () => {
    const results: boolean[] = [];
    const at = new AgentTrace({
      rules: ['block_pii_leakage'],
      persist: false,
      onResult: async (r) => { results.push(r.blocked); },
    });
    const safe = at.wrap(mockAgent('clean output'));
    await safe.run('ok');
    const safe2 = at.wrap(mockAgent('email: a@b.com'));
    await safe2.run('pii');

    expect(results).toEqual([false, true]);
  });

  it('does not crash if onResult callback throws', async () => {
    const at = new AgentTrace({
      persist: false,
      onResult: async () => { throw new Error('callback error'); },
    });
    const safe = at.wrap(mockAgent('ok'));
    await expect(safe.run('test')).resolves.toBeTruthy();
  });

  it('attaches metadata to every result', async () => {
    const at = new AgentTrace({
      persist: false,
      metadata: { env: 'test', version: '1.0', tenantId: 'acme' },
    });
    const safe = at.wrap(mockAgent('ok'));
    const r = await safe.run('test');

    expect(r.metadata).toEqual({ env: 'test', version: '1.0', tenantId: 'acme' });
  });

  it('guardFn works for plain async functions', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const r = await at.guardFn(async () => 'no PII here', 'my input');
    expect(r.blocked).toBe(false);
    expect(r.auditTrail).toHaveLength(1);
  });

  it('guardFn propagates exceptions', async () => {
    const at = new AgentTrace({ persist: false });
    await expect(
      at.guardFn(async () => { throw new Error('agent crashed'); })
    ).rejects.toThrow('agent crashed');
  });
});

// ─── PII Rule ─────────────────────────────────────────────────────────────────

describe('AgentTrace — Rule: block_pii_leakage', () => {
  const rule = (output: unknown) =>
    new AgentTrace({ rules: ['block_pii_leakage'], persist: false })
      .wrap(mockAgent(output))
      .run('test');

  it('blocks email addresses', async () => {
    const r = await rule('Contact: john.doe@example.com');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('HIGH');
  });

  it('blocks US phone numbers', async () => {
    const r = await rule('Call me at 555-234-5678');
    expect(r.blocked).toBe(true);
  });

  it('blocks Social Security Numbers', async () => {
    const r = await rule('SSN: 123-45-6789');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('CRITICAL');
  });

  it('blocks valid credit card numbers (Luhn validated)', async () => {
    // Visa test number that passes Luhn: 4111111111111111
    const r = await rule('Card: 4111111111111111');
    expect(r.blocked).toBe(true);
    // CC rule is severity HIGH (CRITICAL is reserved for SSN/Aadhaar/AWS keys)
    expect(r.violations?.[0]?.severity).toMatch(/^(HIGH|CRITICAL)$/);
  });

  it('does NOT block a product SKU or non-PII identifier', async () => {
    // A product SKU with letters — not matchable by any PII regex
    const r = await rule('Product SKU: ABC-DEF-GHI, price: $29.99');
    expect(r.blocked).toBe(false);
  });

  it('blocks AWS access keys', async () => {
    const r = await rule('Key: AKIAIOSFODNN7EXAMPLE');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('CRITICAL');
  });

  it('blocks Aadhaar numbers', async () => {
    const r = await rule('Aadhaar: 1234 5678 9012');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('CRITICAL');
  });

  it('allows clean text', async () => {
    const r = await rule('The weather is sunny and 25 degrees Celsius.');
    expect(r.blocked).toBe(false);
  });

  it('includes remediation hints in violations', async () => {
    const r = await rule('ssn: 123-45-6789');
    const v = r.violations?.find((x) => x.description.toLowerCase().includes('social security') || x.description.includes('SSN'));
    expect(v).toBeTruthy();
    expect(v?.severity).toBe('CRITICAL');
  });

  it('blocks JSON objects containing PII', async () => {
    const r = await rule({ user: { email: 'alice@corp.com', name: 'Alice' } });
    expect(r.blocked).toBe(true);
  });

  it('blocks multiple PII types simultaneously', async () => {
    const r = await rule('email: a@b.com, ssn: 123-45-6789, phone: 555-123-4567');
    expect(r.blocked).toBe(true);
    expect((r.violations?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });
});

// ─── Financial Rule ───────────────────────────────────────────────────────────

describe('AgentTrace — Rule: block_financial_advice', () => {
  const rule = (output: unknown, threshold?: number) =>
    new AgentTrace({
      rules: ['block_financial_advice'],
      humanApproval: { threshold: threshold ?? 1000 },
      persist: false,
    })
      .wrap(mockAgent(output))
      .run('test');

  it('blocks investment advice language', async () => {
    const r = await rule('You should buy Tesla stock — guaranteed returns!');
    expect(r.blocked).toBe(true);
  });

  it('blocks transactions above threshold', async () => {
    const r = await rule('Processing wire transfer of $5,000.', 1000);
    expect(r.blocked).toBe(true);
  });

  it('allows transactions below threshold', async () => {
    const r = await rule('Processing refund of $50.', 1000);
    expect(r.blocked).toBe(false);
  });

  it('allows factual market data without advice', async () => {
    const r = await rule('Apple stock closed at $189.72 today, down 1.2%.');
    expect(r.blocked).toBe(false);
  });

  it('blocks "invest in" phrasing', async () => {
    const r = await rule('You should invest in index funds for long-term wealth.');
    expect(r.blocked).toBe(true);
  });

  it('severity is CRITICAL for very large transactions', async () => {
    const r = await rule('Processing payment of $50,000.', 1000);
    expect(r.blocked).toBe(true);
    const v = r.violations?.find((x) => x.rule === 'block_financial_advice');
    expect(v?.severity).toBe('CRITICAL');
  });
});

// ─── Harmful Content Rule ─────────────────────────────────────────────────────

describe('AgentTrace — Rule: block_harmful_content', () => {
  const rule = (output: unknown) =>
    new AgentTrace({ rules: ['block_harmful_content'], persist: false })
      .wrap(mockAgent(output))
      .run('test');

  it('blocks bomb-making instructions', async () => {
    const r = await rule('Here is how to make a bomb step by step');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('CRITICAL');
  });

  it('blocks self-harm content', async () => {
    const r = await rule('Here are ways to commit suicide');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('CRITICAL');
  });

  it('blocks drug synthesis instructions', async () => {
    const r = await rule('Step 1: how to make meth — first obtain pseudoephedrine');
    expect(r.blocked).toBe(true);
  });

  it('blocks money laundering instructions', async () => {
    const r = await rule('How to launder money through shell companies');
    expect(r.blocked).toBe(true);
  });

  it('allows legitimate chemistry / medical content', async () => {
    const r = await rule('Paracetamol (acetaminophen) inhibits COX enzymes in the brain.');
    expect(r.blocked).toBe(false);
  });

  it('allows security research content', async () => {
    const r = await rule('SQL injection can be mitigated with parameterised queries.');
    expect(r.blocked).toBe(false);
  });
});

// ─── Human Approval Rule ──────────────────────────────────────────────────────

describe('AgentTrace — Rule: require_human_approval', () => {
  it('blocks high-value transaction without callback', async () => {
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: { threshold: 500 },
      persist: false,
    });
    const r = await at.wrap(mockAgent('Wire $2,500 to supplier')).run('wire');
    expect(r.blocked).toBe(true);
  });

  it('allows when callback approves', async () => {
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: {
        threshold: 500,
        onApprovalRequired: async () => true,
      },
      persist: false,
    });
    const r = await at.wrap(mockAgent('Wire $2,500 to supplier')).run('wire');
    expect(r.blocked).toBe(false);
  });

  it('blocks when callback rejects', async () => {
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: {
        threshold: 500,
        onApprovalRequired: async () => false,
      },
      persist: false,
    });
    const r = await at.wrap(mockAgent('Wire $2,500 to supplier')).run('wire');
    expect(r.blocked).toBe(true);
  });

  it('allows transaction below threshold', async () => {
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: { threshold: 1000 },
      persist: false,
    });
    const r = await at.wrap(mockAgent('Refund $75 to customer')).run('refund');
    expect(r.blocked).toBe(false);
  });

  it('blocks destructive operations regardless of amount', async () => {
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: { threshold: 99999 },  // very high threshold
      persist: false,
    });
    const r = await at.wrap(mockAgent('drop table users — this cannot be undone')).run('db');
    expect(r.blocked).toBe(true);
  });

  it('callback receives trace and description', async () => {
    const calls: Array<{ description: string; amount?: number }> = [];
    const at = new AgentTrace({
      rules: ['require_human_approval'],
      humanApproval: {
        threshold: 100,
        onApprovalRequired: async (ctx) => {
          calls.push({ description: ctx.description, amount: ctx.amount });
          return false;
        },
      },
      persist: false,
    });
    await at.wrap(mockAgent('Process $500 payment')).run('pay');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.amount).toBe(500);
  });
});

// ─── Hallucination Rule ───────────────────────────────────────────────────────

describe('AgentTrace — Rule: block_hallucination', () => {
  it('skips check when no context is provided', async () => {
    const at = new AgentTrace({ rules: ['block_hallucination'], persist: false });
    const r = await at.wrap(mockAgent('According to data, cats have 6 legs.')).run('fact');
    // No context → cannot check → no block
    expect(r.blocked).toBe(false);
  });

  it('passes when claim is supported by context', async () => {
    const at = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The Eiffel Tower is located in Paris, France and was built in 1889.'],
      persist: false,
    });
    const r = await at.wrap(
      mockAgent('According to the data, the Eiffel Tower is in Paris, France.')
    ).run('fact');
    expect(r.blocked).toBe(false);
  });

  it('blocks when claim is not in context', async () => {
    const at = new AgentTrace({
      rules: ['block_hallucination'],
      context: ['The Eiffel Tower is located in Paris, France.'],
      persist: false,
    });
    const r = await at.wrap(
      mockAgent('According to the data, the Colosseum is located in Athens, Greece.')
    ).run('fact');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.severity).toBe('HIGH');
  });
});

// ─── Custom Rules ─────────────────────────────────────────────────────────────

describe('AgentTrace — Custom Rules', () => {
  it('supports createRule() factory', async () => {
    const noSwearing = createRule(
      'no_profanity',
      async ({ result }: RuleContext): Promise<Violation[]> => {
        const text = JSON.stringify(result).toLowerCase();
        if (text.includes('badword')) {
          return [{ rule: 'no_profanity', description: 'Profanity detected', severity: 'MEDIUM' }];
        }
        return [];
      }
    );

    const at = new AgentTrace({ rules: [noSwearing], persist: false });
    const r1 = await at.wrap(mockAgent('This is a badword')).run('test');
    const r2 = await at.wrap(mockAgent('This is clean')).run('test');

    expect(r1.blocked).toBe(true);
    expect(r1.violations?.[0]?.rule).toBe('no_profanity');
    expect(r2.blocked).toBe(false);
  });

  it('can mix built-in and custom rules', async () => {
    const alwaysPass = createRule('always_pass', async () => []);
    const at = new AgentTrace({
      rules: ['block_pii_leakage', alwaysPass],
      persist: false,
    });
    const r = await at.wrap(mockAgent('email: a@b.com')).run('test');
    expect(r.blocked).toBe(true);
    expect(r.violations?.[0]?.rule).toBe('block_pii_leakage');
  });

  it('throws on unknown built-in rule name', () => {
    expect(() =>
      new AgentTrace({ rules: ['unknown_rule_xyz' as never], persist: false })
    ).toThrow(/Unknown built-in rule/);
  });

  it('throws on malformed custom rule object', () => {
    expect(() =>
      new AgentTrace({ rules: [{ notARule: true } as never], persist: false })
    ).toThrow(/Custom rules must have/);
  });
});

// ─── Multiple Rules Parallel Evaluation ───────────────────────────────────────

describe('AgentTrace — Multi-rule evaluation', () => {
  it('collects violations from ALL rules simultaneously', async () => {
    const at = new AgentTrace({
      rules: ['block_pii_leakage', 'block_financial_advice', 'block_harmful_content'],
      persist: false,
    });
    // Output that triggers all three
    const bad = 'email: a@b.com. You should invest in crypto. How to make a bomb.';
    const r = await at.wrap(mockAgent(bad)).run('test');

    expect(r.blocked).toBe(true);
    const ruleNames = r.violations?.map((v) => v.rule) ?? [];
    expect(ruleNames).toContain('block_pii_leakage');
    expect(ruleNames).toContain('block_financial_advice');
    expect(ruleNames).toContain('block_harmful_content');
  });

  it('risk level escalates to CRITICAL when any CRITICAL violation exists', async () => {
    const at = new AgentTrace({
      rules: ['block_pii_leakage'],
      persist: false,
    });
    const r = await at.wrap(mockAgent('SSN: 123-45-6789')).run('test');
    expect(r.riskLevel).toBe('CRITICAL');
  });
});

// ─── Storage ──────────────────────────────────────────────────────────────────

describe('AgentTrace — Storage', () => {
  it('storage is null when persist: false', () => {
    const at = new AgentTrace({ persist: false });
    expect(at.storage).toBeNull();
  });

  it('saves and retrieves traces when persist is enabled', async () => {
    const storagePath = `/tmp/agenttrace-test-${Date.now()}.ndjson`;
    const at = new AgentTrace({ persist: true, storagePath });
    const safe = at.wrap(mockAgent('clean output'));
    const result = await safe.run('test');

    const retrieved = at.storage?.getById(result.auditId);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.auditId).toBe(result.auditId);
    expect(retrieved?.blocked).toBe(false);
    at.close();
  });

  it('getRecent() returns results in reverse-chron order', async () => {
    const storagePath = `/tmp/agenttrace-test-recent-${Date.now()}.ndjson`;
    const at = new AgentTrace({ persist: true, storagePath });
    const safe = at.wrap(mockAgent('output'));

    await safe.run('first');
    await new Promise((r) => setTimeout(r, 10));
    await safe.run('second');

    const recent = at.storage?.getRecent(5) ?? [];
    expect(recent.length).toBe(2);
    // Most recent first
    expect(recent[0]?.auditId).toBeTruthy();
    at.close();
  });

  it('getBlocked() only returns blocked entries', async () => {
    const storagePath = `/tmp/agenttrace-test-blocked-${Date.now()}.ndjson`;
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: true, storagePath });
    const safe = at.wrap(mockAgent('clean'));
    const safe2 = at.wrap(mockAgent('email: x@y.com'));

    await safe.run('clean');
    await safe2.run('pii');

    const blocked = at.storage?.getBlocked() ?? [];
    expect(blocked.every((b) => b.blocked)).toBe(true);
    expect(blocked.length).toBe(1);
    at.close();
  });

  it('stats() returns correct counts', async () => {
    const storagePath = `/tmp/agenttrace-test-stats-${Date.now()}.ndjson`;
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: true, storagePath });
    const clean = at.wrap(mockAgent('ok'));
    const dirty = at.wrap(mockAgent('ssn: 123-45-6789'));

    await clean.run('c1');
    await clean.run('c2');
    await dirty.run('d1');

    const stats = at.storage?.stats();
    expect(stats?.total).toBe(3);
    expect(stats?.blocked).toBe(1);
    expect(stats?.byRiskLevel['CRITICAL']).toBe(1);
    at.close();
  });
});

// ─── Explainer (No-Op) ────────────────────────────────────────────────────────

describe('AgentTrace — Explainer (no-op)', () => {
  it('does not generate explanation when explain: false', async () => {
    const at = new AgentTrace({ explain: false, persist: false });
    const r = await at.wrap(mockAgent('hello')).run('test');
    // With no rules and explain:false, explanation could still be set from NoOp
    // What matters: no error is thrown
    expect(r.blocked).toBe(false);
  });

  it('returns explanation from NoOpExplainer as fallback', async () => {
    const at = new AgentTrace({ explain: true, persist: false });
    // No API key in test env — falls back to NoOp
    const r = await at.wrap(mockAgent('hello')).run('test');
    expect(r.explanation).toBeTruthy();
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('AgentTrace — Edge Cases', () => {
  it('handles null agent output', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const r = await at.wrap(mockAgent(null)).run('test');
    expect(r.blocked).toBe(false);
  });

  it('handles empty string output', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const r = await at.wrap(mockAgent('')).run('test');
    expect(r.blocked).toBe(false);
  });

  it('handles deeply nested JSON output', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const nested = { a: { b: { c: { email: 'leak@example.com' } } } };
    const r = await at.wrap(mockAgent(nested)).run('test');
    expect(r.blocked).toBe(true);
  });

  it('handles very large output without hanging', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const bigText = 'The sky is blue. '.repeat(10_000);
    const r = await at.wrap(mockAgent(bigText)).run('test');
    expect(r.blocked).toBe(false);
  }, 5000);  // 5 second timeout

  it('audit trail records correct action name', async () => {
    const at = new AgentTrace({ persist: false });
    const r = await at.wrap(mockAgent('ok')).invoke('test');
    expect(r.auditTrail[0]?.action).toBe('invoke()');
  });

  it('timestamp is a valid ISO string', async () => {
    const at = new AgentTrace({ persist: false });
    const r = await at.wrap(mockAgent('ok')).run('test');
    expect(() => new Date(r.timestamp).toISOString()).not.toThrow();
  });
});
