import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck, Terminal, Clock, ActivitySquare, AlertOctagon } from 'lucide-react';
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

  useEffect(() => {
    fetch('http://localhost:3001/api/traces')
      .then(res => res.json())
      .then(data => {
        setTraces(data);
        if (data.length > 0) setSelectedTrace(data[0]);
      })
      .catch(console.error);
  }, []);

  const totalAllowed = traces.filter(t => !t.blocked).length;
  const totalBlocked = traces.filter(t => t.blocked).length;
  const criticalIssues = traces.filter(t => t.riskLevel === 'CRITICAL' || t.riskLevel === 'HIGH').length;

  return (
    <div className="dashboard-container">
      <header className="header">
        <div className="header-brand">
          <ShieldCheck size={28} className="brand-icon" />
          <h1>AgentTrace Compliance Console</h1>
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
            {traces.map(trace => (
              <div 
                key={trace.auditId} 
                className={`trace-item ${selectedTrace?.auditId === trace.auditId ? 'active' : ''}`}
                onClick={() => setSelectedTrace(trace)}
              >
                <div className="trace-item-header">
                  <span className={`risk-badge risk-${trace.riskLevel.toLowerCase()}`}>{trace.riskLevel}</span>
                  <span className="time">{new Date(trace.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="trace-item-action">
                  {trace.blocked ? <ShieldAlert size={16} className="text-red" /> : <CheckCircle size={16} className="text-green" />}
                  <span>{trace.auditTrail[0]?.action || 'Unknown Action'}</span>
                </div>
              </div>
            ))}
            {traces.length === 0 && <div className="no-data">No logs found in .agenttrace</div>}
          </div>
        </aside>

        {/* Right Content - Trace Details */}
        <section className="detail-view">
          {selectedTrace ? (
            <div className="detail-card">
              <div className="detail-header">
                <h2>Audit Trace Details</h2>
                <div className="detail-badges">
                  {selectedTrace.blocked ? (
                    <span className="badge badge-blocked"><AlertOctagon size={16} /> BLOCKED</span>
                  ) : (
                    <span className="badge badge-allowed"><CheckCircle size={16} /> ALLOWED</span>
                  )}
                  <span className={`badge risk-${selectedTrace.riskLevel.toLowerCase()}`}>RISK: {selectedTrace.riskLevel}</span>
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
