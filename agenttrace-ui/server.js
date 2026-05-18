import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const app = express();
app.use(cors());

// Path to the agenttrace logs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRACE_FILE = path.resolve(__dirname, '../.agenttrace/traces.ndjson');

app.get('/api/traces', (req, res) => {
  try {
    if (!fs.existsSync(TRACE_FILE)) {
      return res.json([]);
    }
    const content = fs.readFileSync(TRACE_FILE, 'utf-8');
    const traces = content
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line));
      
    // Sort newest first
    res.json(traces.reverse());
  } catch (err) {
    console.error("Error reading traces:", err);
    res.status(500).json({ error: "Failed to read traces" });
  }
});

app.listen(3001, () => {
  console.log('AgentTrace Dashboard API listening on port 3001');
});
