# Contributing to AgentTrace

First off — thank you. AgentTrace is MIT-licensed and community contributions are what make it better.

## Quick Start

```bash
git clone https://github.com/kalash33/agenttrace
cd agenttrace
npm install
npm test         # run all 191 tests
npm run build    # build the SDK
```

## How to Contribute

### 🐛 Reporting Bugs

Open an issue using the **Bug Report** template. Include:
- AgentTrace version (`npm list @hackerx333/agenttrace`)
- Node.js version
- Minimal reproduction snippet
- What you expected vs what happened

### 💡 Suggesting a New Rule

The most impactful contribution. Open an issue using **Rule Request** and include:
- What the rule should detect
- Why it matters (real-world scenario)
- Example input that should be BLOCKED
- Example input that should be ALLOWED

### 🔧 Submitting a Pull Request

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-rule-name`
3. Write the rule in `src/rules/`
4. Add tests in `tests/` (we require tests for all new rules)
5. Run `npm test` — all tests must pass
6. Open a PR against `main`

### Writing a New Rule

Each rule lives in `src/rules/` and implements the `Rule` interface:

```typescript
export interface Rule {
  name: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evaluate(context: RuleContext): Promise<RuleResult>;
}
```

See `src/rules/block_hallucination.ts` for a reference implementation.

## Code Style

- TypeScript strict mode
- No external runtime dependencies in the core SDK
- Every rule must have unit tests with both BLOCK and ALLOW cases
- Plain-English `description` in every `RuleResult` — no jargon

## What We Won't Merge

- Rules that require an LLM call (keeps overhead < 1ms)
- Cloud dependencies in the core SDK
- Breaking changes to the `AgentTrace` public API without discussion

## Questions?

Open a Discussion or email the maintainer. Response time: < 24 hours.
