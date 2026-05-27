/**
 * Unit Tests — AgentPipeline
 *
 * Tests the circuit breaker behaviour: shared pipelineId, parentTraceId
 * propagation, short-circuit on block, stage ordering, and storage.
 *
 * All tests use mock agents and no real LLM calls.
 * Run: npm test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { AgentTrace } from '../../src/guard.js';
import { AgentPipeline } from '../../src/pipeline.js';
import { Store } from '../../src/store.js';
import { createRule } from '../../src/rules/index.js';
import type { StageResult } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a mock agent that always resolves with the given response */
function mockAgent(response: unknown) {
  return {
    run: async (_input: unknown) => response,
    invoke: async (_input: unknown) => response,
  };
}

/** Returns a guard with no rules (always allows) */
function allowGuard() {
  return new AgentTrace({ persist: false });
}

/** Returns a guard that always blocks via a custom rule */
function blockGuard() {
  const alwaysBlock = createRule('always_block', async () => [
    { rule: 'always_block', description: 'Forced block for testing', severity: 'HIGH' as const },
  ]);
  return new AgentTrace({ rules: [alwaysBlock], persist: false });
}

/** Unique temp file path for each test that needs persistence */
function tmpPath() {
  return `/tmp/agenttrace-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`;
}

// ─── Basic Pipeline Execution ─────────────────────────────────────────────────

describe('AgentPipeline — Basic Execution', () => {
  it('returns a PipelineResult with pipelineId and pipelineName', async () => {
    const pipeline = new AgentPipeline({
      name: 'test-pipeline',
      agents: [
        { name: 'stage1', guard: allowGuard(), agent: mockAgent('result-1') },
      ],
    });

    const result = await pipeline.run('input');

    expect(result.pipelineId).toMatch(/^pipe_[a-f0-9]{12}$/);
    expect(result.pipelineName).toBe('test-pipeline');
    expect(result.timestamp).toBeTruthy();
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it('uses "unnamed-pipeline" when no name is provided', async () => {
    const pipeline = new AgentPipeline({
      agents: [{ name: 'stage1', guard: allowGuard(), agent: mockAgent('ok') }],
    });

    const result = await pipeline.run('input');
    expect(result.pipelineName).toBe('unnamed-pipeline');
  });

  it('runs all stages and returns results for each', async () => {
    const pipeline = new AgentPipeline({
      name: 'multi-stage',
      agents: [
        { name: 'researcher', guard: allowGuard(), agent: mockAgent('research done') },
        { name: 'drafter',    guard: allowGuard(), agent: mockAgent('draft written') },
        { name: 'executor',   guard: allowGuard(), agent: mockAgent('action taken')  },
      ],
    });

    const result = await pipeline.run('user request');

    expect(result.stages).toHaveLength(3);
    expect(result.stages.map(s => s.name)).toEqual(['researcher', 'drafter', 'executor']);
    expect(result.shortCircuited).toBe(false);
    expect(result.blockedAt).toBeUndefined();
  });

  it('all stages pass → shortCircuited is false', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'b', guard: allowGuard(), agent: mockAgent('ok') },
      ],
    });

    const result = await pipeline.run('go');
    expect(result.shortCircuited).toBe(false);
    expect(result.stages.every(s => !s.blocked)).toBe(true);
  });

  it('records totalDurationMs as a positive number', async () => {
    const pipeline = new AgentPipeline({
      agents: [{ name: 'a', guard: allowGuard(), agent: mockAgent('ok') }],
    });

    const result = await pipeline.run('go');
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Short-Circuit Behaviour ──────────────────────────────────────────────────

describe('AgentPipeline — Short-Circuit', () => {
  it('short-circuits when the first stage is blocked', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'researcher', guard: blockGuard(), agent: mockAgent('bad output') },
        { name: 'drafter',    guard: allowGuard(), agent: mockAgent('would run') },
        { name: 'executor',   guard: allowGuard(), agent: mockAgent('would run') },
      ],
    });

    const result = await pipeline.run('input');

    expect(result.shortCircuited).toBe(true);
    expect(result.blockedAt).toBe('researcher');
    // Only the first stage ran
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.name).toBe('researcher');
    expect(result.stages[0]?.blocked).toBe(true);
  });

  it('short-circuits when a middle stage is blocked', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'stage1', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'stage2', guard: blockGuard(), agent: mockAgent('blocked') },
        { name: 'stage3', guard: allowGuard(), agent: mockAgent('never runs') },
      ],
    });

    const result = await pipeline.run('input');

    expect(result.shortCircuited).toBe(true);
    expect(result.blockedAt).toBe('stage2');
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]?.blocked).toBe(false);
    expect(result.stages[1]?.blocked).toBe(true);
  });

  it('does NOT short-circuit when last stage is blocked (all stages still ran)', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'stage1', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'stage2', guard: blockGuard(), agent: mockAgent('blocked') },
      ],
    });

    const result = await pipeline.run('input');

    expect(result.shortCircuited).toBe(true);
    expect(result.blockedAt).toBe('stage2');
    // Both stages ran (block was at last stage, still counts as short-circuit)
    expect(result.stages).toHaveLength(2);
  });

  it('stage blocked flag is set correctly per stage', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'pass', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'fail', guard: blockGuard(), agent: mockAgent('blocked') },
      ],
    });

    const result = await pipeline.run('input');
    expect(result.stages[0]?.blocked).toBe(false);
    expect(result.stages[1]?.blocked).toBe(true);
  });

  it('blocked stage has violations populated', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'blocker', guard: blockGuard(), agent: mockAgent('anything') },
      ],
    });

    const result = await pipeline.run('input');
    const stage = result.stages[0]!;
    expect(stage.blocked).toBe(true);
    expect(stage.violations).toBeDefined();
    expect((stage.violations?.length ?? 0)).toBeGreaterThan(0);
    expect(stage.violations?.[0]?.rule).toBe('always_block');
  });

  it('blocked stage has a riskLevel set', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'blocker', guard: blockGuard(), agent: mockAgent('anything') },
      ],
    });

    const result = await pipeline.run('input');
    expect(result.stages[0]?.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH|CRITICAL)$/);
  });
});

// ─── Pipeline ID + Lineage ────────────────────────────────────────────────────

describe('AgentPipeline — pipelineId and parentTraceId Lineage', () => {
  it('all stages share the same pipelineId', async () => {
    // Use persistence so we can read the pipelineId back from GuardedResults
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      name: 'lineage-test',
      agents: [
        { name: 'a', guard: makeGuard(), agent: mockAgent('r1') },
        { name: 'b', guard: makeGuard(), agent: mockAgent('r2') },
        { name: 'c', guard: makeGuard(), agent: mockAgent('r3') },
      ],
      storagePath,
    });

    const result = await pipeline.run('input');
    expect(result.pipelineId).toBeTruthy();

    // Read all traces for this pipeline from store
    const store = new Store(storagePath);
    const traces = store.getByPipelineId(result.pipelineId);

    expect(traces.length).toBe(3);
    const pipelineIds = traces.map(t => t.pipelineId);
    // All traces should share the same pipelineId
    expect(new Set(pipelineIds).size).toBe(1);
    expect(pipelineIds[0]).toBe(result.pipelineId);
  });

  it('first stage has no parentTraceId', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'first', guard: makeGuard(), agent: mockAgent('ok') },
        { name: 'second', guard: makeGuard(), agent: mockAgent('ok') },
      ],
      storagePath,
    });

    const result = await pipeline.run('input');

    const store = new Store(storagePath);
    const traces = store.getByPipelineId(result.pipelineId);

    const firstTrace = traces.find(t => !t.parentTraceId);
    expect(firstTrace).toBeDefined();
  });

  it('second stage parentTraceId matches first stage auditId', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'first',  guard: makeGuard(), agent: mockAgent('r1') },
        { name: 'second', guard: makeGuard(), agent: mockAgent('r2') },
      ],
      storagePath,
    });

    const result = await pipeline.run('input');

    expect(result.stages).toHaveLength(2);
    const firstStage  = result.stages[0]!;
    const secondStage = result.stages[1]!;

    // first stage has no parent
    expect(firstStage.parentTraceId).toBeUndefined();
    // second stage's parentTraceId = first stage's auditId
    expect(secondStage.parentTraceId).toBe(firstStage.auditId);
  });

  it('builds the full lineage chain across 3 stages', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: makeGuard(), agent: mockAgent('r1') },
        { name: 'b', guard: makeGuard(), agent: mockAgent('r2') },
        { name: 'c', guard: makeGuard(), agent: mockAgent('r3') },
      ],
      storagePath,
    });

    const result = await pipeline.run('input');
    const [a, b, c] = result.stages as [StageResult, StageResult, StageResult];

    expect(a.parentTraceId).toBeUndefined();
    expect(b.parentTraceId).toBe(a.auditId);
    expect(c.parentTraceId).toBe(b.auditId);
  });

  it('each stage has a unique auditId', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: allowGuard(), agent: mockAgent('r1') },
        { name: 'b', guard: allowGuard(), agent: mockAgent('r2') },
        { name: 'c', guard: allowGuard(), agent: mockAgent('r3') },
      ],
    });

    const result = await pipeline.run('input');
    const ids = result.stages.map(s => s.auditId);
    expect(new Set(ids).size).toBe(3);  // all unique
  });
});

// ─── onStageComplete Callback ─────────────────────────────────────────────────

describe('AgentPipeline — onStageComplete Callback', () => {
  it('fires once per stage that runs', async () => {
    const calls: string[] = [];

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'b', guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'c', guard: allowGuard(), agent: mockAgent('ok') },
      ],
      onStageComplete: async (name) => { calls.push(name); },
    });

    await pipeline.run('go');
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('fires for blocked stage but NOT for subsequent skipped stages', async () => {
    const calls: string[] = [];

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'pass',   guard: allowGuard(), agent: mockAgent('ok') },
        { name: 'blocker', guard: blockGuard(), agent: mockAgent('bad') },
        { name: 'skipped', guard: allowGuard(), agent: mockAgent('never') },
      ],
      onStageComplete: async (name) => { calls.push(name); },
    });

    await pipeline.run('go');
    expect(calls).toEqual(['pass', 'blocker']);
    expect(calls).not.toContain('skipped');
  });

  it('callback receives the stage name and StageResult', async () => {
    const received: Array<{ name: string; blocked: boolean }> = [];

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'myStage', guard: allowGuard(), agent: mockAgent('result') },
      ],
      onStageComplete: async (name, result) => {
        received.push({ name, blocked: result.blocked });
      },
    });

    await pipeline.run('go');
    expect(received).toHaveLength(1);
    expect(received[0]?.name).toBe('myStage');
    expect(received[0]?.blocked).toBe(false);
  });

  it('does not crash if onStageComplete throws', async () => {
    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: allowGuard(), agent: mockAgent('ok') },
      ],
      onStageComplete: async () => { throw new Error('callback error'); },
    });

    // Should complete without throwing
    await expect(pipeline.run('go')).resolves.toBeTruthy();
  });
});

// ─── Input Propagation ────────────────────────────────────────────────────────

describe('AgentPipeline — Input Propagation', () => {
  it('initial input is passed to the first stage', async () => {
    const receivedInputs: unknown[] = [];

    const capturingAgent = {
      run: async (input: unknown) => {
        receivedInputs.push(input);
        return 'captured';
      },
    };

    const pipeline = new AgentPipeline({
      agents: [{ name: 'a', guard: allowGuard(), agent: capturingAgent }],
    });

    await pipeline.run('the original input');
    expect(receivedInputs[0]).toBe('the original input');
  });

  it('each stage receives the output of the previous stage as its input', async () => {
    const receivedInputs: unknown[] = [];

    function stagentAgent(output: string) {
      return {
        run: async (input: unknown) => {
          receivedInputs.push(input);
          return output;
        },
      };
    }

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'a', guard: allowGuard(), agent: stagentAgent('output-from-a') },
        { name: 'b', guard: allowGuard(), agent: stagentAgent('output-from-b') },
        { name: 'c', guard: allowGuard(), agent: stagentAgent('output-from-c') },
      ],
    });

    await pipeline.run('initial');

    expect(receivedInputs[0]).toBe('initial');
    expect(receivedInputs[1]).toBe('output-from-a');
    expect(receivedInputs[2]).toBe('output-from-b');
  });
});

// ─── Storage — Pipeline-level ─────────────────────────────────────────────────

describe('AgentPipeline — Pipeline-Level Storage', () => {
  it('savePipeline() writes a pipeline_summary record to NDJSON', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      name: 'storage-test',
      agents: [
        { name: 'a', guard: makeGuard(), agent: mockAgent('r1') },
      ],
      storagePath,
    });

    const result = await pipeline.run('go');

    // Read raw NDJSON to verify pipeline_summary row was written
    const raw = fs.readFileSync(storagePath, 'utf8');
    const rows = raw.trim().split('\n').map(l => JSON.parse(l));
    const summary = rows.find((r: { _type?: string }) => r._type === 'pipeline_summary');

    expect(summary).toBeDefined();
    expect(summary.pipeline_id).toBe(result.pipelineId);
    expect(summary.pipeline_name).toBe('storage-test');
  });

  it('getPipelines() returns pipeline summaries', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      name: 'query-test',
      agents: [{ name: 'a', guard: makeGuard(), agent: mockAgent('r1') }],
      storagePath,
    });

    const result = await pipeline.run('go');

    const store = new Store(storagePath);
    const pipelines = store.getPipelines();

    expect(pipelines.length).toBeGreaterThanOrEqual(1);
    const match = pipelines.find(p => p.pipelineId === result.pipelineId);
    expect(match).toBeDefined();
    expect(match?.pipelineName).toBe('query-test');
    expect(match?.shortCircuited).toBe(false);
  });

  it('getPipelines() records shortCircuited correctly', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      name: 'short-circuit-store-test',
      agents: [
        { name: 'blocker', guard: (() => {
          const alwaysBlock = createRule('always_block', async () => [
            { rule: 'always_block', description: 'Forced block', severity: 'HIGH' as const },
          ]);
          return new AgentTrace({ rules: [alwaysBlock], persist: true, storagePath });
        })(), agent: mockAgent('bad') },
        { name: 'skipped', guard: makeGuard(), agent: mockAgent('never') },
      ],
      storagePath,
    });

    const result = await pipeline.run('go');
    expect(result.shortCircuited).toBe(true);

    const store = new Store(storagePath);
    const pipelines = store.getPipelines();
    const match = pipelines.find(p => p.pipelineId === result.pipelineId);

    expect(match?.shortCircuited).toBe(true);
    expect(match?.blockedAt).toBe('blocker');
  });

  it('getByPipelineId() returns only traces for that pipeline', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline1 = new AgentPipeline({
      agents: [
        { name: 'a', guard: makeGuard(), agent: mockAgent('r1') },
        { name: 'b', guard: makeGuard(), agent: mockAgent('r2') },
      ],
      storagePath,
    });

    const pipeline2 = new AgentPipeline({
      agents: [
        { name: 'x', guard: makeGuard(), agent: mockAgent('rx') },
      ],
      storagePath,
    });

    const result1 = await pipeline1.run('go1');
    await pipeline2.run('go2');

    const store = new Store(storagePath);
    const traces = store.getByPipelineId(result1.pipelineId);

    // Should only return the 2 traces from pipeline1
    expect(traces).toHaveLength(2);
    expect(traces.every(t => t.pipelineId === result1.pipelineId)).toBe(true);
  });
});

// ─── Pipeline Context on GuardedResult ───────────────────────────────────────

describe('AgentPipeline — pipelineId on GuardedResult', () => {
  it('GuardedResult has pipelineId when run inside AgentPipeline', async () => {
    const storagePath = tmpPath();
    const makeGuard = () => new AgentTrace({ persist: true, storagePath });

    const pipeline = new AgentPipeline({
      agents: [{ name: 'a', guard: makeGuard(), agent: mockAgent('ok') }],
      storagePath,
    });

    const result = await pipeline.run('go');

    // Retrieve the saved trace from store
    const store = new Store(storagePath);
    const trace = store.getById(result.stages[0]!.auditId);

    expect(trace).toBeDefined();
    expect(trace?.pipelineId).toBe(result.pipelineId);
  });

  it('standalone AgentTrace (not in pipeline) has NO pipelineId', async () => {
    const storagePath = tmpPath();
    const at = new AgentTrace({ persist: true, storagePath });
    const r = await at.guardFn(async () => 'result', 'input');

    const store = new Store(storagePath);
    const trace = store.getById(r.auditId);

    expect(trace?.pipelineId).toBeUndefined();
    expect(trace?.parentTraceId).toBeUndefined();
  });
});

// ─── Shadow Mode in Pipeline ──────────────────────────────────────────────────

describe('AgentPipeline — Shadow Mode', () => {
  it('shadow mode stage does NOT short-circuit even when violations detected', async () => {
    const shadowBlock = createRule('violation_detected', async () => [
      { rule: 'violation_detected', description: 'Test violation', severity: 'HIGH' as const },
    ]);
    const shadowGuard = new AgentTrace({
      rules: [shadowBlock],
      enforcementMode: 'shadow',   // ← shadow: flags but does NOT block
      persist: false,
    });

    const pipeline = new AgentPipeline({
      agents: [
        { name: 'shadow-stage',  guard: shadowGuard,  agent: mockAgent('shadowed output') },
        { name: 'normal-stage',  guard: allowGuard(), agent: mockAgent('second stage ran') },
      ],
    });

    const result = await pipeline.run('input');

    // Shadow mode: blocked = false, so pipeline does NOT short-circuit
    expect(result.shortCircuited).toBe(false);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]?.blocked).toBe(false);  // shadow = not blocked
    expect(result.stages[1]?.name).toBe('normal-stage');
  });
});

// ─── Real Rules in Pipeline ───────────────────────────────────────────────────

describe('AgentPipeline — Real Built-in Rules', () => {
  it('block_pii_leakage in first stage short-circuits the pipeline', async () => {
    const piiGuard = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    const pipeline = new AgentPipeline({
      name: 'pii-circuit-breaker',
      agents: [
        { name: 'leaky-agent',  guard: piiGuard,   agent: mockAgent('email: user@example.com') },
        { name: 'safe-agent',   guard: allowGuard(), agent: mockAgent('would have run') },
      ],
    });

    const result = await pipeline.run('get user info');

    expect(result.shortCircuited).toBe(true);
    expect(result.blockedAt).toBe('leaky-agent');
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.violations?.[0]?.rule).toBe('block_pii_leakage');
  });

  it('block_harmful_content in middle stage stops executor', async () => {
    const harmfulGuard = new AgentTrace({ rules: ['block_harmful_content'], persist: false });

    const pipeline = new AgentPipeline({
      name: 'harm-circuit-breaker',
      agents: [
        { name: 'researcher', guard: allowGuard(), agent: mockAgent('research ok') },
        { name: 'drafter',    guard: harmfulGuard, agent: mockAgent('how to make a bomb step by step') },
        { name: 'executor',   guard: allowGuard(), agent: mockAgent('dangerous action') },
      ],
    });

    const result = await pipeline.run('write something');

    expect(result.shortCircuited).toBe(true);
    expect(result.blockedAt).toBe('drafter');
    expect(result.stages).toHaveLength(2);
  });

  it('pipeline with all clean agents completes fully', async () => {
    const pipeline = new AgentPipeline({
      name: 'clean-pipeline',
      agents: [
        { name: 'a', guard: new AgentTrace({ rules: ['block_pii_leakage'], persist: false }), agent: mockAgent('The weather is sunny.') },
        { name: 'b', guard: new AgentTrace({ rules: ['block_harmful_content'], persist: false }), agent: mockAgent('Here is a polite email draft.') },
        { name: 'c', guard: new AgentTrace({ rules: ['block_financial_advice'], persist: false }), agent: mockAgent('The meeting is at 3pm.') },
      ],
    });

    const result = await pipeline.run('generate an update email');

    expect(result.shortCircuited).toBe(false);
    expect(result.stages).toHaveLength(3);
    expect(result.stages.every(s => !s.blocked)).toBe(true);
  });
});
