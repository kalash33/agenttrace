#!/usr/bin/env node
/**
 * AgentTrace CLI
 * Usage: npx agenttrace ui
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const UI_DIST   = path.join(__dirname, '..', 'agenttrace-ui', 'dist');
const TRACE_FILE = path.join(process.cwd(), '.agenttrace', 'traces.ndjson');

// ─── Content-type map ────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function mime(filePath) {
  return MIME[path.extname(filePath)] || 'application/octet-stream';
}

// ─── NDJSON helpers ───────────────────────────────────────────────────────────

function readRows() {
  if (!fs.existsSync(TRACE_FILE)) return { traces: [], pipelines: [] };
  let all = [];
  try {
    all = fs.readFileSync(TRACE_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { /* ignore */ }
  const traces   = all.filter(r => r._type !== 'pipeline_summary');
  const pipelines = all.filter(r => r._type === 'pipeline_summary');
  return { traces, pipelines };
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── API ──────────────────────────────────────────────────────────────────

  if (req.url === '/api/traces') {
    const { traces } = readRows();
    return json(res, [...traces].reverse());
  }

  if (req.url === '/api/pipelines') {
    const { pipelines } = readRows();
    return json(res, [...pipelines].reverse());
  }

  if (req.url && req.url.startsWith('/api/pipelines/') && req.url.endsWith('/traces')) {
    const pipelineId = req.url.replace('/api/pipelines/', '').replace('/traces', '');
    const { traces } = readRows();
    const filtered = traces
      .filter(t => t.pipeline_id === pipelineId)
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    return json(res, filtered);
  }

  if (req.url === '/api/stats') {
    const { traces, pipelines } = readRows();
    const blocked = traces.filter(t => t.blocked).length;
    const byRiskLevel = {};
    for (const t of traces) {
      const rl = t.risk_level || 'LOW';
      byRiskLevel[rl] = (byRiskLevel[rl] || 0) + 1;
    }
    return json(res, {
      total: traces.length,
      blocked,
      allowed: traces.length - blocked,
      byRiskLevel,
      pipelines: pipelines.length,
      shortCircuited: pipelines.filter(p => p.short_circuited).length,
    });
  }

  // ── Static files ─────────────────────────────────────────────────────────

  let reqPath  = req.url === '/' ? '/index.html' : req.url;
  let filePath = path.join(UI_DIST, reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(UI_DIST, 'index.html'); // SPA fallback
  }

  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': mime(filePath) });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found — run: npm run build inside agenttrace-ui/');
  }
});

// ─── CLI entry ────────────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'ui') {
  const startServer = (port) => {
    server.listen(port, () => {
      console.log(`\n🛡️  AgentTrace Dashboard`);
      console.log(`   Running at:  http://localhost:${port}`);
      console.log(`   Traces file: ${TRACE_FILE}`);
      console.log(`\n   Press Ctrl+C to stop\n`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        startServer(port + 1);
      } else {
        console.error(err);
      }
    });
  };
  startServer(3001);
} else {
  console.log(`\nAgentTrace CLI v1.0.5`);
  console.log(`Usage: npx agenttrace ui\n`);
  process.exit(1);
}
