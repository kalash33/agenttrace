import { v4 as uuidv4 } from 'uuid';
import type { Trace, TraceStep } from './types.js';

/**
 * Tracer — records every step of an agent run into a structured Trace object.
 * Lightweight, synchronous, zero-dependency (no DB writes here — that's Store).
 */
export class Tracer {
  /**
   * Start a new trace for an agent invocation.
   */
  start(originalInput: unknown): Trace {
    return {
      id: uuidv4(),
      startedAt: new Date().toISOString(),
      originalInput,
      steps: [],
      lastAction: 'unknown',
    };
  }

  /**
   * Record a completed step onto an existing trace.
   */
  addStep(
    trace: Trace,
    step: Omit<TraceStep, 'stepIndex' | 'timestamp'>
  ): TraceStep {
    const s: TraceStep = {
      stepIndex: trace.steps.length,
      timestamp: new Date().toISOString(),
      ...step,
    };
    trace.steps.push(s);
    trace.lastAction = step.action;
    return s;
  }

  /**
   * Finalise a trace (compute token totals, etc.).
   * Call once the agent run is complete.
   */
  finish(trace: Trace): Trace {
    // Nothing heavy — the trace is already mutable.
    return trace;
  }

  /**
   * Produce a compact, human-readable summary of all steps.
   */
  summarise(trace: Trace): string {
    if (trace.steps.length === 0) return '(no steps recorded)';
    return trace.steps
      .map(
        (s) =>
          `[Step ${s.stepIndex + 1}] ${s.action} — ${s.durationMs}ms`
      )
      .join('\n');
  }
}
