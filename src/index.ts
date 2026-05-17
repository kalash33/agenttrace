/**
 * AgentTrace — The open-source accountability layer for AI agents.
 * Trace every action. Explain every decision. Control what matters.
 *
 * @packageDocumentation
 */

// ─── Main Class ───────────────────────────────────────────────────────────────
export { AgentTrace, AgentGuard } from './guard.js';

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
  AgentGuardOptions,   // backwards compat
  BuiltInRuleName,
  ExplainerProvider,
  GuardedResult,
  HumanApprovalOptions,
  LLMProviderConfig,
  RiskLevel,
  Rule,
  RuleContext,
  Trace,
  TraceStep,
  Violation,
} from './types.js';
