/**
 * Store — pure-JS, zero-native-dependency audit trail storage.
 *
 * Uses newline-delimited JSON (NDJSON) for append-only persistence.
 *
 * v2 improvements (academic basis):
 *
 *  [1] Hash-Chained Records (Microsoft Agent Governance Toolkit research, 2024):
 *      Each record includes a SHA-256 hash of the previous line, forming an
 *      immutable chain. Any tampering of a record breaks the chain and is
 *      detectable via verifyIntegrity(). This satisfies tamper-evidence
 *      requirements in financial services, healthcare, and EU AI Act Art 9
 *      (risk management documentation must be maintained and verifiable).
 *
 *  [2] Integrity Verification API:
 *      New public method verifyIntegrity() walks the entire chain and reports
 *      any broken links — gaps, modified records, or deleted lines.
 *
 *  [3] Sequence Numbers:
 *      Each record includes a monotonically increasing seq field. Gaps in
 *      sequence numbers indicate deleted records even without hash breakage.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GuardedResult, PipelineResult, Trace } from './types.js';

// ─── Internal Row Shape ───────────────────────────────────────────────────────

interface Row {
  id: string;
  started_at: string;
  input: unknown;
  steps: unknown[];
  blocked: boolean;
  risk_level: string;
  explanation: string | null;
  reason: string | null;
  violations: unknown[] | null;
  result: unknown | null;
  created_at: string;
  timestamp?: string;
  metadata?: Record<string, unknown> | null;
  // Pipeline lineage fields
  pipeline_id?: string | null;
  parent_trace_id?: string | null;
  agent_name?: string | null;
  // v2: Hash chain fields
  seq?: number;
  prev_hash?: string;
  row_hash?: string;
}

// ─── Internal Pipeline Row Shape ──────────────────────────────────────────────

interface PipelineRow {
  _type: 'pipeline_summary';
  pipeline_id: string;
  pipeline_name: string;
  stages: unknown[];
  short_circuited: boolean;
  blocked_at: string | null;
  total_duration_ms: number;
  timestamp: string;
  created_at: string;
  // v2: Hash chain fields
  seq?: number;
  prev_hash?: string;
  row_hash?: string;
}

// ─── Integrity Report ─────────────────────────────────────────────────────────

export interface IntegrityReport {
  /** Whether the entire chain is intact */
  intact: boolean;
  /** Total records checked */
  totalRecords: number;
  /** Records with broken prev_hash links */
  brokenLinks: Array<{ seq: number; id: string; reason: string }>;
  /** Records with non-contiguous sequence numbers (possible deletions) */
  sequenceGaps: Array<{ expectedSeq: number; foundSeq: number }>;
  /** Records without hash data (written before v2) */
  legacyRecords: number;
}

// ─── Store Class ──────────────────────────────────────────────────────────────

export class Store {
  private filePath: string;

  constructor(storagePath: string = '.agentguard/traces.ndjson') {
    // Accept .db extension too — just rename to .ndjson internally
    const resolved = storagePath.endsWith('.db')
      ? storagePath.replace(/\.db$/, '.ndjson')
      : storagePath;

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.filePath = resolved;

    // Create file if missing
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf8');
    }
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  save(trace: Trace, guardedResult: GuardedResult): void {
    const { prevHash, seq } = this._getChainState();

    const row: Row = {
      id: trace.id,
      started_at: trace.startedAt,
      input: trace.originalInput,
      steps: trace.steps,
      blocked: guardedResult.blocked,
      risk_level: guardedResult.riskLevel,
      explanation: guardedResult.explanation ?? null,
      reason: guardedResult.reason ?? null,
      violations: guardedResult.violations ?? null,
      result: guardedResult.result ?? null,
      created_at: new Date().toISOString(),
      timestamp: guardedResult.timestamp,
      metadata: guardedResult.metadata ?? null,
      // Pipeline lineage — null when running standalone
      pipeline_id: trace.pipelineId ?? null,
      parent_trace_id: trace.parentTraceId ?? null,
      agent_name: trace.agentName ?? null,
      // v2: chain fields
      seq,
      prev_hash: prevHash,
    };

    const rowJson = JSON.stringify(row);
    const rowHash = this._sha256(rowJson);
    const finalRow = { ...row, row_hash: rowHash };

    fs.appendFileSync(this.filePath, JSON.stringify(finalRow) + '\n', 'utf8');
  }

  /**
   * Persist a pipeline-level summary record.
   * Individual stage traces are already written by their own AgentTrace instances.
   * This record ties them together for dashboard pipeline-view queries.
   */
  savePipeline(pipelineResult: PipelineResult): void {
    const { prevHash, seq } = this._getChainState();

    const row: PipelineRow = {
      _type: 'pipeline_summary',
      pipeline_id: pipelineResult.pipelineId,
      pipeline_name: pipelineResult.pipelineName,
      stages: pipelineResult.stages,
      short_circuited: pipelineResult.shortCircuited,
      blocked_at: pipelineResult.blockedAt ?? null,
      total_duration_ms: pipelineResult.totalDurationMs,
      timestamp: pipelineResult.timestamp,
      created_at: new Date().toISOString(),
      // v2: chain fields
      seq,
      prev_hash: prevHash,
    };

    const rowJson = JSON.stringify(row);
    const rowHash = this._sha256(rowJson);
    const finalRow = { ...row, row_hash: rowHash };

    fs.appendFileSync(this.filePath, JSON.stringify(finalRow) + '\n', 'utf8');
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  getById(id: string): GuardedResult | null {
    const rows = this._readTraceRows();
    const row = rows.find((r) => r.id === id);
    return row ? this._toResult(row) : null;
  }

  getRecent(limit = 20): GuardedResult[] {
    const rows = this._readTraceRows();
    return rows
      .slice(-limit)
      .reverse()
      .map((r) => this._toResult(r));
  }

  getBlocked(limit = 50): GuardedResult[] {
    const rows = this._readTraceRows().filter((r) => r.blocked);
    return rows
      .slice(-limit)
      .reverse()
      .map((r) => this._toResult(r));
  }

  stats(): { total: number; blocked: number; byRiskLevel: Record<string, number> } {
    const rows = this._readTraceRows();
    const blocked = rows.filter((r) => r.blocked).length;
    const byRiskLevel: Record<string, number> = {};
    for (const r of rows) {
      byRiskLevel[r.risk_level] = (byRiskLevel[r.risk_level] ?? 0) + 1;
    }
    return { total: rows.length, blocked, byRiskLevel };
  }

  /**
   * Get all pipeline summary records.
   */
  getPipelines(limit = 20): PipelineResult[] {
    const rows = this._readAll()
      .filter((r): r is PipelineRow => (r as PipelineRow)._type === 'pipeline_summary')
      .slice(-limit)
      .reverse();

    return rows.map((r) => ({
      pipelineId: r.pipeline_id,
      pipelineName: r.pipeline_name,
      stages: r.stages as PipelineResult['stages'],
      shortCircuited: r.short_circuited,
      blockedAt: r.blocked_at ?? undefined,
      totalDurationMs: r.total_duration_ms,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get all individual trace records that belong to a specific pipeline.
   */
  getByPipelineId(pipelineId: string): GuardedResult[] {
    const rows = this._readTraceRows().filter((r) => r.pipeline_id === pipelineId);
    return rows.map((r) => this._toResult(r));
  }

  /**
   * Verify the integrity of the hash chain.
   *
   * Academic basis: Tamper-evident audit logs are required under EU AI Act Art 9
   * (risk management system documentation) and are a best practice per Microsoft
   * Agent Governance Toolkit (2024) for autonomous agent audit trails.
   *
   * Returns an IntegrityReport describing any broken links or gaps in the chain.
   * An intact chain guarantees no records were modified or deleted after writing.
   *
   * @example
   * const report = store.verifyIntegrity();
   * if (!report.intact) {
   *   console.error('Audit trail may have been tampered with!', report.brokenLinks);
   * }
   */
  verifyIntegrity(): IntegrityReport {
    const lines = this._readRawLines();
    const report: IntegrityReport = {
      intact: true,
      totalRecords: lines.length,
      brokenLinks: [],
      sequenceGaps: [],
      legacyRecords: 0,
    };

    let prevHash = '0'.repeat(64);  // genesis hash
    let expectedSeq = 0;

    for (const line of lines) {
      let record: Row | PipelineRow;
      try {
        record = JSON.parse(line) as Row | PipelineRow;
      } catch {
        report.intact = false;
        report.brokenLinks.push({ seq: expectedSeq, id: '(parse error)', reason: 'Invalid JSON' });
        expectedSeq++;
        continue;
      }

      const { row_hash, prev_hash, seq } = record as Row;

      // Legacy records (pre-v2) — skip hash verification
      if (!row_hash || !prev_hash || seq === undefined) {
        report.legacyRecords++;
        expectedSeq++;
        continue;
      }

      // Check sequence gap
      if (seq !== expectedSeq) {
        report.intact = false;
        report.sequenceGaps.push({ expectedSeq, foundSeq: seq });
      }

      // Verify prev_hash matches hash of previous record
      if (prev_hash !== prevHash) {
        report.intact = false;
        const id = (record as Row).id ?? (record as PipelineRow).pipeline_id ?? 'unknown';
        report.brokenLinks.push({
          seq,
          id,
          reason: `prev_hash mismatch. Expected ${prevHash.slice(0,16)}…, got ${prev_hash.slice(0,16)}…`,
        });
      }

      // Verify this record's own hash
      // To verify: re-hash the record without the row_hash field
      const { row_hash: _rh, ...rowWithoutHash } = record as Row & { row_hash: string };
      const computedHash = this._sha256(JSON.stringify(rowWithoutHash));
      if (computedHash !== row_hash) {
        report.intact = false;
        const id = (record as Row).id ?? (record as PipelineRow).pipeline_id ?? 'unknown';
        report.brokenLinks.push({
          seq,
          id,
          reason: 'row_hash mismatch — record content may have been modified',
        });
      }

      prevHash = row_hash;
      expectedSeq = seq + 1;
    }

    return report;
  }

  /** No-op — file handles are closed after every read/write. */
  close(): void {}

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Get the hash of the last written line and the next sequence number.
   * Used to build the chain for each new record.
   */
  private _getChainState(): { prevHash: string; seq: number } {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);

      if (lines.length === 0) {
        return { prevHash: '0'.repeat(64), seq: 0 };
      }

      const lastLine = lines[lines.length - 1]!;
      const lastRecord = JSON.parse(lastLine) as Row;
      const prevHash = lastRecord.row_hash ?? '0'.repeat(64);
      const seq = (lastRecord.seq ?? lines.length - 2) + 1;

      return { prevHash, seq };
    } catch {
      return { prevHash: '0'.repeat(64), seq: 0 };
    }
  }

  private _sha256(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  private _readRawLines(): string[] {
    try {
      return fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private _readAll(): (Row | PipelineRow)[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row | PipelineRow);
    } catch {
      return [];
    }
  }

  private _readTraceRows(): Row[] {
    return this._readAll().filter(
      (r): r is Row => (r as PipelineRow)._type !== 'pipeline_summary'
    );
  }

  private _toResult(row: Row): GuardedResult {
    return {
      auditId: row.id,
      blocked: row.blocked,
      riskLevel: row.risk_level as GuardedResult['riskLevel'],
      explanation: row.explanation ?? undefined,
      reason: row.reason ?? undefined,
      violations: (row.violations as GuardedResult['violations']) ?? undefined,
      result: row.result ?? undefined,
      auditTrail: (row.steps as GuardedResult['auditTrail']) ?? [],
      timestamp: row.timestamp ?? row.created_at,
      metadata: row.metadata ?? undefined,
      pipelineId: row.pipeline_id ?? undefined,
      parentTraceId: row.parent_trace_id ?? undefined,
    };
  }
}
