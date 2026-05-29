/**
 * AgentTrace — The open-source circuit breaker and accountability layer for AI agents.
 * Trace every action. Explain every decision. Control what matters.
 *
 * v3 improvements (academic basis):
 *   - Temporal grounding: Layer 5 in hallucination detection (arXiv 2024)
 *   - Confidence scoring: Each violation carries a 0–1 confidence score (arXiv 2024)
 *   - Degraded enforcement mode: Three-state circuit breaker (enforce / degraded / shadow)
 *   - Input guard: Pre-execution input validation via guard.checkInput() (OWASP LLM01:2025)
 *   - PipelineValidator: Cross-stage entity consistency (multi-agent coordination, 2024)
 *
 * v2 improvements (academic basis):
 *   - Numeric exact-match hallucination detection (SemEval-2024 Task 7)
 *   - Negation flip detection (NLP grounding research, 2024)
 *   - Bigram overlap replacing single-word overlap (RAGTruth, ACL 2024)
 *   - Hash-chained audit trail with verifyIntegrity() (Microsoft AGT research, 2024)
 *   - Expanded epistemic claim markers for claim decomposition
 *
 * @packageDocumentation
 */

// ─── Main Classes ─────────────────────────────────────────────────────────────
export { AgentTrace, AgentGuard } from './guard.js';
export { AgentPipeline } from './pipeline.js';
export { PipelineValidator } from './pipeline-validator.js';

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
  COMPLIANCE_BUNDLES,
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
export type { IntegrityReport } from './store.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  // Core options & results
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
  // v3 new types
  InputGuardResult,
  ConsistencyReport,
  EntityContradiction,
  ExtractedEntity,
} from './types.js';
