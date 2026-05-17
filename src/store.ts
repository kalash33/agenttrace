/**
 * Store — pure-JS, zero-native-dependency audit trail storage.
 *
 * Uses newline-delimited JSON (NDJSON) for append-only persistence.
 * Drop-in compatible with the SQLite version's public API.
 * When better-sqlite3 / wasm-sqlite is available, swap this file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GuardedResult, Trace } from './types.js';

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
    };
    fs.appendFileSync(this.filePath, JSON.stringify(row) + '\n', 'utf8');
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  getById(id: string): GuardedResult | null {
    const rows = this._readAll();
    const row = rows.find((r) => r.id === id);
    return row ? this._toResult(row) : null;
  }

  getRecent(limit = 20): GuardedResult[] {
    const rows = this._readAll();
    return rows
      .slice(-limit)
      .reverse()
      .map((r) => this._toResult(r));
  }

  getBlocked(limit = 50): GuardedResult[] {
    const rows = this._readAll().filter((r) => r.blocked);
    return rows
      .slice(-limit)
      .reverse()
      .map((r) => this._toResult(r));
  }

  stats(): { total: number; blocked: number; byRiskLevel: Record<string, number> } {
    const rows = this._readAll();
    const blocked = rows.filter((r) => r.blocked).length;
    const byRiskLevel: Record<string, number> = {};
    for (const r of rows) {
      byRiskLevel[r.risk_level] = (byRiskLevel[r.risk_level] ?? 0) + 1;
    }
    return { total: rows.length, blocked, byRiskLevel };
  }

  /** No-op — file handles are closed after every read/write. */
  close(): void {}

  // ─── Private ──────────────────────────────────────────────────────────────

  private _readAll(): Row[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row);
    } catch {
      return [];
    }
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
    };
  }
}
