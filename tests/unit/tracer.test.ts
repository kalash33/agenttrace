/**
 * Unit Tests — Tracer
 *
 * Tests the Tracer class in isolation:
 * - start() with and without pipeline context
 * - addStep()
 * - finish()
 * - summarise()
 */

import { describe, it, expect } from 'vitest';
import { Tracer } from '../../src/tracer.js';
import type { PipelineContext } from '../../src/types.js';

describe('Tracer — start()', () => {
  it('returns a Trace with a valid UUID id', () => {
    const tracer = new Tracer();
    const trace = tracer.start('hello');
    expect(trace.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sets originalInput correctly', () => {
    const tracer = new Tracer();
    const trace = tracer.start({ task: 'summarise' });
    expect(trace.originalInput).toEqual({ task: 'summarise' });
  });

  it('starts with an empty steps array', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(trace.steps).toHaveLength(0);
  });

  it('sets startedAt as a valid ISO timestamp', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(() => new Date(trace.startedAt).toISOString()).not.toThrow();
  });

  it('sets lastAction to "unknown" initially', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(trace.lastAction).toBe('unknown');
  });

  it('accepts undefined input', () => {
    const tracer = new Tracer();
    const trace = tracer.start(undefined);
    expect(trace.originalInput).toBeUndefined();
  });

  it('two traces have different ids', () => {
    const tracer = new Tracer();
    const t1 = tracer.start('a');
    const t2 = tracer.start('b');
    expect(t1.id).not.toBe(t2.id);
  });
});

describe('Tracer — Pipeline Context', () => {
  const ctx: PipelineContext = {
    pipelineId: 'pipe_abc123',
    parentTraceId: 'parent-uuid-here',
    agentName: 'researcher',
  };

  it('stamps pipelineId onto the trace when context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input', ctx);
    expect(trace.pipelineId).toBe('pipe_abc123');
  });

  it('stamps parentTraceId onto the trace when context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input', ctx);
    expect(trace.parentTraceId).toBe('parent-uuid-here');
  });

  it('stamps agentName onto the trace when context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input', ctx);
    expect(trace.agentName).toBe('researcher');
  });

  it('pipelineId is undefined when no context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(trace.pipelineId).toBeUndefined();
  });

  it('parentTraceId is undefined when no context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(trace.parentTraceId).toBeUndefined();
  });

  it('agentName is undefined when no context is provided', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(trace.agentName).toBeUndefined();
  });

  it('handles context with only pipelineId (no parentTraceId for first stage)', () => {
    const tracer = new Tracer();
    const firstStageCtx: PipelineContext = {
      pipelineId: 'pipe_first',
      agentName: 'first-agent',
      // parentTraceId intentionally absent (first stage)
    };
    const trace = tracer.start('input', firstStageCtx);
    expect(trace.pipelineId).toBe('pipe_first');
    expect(trace.parentTraceId).toBeUndefined();
    expect(trace.agentName).toBe('first-agent');
  });
});

describe('Tracer — addStep()', () => {
  it('adds a step with correct stepIndex (0-indexed)', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    const step = tracer.addStep(trace, {
      action: 'run()',
      input: 'foo',
      output: 'bar',
      durationMs: 42,
    });
    expect(step.stepIndex).toBe(0);
  });

  it('increments stepIndex for each added step', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    tracer.addStep(trace, { action: 'step1', input: null, output: null, durationMs: 10 });
    tracer.addStep(trace, { action: 'step2', input: null, output: null, durationMs: 20 });
    const step3 = tracer.addStep(trace, { action: 'step3', input: null, output: null, durationMs: 30 });
    expect(step3.stepIndex).toBe(2);
  });

  it('sets timestamp as a valid ISO string on each step', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    const step = tracer.addStep(trace, { action: 'x', input: null, output: null, durationMs: 5 });
    expect(() => new Date(step.timestamp).toISOString()).not.toThrow();
  });

  it('pushes step onto trace.steps array', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    tracer.addStep(trace, { action: 'a', input: null, output: null, durationMs: 1 });
    tracer.addStep(trace, { action: 'b', input: null, output: null, durationMs: 2 });
    expect(trace.steps).toHaveLength(2);
  });

  it('updates trace.lastAction to the most recent action', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    tracer.addStep(trace, { action: 'first_action', input: null, output: null, durationMs: 1 });
    expect(trace.lastAction).toBe('first_action');
    tracer.addStep(trace, { action: 'second_action', input: null, output: null, durationMs: 2 });
    expect(trace.lastAction).toBe('second_action');
  });

  it('preserves optional metadata on steps', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    const step = tracer.addStep(trace, {
      action: 'test',
      input: null,
      output: null,
      durationMs: 1,
      metadata: { model: 'gpt-4', tokens: 100 },
    });
    expect(step.metadata).toEqual({ model: 'gpt-4', tokens: 100 });
  });
});

describe('Tracer — finish()', () => {
  it('returns the same trace object', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    const returned = tracer.finish(trace);
    expect(returned).toBe(trace);
  });
});

describe('Tracer — summarise()', () => {
  it('returns placeholder string for empty trace', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    expect(tracer.summarise(trace)).toBe('(no steps recorded)');
  });

  it('includes step index and action in summary', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    tracer.addStep(trace, { action: 'run()', input: null, output: null, durationMs: 55 });
    const summary = tracer.summarise(trace);
    expect(summary).toContain('[Step 1]');
    expect(summary).toContain('run()');
    expect(summary).toContain('55ms');
  });

  it('summarises all steps', () => {
    const tracer = new Tracer();
    const trace = tracer.start('input');
    tracer.addStep(trace, { action: 'step-a', input: null, output: null, durationMs: 10 });
    tracer.addStep(trace, { action: 'step-b', input: null, output: null, durationMs: 20 });
    tracer.addStep(trace, { action: 'step-c', input: null, output: null, durationMs: 30 });
    const summary = tracer.summarise(trace);
    expect(summary).toContain('step-a');
    expect(summary).toContain('step-b');
    expect(summary).toContain('step-c');
    expect(summary.split('\n')).toHaveLength(3);
  });
});
