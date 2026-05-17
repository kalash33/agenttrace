import { Tracer } from './tracer.js';
import { resolveExplainer, NoOpExplainer } from './explainer.js';
import { resolveRules, runAllRules } from './rules/index.js';
import { Store } from './store.js';
import type {
  AgentTraceOptions,
  ExplainerProvider,
  GuardedResult,
  RiskLevel,
  Rule,
  Trace,
  Violation,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTERCEPT_METHODS = [
  'run',
  'execute',
  'invoke',
  'call',
  'generate',
  'chat',
  'complete',
  'query',
  'stream',
  'ask',
];

// ─── Risk Scoring ─────────────────────────────────────────────────────────────

function computeRiskLevel(violations: Violation[]): RiskLevel {
  if (violations.some((v) => v.severity === 'CRITICAL')) return 'CRITICAL';
  if (violations.some((v) => v.severity === 'HIGH')) return 'HIGH';
  if (violations.some((v) => v.severity === 'MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

function computeBaseRiskLevel(trace: Trace): RiskLevel {
  const totalMs = trace.steps.reduce((sum, s) => sum + s.durationMs, 0);
  if (trace.steps.length > 10 || totalMs > 30_000) return 'MEDIUM';
  if (trace.steps.length > 5 || totalMs > 10_000) return 'LOW';
  return 'LOW';
}

// ─── AgentTrace ──────────────────────────────────────────────────────────────

/**
 * AgentTrace — The accountability layer for AI agents.
 *
 * Wraps any AI agent and provides:
 * - Real-time action blocking (PII, financial advice, harmful content, etc.)
 * - Plain-English decision explanations via an LLM
 * - Full multi-step audit trail
 * - Local persistent storage (NDJSON, zero native deps)
 *
 * @example
 * ```typescript
 * import { AgentTrace } from 'agenttrace';
 *
 * const trace = new AgentTrace({
 *   rules: ['block_pii_leakage', 'require_human_approval'],
 *   explain: true,
 *   llm: {
 *     baseURL: 'https://api.featherless.ai/v1',
 *     apiKey: process.env.FEATHERLESS_API_KEY,
 *     model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
 *   },
 * });
 *
 * const safeAgent = trace.wrap(myAgent);
 * const result = await safeAgent.run('Process customer refund');
 * ```
 */
export class AgentTrace {
  private rules: Rule[];
  private explainer: ExplainerProvider;
  private tracer: Tracer;
  private store: Store | null;
  private options: AgentTraceOptions;

  constructor(options: AgentTraceOptions = {}) {
    this.options = options;

    // Resolve rules
    this.rules = resolveRules(options.rules ?? []);

    // Resolve explainer (priority: custom → llm config → env auto-detect → noop)
    this.explainer = resolveExplainer(
      options.explain ?? false,
      options.llm,
      options.explainer
    );

    // Tracer
    this.tracer = new Tracer();

    // Storage
    if (options.persist !== false) {
      this.store = new Store(options.storagePath ?? '.agenttrace/traces.ndjson');
    } else {
      this.store = null;
    }

    this.log('AgentTrace initialised', {
      rules: this.rules.map((r) => r.name),
      explain: options.explain ?? false,
      persist: options.persist !== false,
      llmProvider: this.explainer.constructor.name,
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Wrap an agent object. Returns a Proxy with the same interface.
   * All intercepted method calls are traced, rule-checked, and explained.
   */
  wrap<T extends object>(agent: T): T {
    const interceptMethods =
      this.options.interceptMethods ?? DEFAULT_INTERCEPT_METHODS;
    const self = this;

    return new Proxy(agent, {
      get(target, prop) {
        const value = (target as Record<string | symbol, unknown>)[prop];

        if (
          typeof prop === 'string' &&
          interceptMethods.includes(prop) &&
          typeof value === 'function'
        ) {
          return async (...args: unknown[]) =>
            self._guardedCall(
              target as Record<string, unknown>,
              prop,
              value as (...a: unknown[]) => Promise<unknown>,
              args
            );
        }

        return value;
      },
    });
  }

  /**
   * Guard a plain async function without needing an agent object.
   *
   * @example
   * const result = await agentTrace.guardFn(
   *   async () => await myPipeline.run(input),
   *   input
   * );
   */
  async guardFn<T>(
    fn: () => Promise<T>,
    input?: unknown
  ): Promise<GuardedResult & { result?: T }> {
    const trace = this.tracer.start(input);
    const start = Date.now();

    let agentResult: T;
    try {
      agentResult = await fn();
    } catch (err) {
      this.tracer.addStep(trace, {
        action: 'function_call',
        input,
        output: null,
        durationMs: Date.now() - start,
        metadata: { error: String(err) },
      });
      throw err;
    }

    this.tracer.addStep(trace, {
      action: 'function_call',
      input,
      output: agentResult,
      durationMs: Date.now() - start,
    });

    return this._evaluate(agentResult, trace) as Promise<GuardedResult & { result?: T }>;
  }

  /**
   * Access the audit trail storage.
   */
  get storage(): Store | null {
    return this.store;
  }

  /**
   * Close storage handles (call on shutdown).
   */
  close(): void {
    this.store?.close();
  }

  // ─── Internal: Guarded Agent Call ──────────────────────────────────────────

  private async _guardedCall(
    target: Record<string, unknown>,
    methodName: string,
    method: (...args: unknown[]) => Promise<unknown>,
    args: unknown[]
  ): Promise<GuardedResult> {
    const trace = this.tracer.start(args[0]);
    const start = Date.now();

    let agentResult: unknown;
    try {
      agentResult = await method.apply(target, args);
    } catch (err) {
      this.tracer.addStep(trace, {
        action: `${methodName}()`,
        input: args,
        output: null,
        durationMs: Date.now() - start,
        metadata: { error: String(err) },
      });
      throw err;
    }

    this.tracer.addStep(trace, {
      action: `${methodName}()`,
      input: args,
      output: agentResult,
      durationMs: Date.now() - start,
    });

    return this._evaluate(agentResult, trace);
  }

  // ─── Internal: Rule Evaluation ──────────────────────────────────────────────

  private async _evaluate(
    agentResult: unknown,
    trace: Trace
  ): Promise<GuardedResult> {
    this.tracer.finish(trace);

    const now = new Date().toISOString();
    const baseMetadata = this.options.metadata;

    let guardedResult: GuardedResult;

    if (this.rules.length === 0) {
      const explanation = await this.explainer.explainAllow(agentResult, trace);
      guardedResult = {
        auditId: trace.id,
        blocked: false,
        riskLevel: computeBaseRiskLevel(trace),
        explanation,
        auditTrail: trace.steps,
        result: agentResult,
        timestamp: now,
        metadata: baseMetadata,
      };
    } else {
      // Run ALL rules in parallel for zero added serial latency
      const violations = await runAllRules(this.rules, {
        result: agentResult,
        trace,
        guardOptions: this.options,
      });

      if (violations.length > 0) {
        // BLOCKED
        const reason = await this.explainer.explainBlock(violations, trace);
        guardedResult = {
          auditId: trace.id,
          blocked: true,
          reason,
          riskLevel: computeRiskLevel(violations),
          auditTrail: trace.steps,
          violations,
          timestamp: now,
          metadata: baseMetadata,
        };

        this.log('⛔ BLOCKED', {
          auditId: trace.id,
          riskLevel: guardedResult.riskLevel,
          violations: violations.map((v) => `[${v.severity}] ${v.rule}: ${v.description}`),
        });
      } else {
        // ALLOWED
        const explanation = this.options.explain
          ? await this.explainer.explainAllow(agentResult, trace)
          : undefined;

        guardedResult = {
          auditId: trace.id,
          blocked: false,
          riskLevel: computeBaseRiskLevel(trace),
          explanation,
          auditTrail: trace.steps,
          result: agentResult,
          timestamp: now,
          metadata: baseMetadata,
        };

        this.log('✅ ALLOWED', {
          auditId: trace.id,
          steps: trace.steps.length,
          riskLevel: guardedResult.riskLevel,
        });
      }
    }

    // Persist to audit trail
    this.store?.save(trace, guardedResult);

    // User callback
    if (this.options.onResult) {
      try {
        await this.options.onResult(guardedResult);
      } catch (cbErr) {
        this.log('onResult callback threw', cbErr);
      }
    }

    return guardedResult;
  }

  // ─── Debug Logging ────────────────────────────────────────────────────────

  private log(message: string, data?: unknown): void {
    if (this.options.debug) {
      console.log(`[AgentTrace] ${message}`, data ?? '');
    }
  }
}

// ─── Backwards Compatibility Alias ────────────────────────────────────────────

/** @deprecated Use AgentTrace */
export const AgentGuard = AgentTrace;
