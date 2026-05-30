---
name: Rule Request
about: Suggest a new compliance rule for AgentTrace
title: '[RULE] '
labels: rule-request
assignees: ''
---

## What should this rule detect?
A clear description of what agent behavior the rule should catch.

## Why does this matter?
Real-world scenario where this rule would have prevented damage.

## Example — should be BLOCKED
```
// Input or agent output that should trigger this rule
```

## Example — should be ALLOWED
```
// Similar input that should pass through without triggering
```

## Suggested rule name
Something like `block_financial_advice` or `block_pii_leakage`.

## Severity
- [ ] LOW
- [ ] MEDIUM  
- [ ] HIGH
- [ ] CRITICAL

## Additional context
Any compliance standard, framework, or regulation this rule relates to (OWASP LLM, EU AI Act, HIPAA, etc.)
