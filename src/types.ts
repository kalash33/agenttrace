// ─── Core Types ──────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type BuiltInRuleName =
  // ── Privacy & Data ───────────────────────────────────────────────────────
  | 'block_pii_leakage'
  | 'block_special_category_data'       // GDPR Art 9
  // ── EU AI Act Prohibited Practices (Art 5) ────────────────────────────────
  | 'block_manipulation'
  // ── Safety & Harm ─────────────────────────────────────────────────────────
  | 'block_harmful_content'
  // ── Professional Advice ───────────────────────────────────────────────────
  | 'block_medical_advice'
  | 'block_legal_advice'
  // ── Financial ─────────────────────────────────────────────────────────────
  | 'block_financial_advice'
  // ── Fairness (EU Charter Art 21) ──────────────────────────────────────────
  | 'block_discriminatory_output'
  // ── Security (OWASP LLM Top 10) ───────────────────────────────────────────
  | 'block_prompt_injection'
  | 'block_system_prompt_leakage'
  // ── Transparency (EU AI Act Art 50) ───────────────────────────────────────
  | 'block_ai_identity_deception'
  // ── Quality & Accuracy ────────────────────────────────────────────────────
  | 'block_hallucination'
  // ── Human Oversight (EU AI Act Art 14) ────────────────────────────────────
  | 'require_human_approval';

// ─── Trace / Step ────────────────────────────────────────────────────────────

export interface TraceStep {
  /** Sequential step number within a single agent run */
  stepIndex: number;
  /** ISO timestamp when this step occurred */
  timestamp: string;
  /** What action the agent attempted */
  action: string;
  /** Raw input to this step */
  input: unknown;
  /** Raw output from this step */
  output: unknown;
  /** Duration in milliseconds */
  durationMs: number;
  /** Any metadata the agent or integration layer attaches */
  metadata?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  /** When the agent run started */
  startedAt: string;
  /** The original user-facing prompt / task */
  originalInput: unknown;
  /** Every step the agent took */
  steps: TraceStep[];
  /** Description of the last action (used in block messages) */
  lastAction: string;
  /** Cumulative token usage if available */
  tokenUsage?: { prompt: number; completion: number; total: number };
  /**
   * Shared pipeline identifier — present when this agent ran inside
   * an AgentPipeline. All stages in the same pipeline run share this ID.
   */
  pipelineId?: string;
  /**
   * The auditId of the immediately preceding stage in the pipeline.
   * Allows full lineage reconstruction: follow parentTraceId to trace
   * the error back to its origin across agents.
   */
  parentTraceId?: string;
  /**
   * Human-readable name of this agent within the pipeline
   * (e.g. "researcher", "drafter", "executor").
   */
  agentName?: string;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export interface RuleContext {
  /** The full agent output/result to check */
  result: unknown;
  /** The live trace at the time of checking */
  trace: Trace;
  /** Options the user passed to AgentTrace */
  guardOptions: AgentTraceOptions;
}

export interface Violation {
  /** The rule that was triggered */
  rule: string;
  /** Human-readable description of what was found */
  description: string;
  /** The specific value or snippet that triggered the rule */
  evidence?: string;
  /** How severe is this violation? */
  severity: RiskLevel;
  /** Optional remediation guidance */
  remediation?: string;
}

export interface Rule {
  name: string;
  description: string;
  /** Returns violations found; empty array = clean */
  check(ctx: RuleContext): Promise<Violation[]>;
}

// ─── LLM Provider Config ─────────────────────────────────────────────────────

export interface LLMProviderConfig {
  /**
   * OpenAI-compatible API base URL.
   * Defaults to https://api.openai.com/v1
   * Set to https://api.featherless.ai/v1 for Featherless.
   * Set to https://api.anthropic.com for Anthropic.
   */
  baseURL?: string;
  /** API key. Falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY env vars. */
  apiKey?: string;
  /** Model identifier. */
  model?: string;
  /** Max tokens for explanation output. Default: 300 */
  maxTokens?: number;
  /** Request timeout in ms. Default: 15000 */
  timeoutMs?: number;
  /** Number of retries on transient errors. Default: 2 */
  retries?: number;
}

// ─── Human-Approval Gate ─────────────────────────────────────────────────────

export interface HumanApprovalOptions {
  /**
   * Called when an action requires human review.
   * Return `true` to approve, `false` to reject.
   * If not provided, actions are auto-rejected when the threshold is exceeded.
   */
  onApprovalRequired?: (context: {
    trace: Trace;
    description: string;
    amount?: number;
  }) => Promise<boolean>;
  /** Monetary threshold in USD above which approval is required. Default: $1000 */
  threshold?: number;
}

// ─── Pipeline Context ─────────────────────────────────────────────────────────

/**
 * Injected by AgentPipeline into each AgentTrace instance.
 * Allows individual guard instances to stamp traces with pipeline metadata
 * for lineage reconstruction.
 */
export interface PipelineContext {
  /** Shared UUID for all stages in this pipeline run */
  pipelineId: string;
  /** The auditId of the previous stage (undefined for the first stage) */
  parentTraceId?: string;
  /** Human name of this agent in the pipeline (e.g. "researcher") */
  agentName?: string;
}

// ─── AgentTrace Options ───────────────────────────────────────────────────────

export interface AgentTraceOptions {
  /**
   * Built-in rule names or custom Rule objects.
   * @default []
   */
  rules?: (BuiltInRuleName | Rule)[];

  /**
   * Defines how rules are applied.
   * 'enforce' (default): Blocks agent execution when rules are violated.
   * 'shadow': Traces and flags violations, but allows execution to continue (Dry Run).
   */
  enforcementMode?: 'enforce' | 'shadow';

  /**
   * Generate plain-English explanations for every decision.
   * Requires a configured LLM provider or FEATHERLESS_API_KEY / OPENAI_API_KEY env var.
   * @default false
   */
  explain?: boolean;

  /**
   * LLM provider configuration for the explanation engine.
   * Defaults to Featherless AI if FEATHERLESS_API_KEY is set, then OpenAI, then Anthropic.
   */
  llm?: LLMProviderConfig;

  /**
   * Custom explanation provider. Overrides the llm config entirely.
   */
  explainer?: ExplainerProvider;

  /**
   * Persist traces to local NDJSON store.
   * @default true
   */
  persist?: boolean;

  /**
   * Path to the audit trail storage file.
   * @default '.agenttrace/traces.ndjson'
   */
  storagePath?: string;

  /**
   * Options for the human-approval rule.
   * Only relevant when 'require_human_approval' is in rules.
   */
  humanApproval?: HumanApprovalOptions;

  /**
   * Context documents for hallucination checking (RAG).
   * Only relevant when 'block_hallucination' is in rules.
   */
  context?: string[];

  /**
   * Callback invoked after every agent run (blocked or allowed).
   */
  onResult?: (result: GuardedResult) => void | Promise<void>;

  /**
   * Log debug information to console.
   * @default false
   */
  debug?: boolean;

  /**
   * Which methods to intercept on the wrapped agent.
   * @default ['run', 'execute', 'invoke', 'call', 'generate', 'chat', 'complete', 'query']
   */
  interceptMethods?: string[];

  /**
   * Metadata to attach to every trace (e.g. environment, version, tenant ID).
   */
  metadata?: Record<string, unknown>;

  /**
   * Pipeline context injected by AgentPipeline.
   * Not intended for manual use — set automatically when running inside a pipeline.
   */
  _pipelineContext?: PipelineContext;
}

// ─── Explainer ───────────────────────────────────────────────────────────────

export interface ExplainerProvider {
  explainAllow(result: unknown, trace: Trace): Promise<string>;
  explainBlock(violations: Violation[], trace: Trace): Promise<string>;
}

// ─── Guard Result ─────────────────────────────────────────────────────────────

export interface GuardedResult {
  /** ID of the audit trace in storage */
  auditId: string;
  /** Whether the action was blocked */
  blocked: boolean;
  /** Human-readable reason (always present on block) */
  reason?: string;
  /** Plain-English explanation of the decision (if explain: true) */
  explanation?: string;
  /** Computed risk level of this run */
  riskLevel: RiskLevel;
  /** Full multi-step reasoning chain */
  auditTrail: TraceStep[];
  /** Violations that triggered a block */
  violations?: Violation[];
  /** The original agent result (only when not blocked) */
  result?: unknown;
  /** ISO timestamp of when the guard ran */
  timestamp: string;
  /** Metadata attached from AgentTraceOptions */
  metadata?: Record<string, unknown>;
  /** Pipeline ID — present when this run was part of an AgentPipeline */
  pipelineId?: string;
  /** auditId of the previous stage — present when this run was part of an AgentPipeline */
  parentTraceId?: string;
}

// ─── AgentPipeline Types ──────────────────────────────────────────────────────

/**
 * Configuration for a single stage in an AgentPipeline.
 */
export interface PipelineStage {
  /** Human-readable name for this stage (e.g. "researcher", "drafter") */
  name: string;
  /** The AgentTrace guard instance configured for this agent */
  guard: import('./guard.js').AgentTrace;
  /** The agent object to wrap and invoke */
  agent: object;
  /**
   * Which method to call on the agent. Defaults to 'run'.
   * Use this if your agent uses a different entry method (e.g. 'invoke', 'kickoff').
   */
  method?: string;
}

/**
 * The result of a single stage within a pipeline run.
 */
export interface StageResult {
  /** Stage name as defined in PipelineStage.name */
  name: string;
  /** auditId of this stage's GuardedResult */
  auditId: string;
  /**
   * auditId of the previous stage — undefined for the first stage.
   * Follow this chain to reconstruct full error lineage.
   */
  parentTraceId?: string;
  /** Whether this stage was blocked */
  blocked: boolean;
  /** Risk level computed for this stage */
  riskLevel: RiskLevel;
  /** Violations that caused a block (empty if allowed) */
  violations?: Violation[];
  /** Plain-English explanation (if explain: true on the guard) */
  explanation?: string;
  /** The agent's output (only when not blocked) */
  result?: unknown;
  /** Wall-clock duration of this stage in milliseconds */
  durationMs: number;
}

/**
 * The result of a full AgentPipeline.run() call.
 */
export interface PipelineResult {
  /** Shared UUID for all stages in this pipeline run */
  pipelineId: string;
  /** Name of the pipeline as set in AgentPipelineOptions */
  pipelineName: string;
  /**
   * Results for every stage that actually ran.
   * If shortCircuited is true, only the stages up to and including blockedAt are present.
   */
  stages: StageResult[];
  /**
   * True if any stage was blocked in 'enforce' mode,
   * causing all subsequent stages to be skipped.
   */
  shortCircuited: boolean;
  /**
   * Name of the stage that caused the short-circuit.
   * Undefined if the pipeline completed without blocking.
   */
  blockedAt?: string;
  /** Total wall-clock time for all stages that ran */
  totalDurationMs: number;
  /** ISO timestamp of when pipeline.run() was called */
  timestamp: string;
}

/**
 * Options for constructing an AgentPipeline.
 */
export interface AgentPipelineOptions {
  /** Human-readable pipeline name used in audit records */
  name?: string;
  /** Ordered list of stages. Stages run sequentially in array order. */
  agents: PipelineStage[];
  /**
   * Callback fired after each stage completes (blocked or allowed).
   * Useful for logging, metrics, or real-time UI updates.
   */
  onStageComplete?: (stageName: string, result: StageResult) => void | Promise<void>;
  /**
   * Path to NDJSON storage for pipeline records.
   * Defaults to '.agenttrace/traces.ndjson' (same file as individual traces).
   */
  storagePath?: string;
  /**
   * Whether to persist the pipeline-level summary record.
   * Individual stage traces are always persisted by their own AgentTrace instances.
   * @default true
   */
  persist?: boolean;
}

// ─── Backwards Compatibility Alias ──────────────────────────────────────────

/** @deprecated Use AgentTraceOptions */
export type AgentGuardOptions = AgentTraceOptions;
