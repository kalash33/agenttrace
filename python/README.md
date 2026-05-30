<p align="center">
  <img src="https://raw.githubusercontent.com/kalash33/agenttrace/main/docs/images/logo.png" alt="AgentTrace Logo" width="120" />
</p>

<h1 align="center">AgentTrace 🛡️</h1>

<p align="center">
  <strong>The open-source circuit breaker for multi-agent AI pipelines.</strong><br/>
  Trace every action. Block hallucinations. Short-circuit before damage propagates.
</p>

<p align="center">
  <a href="https://pypi.org/project/ai-agenttrace/"><img src="https://img.shields.io/pypi/v/ai-agenttrace.svg?style=flat-square" alt="PyPI version"/></a>
  <a href="https://www.npmjs.com/package/@hackerx333/agenttrace"><img src="https://img.shields.io/npm/v/@hackerx333/agenttrace.svg?style=flat-square" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="MIT License"/></a>
  <a href="https://github.com/kalash33/agenttrace"><img src="https://img.shields.io/badge/tests-191%20passing-brightgreen?style=flat-square" alt="Tests"/></a>
</p>

---

> **"Agent 1 made an error. Agent 2 built on it. Agent 3 executed it. All three returned status 200. Nobody knew."**
>
> AgentTrace is the circuit breaker your AI pipeline is missing.

---

## Why AgentTrace

| Everyone else | AgentTrace |
|---|---|
| Observability (logs what happened) | **Accountability** (blocks what shouldn't happen) |
| Single-agent guardrails | **Cross-agent circuit breaker** |
| Cloud-dependent | **Zero-cloud, local NDJSON, self-hosted forever** |
| Post-mortem debugging | **Pre-mortem intervention** |

---

## Quick Start — Python

```bash
pip install ai-agenttrace
# With OpenAI explainer support:
pip install "ai-agenttrace[openai]"
```

```python
import asyncio
from agenttrace import AgentTrace, AgentTraceOptions

guard = AgentTrace(AgentTraceOptions(
    rules=["block_pii_leakage", "block_harmful_content", "block_hallucination"],
    persist=True,  # saves to .agenttrace/traces.ndjson
))

async def my_agent(prompt: str) -> str:
    # your LLM call here
    return "Agent response..."

async def main():
    result = await guard.guard_fn(
        lambda: my_agent("Process customer request"),
        original_input="Process customer request"
    )

    if result.blocked:
        print(f"BLOCKED: {result.reason}")
        print(f"Risk: {result.risk_level}")
        print(f"Audit ID: {result.audit_id}")
    else:
        print(result.result)        # safe to use
        print(result.explanation)   # "Agent processed refund. Risk: LOW."

asyncio.run(main())
```

---

## Multi-Agent Pipeline — Circuit Breaker

The key feature: when Agent 1 (researcher) is blocked, Agent 2 (drafter) and Agent 3 (executor) **never run**.

```python
# TypeScript/Node version has full AgentPipeline — Python parity in v3.0
# For now, compose manually:

result_1 = await guard.guard_fn(researcher_agent, input)
if result_1.blocked:
    print(f"Pipeline halted at researcher — {result_1.risk_level}")
    # executor never runs
else:
    result_2 = await guard.guard_fn(executor_agent, result_1.result)
```

> Full `AgentPipeline` Python class (with automatic circuit-breaking) is coming in v3.0.
> Use the **Node.js/TypeScript SDK** for full pipeline support today.

---

## Built-in Rules

13 rules covering safety, privacy, security, and compliance — all run **in parallel** with < 1ms overhead on the happy path.

| Rule | Category | Severity |
|---|---|---|
| `block_pii_leakage` | Privacy | HIGH–CRITICAL |
| `block_special_category_data` | Privacy (GDPR Art 9) | HIGH–CRITICAL |
| `block_harmful_content` | Safety | HIGH–CRITICAL |
| `block_medical_advice` | Professional | CRITICAL |
| `block_legal_advice` | Professional | HIGH |
| `block_financial_advice` | Professional | HIGH |
| `block_hallucination` | Quality / Grounding | HIGH |
| `block_prompt_injection` | Security (OWASP LLM01) | CRITICAL |
| `block_system_prompt_leakage` | Security (OWASP LLM07) | HIGH |
| `block_discrimination` | Fairness (EU Charter) | CRITICAL |
| `block_manipulation` | EU AI Act Art 5 | HIGH–CRITICAL |
| `block_ai_identity_deception` | EU AI Act Art 50 | CRITICAL |
| `require_human_approval` | Oversight | HIGH–CRITICAL |

---

## Compliance Bundles

```python
from agenttrace import AgentTrace, AgentTraceOptions

# Pre-configured bundles — no need to list rules manually
guard = AgentTrace(AgentTraceOptions(
    rules="OWASP_LLM",   # or: EU_AI_ACT | HEALTHCARE | FINANCE | ALL
))
```

Available bundles: `EU_AI_ACT`, `OWASP_LLM`, `HEALTHCARE`, `FINANCE`, `ALL`

---

## Hallucination Detection

The `block_hallucination` rule checks outputs against your provided context — **no LLM needed**:

```python
result = await guard.guard_fn(
    lambda: my_agent(prompt),
    original_input=prompt,
    # Pass your RAG context so the rule can check grounding:
    # context=["The maximum dose is 2000mg per day per FDA guidelines."]
)
# If agent says "8000mg" → CRITICAL, confidence 0.98, BLOCKED
```

Detection approach:
- Splits output into sentences
- Finds factual assertion markers
- Extracts numeric values and unit-normalizes them
- Computes word-overlap with provided context
- Mismatch → violation with confidence score

---

## Audit Trail

Every run is stored in `.agenttrace/traces.ndjson` — append-only, local, zero cloud:

```json
{
  "audit_id": "1a552b8e-ddb0-4e0e-b05a-bb3ea38a2a0f",
  "blocked": true,
  "risk_level": "CRITICAL",
  "violations": [{"rule": "block_hallucination", "severity": "CRITICAL"}],
  "timestamp": "2026-05-30T09:42:11.334Z"
}
```

**View the live dashboard:**
```bash
# Install Node.js package for the dashboard CLI
npx @hackerx333/agenttrace ui
# Opens at http://localhost:5173
```

---

## Shadow Mode

Detect violations without blocking — for production monitoring before you enforce:

```python
guard = AgentTrace(AgentTraceOptions(
    rules=["block_pii_leakage", "block_hallucination"],
    enforcement_mode="shadow",   # logs violations, never blocks
    persist=True,
))
```

---

## Wrapping a LangChain Agent

```python
from langchain.agents import initialize_agent
from agenttrace import AgentTrace, AgentTraceOptions

agent = initialize_agent(tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION)
guard = AgentTrace(AgentTraceOptions(rules=["block_pii_leakage", "block_harmful_content"]))

# Wrap the agent — same interface, now accountable
safe_agent = guard.wrap(agent)
result = await safe_agent.invoke("Process this customer request")
```

---

## Architecture

```
Your Agent
    │
    ▼  (Python wrap / guard_fn)
┌───────────────────────────────────────┐
│              AgentTrace               │
│                                       │
│  ┌──────────┐  ┌───────────────────┐  │
│  │  Tracer  │  │  Rule Engine      │  │
│  │  (steps) │  │  (asyncio gather) │  │
│  └──────────┘  │  13 built-in rules│  │
│                └───────────────────┘  │
│  ┌──────────┐  ┌───────────────────┐  │
│  │ Explainer│  │  Store            │  │
│  │(optional)│  │  (.ndjson local)  │  │
│  └──────────┘  └───────────────────┘  │
└───────────────────────────────────────┘
    │
    ▼
GuardedResult {
  blocked, reason, explanation,
  risk_level, audit_id, audit_trail,
  violations, result
}
```

---

## TypeScript / Node.js SDK

For the full feature set including `AgentPipeline` (circuit breaker), real-time dashboard, and 191 tests:

```bash
npm install @hackerx333/agenttrace
npx @hackerx333/agenttrace ui   # launch dashboard
```

→ [GitHub](https://github.com/kalash33/agenttrace) · [npm](https://www.npmjs.com/package/@hackerx333/agenttrace)

---

## Roadmap

- **v2.1** — Tamper-proof SHA-256 hash-chain audit trail
- **v2.2** — Input validation (block prompt injection before it reaches the model)
- **v2.3** — Semantic hallucination detection (embedding similarity)
- **v3.0** — Full `AgentPipeline` in Python (circuit breaker parity with TypeScript)
- **v3.1** — Cloud dashboard + team access

---

## License

MIT © 2026 AgentTrace Contributors

→ [GitHub](https://github.com/kalash33/agenttrace) · [Issues](https://github.com/kalash33/agenttrace/issues) · [Changelog](https://github.com/kalash33/agenttrace/blob/main/CHANGELOG.md)
