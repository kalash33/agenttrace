/**
 * Unit Tests — AgentTrace Pipeline Context
 *
 * Tests the new pipeline context behaviour on AgentTrace:
 * - _setPipelineContext() / _clearPipelineContext()
 * - pipelineId and parentTraceId appear on GuardedResult
 * - Standalone runs have no pipeline fields
 */

import { describe, it, expect } from 'vitest';
import { AgentTrace } from '../../src/guard.js';
import { Store } from '../../src/store.js';

function tmpPath() {
  return `/tmp/agenttrace-guard-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`;
}

function mockAgent(response: unknown) {
  return { run: async () => response };
}

// ─── Pipeline Context on GuardedResult ───────────────────────────────────────

describe('AgentTrace — Pipeline Context', () => {
  it('pipelineId is absent from GuardedResult when running standalone', async () => {
    const at = new AgentTrace({ persist: false });
    const r = await at.wrap(mockAgent('ok')).run('input');
    expect(r.pipelineId).toBeUndefined();
  });

  it('parentTraceId is absent from GuardedResult when running standalone', async () => {
    const at = new AgentTrace({ persist: false });
    const r = await at.wrap(mockAgent('ok')).run('input');
    expect(r.parentTraceId).toBeUndefined();
  });

  it('pipelineId appears on GuardedResult after _setPipelineContext()', async () => {
    const at = new AgentTrace({ persist: false });
    at._setPipelineContext({
      pipelineId: 'pipe_test_abc',
      agentName: 'testAgent',
    });
    const r = await at.wrap(mockAgent('ok')).run('input');
    expect(r.pipelineId).toBe('pipe_test_abc');
  });

  it('parentTraceId appears on GuardedResult after _setPipelineContext()', async () => {
    const at = new AgentTrace({ persist: false });
    at._setPipelineContext({
      pipelineId: 'pipe_test_def',
      parentTraceId: 'previous-audit-id',
      agentName: 'secondAgent',
    });
    const r = await at.wrap(mockAgent('ok')).run('input');
    expect(r.parentTraceId).toBe('previous-audit-id');
  });

  it('after _clearPipelineContext(), new runs have no pipelineId', async () => {
    const at = new AgentTrace({ persist: false });
    at._setPipelineContext({ pipelineId: 'pipe_ephemeral', agentName: 'x' });
    at._clearPipelineContext();
    const r = await at.wrap(mockAgent('ok')).run('input');
    expect(r.pipelineId).toBeUndefined();
  });

  it('pipeline context is stamped on guardFn results too', async () => {
    const at = new AgentTrace({ persist: false });
    at._setPipelineContext({ pipelineId: 'pipe_fn', agentName: 'fnAgent' });
    const r = await at.guardFn(async () => 'result', 'input');
    expect(r.pipelineId).toBe('pipe_fn');
  });

  it('pipelineId is persisted to storage', async () => {
    const storagePath = tmpPath();
    const at = new AgentTrace({ persist: true, storagePath });
    at._setPipelineContext({ pipelineId: 'pipe_persist_check', agentName: 'a' });
    const r = await at.wrap(mockAgent('ok')).run('input');

    const store = new Store(storagePath);
    const trace = store.getById(r.auditId);
    expect(trace?.pipelineId).toBe('pipe_persist_check');
  });

  it('parentTraceId is persisted to storage', async () => {
    const storagePath = tmpPath();
    const at = new AgentTrace({ persist: true, storagePath });
    at._setPipelineContext({
      pipelineId: 'pipe_parent_check',
      parentTraceId: 'some-parent-id',
      agentName: 'b',
    });
    const r = await at.wrap(mockAgent('ok')).run('input');

    const store = new Store(storagePath);
    const trace = store.getById(r.auditId);
    expect(trace?.parentTraceId).toBe('some-parent-id');
  });

  it('pipeline context is present on blocked results too', async () => {
    const at = new AgentTrace({ rules: ['block_pii_leakage'], persist: false });
    at._setPipelineContext({ pipelineId: 'pipe_block_context', agentName: 'leakyAgent' });
    const r = await at.wrap(mockAgent('email: user@example.com')).run('input');

    expect(r.blocked).toBe(true);
    expect(r.pipelineId).toBe('pipe_block_context');
  });
});
