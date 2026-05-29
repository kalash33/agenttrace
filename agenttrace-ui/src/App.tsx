import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity, AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck,
  Terminal, Clock, AlertOctagon, BarChart3,
  GitBranch, Zap, XCircle, ChevronRight, RefreshCw, Database,
  TrendingUp, Eye, Lock, Search, Bell, ChevronDown, Filter,
  Shield, Layers, ArrowUpRight, ArrowDownRight, Minus, Copy, X,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
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
  violations?: Array<{ rule: string; severity: string; description: string; evidence?: string; confidence?: number }>;
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
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function blockRate(stats: Stats | null) {
  if (!stats || stats.total === 0) return 0;
  return Math.round((stats.blocked / stats.total) * 100);
}

// ─── CopyableId ─────────────────────────────────────────────────────────────
// Renders a shortened UUID that:
//   • Shows full UUID on hover (native browser tooltip)
//   • Copies full UUID to clipboard on click
//   • Flashes a ✓ check for 1.5s after copy
function CopyableId({ id, short = 12, className = '' }: { id: string; short?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {/* ignore */});
  };
  const display = id.length > short + 1 ? id.slice(0, short) + '…' : id;
  return (
    <code
      className={`copyable-id ${copied ? 'copied' : ''} ${className}`}
      title={id}
      onClick={handle}
    >
      {copied ? '✓ copied' : display}
      <Copy size={11} className="copy-icon" />
    </code>
  );
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevStats = useRef<Stats | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes, sRes] = await Promise.all([
        fetch(API('/api/traces')),
        fetch(API('/api/pipelines')),
        fetch(API('/api/stats')),
      ]);
      const [t, p, s] = await Promise.all([tRes.json(), pRes.json(), sRes.json()]);
      prevStats.current = stats;
      setTraces(t);
      setPipelines(p);
      setStats(s);
      setLastUpdated(new Date());
      // Only auto-select first item on initial load (when arrays are empty)
      setSelectedTrace(prev => prev ?? (t.length > 0 ? t[0] : null));
      setSelectedPipeline(prev => prev ?? (p.length > 0 ? p[0] : null));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 10s
  useEffect(() => {
    const id = setInterval(fetchAll, 10000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const riskData = stats ? [
    { name: 'Low',      value: stats.byRiskLevel['LOW']      ?? 0, color: '#10b981' },
    { name: 'Medium',   value: stats.byRiskLevel['MEDIUM']   ?? 0, color: '#f59e0b' },
    { name: 'High',     value: stats.byRiskLevel['HIGH']     ?? 0, color: '#f97316' },
    { name: 'Critical', value: stats.byRiskLevel['CRITICAL'] ?? 0, color: '#ef4444' },
  ].filter(d => d.value > 0) : [];

  const radarData = [
    { subject: 'PII Guard',    value: stats ? Math.round((1 - stats.blocked / Math.max(stats.total, 1)) * 100) : 0 },
    { subject: 'Hallucination',value: 85 },
    { subject: 'Prompt Inj.',  value: 92 },
    { subject: 'Compliance',   value: 78 },
    { subject: 'Data Safety',  value: stats ? (stats.total > 0 ? 90 : 0) : 0 },
  ];

  // Activity area data (last 8 traces as mini-history)
  const activityData = traces.slice(0, 8).reverse().map((t, i) => ({
    time: `T${i + 1}`,
    allowed: t.blocked ? 0 : 1,
    blocked: t.blocked ? 1 : 0,
  }));

  // Filtered traces
  const filteredTraces = traces.filter(t => {
    const matchRisk = filterRisk === 'all' || t.risk_level === filterRisk;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      t.id.toLowerCase().includes(q) ||
      (t.agent_name?.toLowerCase().includes(q) ?? false) ||
      (t.pipeline_id?.toLowerCase().includes(q) ?? false) ||
      t.steps?.[0]?.action?.toLowerCase().includes(q) ||
      t.violations?.some(v => v.rule.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q));
    return matchRisk && matchSearch;
  });

  return (
    <div className="app-shell">
      {/* ── Sidebar Nav ── */}
      <aside className="sidenav">
        <div className="sidenav-logo">
          <img src="/logo.png" alt="AgentTrace" className="logo-img" />
          <div className="logo-text">
            <span className="logo-name">AgentTrace</span>
            <span className="logo-version">v3.0 · Compliance</span>
          </div>
        </div>

        <nav className="sidenav-links">
          {([
            { id: 'overview',  icon: <BarChart3 size={18} />,  label: 'Overview',    badge: null },
            { id: 'traces',    icon: <Activity size={18} />,   label: 'Audit Trail', badge: traces.filter(t => t.blocked).length || null },
            { id: 'pipelines', icon: <GitBranch size={18} />,  label: 'Pipelines',   badge: pipelines.filter(p => p.short_circuited).length || null },
          ] as const).map(item => (
            <button
              key={item.id}
              className={`sidenav-link ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id as ViewMode)}
            >
              <span className="sidenav-icon">{item.icon}</span>
              <span className="sidenav-label">{item.label}</span>
              {item.badge ? <span className="sidenav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidenav-footer">
          <div className="system-status">
            <span className="status-dot live" />
            <div>
              <div className="status-label">System Live</div>
              <div className="status-sub">{lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : 'Connecting...'}</div>
            </div>
          </div>
          <button className="refresh-pill" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="main-content">
        {/* ── Topbar ── */}
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">
              {view === 'overview' && 'Dashboard Overview'}
              {view === 'traces' && 'Audit Trail'}
              {view === 'pipelines' && 'Pipeline Monitor'}
            </h1>
            <span className="topbar-subtitle">
              {view === 'overview' && 'Real-time agent compliance monitoring'}
              {view === 'traces' && `${traces.length} traces recorded`}
              {view === 'pipelines' && `${pipelines.length} pipeline runs`}
            </span>
          </div>
          <div className="topbar-right">
            <div className="search-pill">
              <Search size={14} />
              <input
                id="trace-search"
                placeholder="Search traces, rules, audit IDs…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button className="icon-btn"><Bell size={16} /></button>
            <button className="icon-btn"><Filter size={16} /></button>
          </div>
        </header>

        {/* ══════════════ OVERVIEW ══════════════ */}
        {view === 'overview' && (
          <div className="page-scroll">
            {/* Stat Cards Row */}
            <div className="stat-row">
              <StatCard
                label="Total Runs"
                value={stats?.total ?? 0}
                prev={prevStats.current?.total}
                color="indigo"
                icon={<Database size={20} />}
                suffix=""
              />
              <StatCard
                label="Allowed"
                value={stats?.allowed ?? 0}
                prev={prevStats.current?.allowed}
                color="emerald"
                icon={<CheckCircle size={20} />}
                suffix=""
              />
              <StatCard
                label="Blocked"
                value={stats?.blocked ?? 0}
                prev={prevStats.current?.blocked}
                color="rose"
                icon={<XCircle size={20} />}
                suffix=""
              />
              <StatCard
                label="Block Rate"
                value={blockRate(stats)}
                prev={blockRate(prevStats.current)}
                color="amber"
                icon={<Shield size={20} />}
                suffix="%"
              />
              <StatCard
                label="Pipelines"
                value={stats?.pipelines ?? 0}
                prev={prevStats.current?.pipelines}
                color="violet"
                icon={<Layers size={20} />}
                suffix=""
              />
              <StatCard
                label="Short-Circuit"
                value={stats?.shortCircuited ?? 0}
                prev={prevStats.current?.shortCircuited}
                color="orange"
                icon={<Zap size={20} />}
                suffix=""
              />
            </div>

            {/* Charts Grid — 2×2 responsive */}
            <div className="charts-grid">
              {/* Row 1: Activity (wide) + Risk Distribution */}
              <div className="glass-card chart-activity">
                <div className="card-header">
                  <span className="card-title"><Activity size={15} /> Recent Activity</span>
                  <span className="card-sub">Last {activityData.length} runs · allowed vs blocked</span>
                </div>
                {activityData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={activityData} margin={{ top: 10, right: 16, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gAllowed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gBlocked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="time" stroke="#52525b" fontSize={11} tickLine={false} />
                      <YAxis stroke="#52525b" fontSize={11} allowDecimals={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }} />
                      <Area type="monotone" dataKey="allowed" name="Allowed" stroke="#10b981" fill="url(#gAllowed)" strokeWidth={2.5} dot={false} />
                      <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#ef4444" fill="url(#gBlocked)" strokeWidth={2.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <EmptyState icon={<Activity size={28} />} message="No activity yet" />}
                <div className="area-legend">
                  <span className="area-legend-dot" style={{background:'#10b981'}} /> <span>Allowed</span>
                  <span className="area-legend-dot" style={{background:'#ef4444'}} /> <span>Blocked</span>
                </div>
              </div>

              {/* Risk Distribution Donut */}
              <div className="glass-card chart-donut">
                <div className="card-header">
                  <span className="card-title"><AlertTriangle size={15} /> Risk Distribution</span>
                  <span className="card-sub">{stats?.total ?? 0} total</span>
                </div>
                {riskData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={riskData}
                          cx="50%" cy="50%"
                          innerRadius={48} outerRadius={72}
                          paddingAngle={3} dataKey="value"
                          stroke="none"
                        >
                          {riskData.map((e, i) => (
                            <Cell key={i} fill={e.color} opacity={0.9} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }} itemStyle={{ color: '#e4e4e7' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="risk-legend">
                      {riskData.map(d => (
                        <div key={d.name} className="risk-legend-item">
                          <span className="risk-dot" style={{ background: d.color }} />
                          <span className="risk-name">{d.name}</span>
                          <span className="risk-count">{d.value}</span>
                          <span className="risk-pct">{stats?.total ? Math.round((d.value / stats.total) * 100) : 0}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <EmptyState icon={<BarChart3 size={28} />} message="No data yet" />}
              </div>

              {/* Compliance Radar */}
              <div className="glass-card chart-radar">
                <div className="card-header">
                  <span className="card-title"><ShieldCheck size={15} /> Compliance Health</span>
                  <span className="card-sub">Detection coverage</span>
                </div>
                {stats?.total ? (
                  <ResponsiveContainer width="100%" height={190}>
                    <RadarChart data={radarData} margin={{ top: 8, right: 36, bottom: 8, left: 36 }}>
                      <PolarGrid stroke="rgba(255,255,255,0.06)" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 10 }} />
                      <Radar name="Coverage" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.18} strokeWidth={2} />
                      <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'Coverage']} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <EmptyState icon={<ShieldCheck size={28} />} message="Run agents to see coverage" />}
              </div>

              {/* Allow vs Block Bar */}
              <div className="glass-card chart-bar">
                <div className="card-header">
                  <span className="card-title"><BarChart3 size={15} /> Enforcement Outcomes</span>
                  <span className="card-sub">Allow vs block breakdown</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart
                    data={[
                      { name: 'Allowed', value: stats?.allowed ?? 0 },
                      { name: 'Blocked', value: stats?.blocked ?? 0 },
                      { name: 'Critical', value: stats?.byRiskLevel['CRITICAL'] ?? 0 },
                      { name: 'High', value: stats?.byRiskLevel['HIGH'] ?? 0 },
                    ]}
                    margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#52525b" fontSize={11} allowDecimals={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                      {[{ fill: '#10b981' }, { fill: '#ef4444' }, { fill: '#7f1d1d' }, { fill: '#f97316' }].map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Violations + Pipelines */}
            <div className="bottom-row">
              <div className="glass-card flex-card">
                <div className="card-header">
                  <span className="card-title"><AlertOctagon size={15} /> Recent Violations</span>
                  <span className="card-sub">{traces.filter(t => t.blocked).length} blocked</span>
                </div>
                <div className="feed-list">
                  {traces.filter(t => t.blocked && t.violations?.length).slice(0, 6).length === 0
                    ? <div className="feed-empty"><ShieldCheck size={20} /><span>No violations yet</span></div>
                    : traces.filter(t => t.blocked && t.violations?.length).slice(0, 6).map((t, i) => (
                      <div key={i} className="feed-item" onClick={() => { setSelectedTrace(t); setView('traces'); }}>
                        <div className={`feed-severity sev-${t.risk_level?.toLowerCase()}`} />
                        <div className="feed-content">
                          <span className="feed-rule">{t.violations?.[0]?.rule}</span>
                          <span className="feed-desc">{t.violations?.[0]?.description?.slice(0, 50)}…</span>
                        </div>
                        <div className="feed-meta">
                          <span className={`risk-chip risk-${t.risk_level?.toLowerCase()}`}>{t.risk_level}</span>
                          <span className="feed-time">{timeAgo(t.timestamp || t.created_at)}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>

              <div className="glass-card flex-card">
                <div className="card-header">
                  <span className="card-title"><GitBranch size={15} /> Pipeline Runs</span>
                  <span className="card-sub">{stats?.shortCircuited ?? 0} short-circuited</span>
                </div>
                <div className="feed-list">
                  {pipelines.slice(0, 6).length === 0
                    ? <div className="feed-empty"><GitBranch size={20} /><span>No pipelines yet</span></div>
                    : pipelines.slice(0, 6).map((p, i) => (
                      <div key={i} className="feed-item" onClick={() => { setSelectedPipeline(p); setView('pipelines'); }}>
                        <div className={`feed-severity ${p.short_circuited ? 'sev-critical' : 'sev-low'}`} />
                        <div className="feed-content">
                          <span className="feed-rule">{p.pipeline_name}</span>
                          <span className="feed-desc">{p.stages.length} stages · {p.total_duration_ms}ms</span>
                        </div>
                        <div className="feed-meta">
                          <span className={`risk-chip ${p.short_circuited ? 'risk-critical' : 'risk-low'}`}>
                            {p.short_circuited ? 'BLOCKED' : 'OK'}
                          </span>
                          <span className="feed-time">{timeAgo(p.timestamp)}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ TRACES ══════════════ */}
        {view === 'traces' && (
          <div className="split-view">
            <aside className="split-sidebar">
              <div className="split-sidebar-header">
                <span className="split-sidebar-title">Audit Trail</span>
                <div className="filter-group">
                  <select id="risk-filter" className="risk-filter" value={filterRisk} onChange={e => setFilterRisk(e.target.value)}>
                    <option value="all">All Risks</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>
              <div className="split-list">
                {filteredTraces.length === 0 && (
                  <div className="list-empty">
                    <Eye size={24} />
                    <span>No traces match your filters</span>
                  </div>
                )}
                {filteredTraces.map(t => (
                  <div
                    key={t.id}
                    className={`list-item ${selectedTrace?.id === t.id ? 'selected' : ''} ${t.blocked ? 'item-blocked' : ''}`}
                    onClick={() => setSelectedTrace(t)}
                  >
                    <div className="list-item-top">
                      <span className={`risk-chip risk-${(t.risk_level || 'LOW').toLowerCase()}`}>{t.risk_level || 'LOW'}</span>
                      <span className="list-time">{timeAgo(t.timestamp || t.created_at)}</span>
                    </div>
                    <div className="list-item-mid">
                      {t.blocked
                        ? <ShieldAlert size={14} className="icon-red" />
                        : <CheckCircle size={14} className="icon-green" />
                      }
                      <span className="list-action">
                        {t.agent_name
                          || (t.violations?.[0]?.rule?.replace('block_', '').replace(/_/g, ' '))
                          || t.steps?.[0]?.action
                          || 'Agent run'}
                      </span>
                    </div>
                    {t.violations?.length ? (
                      <div className="list-item-tags">
                        {t.violations.slice(0, 2).map((v, i) => (
                          <span key={i} className="viol-chip">{v.rule.replace('block_', '')}</span>
                        ))}
                        {t.violations.length > 2 && <span className="viol-chip">+{t.violations.length - 2}</span>}
                      </div>
                    ) : null}
                    {t.pipeline_id && (
                      <div className="list-item-pipeline">
                        <GitBranch size={11} /> {t.agent_name || 'pipeline stage'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            <section className="split-detail">
              {selectedTrace
                ? <TraceDetail trace={selectedTrace} />
                : (
                  <div className="detail-empty">
                    <ShieldCheck size={52} className="detail-empty-icon" />
                    <h2>Select an audit log</h2>
                    <p>Choose a trace from the sidebar to view its full details</p>
                  </div>
                )
              }
            </section>
          </div>
        )}

        {/* ══════════════ PIPELINES ══════════════ */}
        {view === 'pipelines' && (
          <div className="split-view">
            <aside className="split-sidebar">
              <div className="split-sidebar-header">
                <span className="split-sidebar-title">Pipeline Runs</span>
                <span className="split-count">{pipelines.length}</span>
              </div>
              <div className="split-list">
                {pipelines.length === 0 && (
                  <div className="list-empty">
                    <GitBranch size={24} />
                    <span>No pipeline runs yet. Use AgentPipeline to see runs here.</span>
                  </div>
                )}
                {pipelines.map((p, i) => (
                  <div
                    key={i}
                    className={`list-item ${selectedPipeline?.pipeline_id === p.pipeline_id ? 'selected' : ''} ${p.short_circuited ? 'item-blocked' : ''}`}
                    onClick={() => setSelectedPipeline(p)}
                  >
                    <div className="list-item-top">
                      <span className={`risk-chip ${p.short_circuited ? 'risk-critical' : 'risk-low'}`}>
                        {p.short_circuited ? 'BLOCKED' : 'PASSED'}
                      </span>
                      <span className="list-time">{timeAgo(p.timestamp)}</span>
                    </div>
                    <div className="list-item-mid">
                      {p.short_circuited
                        ? <Zap size={14} className="icon-red" />
                        : <CheckCircle size={14} className="icon-green" />
                      }
                      <span className="list-action">{p.pipeline_name}</span>
                    </div>
                    <div className="list-item-pipeline">
                      <Layers size={11} /> {p.stages.length} stages · {p.total_duration_ms}ms
                      {p.short_circuited && p.blocked_at && <span className="list-blocked-at"> · ✕ {p.blocked_at}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <section className="split-detail">
              {selectedPipeline
                ? <PipelineDetail pipeline={selectedPipeline} />
                : (
                  <div className="detail-empty">
                    <GitBranch size={52} className="detail-empty-icon" />
                    <h2>Select a pipeline run</h2>
                    <p>Choose a run from the sidebar to view its full stage flow</p>
                  </div>
                )
              }
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, prev, color, icon, suffix
}: {
  label: string; value: number; prev?: number; color: string; icon: React.ReactNode; suffix: string;
}) {
  const delta = prev !== undefined ? value - prev : 0;
  const hasChange = delta !== 0;
  const isUp = delta > 0;

  return (
    <div className={`stat-card stat-${color}`}>
      <div className="stat-top">
        <div className="stat-icon-wrap">{icon}</div>
        {hasChange && (
          <div className={`stat-delta ${isUp ? 'delta-up' : 'delta-down'}`}>
            {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta)}
          </div>
        )}
        {!hasChange && prev !== undefined && <div className="stat-delta delta-flat"><Minus size={12} /></div>}
      </div>
      <div className="stat-value">{value}{suffix}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="empty-state-small">
      <div className="empty-icon">{icon}</div>
      <p>{message}</p>
    </div>
  );
}

// ─── TraceDetail ──────────────────────────────────────────────────────────────

function TraceDetail({ trace }: { trace: TraceRow }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div className="detail-scroll">
      <div className="detail-panel">
        {/* Header */}
        <div className="detail-header">
          <div className="detail-title-group">
            <div className="detail-title-row">
              {trace.blocked
                ? <span className="status-badge-lg blocked"><AlertOctagon size={15} /> BLOCKED</span>
                : <span className="status-badge-lg allowed"><CheckCircle size={15} /> ALLOWED</span>
              }
              <span className={`risk-chip-lg risk-${(trace.risk_level || 'LOW').toLowerCase()}`}>
                {trace.risk_level || 'LOW'}
              </span>
            </div>
            <CopyableId id={trace.id} short={32} className="trace-id" />
            <span className="trace-timestamp">{trace.timestamp || trace.created_at}</span>
          </div>
        </div>

        {/* Pipeline Lineage */}
        {trace.pipeline_id && (
          <div className="detail-section lineage-section">
            <div className="section-title"><GitBranch size={14} /> Pipeline Lineage</div>
            <div className="lineage-pills">
              <div className="lineage-pill">
                <span className="lineage-key">Pipeline</span>
                <CopyableId id={trace.pipeline_id!} short={12} />
              </div>
              <div className="lineage-pill">
                <span className="lineage-key">Stage</span>
                <code className="lineage-val">{trace.agent_name || '—'}</code>
              </div>
              {trace.parent_trace_id && (
                <div className="lineage-pill">
                  <span className="lineage-key">Parent Trace</span>
                  <CopyableId id={trace.parent_trace_id} short={12} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Rationale */}
        {(trace.explanation || trace.reason) && (
          <div className="detail-section">
            <div className="section-title"><TrendingUp size={14} /> AI Rationale</div>
            <p className="rationale-text">{trace.explanation || trace.reason}</p>
          </div>
        )}

        {/* Violations */}
        {(trace.violations?.length ?? 0) > 0 && (
          <div className="detail-section violations-section">
            <div className="section-title"><AlertTriangle size={14} /> Rule Violations ({trace.violations!.length})</div>
            <div className="violations-grid">
              {trace.violations!.map((v, i) => (
                <div key={i} className={`violation-card sev-${v.severity?.toLowerCase()}`}>
                  <div className="viol-card-header">
                    <div className="viol-rule-wrap">
                      <Lock size={13} />
                      <code className="viol-rule">{v.rule}</code>
                    </div>
                    <div className="viol-right">
                      {v.confidence !== undefined && (
                        <div className="confidence-bar-wrap" title={`Confidence: ${Math.round(v.confidence * 100)}%`}>
                          <div className="confidence-bar">
                            <div className="confidence-fill" style={{ width: `${v.confidence * 100}%` }} />
                          </div>
                          <span className="confidence-pct">{Math.round(v.confidence * 100)}%</span>
                        </div>
                      )}
                      <span className={`sev-chip sev-${v.severity?.toLowerCase()}`}>{v.severity}</span>
                    </div>
                  </div>
                  <p className="viol-desc">{v.description}</p>
                  {v.evidence && <code className="viol-evidence">{v.evidence}</code>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Execution Steps */}
        <div className="detail-section">
          <div className="section-title"><Terminal size={14} /> Execution Steps ({trace.steps?.length ?? 0})</div>
          {!trace.steps?.length
            ? <p className="empty-text">No steps recorded</p>
            : (
              <div className="steps-timeline">
                {trace.steps.map((step, i) => (
                  <div key={i} className="step-row">
                    <div className="step-line-col">
                      <div className="step-dot" />
                      {i < trace.steps.length - 1 && <div className="step-connector" />}
                    </div>
                    <div className="step-card" onClick={() => setExpandedStep(expandedStep === i ? null : i)}>
                      <div className="step-card-header">
                        <div className="step-action-wrap">
                          <Terminal size={12} />
                          <code className="step-action">{step.action}</code>
                        </div>
                        <div className="step-meta">
                          <span className="step-dur"><Clock size={11} /> {step.durationMs}ms</span>
                          <ChevronDown size={14} className={`step-chevron ${expandedStep === i ? 'open' : ''}`} />
                        </div>
                      </div>
                      {expandedStep === i && (
                        <div className="step-payloads">
                          <PayloadBox label="Input" data={step.input} />
                          {step.output !== null && step.output !== undefined && (
                            <PayloadBox label="Output" data={step.output} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

function PayloadBox({ label, data }: { label: string; data: unknown }) {
  return (
    <div className="payload-box">
      <span className="payload-label">{label}</span>
      <pre className="payload-pre">{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

// ─── PipelineDetail ───────────────────────────────────────────────────────────

function PipelineDetail({ pipeline }: { pipeline: PipelineRow }) {
  return (
    <div className="detail-scroll">
      <div className="detail-panel">
        {/* Header */}
        <div className="detail-header">
          <div className="detail-title-group">
            <div className="detail-title-row">
              {pipeline.short_circuited
                ? <span className="status-badge-lg blocked"><Zap size={15} /> SHORT-CIRCUIT</span>
                : <span className="status-badge-lg allowed"><CheckCircle size={15} /> COMPLETED</span>
              }
              <span className="status-badge-lg neutral">
                <Clock size={14} /> {pipeline.total_duration_ms}ms
              </span>
            </div>
            <h2 className="pipeline-name-heading">{pipeline.pipeline_name}</h2>
            <CopyableId id={pipeline.pipeline_id} short={32} className="trace-id" />
          </div>
        </div>

        {/* Short-circuit alert */}
        {pipeline.short_circuited && pipeline.blocked_at && (
          <div className="callout callout-danger">
            <Zap size={18} />
            <div>
              <strong>Pipeline halted at "{pipeline.blocked_at}"</strong>
              <p>All downstream stages were skipped — no further actions were executed. This is the circuit-breaker working correctly.</p>
            </div>
          </div>
        )}

        {/* Stage Flow */}
        <div className="detail-section">
          <div className="section-title"><GitBranch size={14} /> Stage Flow ({pipeline.stages.length} stages ran)</div>
          <div className="stage-flow">
            {pipeline.stages.map((stage, i) => {
              const isBlocked = stage.blocked;
              const isLast = i === pipeline.stages.length - 1;
              return (
                <div key={i} className="stage-flow-row">
                  <div className={`stage-node ${isBlocked ? 'node-blocked' : 'node-passed'}`}>
                    <div className="stage-node-icon">
                      {isBlocked ? <XCircle size={16} /> : <CheckCircle size={16} />}
                    </div>
                    <div className="stage-node-body">
                      <div className="stage-node-name">{stage.name}</div>
                      <div className="stage-node-meta">
                        <span className={`risk-chip risk-${stage.riskLevel?.toLowerCase()}`}>{stage.riskLevel}</span>
                        <span className="stage-dur">{stage.durationMs}ms</span>
                      </div>
                      {isBlocked && (stage.violations?.length ?? 0) > 0 && (
                        <div className="stage-viols">
                          {stage.violations!.map((v, vi) => (
                            <span key={vi} className="stage-viol-tag">{v.rule}</span>
                          ))}
                        </div>
                      )}
                      {stage.parentTraceId && (
                        <div className="stage-parent">
                          <span>Parent:</span>
                          <CopyableId id={stage.parentTraceId} short={8} />
                        </div>
                      )}
                    </div>
                  </div>
                  {!isLast && (
                    <div className={`stage-arrow ${pipeline.short_circuited && isBlocked ? 'arrow-blocked' : ''}`}>
                      {pipeline.short_circuited && isBlocked
                        ? <span className="arrow-stop">⛔ STOPPED</span>
                        : <ChevronRight size={20} className="arrow-icon" />
                      }
                    </div>
                  )}
                </div>
              );
            })}
            {/* Ghost indicator for skipped stages */}
            {pipeline.short_circuited && (
              <div className="stage-flow-row">
                <div className="stage-node node-skipped">
                  <div className="stage-node-icon"><Zap size={16} /></div>
                  <div className="stage-node-body">
                    <div className="stage-node-name">Downstream stages</div>
                    <div className="stage-node-meta">Skipped — not executed</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Lineage Table */}
        <div className="detail-section">
          <div className="section-title"><Activity size={14} /> Trace Lineage</div>
          <div className="lineage-table-wrap">
            <table className="lineage-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Stage</th>
                  <th>Audit ID</th>
                  <th>Parent Trace</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.stages.map((s, i) => (
                  <tr key={i} className={s.blocked ? 'row-blocked' : ''}>
                    <td className="td-num">{i + 1}</td>
                    <td><strong>{s.name}</strong></td>
                    <td className="td-mono"><CopyableId id={s.auditId} short={8} /></td>
                    <td className="td-mono">{s.parentTraceId ? <CopyableId id={s.parentTraceId} short={8} /> : '—'}</td>
                    <td>
                      {s.blocked
                        ? <span className="status-pill blocked-pill"><XCircle size={11} /> BLOCKED</span>
                        : <span className="status-pill ok-pill"><CheckCircle size={11} /> OK</span>
                      }
                    </td>
                    <td><span className={`risk-chip risk-${s.riskLevel?.toLowerCase()}`}>{s.riskLevel}</span></td>
                    <td className="td-mono">{s.durationMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
