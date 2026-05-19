# AgentTrace - Release & Product Roadmap

## 🚀 Current v1.0.0 Status (Ready for Release)
We have successfully built the ultimate open-source accountability layer for AI agents. The current feature set is production-ready and includes:
- **Multi-Language Support**: Feature parity across TypeScript (Node.js) and Python SDKs.
- **Framework Agnostic**: Drop-in compatibility with LangChain, Vercel AI SDK, CrewAI, and custom classes via the `trace.wrap()` proxy.
- **Rule Engines**: 13 high-stakes rules (PII, Financial Advice, Hallucinations, EU AI Act, OWASP).
- **AI Explainer Engine**: Uses Featherless/OpenAI/Anthropic to generate non-technical, plain-English justifications for blocks.
- **Shadow Mode**: Enterprise dry-run feature (`enforcementMode: 'shadow'`) to flag violations without breaking production.
- **Global Configs**: Automatic resolution of `agenttrace.config.json` for per-project compliance settings.
- **React Dashboard**: A premium local dashboard (`agenttrace-ui`) that unifies both TS and Python logs into beautiful charts and timelines.

## 📦 Release Strategy (Next Steps)
1. **Package Refinement**:
   - Rename `package.json` to `@agenttrace/sdk` or `agenttrace`.
   - Update `pyproject.toml` or `setup.py` to `agenttrace`.
   - Ensure `README.md` is spectacular with GIFs of the dashboard.
2. **Build Process**:
   - Run `tsup` for TS to generate CommonJS & ESM bundles.
   - Build Python wheels via `poetry build`.
3. **Publishing**:
   - Run `npm publish --access public`
   - Run `twine upload dist/*`
4. **Marketing Launch**:
   - **Hacker News**: Post titled *"Show HN: We built an open-source accountability layer for AI agents"*
   - **Video Demo**: A 45-second Loom demonstrating an agent attempting to give illegal financial advice, being blocked by AgentTrace, and the compliance officer viewing the AI explanation in the React Dashboard.

## 🔮 Future Features Roadmap
To make this the absolute best SDK on the market, we plan to implement the following features post-v1 launch:

### 1. Context-Aware PII Redaction
- **Feature**: Instead of completely blocking an action if PII is detected, the SDK intercepts the output and masks sensitive data (`John's SSN is ***-**-****`) while allowing the safe content through.

### 2. Token / Financial Hard Caps
- **Feature**: `block_budget_exceeded` rule. Monitors the cumulative LLM cost within a single trace. If an agent enters an infinite loop and burns through $5.00, it is forcefully terminated.

### 3. Cloud SaaS Dashboard (Enterprise Tier)
- **Feature**: A hosted platform (`app.agenttrace.ai`). Developers set `persist: "cloud"` and provide an `AGENTTRACE_API_KEY`. The SDK transmits logs via background workers to a centralized dashboard where teams can manage compliance across hundreds of production agents.

### 4. Human-in-the-Loop Webhooks
- **Feature**: When `require_human_approval` is triggered, instead of just blocking, the SDK fires a webhook to a Slack/Teams channel. A human manager clicks "Approve" or "Reject", and the promise resolves with their decision.
