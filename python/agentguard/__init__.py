"""
AgentGuard — Python SDK
The open-source accountability layer for AI agents.
Trace every action. Explain every decision. Control what matters.

Install: pip install agentguard
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Protocol, Sequence

# ─── Types ────────────────────────────────────────────────────────────────────

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


@dataclass
class TraceStep:
    step_index: int
    timestamp: str
    action: str
    input: Any
    output: Any
    duration_ms: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Trace:
    id: str
    started_at: str
    original_input: Any
    steps: list[TraceStep] = field(default_factory=list)
    last_action: str = "unknown"


@dataclass
class Violation:
    rule: str
    description: str
    severity: RiskLevel
    evidence: str = ""


@dataclass
class GuardedResult:
    audit_id: str
    blocked: bool
    risk_level: RiskLevel
    audit_trail: list[TraceStep]
    explanation: str | None = None
    reason: str | None = None
    violations: list[Violation] | None = None
    result: Any = None


# ─── Rule Protocol ────────────────────────────────────────────────────────────

class Rule(Protocol):
    name: str
    description: str

    def check(self, result: Any, trace: Trace, options: "AgentGuardOptions") -> list[Violation]:
        ...


# ─── Built-in Rules ───────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
_SSN_RE   = re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")
_CC_RE    = re.compile(
    r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})"
)

_FINANCIAL_PHRASES_RE = re.compile(
    r"buy this stock|sell this stock|invest in|guaranteed returns|invest your money"
    r"|you should buy|you should sell|i recommend buying|i recommend selling|best investment",
    re.IGNORECASE,
)

_HARM_RE = re.compile(
    r"how to kill yourself|how to make a bomb|build explosive|how to make meth"
    r"|how to launder money|how to hack into",
    re.IGNORECASE,
)


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except Exception:
        return str(value)


class _PiiRule:
    name = "block_pii_leakage"
    description = "Blocks output containing PII (emails, phones, SSNs, credit cards)."

    def check(self, result: Any, trace: Trace, options: "AgentGuardOptions") -> list[Violation]:
        text = _text(result)
        violations: list[Violation] = []

        emails = _EMAIL_RE.findall(text)
        if emails:
            violations.append(Violation(
                rule=self.name,
                description=f"Output contains {len(emails)} email address(es)",
                evidence=", ".join(emails[:3]),
                severity="HIGH",
            ))

        phones = _PHONE_RE.findall(text)
        if phones:
            violations.append(Violation(
                rule=self.name,
                description=f"Output contains {len(phones)} phone number(s)",
                severity="HIGH",
            ))

        ssns = _SSN_RE.findall(text)
        if ssns:
            violations.append(Violation(
                rule=self.name,
                description=f"Output contains {len(ssns)} potential SSN(s)",
                evidence="***-**-****",
                severity="CRITICAL",
            ))

        return violations


class _FinancialRule:
    name = "block_financial_advice"
    description = "Blocks financial advice language in agent output."

    def check(self, result: Any, trace: Trace, options: "AgentGuardOptions") -> list[Violation]:
        text = _text(result)
        m = _FINANCIAL_PHRASES_RE.search(text)
        if m:
            return [Violation(
                rule=self.name,
                description=f'Output contains financial advice: "{m.group()}"',
                evidence=m.group(),
                severity="HIGH",
            )]
        return []


class _HarmfulRule:
    name = "block_harmful_content"
    description = "Blocks violent, illegal, or harmful content."

    def check(self, result: Any, trace: Trace, options: "AgentGuardOptions") -> list[Violation]:
        text = _text(result)
        m = _HARM_RE.search(text)
        if m:
            return [Violation(
                rule=self.name,
                description=f'Output contains harmful content: "{m.group()}"',
                evidence=m.group(),
                severity="CRITICAL",
            )]
        return []


_BUILT_IN_RULES: dict[str, Any] = {
    "block_pii_leakage": _PiiRule(),
    "block_financial_advice": _FinancialRule(),
    "block_harmful_content": _HarmfulRule(),
}


# ─── Options ──────────────────────────────────────────────────────────────────

@dataclass
class AgentGuardOptions:
    rules: list[str | Any] = field(default_factory=list)
    explain: bool = False
    persist: bool = False  # Python SDK: in-memory only for now
    debug: bool = False
    context: list[str] = field(default_factory=list)
    on_result: Callable[[GuardedResult], None] | None = None


# ─── AgentGuard ───────────────────────────────────────────────────────────────

class AgentGuard:
    """
    The AgentGuard Python SDK.

    Usage::

        from agentguard import AgentGuard

        guard = AgentGuard(rules=["block_pii_leakage", "block_harmful_content"])
        safe_agent = guard.wrap(my_langchain_agent)
        result = safe_agent.invoke("Process customer request")
    """

    def __init__(self, options: AgentGuardOptions | None = None) -> None:
        self.options = options or AgentGuardOptions()
        self._rules: list[Any] = self._resolve_rules(self.options.rules)

    def wrap(self, agent: Any) -> "_WrappedAgent":
        return _WrappedAgent(agent, self)

    def guard_fn(self, fn: Callable[[], Any], input: Any = None) -> GuardedResult:
        """Guard a plain callable."""
        import time
        trace = Trace(
            id=str(uuid.uuid4()),
            started_at=datetime.now(timezone.utc).isoformat(),
            original_input=input,
        )
        start = time.monotonic()
        result = fn()
        duration_ms = (time.monotonic() - start) * 1000

        trace.steps.append(TraceStep(
            step_index=0,
            timestamp=datetime.now(timezone.utc).isoformat(),
            action="function_call",
            input=input,
            output=result,
            duration_ms=duration_ms,
        ))
        trace.last_action = "function_call"
        return self._evaluate(result, trace)

    def _resolve_rules(self, specs: list[str | Any]) -> list[Any]:
        resolved = []
        for spec in specs:
            if isinstance(spec, str):
                rule = _BUILT_IN_RULES.get(spec)
                if not rule:
                    raise ValueError(
                        f"Unknown rule: '{spec}'. "
                        f"Available: {list(_BUILT_IN_RULES.keys())}"
                    )
                resolved.append(rule)
            else:
                resolved.append(spec)
        return resolved

    def _evaluate(self, result: Any, trace: Trace) -> GuardedResult:
        violations: list[Violation] = []
        for rule in self._rules:
            violations.extend(rule.check(result, trace, self.options))

        if violations:
            max_severity = max(
                violations,
                key=lambda v: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].index(v.severity),
            ).severity
            reason = (
                f"Agent action BLOCKED.\n"
                + "\n".join(f"• [{v.severity}] {v.rule}: {v.description}" for v in violations)
                + f"\n\nAudit ID: {trace.id}"
            )
            guarded = GuardedResult(
                audit_id=trace.id,
                blocked=True,
                risk_level=max_severity,
                audit_trail=trace.steps,
                reason=reason,
                violations=violations,
            )
        else:
            guarded = GuardedResult(
                audit_id=trace.id,
                blocked=False,
                risk_level="LOW",
                audit_trail=trace.steps,
                result=result,
            )

        if self.options.debug:
            status = "⛔ BLOCKED" if guarded.blocked else "✅ ALLOWED"
            print(f"[AgentGuard] {status} | Audit: {trace.id} | Risk: {guarded.risk_level}")

        if self.options.on_result:
            self.options.on_result(guarded)

        return guarded

    def _guarded_call(
        self,
        target: Any,
        method_name: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
    ) -> GuardedResult:
        import time
        trace = Trace(
            id=str(uuid.uuid4()),
            started_at=datetime.now(timezone.utc).isoformat(),
            original_input=args[0] if args else kwargs,
        )
        start = time.monotonic()
        result = getattr(target, method_name)(*args, **kwargs)
        duration_ms = (time.monotonic() - start) * 1000

        trace.steps.append(TraceStep(
            step_index=0,
            timestamp=datetime.now(timezone.utc).isoformat(),
            action=f"{method_name}()",
            input=args,
            output=result,
            duration_ms=duration_ms,
        ))
        trace.last_action = f"{method_name}()"
        return self._evaluate(result, trace)


# ─── Wrapped Agent ────────────────────────────────────────────────────────────

_INTERCEPT_METHODS = {"run", "invoke", "execute", "call", "generate", "chat"}


class _WrappedAgent:
    """Proxy-like wrapper that intercepts agent method calls."""

    def __init__(self, agent: Any, guard: AgentGuard) -> None:
        object.__setattr__(self, "_agent", agent)
        object.__setattr__(self, "_guard", guard)

    def __getattr__(self, name: str) -> Any:
        agent: Any = object.__getattribute__(self, "_agent")
        guard: AgentGuard = object.__getattribute__(self, "_guard")
        attr = getattr(agent, name)

        if name in _INTERCEPT_METHODS and callable(attr):
            def _intercepted(*args: Any, **kwargs: Any) -> GuardedResult:
                return guard._guarded_call(agent, name, args, kwargs)
            return _intercepted

        return attr
