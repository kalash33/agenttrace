/**
 * AgentTrace — The open-source circuit breaker and accountability layer for AI agents.
 * Trace every action. Explain every decision. Control what matters.
 *
 * @packageDocumentation
 */

// ─── Main Classes ─────────────────────────────────────────────────────────────
export { AgentTrace, AgentGuard } from './guard.js';
export { AgentPipeline } from './pipeline.js';

// ─── Rules ────────────────────────────────────────────────────────────────────
export {
  blockPiiLeakage,
  blockFinancialAdvice,
  blockHarmfulContent,
  requireHumanApproval,
  blockHallucination,
  createRule,
  resolveRules,
  runAllRules,
} from './rules/index.js';

// ─── Core Modules ─────────────────────────────────────────────────────────────
export { Tracer } from './tracer.js';
export {
  OpenAICompatibleExplainer,
  AnthropicExplainer,
  NoOpExplainer,
  resolveExplainer,
} from './explainer.js';
export { Store } from './store.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  AgentTraceOptions,
  AgentGuardOptions,       // backwards compat
  AgentPipelineOptions,
  BuiltInRuleName,
  ExplainerProvider,
  GuardedResult,
  HumanApprovalOptions,
  LLMProviderConfig,
  PipelineContext,
  PipelineResult,
  PipelineStage,
  RiskLevel,
  Rule,
  RuleContext,
  StageResult,
  Trace,
  TraceStep,
  Violation,
} from './types.js';
