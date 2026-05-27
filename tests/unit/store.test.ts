/**
 * Unit Tests — Store (new pipeline methods)
 *
 * Tests the new pipeline-related methods added to Store:
 * - save() — now persists pipelineId, parentTraceId, agentName
 * - savePipeline() — writes a pipeline_summary row
 * - getPipelines() — queries pipeline summaries
 * - getByPipelineId() — returns all traces for a pipeline
 * - Existing methods (getById, getRecent, getBlocked, stats) still work correctly
 *   when the NDJSON file contains a mix of trace rows and pipeline_summary rows
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { Store } from '../../src/store.js';
import type { GuardedResult, PipelineResult, Trace } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpPath() {
  return `/tmp/agenttrace-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`;
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

// ─── save() — Pipeline Field Persistence ──────────────────────────────────────

describe('Store — save() with pipeline fields', () => {
  it('persists pipelineId when trace has one', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const trace = makeTrace({ id: 'trace-1', pipelineId: 'pipe_abc' });
    const result = makeResult({ auditId: 'trace-1' });

    store.save(trace, result);

    const retrieved = store.getById('trace-1');
    expect(retrieved?.pipelineId).toBe('pipe_abc');
  });

  it('persists parentTraceId when trace has one', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const trace = makeTrace({ id: 'trace-2', parentTraceId: 'parent-trace-id' });
    const result = makeResult({ auditId: 'trace-2' });

    store.save(trace, result);

    const retrieved = store.getById('trace-2');
    expect(retrieved?.parentTraceId).toBe('parent-trace-id');
  });

  it('pipelineId is undefined for standalone traces', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const trace = makeTrace({ id: 'trace-standalone' });  // no pipelineId
    const result = makeResult({ auditId: 'trace-standalone' });

    store.save(trace, result);

    const retrieved = store.getById('trace-standalone');
    expect(retrieved?.pipelineId).toBeUndefined();
    expect(retrieved?.parentTraceId).toBeUndefined();
  });

  it('saves and retrieves all standard fields correctly alongside pipeline fields', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const trace = makeTrace({ id: 'trace-full', pipelineId: 'pipe_xyz', parentTraceId: 'parent-id' });
    const result = makeResult({
      auditId: 'trace-full',
      blocked: true,
      riskLevel: 'HIGH',
      violations: [{ rule: 'block_pii_leakage', description: 'email found', severity: 'HIGH' }],
    });

    store.save(trace, result);

    const retrieved = store.getById('trace-full');
    expect(retrieved?.blocked).toBe(true);
    expect(retrieved?.riskLevel).toBe('HIGH');
    expect(retrieved?.pipelineId).toBe('pipe_xyz');
    expect(retrieved?.parentTraceId).toBe('parent-id');
    expect(retrieved?.violations?.[0]?.rule).toBe('block_pii_leakage');
  });
});

// ─── savePipeline() ───────────────────────────────────────────────────────────

describe('Store — savePipeline()', () => {
  it('writes a pipeline_summary row to the NDJSON file', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const pipeline = makePipelineResult({ pipelineId: 'pipe_save_test', pipelineName: 'my-pipe' });

    store.savePipeline(pipeline);

    const raw = fs.readFileSync(storagePath, 'utf8');
    const rows = raw.trim().split('\n').map(l => JSON.parse(l));
    const summary = rows.find((r: { _type?: string }) => r._type === 'pipeline_summary');

    expect(summary).toBeDefined();
    expect(summary.pipeline_id).toBe('pipe_save_test');
    expect(summary.pipeline_name).toBe('my-pipe');
  });

  it('persists shortCircuited and blockedAt correctly', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const pipeline = makePipelineResult({
      shortCircuited: true,
      blockedAt: 'researcher',
    });

    store.savePipeline(pipeline);

    const pipelines = store.getPipelines();
    expect(pipelines[0]?.shortCircuited).toBe(true);
    expect(pipelines[0]?.blockedAt).toBe('researcher');
  });

  it('persists totalDurationMs and timestamp', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    const ts = new Date().toISOString();
    const pipeline = makePipelineResult({ totalDurationMs: 1234, timestamp: ts });

    store.savePipeline(pipeline);

    const pipelines = store.getPipelines();
    expect(pipelines[0]?.totalDurationMs).toBe(1234);
    expect(pipelines[0]?.timestamp).toBe(ts);
  });

  it('multiple pipelines are all persisted', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_1', pipelineName: 'pipe-one' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_2', pipelineName: 'pipe-two' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_3', pipelineName: 'pipe-three' }));

    const pipelines = store.getPipelines(10);
    expect(pipelines.length).toBe(3);
  });
});

// ─── getPipelines() ───────────────────────────────────────────────────────────

describe('Store — getPipelines()', () => {
  it('returns empty array when no pipeline summaries exist', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    // Only save trace rows, no pipeline summaries
    store.save(makeTrace({ id: 'only-trace' }), makeResult({ auditId: 'only-trace' }));

    expect(store.getPipelines()).toHaveLength(0);
  });

  it('returns only pipeline_summary records, not trace records', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    // Mix of trace rows and pipeline summary
    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_only' }));

    const pipelines = store.getPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.pipelineId).toBe('pipe_only');
  });

  it('respects the limit parameter', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    for (let i = 0; i < 10; i++) {
      store.savePipeline(makePipelineResult({ pipelineId: `pipe_${i}` }));
    }

    expect(store.getPipelines(3)).toHaveLength(3);
  });

  it('returns pipelines in reverse-chronological order (most recent first)', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_first',  pipelineName: 'first' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_second', pipelineName: 'second' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_third',  pipelineName: 'third' }));

    const pipelines = store.getPipelines();
    // Most recent (third) should come first
    expect(pipelines[0]?.pipelineName).toBe('third');
    expect(pipelines[2]?.pipelineName).toBe('first');
  });

  it('correctly maps shortCircuited=false when pipeline completed successfully', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);
    store.savePipeline(makePipelineResult({ shortCircuited: false, blockedAt: undefined }));

    const pipelines = store.getPipelines();
    expect(pipelines[0]?.shortCircuited).toBe(false);
    expect(pipelines[0]?.blockedAt).toBeUndefined();
  });
});

// ─── getByPipelineId() ────────────────────────────────────────────────────────

describe('Store — getByPipelineId()', () => {
  it('returns empty array when no traces match the pipelineId', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 't1', pipelineId: 'pipe_other' }), makeResult({ auditId: 't1' }));

    expect(store.getByPipelineId('pipe_nonexistent')).toHaveLength(0);
  });

  it('returns only traces matching the given pipelineId', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 't1', pipelineId: 'pipe_A' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2', pipelineId: 'pipe_A' }), makeResult({ auditId: 't2' }));
    store.save(makeTrace({ id: 't3', pipelineId: 'pipe_B' }), makeResult({ auditId: 't3' }));
    store.save(makeTrace({ id: 't4' }), makeResult({ auditId: 't4' }));  // standalone

    const results = store.getByPipelineId('pipe_A');
    expect(results).toHaveLength(2);
    expect(results.every(r => r.pipelineId === 'pipe_A')).toBe(true);
  });

  it('does NOT include pipeline_summary rows in results', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 't1', pipelineId: 'pipe_X' }), makeResult({ auditId: 't1' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_X' }));

    const results = store.getByPipelineId('pipe_X');
    // Should only return the trace, not the summary
    expect(results).toHaveLength(1);
    expect(results[0]?.auditId).toBe('t1');
  });

  it('returns parentTraceId on retrieved traces', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(
      makeTrace({ id: 't1', pipelineId: 'pipe_Y' }),
      makeResult({ auditId: 't1' })
    );
    store.save(
      makeTrace({ id: 't2', pipelineId: 'pipe_Y', parentTraceId: 't1' }),
      makeResult({ auditId: 't2' })
    );

    const results = store.getByPipelineId('pipe_Y');
    const second = results.find(r => r.auditId === 't2');
    expect(second?.parentTraceId).toBe('t1');
  });
});

// ─── Mixed NDJSON — Existing Methods Still Work ───────────────────────────────

describe('Store — Existing Methods with Mixed NDJSON (trace + pipeline_summary rows)', () => {
  it('getById() ignores pipeline_summary rows', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 'real-trace' }), makeResult({ auditId: 'real-trace' }));
    store.savePipeline(makePipelineResult({ pipelineId: 'pipe_mixed' }));

    const result = store.getById('real-trace');
    expect(result).not.toBeNull();
    expect(result?.auditId).toBe('real-trace');
  });

  it('getRecent() ignores pipeline_summary rows', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2' }));
    store.savePipeline(makePipelineResult());  // pipeline summary mixed in

    const recent = store.getRecent(10);
    // Should return only the 2 trace rows, not the summary
    expect(recent).toHaveLength(2);
    expect(recent.every(r => r.auditId !== undefined)).toBe(true);
  });

  it('getBlocked() ignores pipeline_summary rows', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 'blocked-trace' }), makeResult({ auditId: 'blocked-trace', blocked: true, riskLevel: 'HIGH' }));
    store.savePipeline(makePipelineResult({ shortCircuited: true }));

    const blocked = store.getBlocked();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.auditId).toBe('blocked-trace');
  });

  it('stats() ignores pipeline_summary rows in counts', () => {
    const storagePath = tmpPath();
    const store = new Store(storagePath);

    store.save(makeTrace({ id: 't1' }), makeResult({ auditId: 't1', blocked: false, riskLevel: 'LOW' }));
    store.save(makeTrace({ id: 't2' }), makeResult({ auditId: 't2', blocked: true,  riskLevel: 'HIGH' }));
    store.savePipeline(makePipelineResult());  // this should NOT count in stats

    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.blocked).toBe(1);
  });
});
