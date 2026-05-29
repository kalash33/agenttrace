import * as fs from 'node:fs';
import * as path from 'node:path';

import { Tracer } from './tracer.js';
import { resolveExplainer, NoOpExplainer } from './explainer.js';
import { resolveRules, runAllRules } from './rules/index.js';
import { Store } from './store.js';
import type {
  AgentTraceOptions,
  ExplainerProvider,
  GuardedResult,
  InputGuardResult,
  PipelineContext,
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
 * - Pipeline context stamping (when used inside AgentPipeline)
 *
 * @example
 * ```typescript
 * import { AgentTrace } from '@hackerx333/agenttrace';
 *
 * const guard = new AgentTrace({
 *   rules: ['block_pii_leakage', 'require_human_approval'],
 *   explain: true,
 * });
 *
 * const safeAgent = guard.wrap(myAgent);
 * const result = await safeAgent.run('Process customer refund');
 * ```
 *
 * @example Multi-agent pipeline
 * ```typescript
 * import { AgentTrace, AgentPipeline } from '@hackerx333/agenttrace';
 *
 * const pipeline = new AgentPipeline({
 *   name: 'support-pipeline',
 *   agents: [
 *     { name: 'researcher', guard: new AgentTrace({ rules: ['block_hallucination'] }), agent: researchAgent },
 *     { name: 'executor',   guard: new AgentTrace({ rules: ['require_human_approval'] }), agent: executorAgent },
 *   ],
 * });
 *
 * const result = await pipeline.run(userInput);
 * // result.shortCircuited → true if any stage was blocked
 * ```
 */
export class AgentTrace {
  private rules: Rule[];
  private explainer: ExplainerProvider;
  private tracer: Tracer;
  private store: Store | null;
  private options: AgentTraceOptions;

  constructor(options: AgentTraceOptions = {}) {
    // Attempt to load global config from agenttrace.config.json
    let globalConfig: AgentTraceOptions = {};
    try {
      const configPath = path.resolve(process.cwd(), 'agenttrace.config.json');
      if (fs.existsSync(configPath)) {
        globalConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {
      // Ignore config parsing errors
    }

    this.options = { ...globalConfig, ...options };

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
    const pipelineContext = this.options._pipelineContext;
    const trace = this.tracer.start(input, pipelineContext);
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
   * Validate agent INPUT before it reaches the LLM.
   *
   * Academic basis: OWASP LLM01:2025 — Prompt injection is the #1 LLM risk.
   * Inputs must be treated as executable directives and validated BEFORE the
   * agent processes them. This is the "pre-flight" input guard.
   *
   * Runs `block_prompt_injection` and `block_pii_leakage` against the input
   * by default. You can also pass your configured rules (they'll be filtered
   * to only run checks that make sense for input validation).
   *
   * @example
   * const check = await guard.checkInput(userMessage);
   * if (check.blocked) {
   *   return { error: 'Input rejected: ' + check.violations[0].description };
   * }
   * // Safe to proceed
   * const result = await agent.run(userMessage);
   */
  async checkInput(input: unknown): Promise<InputGuardResult> {
    const now = new Date().toISOString();
    const inputText = typeof input === 'string' ? input : JSON.stringify(input);

    // Input guard uses prompt injection + PII rules by default.
    // These are the rules that specifically detect malicious INPUT patterns.
    const inputRuleNames = ['block_prompt_injection', 'block_pii_leakage'] as const;
    const inputRules = resolveRules([...inputRuleNames]);

    // Create a minimal synthetic trace for rule context
    const syntheticTrace: Trace = {
      id: `input-check-${Date.now()}`,
      startedAt: now,
      originalInput: input,
      steps: [],
      lastAction: 'checkInput()',
    };

    const violations = await runAllRules(inputRules, {
      result: inputText,    // rules inspect result field
      trace: syntheticTrace,
      guardOptions: this.options,
    });

    const riskLevel = computeRiskLevel(violations);
    const blocked = violations.some(v => v.severity === 'HIGH' || v.severity === 'CRITICAL');

    this.log(blocked ? '⛔ INPUT BLOCKED' : '✅ INPUT CLEAN', {
      violations: violations.map(v => `[${v.severity}] ${v.rule}`),
    });

    return { blocked, riskLevel, violations, input, timestamp: now };
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

  // ─── Internal: Pipeline Context Injection ───────────────────────────────────

  /**
   * Called by AgentPipeline to inject pipeline context before each stage run.
   * Not part of the public API — use AgentPipeline instead.
   * @internal
   */
  _setPipelineContext(ctx: PipelineContext): void {
    this.options._pipelineContext = ctx;
  }

  /**
   * Clears the injected pipeline context after a stage completes.
   * @internal
   */
  _clearPipelineContext(): void {
    this.options._pipelineContext = undefined;
  }

  // ─── Internal: Guarded Agent Call ──────────────────────────────────────────

  private async _guardedCall(
    target: Record<string, unknown>,
    methodName: string,
    method: (...args: unknown[]) => Promise<unknown>,
    args: unknown[]
  ): Promise<GuardedResult> {
    const pipelineContext = this.options._pipelineContext;
    const trace = this.tracer.start(args[0], pipelineContext);
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
        pipelineId: trace.pipelineId,
        parentTraceId: trace.parentTraceId,
      };
    } else {
      // Run ALL rules in parallel for zero added serial latency
      const violations = await runAllRules(this.rules, {
        result: agentResult,
        trace,
        guardOptions: this.options,
      });

      if (violations.length > 0) {
        const mode = this.options.enforcementMode ?? 'enforce';
        const isShadow = mode === 'shadow';
        const isDegraded = mode === 'degraded';

        // Degraded mode: only HIGH/CRITICAL violations block; MEDIUM violations
        // allow execution to continue but flag result as degraded.
        // Academic basis: Multi-agent resilience research (2024) — binary
        // circuit breakers create unnecessary full shutdowns. DEGRADED state
        // allows partial operation with reduced trust.
        const severeViolations = violations.filter(
          v => v.severity === 'HIGH' || v.severity === 'CRITICAL'
        );
        const shouldBlock = isShadow
          ? false
          : isDegraded
            ? severeViolations.length > 0
            : violations.length > 0;  // enforce: any violation blocks

        const violationsToReport = isDegraded && !shouldBlock
          ? violations  // degraded but passing — report all for audit
          : violations;

        const reason = await this.explainer.explainBlock(violationsToReport, trace);
        guardedResult = {
          auditId: trace.id,
          blocked: shouldBlock,
          reason,
          riskLevel: computeRiskLevel(violations),
          auditTrail: trace.steps,
          violations: violationsToReport,
          timestamp: now,
          metadata: baseMetadata,
          pipelineId: trace.pipelineId,
          parentTraceId: trace.parentTraceId,
          // Pass result through in shadow and degraded-but-passing modes
          ...((isShadow || (isDegraded && !shouldBlock)) ? { result: agentResult } : {}),
          // Flag degraded state when we chose not to block but violations exist
          ...(isDegraded && !shouldBlock && violations.length > 0 ? { degraded: true } : {}),
        };

        const logLabel = isShadow
          ? '👻 SHADOW (violations found)'
          : isDegraded && !shouldBlock
            ? '⚡ DEGRADED (non-critical violations, continuing)'
            : '⛔ BLOCKED';
        this.log(logLabel, {
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
          pipelineId: trace.pipelineId,
          parentTraceId: trace.parentTraceId,
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
