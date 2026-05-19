import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck, Terminal, Clock, ActivitySquare, AlertOctagon, BarChart3 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import './index.css';

type Trace = {
  auditId: string;
  blocked: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason?: string;
  explanation?: string;
  auditTrail: Array<{
    action: string;
    input: any;
    output: any;
    durationMs: number;
    timestamp: string;
  }>;
  violations?: Array<{
    rule: string;
    severity: string;
    description: string;
  }>;
  result?: any;
  timestamp: string;
};

function App() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [view, setView] = useState<'overview' | 'detail'>('detail');

  useEffect(() => {
    const apiUrl = window.location.hostname === 'localhost' && window.location.port === '5173' 
      ? 'http://localhost:3001/api/traces' 
      : '/api/traces';
    fetch(apiUrl)
      .then(res => res.json())
      .then(data => {
        const normalized: Trace[] = data.map((raw: any) => ({
          auditId: raw.id || raw.audit_id || raw.auditId || 'unknown',
          blocked: !!raw.blocked,
          riskLevel: raw.risk_level || raw.riskLevel || 'LOW',
          reason: raw.reason,
          explanation: raw.explanation,
          auditTrail: raw.steps || raw.audit_trail || raw.auditTrail || [],
          violations: raw.violations || [],
          result: raw.result,
          timestamp: raw.created_at || raw.timestamp || raw.started_at || new Date().toISOString()
        }));
        setTraces(normalized);
        if (normalized.length > 0) setSelectedTrace(normalized[0]);
      })
      .catch(console.error);
  }, []);

  const totalAllowed = traces.filter(t => !t.blocked).length;
  const totalBlocked = traces.filter(t => t.blocked).length;
  const criticalIssues = traces.filter(t => t.riskLevel === 'CRITICAL' || t.riskLevel === 'HIGH').length;

  const riskData = [
    { name: 'Low', value: traces.filter(t => t.riskLevel === 'LOW').length, color: '#10b981' },
    { name: 'Medium', value: traces.filter(t => t.riskLevel === 'MEDIUM').length, color: '#f59e0b' },
    { name: 'High/Critical', value: criticalIssues, color: '#ef4444' }
  ].filter(d => d.value > 0);

  return (
    <div className="dashboard-container">
      <header className="header">
        <div className="header-brand">
          <ShieldCheck size={28} className="brand-icon" />
          <h1>AgentTrace Compliance Console</h1>
        </div>
        <div className="header-nav">
          <button className={`nav-btn ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            <BarChart3 size={16} /> Overview
          </button>
          <button className={`nav-btn ${view === 'detail' ? 'active' : ''}`} onClick={() => setView('detail')}>
            <Activity size={16} /> Audit Trail
          </button>
        </div>
        <div className="header-status">
          <span className="status-badge live"><span className="dot"></span> Live Monitoring</span>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Left Sidebar - Logs List */}
        <aside className="sidebar">
          <div className="stats-row">
            <div className="stat-card">
              <span className="stat-value text-green">{totalAllowed}</span>
              <span className="stat-label">Allowed Actions</span>
            </div>
            <div className="stat-card">
              <span className="stat-value text-red">{totalBlocked}</span>
              <span className="stat-label">Blocked Actions</span>
            </div>
            <div className="stat-card">
              <span className="stat-value text-orange">{criticalIssues}</span>
              <span className="stat-label">High Risk</span>
            </div>
          </div>

          <h3 className="section-title">Recent Audit Logs</h3>
          <div className="trace-list">
            {traces.map(trace => {
              const rLevel = trace.riskLevel || 'LOW';
              return (
              <div 
                key={trace.auditId} 
                className={`trace-item ${selectedTrace?.auditId === trace.auditId ? 'active' : ''}`}
                onClick={() => setSelectedTrace(trace)}
              >
                <div className="trace-item-header">
                  <span className={`risk-badge risk-${rLevel.toLowerCase()}`}>{rLevel}</span>
                  <span className="time">{new Date(trace.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="trace-item-action">
                  {trace.blocked ? <ShieldAlert size={16} className="text-red" /> : <CheckCircle size={16} className="text-green" />}
                  <span>{trace.auditTrail?.[0]?.action || 'Unknown Action'}</span>
                </div>
              </div>
            )})}
            {traces.length === 0 && <div className="no-data">No logs found in .agenttrace</div>}
          </div>
        </aside>

        {/* Right Content - Trace Details */}
        <section className="detail-view">
          {view === 'overview' ? (
            <div className="overview-card">
              <div className="detail-header">
                <h2>Compliance Overview</h2>
              </div>
              <div className="charts-grid">
                <div className="chart-box">
                  <h3>Risk Distribution</h3>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={riskData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {riskData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="chart-box">
                  <h3>Action Status</h3>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={[
                        { name: 'Allowed', value: totalAllowed, fill: '#10b981' },
                        { name: 'Blocked', value: totalBlocked, fill: '#ef4444' }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="name" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" allowDecimals={false} />
                        <Tooltip cursor={{ fill: '#334155', opacity: 0.2 }} contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedTrace ? (
            <div className="detail-card">
              <div className="detail-header">
                <h2>Audit Trace Details</h2>
                <div className="detail-badges">
                  {selectedTrace.blocked ? (
                    <span className="badge badge-blocked"><AlertOctagon size={16} /> BLOCKED</span>
                  ) : (
                    <span className="badge badge-allowed"><CheckCircle size={16} /> ALLOWED</span>
                  )}
                  <span className={`badge risk-${(selectedTrace.riskLevel || 'LOW').toLowerCase()}`}>RISK: {selectedTrace.riskLevel || 'LOW'}</span>
                </div>
              </div>

              <div className="detail-section explanation-section">
                <h3><ActivitySquare size={18} /> AI Rationale</h3>
                <p className="explanation-text">
                  {selectedTrace.explanation || selectedTrace.reason}
                </p>
              </div>

              {selectedTrace.violations && selectedTrace.violations.length > 0 && (
                <div className="detail-section violations-section">
                  <h3><AlertTriangle size={18} /> Rule Violations</h3>
                  <div className="violations-list">
                    {selectedTrace.violations.map((v, i) => (
                      <div key={i} className="violation-item">
                        <span className="rule-name">{v.rule}</span>
                        <p className="rule-desc">{v.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-section steps-section">
                <h3><Terminal size={18} /> Execution Steps</h3>
                <div className="steps-timeline">
                  {selectedTrace.auditTrail.map((step, i) => (
                    <div key={i} className="step-item">
                      <div className="step-marker"></div>
                      <div className="step-content">
                        <div className="step-header">
                          <span className="step-action">{step.action}</span>
                          <span className="step-time"><Clock size={12} /> {step.durationMs}ms</span>
                        </div>
                        <div className="step-payloads">
                          <div className="payload-box">
                            <strong>Input:</strong>
                            <pre>{JSON.stringify(step.input, null, 2)}</pre>
                          </div>
                          {step.output && (
                            <div className="payload-box">
                              <strong>Output:</strong>
                              <pre>{JSON.stringify(step.output, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="empty-state">
              <ShieldCheck size={48} />
              <h2>Select an audit log to view details</h2>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
