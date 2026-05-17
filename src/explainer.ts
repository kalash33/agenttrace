/**
 * Explainer — generates plain-English decision rationale.
 *
 * The OpenAI SDK is loaded lazily so unit tests can run without it.
 * For integration tests, the real API is called.
 */

import type { ExplainerProvider, LLMProviderConfig, Trace, Violation } from './types.js';

// ─── Retry Helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs = 600
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

// ─── OpenAI-Compatible Explainer ──────────────────────────────────────────────

export class OpenAICompatibleExplainer implements ExplainerProvider {
  private config: Required<LLMProviderConfig>;
  // Client is typed as unknown until resolved — cast at callsite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null;

  constructor(config: LLMProviderConfig = {}) {
    const apiKey =
      config.apiKey ??
      process.env['FEATHERLESS_API_KEY'] ??
      process.env['OPENAI_API_KEY'] ??
      'no-key';

    const baseURL =
      config.baseURL ??
      (process.env['FEATHERLESS_API_KEY']
        ? 'https://api.featherless.ai/v1'
        : 'https://api.openai.com/v1');

    this.config = {
      apiKey,
      baseURL,
      model:
        config.model ??
        (process.env['FEATHERLESS_API_KEY']
          ? 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B'
          : 'gpt-4o-mini'),
      maxTokens: config.maxTokens ?? 300,
      timeoutMs: config.timeoutMs ?? 20_000,
      retries: config.retries ?? 2,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<any> {
    if (!this._client) {
      // Dynamic import — avoids static resolution issues in unit test environments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = await import('openai') as any;
      const OpenAI = m.default ?? m;
      this._client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        timeout: this.config.timeoutMs,
        maxRetries: 0,
      });
    }
    return this._client;
  }

  async explainAllow(result: unknown, trace: Trace): Promise<string> {
    try {
      const client = await this.getClient();
      const stepSummary =
        trace.steps.length > 0
          ? trace.steps
              .map((s, i) => `  Step ${i + 1}: ${s.action} (${s.durationMs}ms)`)
              .join('\n')
          : '  (no steps recorded)';

      const prompt = [
        'You are an AI audit assistant reviewing a completed AI agent action.',
        '',
        `ORIGINAL TASK: ${JSON.stringify(trace.originalInput)}`,
        `STEPS TAKEN (${trace.steps.length}):`,
        stepSummary,
        `FINAL OUTPUT: ${JSON.stringify(result).slice(0, 800)}`,
        '',
        'In 2-3 sentences, explain WHY the agent produced this output.',
        'Cover: key factors considered, reasoning pattern, and confidence level.',
        'Write clearly for a non-technical compliance officer.',
        'Do not include any preamble. Start directly with the explanation.',
      ].join('\n');

      const response = await withRetry(
        () =>
          client.chat.completions.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          }),
        this.config.retries
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (response as any)?.choices?.[0]?.message?.content?.trim() as string | undefined;
      return (
        text ||
        `Agent completed the task in ${trace.steps.length} step(s). All accountability rules passed.`
      );
    } catch {
      return `Agent completed the task in ${trace.steps.length} step(s). All accountability rules passed. [Explanation unavailable — LLM unreachable]`;
    }
  }

  async explainBlock(violations: Violation[], trace: Trace): Promise<string> {
    const violationList = violations
      .map(
        (v) =>
          `  • [${v.severity}] Rule "${v.rule}": ${v.description}` +
          (v.evidence ? ` (Evidence: ${v.evidence.slice(0, 80)})` : '') +
          (v.remediation ? `\n    Remediation: ${v.remediation}` : '')
      )
      .join('\n');

    return [
      `⛔ AGENT ACTION BLOCKED`,
      ``,
      `The agent attempted to perform: "${trace.lastAction}"`,
      `Audit ID: ${trace.id}`,
      `Timestamp: ${new Date().toISOString()}`,
      ``,
      `Rule Violations (${violations.length}):`,
      violationList,
      ``,
      `No action was taken. This event has been logged. Human review required.`,
    ].join('\n');
  }
}

// ─── Anthropic Explainer (delegates to OpenAI-compat) ────────────────────────

export class AnthropicExplainer implements ExplainerProvider {
  private inner: OpenAICompatibleExplainer;

  constructor(apiKey?: string, model = 'claude-3-haiku-20240307') {
    this.inner = new OpenAICompatibleExplainer({
      apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'],
      baseURL: 'https://api.anthropic.com/v1',
      model,
    });
  }

  async explainAllow(result: unknown, trace: Trace): Promise<string> {
    return this.inner.explainAllow(result, trace);
  }

  async explainBlock(violations: Violation[], trace: Trace): Promise<string> {
    return this.inner.explainBlock(violations, trace);
  }
}

// ─── No-Op Explainer ─────────────────────────────────────────────────────────

export class NoOpExplainer implements ExplainerProvider {
  async explainAllow(_result: unknown, trace: Trace): Promise<string> {
    return `Agent completed task in ${trace.steps.length} step(s). All accountability rules passed.`;
  }

  async explainBlock(violations: Violation[], trace: Trace): Promise<string> {
    const rules = violations.map((v) => `"${v.rule}"`).join(', ');
    const severityOrder: Violation['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const maxSev = violations.reduce(
      (m, v) =>
        severityOrder.indexOf(v.severity) < severityOrder.indexOf(m) ? v.severity : m,
      'LOW' as Violation['severity']
    );
    return [
      `⛔ AGENT ACTION BLOCKED`,
      `Violated rule(s): ${rules}`,
      `Highest severity: ${maxSev}`,
      `Action attempted: "${trace.lastAction}"`,
      `Audit ID: ${trace.id}`,
      `No action was taken. Human review required.`,
    ].join('\n');
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function resolveExplainer(
  explain: boolean,
  llmConfig?: LLMProviderConfig,
  customExplainer?: ExplainerProvider
): ExplainerProvider {
  if (customExplainer) return customExplainer;
  if (!explain) return new NoOpExplainer();

  if (llmConfig?.baseURL || llmConfig?.apiKey || llmConfig?.model) {
    return new OpenAICompatibleExplainer(llmConfig);
  }

  if (process.env['FEATHERLESS_API_KEY']) {
    return new OpenAICompatibleExplainer({
      baseURL: 'https://api.featherless.ai/v1',
      apiKey: process.env['FEATHERLESS_API_KEY'],
      model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
      ...llmConfig,
    });
  }

  if (process.env['OPENAI_API_KEY']) {
    return new OpenAICompatibleExplainer({
      baseURL: 'https://api.openai.com/v1',
      apiKey: process.env['OPENAI_API_KEY'],
      model: 'gpt-4o-mini',
      ...llmConfig,
    });
  }

  if (process.env['ANTHROPIC_API_KEY']) {
    return new AnthropicExplainer(process.env['ANTHROPIC_API_KEY']);
  }

  return new NoOpExplainer();
}
