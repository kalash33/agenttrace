import * as fs from 'node:fs';
import * as path from 'node:path';

import { v4 as uuidv4 } from 'uuid';
import { AgentTrace } from './guard.js';
import { Store } from './store.js';
import type {
  AgentPipelineOptions,
  PipelineContext,
  PipelineResult,
  StageResult,
} from './types.js';

/**
 * AgentPipeline — the circuit breaker for multi-agent AI pipelines.
 *
 * Connects multiple AgentTrace-wrapped agents into an ordered pipeline where:
 * - All stages share a single `pipelineId` for unified lineage tracking
 * - Each stage receives the previous stage's `auditId` as `parentTraceId`
 * - If any stage is BLOCKED (in enforce mode), the pipeline short-circuits:
 *   all subsequent stages are skipped, preventing error propagation
 * - A pipeline-level summary record is written to the same NDJSON store
 *
 * @example
 * ```typescript
 * import { AgentTrace, AgentPipeline } from '@hackerx333/agenttrace';
 *
 * const pipeline = new AgentPipeline({
 *   name: 'customer-support-pipeline',
 *   agents: [
 *     { name: 'researcher', guard: new AgentTrace({ rules: ['block_hallucination'] }), agent: researchAgent },
 *     { name: 'drafter',    guard: new AgentTrace({ rules: ['block_pii_leakage'] }),   agent: drafterAgent  },
 *     { name: 'executor',   guard: new AgentTrace({ rules: ['require_human_approval'] }), agent: executorAgent },
 *   ],
 *   onStageComplete: (name, result) => {
 *     console.log(`[${name}] ${result.blocked ? '⛔ BLOCKED' : '✅ OK'} — ${result.riskLevel}`);
 *   },
 * });
 *
 * const result = await pipeline.run(userInput);
 *
 * if (result.shortCircuited) {
 *   console.log(`Pipeline blocked at stage: ${result.blockedAt}`);
 *   console.log(`Downstream agents were NOT run.`);
 * }
 * ```
 */
export class AgentPipeline {
  private options: AgentPipelineOptions;
  private store: Store | null;
  private pipelineName: string;

  constructor(options: AgentPipelineOptions) {
    this.options = options;
    this.pipelineName = options.name ?? 'unnamed-pipeline';

    if (options.persist !== false) {
      this.store = new Store(options.storagePath ?? '.agenttrace/traces.ndjson');
    } else {
      this.store = null;
    }
  }

  /**
   * Run the pipeline stages in order.
   *
   * Each stage receives the previous stage's output as its input.
   * If a stage is BLOCKED (enforce mode), the pipeline short-circuits and
   * returns immediately — no downstream agents run.
   *
   * @param input - The initial input passed to the first stage.
   * @returns A PipelineResult describing every stage that ran.
   */
  async run(input: unknown): Promise<PipelineResult> {
    const pipelineId = `pipe_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const pipelineStart = Date.now();
    const timestamp = new Date().toISOString();
    const stages: StageResult[] = [];

    let currentInput: unknown = input;
    let previousAuditId: string | undefined = undefined;
    let shortCircuited = false;
    let blockedAt: string | undefined = undefined;

    this.logPipeline(`Starting pipeline "${this.pipelineName}"`, { pipelineId, stages: this.options.agents.map(a => a.name) });

    for (const stage of this.options.agents) {
      const stageStart = Date.now();

      // Build pipeline context for this stage
      const pipelineContext: PipelineContext = {
        pipelineId,
        parentTraceId: previousAuditId,
        agentName: stage.name,
      };

      // Inject context into the guard instance
      stage.guard._setPipelineContext(pipelineContext);

      let stageResult: StageResult;

      try {
        // Determine which method to invoke on the agent
        const methodName = stage.method ?? 'run';
        const agentMethod = (stage.agent as Record<string, unknown>)[methodName];

        let guardedResult;
        if (typeof agentMethod === 'function') {
          // Use wrap() to intercept the method
          const wrappedAgent = stage.guard.wrap(stage.agent);
          const wrappedMethod = (wrappedAgent as Record<string, unknown>)[methodName] as (...args: unknown[]) => Promise<unknown>;
          guardedResult = await wrappedMethod(currentInput);
        } else {
          // Fall back to guardFn for agents without a matching method
          guardedResult = await stage.guard.guardFn(
            async () => currentInput,
            currentInput
          );
        }

        const gr = guardedResult as import('./types.js').GuardedResult;

        stageResult = {
          name: stage.name,
          auditId: gr.auditId,
          parentTraceId: previousAuditId,
          blocked: gr.blocked,
          riskLevel: gr.riskLevel,
          violations: gr.violations,
          explanation: gr.explanation,
          result: gr.result,
          durationMs: Date.now() - stageStart,
        };

      } catch (err) {
        // If the agent itself throws, treat this as a critical stage failure
        stageResult = {
          name: stage.name,
          auditId: `error-${uuidv4()}`,
          parentTraceId: previousAuditId,
          blocked: true,
          riskLevel: 'CRITICAL',
          violations: [{
            rule: 'stage_error',
            description: `Stage "${stage.name}" threw an exception: ${String(err)}`,
            severity: 'CRITICAL',
          }],
          durationMs: Date.now() - stageStart,
        };
      } finally {
        // Always clean up the pipeline context regardless of success/failure
        stage.guard._clearPipelineContext();
      }

      stages.push(stageResult);

      // Fire the user callback
      if (this.options.onStageComplete) {
        try {
          await this.options.onStageComplete(stage.name, stageResult);
        } catch {
          // Swallow callback errors — don't let user code break the pipeline
        }
      }

      this.logPipeline(
        stageResult.blocked ? `⛔ Stage "${stage.name}" BLOCKED` : `✅ Stage "${stage.name}" passed`,
        { auditId: stageResult.auditId, riskLevel: stageResult.riskLevel }
      );

      if (stageResult.blocked) {
        // SHORT-CIRCUIT: do not run any subsequent stages
        shortCircuited = true;
        blockedAt = stage.name;
        this.logPipeline(`🛑 Pipeline short-circuited at "${stage.name}". Remaining stages will NOT run.`, {
          pipelineId,
          skippedStages: this.options.agents
            .slice(this.options.agents.indexOf(stage) + 1)
            .map(a => a.name),
        });
        break;
      }

      // Pass this stage's output as input to the next stage
      previousAuditId = stageResult.auditId;
      currentInput = stageResult.result;
    }

    const pipelineResult: PipelineResult = {
      pipelineId,
      pipelineName: this.pipelineName,
      stages,
      shortCircuited,
      blockedAt,
      totalDurationMs: Date.now() - pipelineStart,
      timestamp,
    };

    // Persist pipeline-level summary record
    this.store?.savePipeline(pipelineResult);

    this.logPipeline(
      shortCircuited
        ? `Pipeline "${this.pipelineName}" finished with SHORT-CIRCUIT`
        : `Pipeline "${this.pipelineName}" completed successfully`,
      {
        pipelineId,
        totalDurationMs: pipelineResult.totalDurationMs,
        stagesRan: stages.length,
        shortCircuited,
        blockedAt,
      }
    );

    return pipelineResult;
  }

  private logPipeline(message: string, data?: unknown): void {
    console.log(`[AgentPipeline] ${message}`, data ?? '');
  }
}
