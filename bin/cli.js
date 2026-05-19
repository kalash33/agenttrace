#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const UI_DIST = path.join(__dirname, '..', 'agenttrace-ui', 'dist');

const getContentType = (ext) => {
  const map = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  return map[ext] || 'application/octet-stream';
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/api/traces') {
    const tracesPath = path.join(process.cwd(), '.agenttrace', 'traces.ndjson');
    if (!fs.existsSync(tracesPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }

    try {
      const content = fs.readFileSync(tracesPath, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.filter(l => l).map(l => JSON.parse(l));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(parsed));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Serve static files
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  let filePath = path.join(UI_DIST, reqPath);

  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(UI_DIST, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': getContentType(ext) });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found - Ensure UI is built');
  }
});

let PORT = 3001;

const command = process.argv[2];

if (command === 'ui') {
  const startServer = (port) => {
    server.listen(port, () => {
      console.log(`\n🚀 AgentTrace Dashboard running at http://localhost:${port}`);
      console.log(`Reading traces from: ${path.join(process.cwd(), '.agenttrace', 'traces.ndjson')}\n`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error(err);
      }
    });
  };
  
  startServer(PORT);
} else {
  console.log(`\nAgentTrace CLI v1.0.2`);
  console.log(`Usage: npx agenttrace ui\n`);
  process.exit(1);
}
