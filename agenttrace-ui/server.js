import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRACE_FILE = path.resolve(__dirname, '../.agenttrace/traces.ndjson');

/** Parse the NDJSON file and split rows by type */
function readRows() {
  if (!fs.existsSync(TRACE_FILE)) return { traces: [], pipelines: [] };
  const content = fs.readFileSync(TRACE_FILE, 'utf-8');
  const all = content
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);

  const traces   = all.filter(r => r._type !== 'pipeline_summary');
  const pipelines = all.filter(r => r._type === 'pipeline_summary');
  return { traces, pipelines };
}

/** GET /api/traces — individual agent trace rows, newest first */
app.get('/api/traces', (_req, res) => {
  try {
    const { traces } = readRows();
    res.json(traces.reverse());
  } catch (err) {
    console.error('Error reading traces:', err);
    res.status(500).json({ error: 'Failed to read traces' });
  }
});

/** GET /api/pipelines — pipeline summary records, newest first */
app.get('/api/pipelines', (_req, res) => {
  try {
    const { pipelines } = readRows();
    res.json(pipelines.reverse());
  } catch (err) {
    console.error('Error reading pipelines:', err);
    res.status(500).json({ error: 'Failed to read pipelines' });
  }
});

/**
 * GET /api/pipelines/:pipelineId/traces
 * All individual trace rows that belong to a specific pipeline, ordered by stage.
 */
app.get('/api/pipelines/:pipelineId/traces', (req, res) => {
  try {
    const { traces } = readRows();
    const pipelineTraces = traces
      .filter(t => t.pipeline_id === req.params.pipelineId)
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    res.json(pipelineTraces);
  } catch (err) {
    console.error('Error reading pipeline traces:', err);
    res.status(500).json({ error: 'Failed to read pipeline traces' });
  }
});

/** GET /api/stats — aggregate stats for the overview */
app.get('/api/stats', (_req, res) => {
  try {
    const { traces, pipelines } = readRows();
    const blocked = traces.filter(t => t.blocked).length;
    const byRiskLevel = {};
    for (const t of traces) {
      const rl = t.risk_level || 'LOW';
      byRiskLevel[rl] = (byRiskLevel[rl] || 0) + 1;
    }
    const shortCircuited = pipelines.filter(p => p.short_circuited).length;
    res.json({
      total: traces.length,
      blocked,
      allowed: traces.length - blocked,
      byRiskLevel,
      pipelines: pipelines.length,
      shortCircuited,
    });
  } catch (err) {
    console.error('Error reading stats:', err);
    res.status(500).json({ error: 'Failed to read stats' });
  }
});

app.listen(3001, () => {
  console.log('AgentTrace Dashboard API listening on http://localhost:3001');
});
