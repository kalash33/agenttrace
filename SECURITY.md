# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 2.x | ✅ Active |
| 1.x | ❌ End of life |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues directly to the maintainer:

1. Open a [GitHub Security Advisory](https://github.com/kalash33/agenttrace/security/advisories/new) (private)
2. Include: description, steps to reproduce, potential impact, suggested fix if any

**Response time:** Within 48 hours for acknowledgement, patch within 7 days for confirmed vulnerabilities.

## Scope

AgentTrace is a local-first tool — it does not send data to any external service. Security issues in scope:

- Rule bypass vulnerabilities (inputs that should be blocked but aren't)
- Prompt injection in the rule evaluation engine itself
- Audit trail tampering or forgery
- Dependency vulnerabilities with known exploits

## Out of Scope

- Issues in the demo dashboard that don't affect the SDK
- Theoretical attacks with no practical exploit
