# Changelog

All notable changes to AgentTrace are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-05-30

### 🚀 Major Release — Dashboard v3, Numeric Hallucination, 191 Tests

#### Added
- **Dashboard v3** — full premium dark-mode React UI:
  - Overview: activity area chart, risk distribution donut, compliance radar, enforcement outcomes bar chart
  - Audit Trail: searchable list with risk filter, click-through detail inspector (violations, evidence, AI rationale, steps)
  - Pipeline Monitor: stage flow diagram with parent trace IDs, lineage table, blocked-at indicator in list
  - Auto-refresh every 10 seconds with stat card deltas
  - Zero console errors (accessibility, form ids, functional state init all clean)
- **Numeric hallucination detection** — dedicated numeric value extraction (`8000mg vs 2000mg`) returns `confidence: 0.98`, `severity: CRITICAL`
- **191 passing tests** across 7 test files (unit + integration)
- **`seed-test-data.mjs`** — comprehensive seeding script with 10 realistic scenarios (medical cascade, PII email blast, clean finance, prompt injection, shadow mode, legal advice, etc.)
- **AgentTrace shield logo** — new "AT" icon in dashboard sidebar
- **`list-blocked-at`** pipeline list now shows `· ✕ {blocked_at}` in red for short-circuited pipelines
- **Human-readable action labels** — sidebar shows violation rule name instead of always `function_call`

#### Fixed
- Charts grid layout — was broken, now correct 2×2 responsive grid
- Pipeline/trace click selection — functional `setState` prevents re-render overwriting user selection
- Radar axis labels truncated — added explicit margins to `RadarChart`
- Search input accessibility — added `id="trace-search"` and `id="risk-filter"` (zero console warnings)
- `setSelectedTrace` / `setSelectedPipeline` only set on first load (not every poll cycle)

#### Changed
- `version`: `1.1.0` → `2.0.0`
- `description` updated to reflect circuit breaker + accountability framing
- `keywords` expanded with `hallucination-detection`, `pipeline-safety`, `owasp-llm`, `gdpr`, `hipaa`, `shadow-mode`, `pii-detection`, `real-time-blocking`
- Bar chart now shows 4 bars (Allowed, Blocked, Critical, High) instead of 2
- **Dashboard UX polish:**
  - `CopyableId` component — click any audit/pipeline/parent-trace ID to copy full UUID; hover shows full ID via tooltip; 1.5s green "✓ copied" flash
  - Search bar ✕ clear button appears when typing — one click to reset
  - Search now covers `agent_name`, `pipeline_id`, violation descriptions (not just rule name)
  - Search placeholder updated to "Search traces, rules, audit IDs…"
- **Python SDK `ai-agenttrace` 2.0.0 published to PyPI:**
  - `openai` dependency made optional (`pip install ai-agenttrace[openai]`)
  - Added `keywords` for PyPI discoverability
  - Added Python 3.9–3.12 classifiers, Security topic, Production/Stable status
  - Added Documentation, Repository, Changelog project URLs


---

## [1.1.0] — 2026-05-29

### Added
- `AgentPipeline` class — multi-agent circuit breaker with `pipelineId` lineage
- `PipelineValidator` — validates pipeline config before running
- Shadow enforcement mode — detect without blocking
- `COMPLIANCE_BUNDLES` — pre-configured rule sets (EU_AI_ACT, OWASP_LLM, HEALTHCARE, FINANCE, ALL)
- Dashboard API server (`agenttrace-ui/server.js`) — `/api/traces`, `/api/pipelines`, `/api/stats`
- `block_prompt_injection` rule — OWASP LLM01
- `block_system_prompt_leakage` rule — OWASP LLM07
- `block_ai_identity_deception` rule — EU AI Act Art 50(2)
- `block_manipulation` rule — EU AI Act Art 5

#### Fixed
- Integration tests for C3 (clean 3-stage pipeline) and G4 (groundedness check)
- ESM/CJS dual build — `dist/index.mjs` + `dist/index.js`

---

## [1.0.0] — 2026-05-15

### Initial Release

- `AgentTrace` core class with `wrap()` and `guardFn()` methods
- JavaScript Proxy-based agent wrapping (zero code changes to your agent)
- 9 built-in rules: `block_pii_leakage`, `block_special_category_data`, `block_harmful_content`, `block_medical_advice`, `block_legal_advice`, `block_financial_advice`, `block_discriminatory_output`, `block_hallucination`, `require_human_approval`
- Parallel rule evaluation via `Promise.all()`
- Append-only NDJSON audit trail (`.agenttrace/traces.ndjson`)
- LLM explainer (Anthropic Claude + OpenAI)
- `agenttrace.config.json` global config auto-resolution
- `createRule()` API for custom rules
- Python SDK (`ai-agenttrace` on PyPI)
- TypeScript + CJS + ESM dual build
- Node.js ≥ 18 required
