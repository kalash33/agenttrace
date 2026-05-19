# AgentTrace 🛡️

> **The accountability layer for AI agents. Trace every action. Explain every decision. Control what matters.**

[![npm version](https://img.shields.io/npm/v/@hackerx333/agenttrace.svg)](https://www.npmjs.com/package/@hackerx333/agenttrace)
[![PyPI version](https://img.shields.io/pypi/v/hackerx33-agenttrace.svg)](https://pypi.org/project/hackerx33-agenttrace/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

*Your AI agent's conscience — blocks harm, explains reasoning, logs everything.*

---

<!-- 
🚨 REPOSITORY SETUP CHECKLIST 🚨
Before launching on Hacker News, update your GitHub repository settings:
1. **About Description:** "The open-source accountability layer for AI agents. Trace every action. Explain every decision. Control what matters."
2. **Website Link:** Add the link to your NPM package or official website.
3. **Topics/Tags:** `ai-agents`, `accountability`, `guardrails`, `llm`, `langchain`, `security`
-->

## The Problem

AI agents are making autonomous decisions. **Nobody knows why.**

When they go wrong, nobody can explain what happened.
- 🔴 **51%** of enterprises have AI agents in production.
- 🔴 **"AI Accountability"** is the #1 enterprise requirement for new AI tools.
- 🔴 The **EU AI Act** mandates explainability by December 2027.

Boards want decision logs. Your customers want to trust your AI. **Nobody else provides this combination: open-source + real-time blocking + plain-English explanations + full trace.**

---

## 🌟 Key Features

### 1. The React Dashboard
AgentTrace ships with a stunning, ultra-premium local React dashboard (`agenttrace-ui`).
It automatically visualizes your AI traces, parses multi-step reasoning, and displays dynamic Risk Distribution (Low/Medium/High/Critical) and Action Status (Allowed/Blocked) charts.
*Both TypeScript and Python SDKs log to the exact same file, meaning the dashboard works flawlessly in polyglot monorepos!*

**To launch the dashboard locally:**
```bash
npx agenttrace ui
```
*(The dashboard will instantly read the `.agenttrace/traces.ndjson` file in your main project if you run it from your project root).*

### 2. Enterprise "Shadow Mode"
Nervous about breaking production? Use **Shadow Mode**.
```typescript
const guard = new AgentTrace({
  enforcementMode: 'shadow', // 'enforce' | 'shadow'
  rules: ['block_financial_advice']
});
```
In Shadow Mode, AgentTrace will detect the violation, log it as CRITICAL, and generate the plain-English rationale for the dashboard—but it will **not** block the agent's output from reaching the user. 

### 3. Global Configuration
Drop an `agenttrace.config.json` file in the root of your project. The SDK automatically resolves it.
Configure your compliance rules, LLM explaining models, and enforcement modes universally across hundreds of microservices.

### 4. AI Explainer Engine
When an action is blocked, AgentTrace uses a lightning-fast LLM (via Featherless, OpenAI, or Anthropic) to read the context and write a plain-English explanation for the compliance officer (e.g., *"Agent was blocked because it attempted to provide uncertified medical advice regarding dosage."*).

---

## Quick Start

### TypeScript / Node.js

```bash
npm install @hackerx333/agenttrace
```

```typescript
import { AgentTrace } from '@hackerx333/agenttrace';

// 1. Initialize the accountability layer
const guard = new AgentTrace({
  enforcementMode: 'enforce',
  rules: [
    'block_pii_leakage',       // Stop PII leaking to users
    'block_financial_advice',  // No unqualified investment advice
    'require_human_approval',  // Gate high-value transactions
  ],
  explain: true,               // Generate plain-English explanations
});

// 2. Wrap your agent — same interface, now accountable
const safeAgent = guard.wrap(myLangChainAgent);

// 3. Run it
const result = await safeAgent.run("Process this customer refund");

// If BLOCKED:
// result.blocked   → true
// result.riskLevel → 'CRITICAL'
// result.reason    → "Agent action BLOCKED. Violated rule(s): require_human_approval..."

// If ALLOWED:
// result.blocked      → false
// result.explanation  → "Agent processed a $50 refund because the product was defective."
// result.riskLevel    → 'LOW'
// result.auditTrail   → [step1, step2, ...] — full reasoning chain
```

### Python

```bash
pip install hackerx33-agenttrace
```

```python
from agenttrace import AgentTrace, AgentTraceOptions

guard = AgentTrace(AgentTraceOptions(
    enforcementMode='shadow',
    rules=["block_pii_leakage", "block_harmful_content"],
    explain=True,
))

safe_agent = guard.wrap(my_crewai_agent)
result = await safe_agent.invoke("Process customer request")

print(result.blocked)     # True/False
print(result.risk_level)  # 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
print(result.explanation) # "Agent accessed non-sensitive records securely."
```

---

## Built-in Rules

AgentTrace ships with 13 built-in rules designed to enforce enterprise-grade accountability.

| Rule | Category | What it blocks | Severity |
|------|----------|---------------|----------|
| `block_pii_leakage` | **Privacy** | Emails, phones, SSNs, credit card numbers, Aadhaar, API Keys. | HIGH–CRITICAL |
| `block_special_category_data` | **Privacy** | GDPR Art 9 data: health, genetics, sexual orientation, political views. | HIGH–CRITICAL |
| `block_manipulation` | **EU AI Act** | Art 5 prohibited practices: artificial urgency, dark patterns, gaslighting. | HIGH–CRITICAL |
| `block_discriminatory_output` | **Fairness** | EU Charter Art 21: Bias on race, gender, age, religion, nationality, disability. | CRITICAL |
| `block_ai_identity_deception` | **Transparency**| EU AI Act Art 50: Agents claiming to be human or denying being AI. | CRITICAL |
| `block_medical_advice` | **Professional** | Unqualified diagnosis, treatment recommendations, dosage instructions. | CRITICAL |
| `block_legal_advice` | **Professional** | Unauthorized Practice of Law (UPL): specific legal strategy advice. | HIGH |
| `block_financial_advice` | **Professional** | Investment recommendations, guaranteed returns, loan guidance. | HIGH |
| `block_prompt_injection` | **Security** | OWASP LLM01: Detects instruction overrides, persona hijacking, data exfil. | CRITICAL |
| `block_system_prompt_leakage` | **Security** | OWASP LLM07: Agent exposing its internal configuration or instructions. | HIGH |
| `block_harmful_content` | **Safety** | Violence, illegal instructions, self-harm, hate speech. | HIGH–CRITICAL |
| `require_human_approval` | **Oversight** | Actions above a $ threshold, irreversible/destructive operations. | HIGH–CRITICAL |
| `block_hallucination` | **Quality** | Factual claims not supported by your RAG context documents. | HIGH |

All rules run **in parallel** — zero extra latency on the happy path. You can easily group these by using pre-configured bundles like `COMPLIANCE_BUNDLES.EU_AI_ACT` or `COMPLIANCE_BUNDLES.OWASP_LLM`.

---

## Custom Rules

Write your own rules in 5 lines:

```typescript
import { createRule, AgentTrace } from 'agenttrace';

const noCompetitorMentions = createRule(
  'no_competitor_mentions',
  async ({ result }) => {
    const text = JSON.stringify(result);
    if (text.toLowerCase().includes('rival-corp')) {
      return [{ rule: 'no_competitor_mentions', description: 'Competitor mentioned', severity: 'MEDIUM' }];
    }
    return [];
  }
);

const guard = new AgentTrace({ rules: [noCompetitorMentions, 'block_pii_leakage'] });
```

---

## Audit Trail

Every agent run is automatically stored in a local SQLite database:

```typescript
// Query your audit trail
const recent = guard.storage?.getRecent(20);
const blocked = guard.storage?.getBlocked();
const stats = guard.storage?.stats();
// → { total: 142, blocked: 3, byRiskLevel: { LOW: 138, HIGH: 3, CRITICAL: 1 } }

// Look up a specific run
const run = guard.storage?.getById('audit-uuid-here');
```

---

## Works With

- ✅ **OpenAI** — Assistants, Responses API, Chat Completions
- ✅ **LangChain / LangGraph** — any `.invoke()` or `.run()` agent
- ✅ **CrewAI** — crew.kickoff()
- ✅ **Anthropic** — tool use agents
- ✅ **Any async function** — use `guard.guardFn()`

```typescript
// Works with any async function — no agent object needed
const result = await guard.guardFn(
  async () => await myCustomAgent.process(input),
  input  // original task for tracing
);
```

---

## Explanation Engine

Set `explain: true` and add `ANTHROPIC_API_KEY` to get plain-English explanations:

```
Agent processed a $50 refund for customer #12345 because:
(1) The purchase was within the 30-day return window,
(2) The amount was below the $100 automatic-approval threshold,
(3) The customer's account is in good standing.
Risk: LOW. Confidence: HIGH.
```

No API key? Explanations gracefully fall back to a shorter canned message. **AgentTrace never crashes because of a missing API key.**

---

## Architecture

```
Your Agent
    │
    ▼ (Proxy intercept)
┌─────────────────────────────────────────┐
│              AgentTrace                 │
│                                         │
│  ┌─────────┐  ┌─────────────────────┐   │
│  │  Tracer │  │  Rule Engine        │   │
│  │         │  │  (runs in parallel) │   │
│  │ Step 1  │  │  • block_pii        │   │
│  │ Step 2  │  │  • block_financial  │   │
│  │ Step 3  │  │  • block_harmful    │   │
│  └─────────┘  │  • human_approval   │   │
│               │  • hallucination    │   │
│               │  • custom rules...  │   │
│               └─────────────────────┘   │
│                                         │
│  ┌──────────────┐  ┌────────────────┐   │
│  │   Explainer  │  │     Store      │   │
│  │  (Anthropic  │  │ (SQLite WAL)   │   │
│  │  claude-3)   │  │                │   │
│  └──────────────┘  └────────────────┘   │
└─────────────────────────────────────────┘
    │
    ▼
GuardedResult {
  blocked, reason, explanation,
  riskLevel, auditId, auditTrail,
  violations, result
}
```

---

## Self-Hosted (Free Forever)

AgentTrace stores everything locally in SQLite. Zero cloud dependency. Zero data leaves your machine.

```
.agenttrace/
└── traces.db   ← all your audit trails, WAL mode, fast
```

## Cloud Dashboard (Coming Soon)

- Real-time monitoring dashboard
- Team access and alerts
- Compliance reports (EU AI Act, SOC2)
- 1-year retention with search

→ [Join the waitlist](#)

---

## FAQ

**Q: Does this add latency?**  
A: Rules run in parallel. For the happy path (no violations), the overhead is typically <5ms. Explanation generation (optional) adds ~500-800ms via Anthropic's API.

**Q: What if my agent isn't an object with a `.run()` method?**  
A: Use `guard.guardFn(async () => myFn(input), input)`.

**Q: Can I use this without an Anthropic API key?**  
A: Yes. All rules work without any API key. The `explain: true` feature requires `ANTHROPIC_API_KEY` but falls back gracefully.

**Q: Is the audit trail tamper-proof?**  
A: Currently it's an append-only SQLite WAL database. True cryptographic signing (hash-chain) is on the roadmap.

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Key areas for contribution:
- New built-in rules (domain-specific)
- Agent framework integrations (AutoGen, Semantic Kernel, etc.)
- Better hallucination detection (semantic similarity, vector search)
- Cloud dashboard
- Hash-chain audit trail (tamper-proof)

---

## License

MIT © 2026 AgentTrace Contributors

---

## Why "Accountability" and not "Guardrails"?

> "Intelligence may be scalable, but accountability is not." — Accenture/Wharton, 2026

Guardrails are a feature. Accountability is a principle. Guardrails prevent bad outputs. Accountability explains every output — blocked or allowed — and creates a chain of evidence that stands up to audit.

We believe every AI agent action should be traceable, explainable, and controllable. **Not just the bad ones.**
