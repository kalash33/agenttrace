import { useEffect, useState, useCallback } from 'react';
import {
  Activity, AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck,
  Terminal, Clock, ActivitySquare, AlertOctagon, BarChart3,
  GitBranch, Zap, XCircle, ChevronRight, RefreshCw, Database,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import './index.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type TraceRow = {
  id: string;
  blocked: boolean;
  risk_level: RiskLevel;
  reason?: string;
  explanation?: string;
  steps: Array<{ action: string; input: unknown; output: unknown; durationMs: number; timestamp: string; stepIndex: number }>;
  violations?: Array<{ rule: string; severity: string; description: string; evidence?: string }>;
  result?: unknown;
  timestamp?: string;
  created_at?: string;
  started_at?: string;
  pipeline_id?: string;
  parent_trace_id?: string;
  agent_name?: string;
};

type PipelineStage = {
  name: string;
  auditId: string;
  parentTraceId?: string;
  blocked: boolean;
  riskLevel: RiskLevel;
  violations?: Array<{ rule: string; severity: string; description: string }>;
  durationMs: number;
  result?: unknown;
};

type PipelineRow = {
  pipeline_id: string;
  pipeline_name: string;
  stages: PipelineStage[];
  short_circuited: boolean;
  blocked_at?: string;
  total_duration_ms: number;
  timestamp: string;
};

type Stats = {
  total: number;
  blocked: number;
  allowed: number;
  byRiskLevel: Record<string, number>;
  pipelines: number;
  shortCircuited: number;
};

type ViewMode = 'overview' | 'traces' | 'pipelines';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API = (p: string) =>
  window.location.port === '5173' ? `http://localhost:3001${p}` : p;

function timeAgo(ts?: string) {
  if (!ts) return '';
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [traces, setTraces]       = useState<TraceRow[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [view, setView]           = useState<ViewMode>('overview');
  const [selectedTrace, setSelectedTrace]       = useState<TraceRow | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes, sRes] = await Promise.all([
        fetch(API('/api/traces')),
        fetch(API('/api/pipelines')),
        fetch(API('/api/stats')),
      ]);
      const [t, p, s] = await Promise.all([tRes.json(), pRes.json(), sRes.json()]);
      setTraces(t);
      setPipelines(p);
      setStats(s);
      if (t.length > 0 && !selectedTrace) setSelectedTrace(t[0]);
      if (p.length > 0 && !selectedPipeline) setSelectedPipeline(p[0]);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const riskData = stats ? [
    { name: 'Low',      value: stats.byRiskLevel['LOW']      ?? 0, color: '#10b981' },
    { name: 'Medium',   value: stats.byRiskLevel['MEDIUM']   ?? 0, color: '#f59e0b' },
    { name: 'High',     value: stats.byRiskLevel['HIGH']     ?? 0, color: '#f97316' },
    { name: 'Critical', value: stats.byRiskLevel['CRITICAL'] ?? 0, color: '#ef4444' },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="dashboard-container">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <ShieldCheck size={26} className="brand-icon" />
          <div>
            <h1>AgentTrace</h1>
            <p className="header-sub">Compliance &amp; Pipeline Console</p>
          </div>
        </div>

        <nav className="header-nav">
          {(['overview', 'traces', 'pipelines'] as ViewMode[]).map(v => (
            <button key={v} className={`nav-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
              {v === 'overview'  && <><BarChart3 size={15} /> Overview</>}
              {v === 'traces'    && <><Activity  size={15} /> Audit Trail</>}
              {v === 'pipelines' && <><GitBranch size={15} /> Pipelines{pipelines.length > 0 && <span className="nav-badge">{pipelines.length}</span>}</>}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <button className="refresh-btn" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <span className="status-badge live"><span className="dot" />Live</span>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* ══════════════ OVERVIEW ══════════════ */}
        {view === 'overview' && (
          <div className="overview-full">
            {/* Top stat cards */}
            <div className="overview-stats">
              <StatCard label="Total Runs"    value={stats?.total ?? 0}          color="accent" icon={<Database size={18}/>} />
              <StatCard label="Allowed"       value={stats?.allowed ?? 0}         color="green"  icon={<CheckCircle size={18}/>} />
              <StatCard label="Blocked"       value={stats?.blocked ?? 0}         color="red"    icon={<XCircle size={18}/>} />
              <StatCard label="Pipelines"     value={stats?.pipelines ?? 0}       color="orange" icon={<GitBranch size={18}/>} />
              <StatCard label="Short-Circuit" value={stats?.shortCircuited ?? 0}  color="red"    icon={<Zap size={18}/>} />
            </div>

            <div className="charts-grid">
              <div className="chart-box">
                <h3>Risk Distribution</h3>
                {riskData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={riskData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                        {riskData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChart />}
                <div className="legend">
                  {riskData.map(d => (
                    <span key={d.name} className="legend-item">
                      <span className="legend-dot" style={{ background: d.color }} />
                      {d.name} ({d.value})
                    </span>
                  ))}
                </div>
              </div>

              <div className="chart-box">
                <h3>Action Status</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[
                    { name: 'Allowed', value: stats?.allowed ?? 0 },
                    { name: 'Blocked', value: stats?.blocked ?? 0 },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                    <YAxis stroke="#71717a" fontSize={12} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#27272a' }} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}
                      fill="#6366f1"
                      label={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-box recent-violations-box">
                <h3>Recent Violations</h3>
                {traces.filter(t => t.blocked && t.violations?.length).slice(0, 5).length === 0
                  ? <p className="empty-msg">No violations yet</p>
                  : traces.filter(t => t.blocked && t.violations?.length).slice(0, 5).map((t, i) => (
                    <div key={i} className="mini-violation" onClick={() => { setSelectedTrace(t); setView('traces'); }}>
                      <span className={`risk-badge risk-${t.risk_level?.toLowerCase()}`}>{t.risk_level}</span>
                      <span className="mini-violation-rule">{t.violations?.[0]?.rule}</span>
                      <span className="mini-violation-time">{timeAgo(t.timestamp || t.created_at)}</span>
                    </div>
                  ))
                }
              </div>

              <div className="chart-box recent-pipelines-box">
                <h3>Recent Pipelines</h3>
                {pipelines.slice(0, 5).length === 0
                  ? <p className="empty-msg">No pipelines run yet</p>
                  : pipelines.slice(0, 5).map((p, i) => (
                    <div key={i} className="mini-pipeline" onClick={() => { setSelectedPipeline(p); setView('pipelines'); }}>
                      {p.short_circuited
                        ? <Zap size={14} className="text-red" />
                        : <CheckCircle size={14} className="text-green" />}
                      <span className="mini-pipeline-name">{p.pipeline_name}</span>
                      <span className="mini-pipeline-stages">{p.stages.length} stages</span>
                      <span className="mini-violation-time">{timeAgo(p.timestamp)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ TRACES ══════════════ */}
        {view === 'traces' && (
          <>
            <aside className="sidebar">
              <div className="sidebar-header">
                <span className="sidebar-title">Audit Logs</span>
                <span className="sidebar-count">{traces.length}</span>
              </div>
              <div className="trace-list">
                {traces.length === 0 && <div className="no-data">No traces yet. Run an agent to see logs.</div>}
                {traces.map(t => (
                  <div
                    key={t.id}
                    className={`trace-item ${selectedTrace?.id === t.id ? 'active' : ''} ${t.blocked ? 'trace-blocked' : ''}`}
                    onClick={() => setSelectedTrace(t)}
                  >
                    <div className="trace-item-header">
                      <span className={`risk-badge risk-${(t.risk_level || 'LOW').toLowerCase()}`}>{t.risk_level || 'LOW'}</span>
                      <span className="time">{timeAgo(t.timestamp || t.created_at)}</span>
                    </div>
                    <div className="trace-item-action">
                      {t.blocked ? <ShieldAlert size={14} className="text-red" /> : <CheckCircle size={14} className="text-green" />}
                      <span>{t.steps?.[0]?.action || 'Agent run'}</span>
                    </div>
                    {t.pipeline_id && (
                      <div className="trace-pipeline-tag">
                        <GitBranch size={11} /> {t.agent_name || 'pipeline stage'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            <section className="detail-view">
              {selectedTrace ? <TraceDetail trace={selectedTrace} /> : (
                <div className="empty-state"><ShieldCheck size={48} /><h2>Select an audit log</h2></div>
              )}
            </section>
          </>
        )}

        {/* ══════════════ PIPELINES ══════════════ */}
        {view === 'pipelines' && (
          <>
            <aside className="sidebar">
              <div className="sidebar-header">
                <span className="sidebar-title">Pipeline Runs</span>
                <span className="sidebar-count">{pipelines.length}</span>
              </div>
              <div className="trace-list">
                {pipelines.length === 0 && (
                  <div className="no-data">
                    No pipelines yet. Use <code>AgentPipeline</code> to see runs here.
                  </div>
                )}
                {pipelines.map((p, i) => (
                  <div
                    key={i}
                    className={`trace-item ${selectedPipeline?.pipeline_id === p.pipeline_id ? 'active' : ''} ${p.short_circuited ? 'trace-blocked' : ''}`}
                    onClick={() => setSelectedPipeline(p)}
                  >
                    <div className="trace-item-header">
                      <span className={`risk-badge ${p.short_circuited ? 'risk-critical' : 'risk-low'}`}>
                        {p.short_circuited ? 'BLOCKED' : 'PASSED'}
                      </span>
                      <span className="time">{timeAgo(p.timestamp)}</span>
                    </div>
                    <div className="trace-item-action">
                      {p.short_circuited ? <Zap size={14} className="text-red" /> : <CheckCircle size={14} className="text-green" />}
                      <span>{p.pipeline_name}</span>
                    </div>
                    <div className="trace-pipeline-tag">
                      <GitBranch size={11} /> {p.stages.length} stages · {p.total_duration_ms}ms
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <section className="detail-view">
              {selectedPipeline ? <PipelineDetail pipeline={selectedPipeline} /> : (
                <div className="empty-state"><GitBranch size={48} /><h2>Select a pipeline run</h2></div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <div className="stat-icon">{icon}</div>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function EmptyChart() {
  return <div className="empty-chart">No data yet</div>;
}

// ─── TraceDetail ──────────────────────────────────────────────────────────────

function TraceDetail({ trace }: { trace: TraceRow }) {
  return (
    <div className="detail-card">
      <div className="detail-header">
        <div>
          <h2>Audit Trace</h2>
          <code className="audit-id">{trace.id}</code>
        </div>
        <div className="detail-badges">
          {trace.blocked
            ? <span className="badge badge-blocked"><AlertOctagon size={14} /> BLOCKED</span>
            : <span className="badge badge-allowed"><CheckCircle size={14} /> ALLOWED</span>}
          <span className={`badge risk-badge risk-${(trace.risk_level || 'LOW').toLowerCase()}`}>
            RISK: {trace.risk_level || 'LOW'}
          </span>
        </div>
      </div>

      {/* Pipeline lineage */}
      {trace.pipeline_id && (
        <div className="detail-section pipeline-lineage-section">
          <h3><GitBranch size={16} /> Pipeline Lineage</h3>
          <div className="lineage-grid">
            <div className="lineage-item">
              <span className="lineage-label">Pipeline ID</span>
              <code className="lineage-value">{trace.pipeline_id}</code>
            </div>
            <div className="lineage-item">
              <span className="lineage-label">Stage Name</span>
              <code className="lineage-value">{trace.agent_name || '—'}</code>
            </div>
            {trace.parent_trace_id && (
              <div className="lineage-item">
                <span className="lineage-label">Parent Trace ID</span>
                <code className="lineage-value">{trace.parent_trace_id}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explanation / reason */}
      {(trace.explanation || trace.reason) && (
        <div className="detail-section explanation-section">
          <h3><ActivitySquare size={16} /> AI Rationale</h3>
          <p className="explanation-text">{trace.explanation || trace.reason}</p>
        </div>
      )}

      {/* Violations */}
      {(trace.violations?.length ?? 0) > 0 && (
        <div className="detail-section violations-section">
          <h3><AlertTriangle size={16} /> Rule Violations ({trace.violations!.length})</h3>
          <div className="violations-list">
            {trace.violations!.map((v, i) => (
              <div key={i} className={`violation-item sev-${v.severity?.toLowerCase()}`}>
                <div className="violation-header">
                  <span className="rule-name">{v.rule}</span>
                  <span className={`sev-badge sev-${v.severity?.toLowerCase()}`}>{v.severity}</span>
                </div>
                <p className="rule-desc">{v.description}</p>
                {v.evidence && <code className="evidence">{v.evidence}</code>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution steps */}
      <div className="detail-section steps-section">
        <h3><Terminal size={16} /> Execution Steps ({trace.steps?.length ?? 0})</h3>
        {!trace.steps?.length
          ? <p className="empty-msg">No steps recorded</p>
          : (
            <div className="steps-timeline">
              {trace.steps.map((step, i) => (
                <div key={i} className="step-item">
                  <div className="step-marker" />
                  <div className="step-content">
                    <div className="step-header">
                      <span className="step-action">{step.action}</span>
                      <span className="step-time"><Clock size={11} /> {step.durationMs}ms</span>
                    </div>
                    <div className="step-payloads">
                      <PayloadBox label="Input"  data={step.input} />
                      {step.output !== null && step.output !== undefined && <PayloadBox label="Output" data={step.output} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function PayloadBox({ label, data }: { label: string; data: unknown }) {
  return (
    <div className="payload-box">
      <strong>{label}</strong>
      <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

// ─── PipelineDetail ───────────────────────────────────────────────────────────

function PipelineDetail({ pipeline }: { pipeline: PipelineRow }) {
  return (
    <div className="detail-card">
      <div className="detail-header">
        <div>
          <h2>{pipeline.pipeline_name}</h2>
          <code className="audit-id">{pipeline.pipeline_id}</code>
        </div>
        <div className="detail-badges">
          {pipeline.short_circuited
            ? <span className="badge badge-blocked"><Zap size={14} /> SHORT-CIRCUIT</span>
            : <span className="badge badge-allowed"><CheckCircle size={14} /> COMPLETED</span>}
          <span className="badge badge-neutral">
            <Clock size={14} /> {pipeline.total_duration_ms}ms
          </span>
        </div>
      </div>

      {/* Short-circuit callout */}
      {pipeline.short_circuited && pipeline.blocked_at && (
        <div className="callout callout-error">
          <Zap size={16} />
          <div>
            <strong>Pipeline short-circuited at stage "{pipeline.blocked_at}"</strong>
            <p>All downstream stages were skipped. No further actions were executed.</p>
          </div>
        </div>
      )}

      {/* Stage flow */}
      <div className="detail-section pipeline-stages-section">
        <h3><GitBranch size={16} /> Stage Flow ({pipeline.stages.length} stages ran)</h3>
        <div className="pipeline-flow">
          {pipeline.stages.map((stage, i) => {
            const isBlocked  = stage.blocked;
            const isLast     = i === pipeline.stages.length - 1;
            return (
              <div key={i} className="pipeline-stage-row">
                <div className={`stage-node ${isBlocked ? 'stage-blocked' : 'stage-passed'}`}>
                  <div className="stage-icon">
                    {isBlocked ? <XCircle size={16} /> : <CheckCircle size={16} />}
                  </div>
                  <div className="stage-info">
                    <span className="stage-name">{stage.name}</span>
                    <span className="stage-meta">
                      <span className={`risk-badge risk-${stage.riskLevel?.toLowerCase()}`}>{stage.riskLevel}</span>
                      <span className="stage-duration">{stage.durationMs}ms</span>
                    </span>
                    {isBlocked && (stage.violations?.length ?? 0) > 0 && (
                      <div className="stage-violations">
                        {stage.violations!.map((v, vi) => (
                          <span key={vi} className="stage-viol-tag">{v.rule}</span>
                        ))}
                      </div>
                    )}
                    {stage.parentTraceId && (
                      <div className="stage-lineage">
                        <span className="lineage-label">Parent trace:</span>
                        <code>{stage.parentTraceId.slice(0, 8)}…</code>
                      </div>
                    )}
                  </div>
                </div>
                {!isLast && (
                  <div className={`stage-connector ${pipeline.short_circuited && isBlocked ? 'connector-blocked' : ''}`}>
                    {pipeline.short_circuited && isBlocked
                      ? <span className="connector-label">⛔ STOPPED</span>
                      : <ChevronRight size={16} className="connector-arrow" />}
                  </div>
                )}
              </div>
            );
          })}

          {/* Skipped stages ghost indicator */}
          {pipeline.short_circuited && (() => {
            const blockedIdx = pipeline.stages.findIndex(s => s.blocked);
            // We don't have the full list of defined stages here, just what ran.
            // Show a ghost "Downstream skipped" indicator.
            if (blockedIdx !== -1) {
              return (
                <div className="pipeline-stage-row">
                  <div className="stage-node stage-skipped">
                    <div className="stage-icon"><Zap size={16} /></div>
                    <div className="stage-info">
                      <span className="stage-name">Downstream stages</span>
                      <span className="stage-meta">Skipped — not executed</span>
                    </div>
                  </div>
                </div>
              );
            }
          })()}
        </div>
      </div>

      {/* Lineage table */}
      <div className="detail-section">
        <h3><Activity size={16} /> Trace Lineage</h3>
        <table className="lineage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Stage</th>
              <th>Audit ID</th>
              <th>Parent Trace</th>
              <th>Status</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.stages.map((s, i) => (
              <tr key={i} className={s.blocked ? 'row-blocked' : ''}>
                <td className="td-mono">{i + 1}</td>
                <td><strong>{s.name}</strong></td>
                <td className="td-mono">{s.auditId.slice(0, 8)}…</td>
                <td className="td-mono">{s.parentTraceId ? s.parentTraceId.slice(0, 8) + '…' : <span className="text-muted">—</span>}</td>
                <td>
                  {s.blocked
                    ? <span className="badge badge-blocked" style={{fontSize:'0.7rem',padding:'2px 8px'}}><XCircle size={11}/> BLOCKED</span>
                    : <span className="badge badge-allowed" style={{fontSize:'0.7rem',padding:'2px 8px'}}><CheckCircle size={11}/> OK</span>}
                </td>
                <td><span className={`risk-badge risk-${s.riskLevel?.toLowerCase()}`}>{s.riskLevel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
