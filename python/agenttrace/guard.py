import uuid
import inspect
from datetime import datetime
from typing import Any, Callable, Coroutine, Dict, Optional

from .types import AgentTraceOptions, GuardedResult, RuleContext, Trace, TraceStep
from .rules import resolve_rules, run_all_rules
from .explainer import NoOpExplainer, OpenAICompatibleExplainer
from .store import Store

class AgentTrace:
    def __init__(self, options: AgentTraceOptions):
        self.options = options
        self.rules = resolve_rules(options.rules)
        
        if options.explain:
            self.explainer = OpenAICompatibleExplainer()
        else:
            self.explainer = NoOpExplainer()
            
        self.store = Store(options.storage_path) if options.persist else None

    async def guard_fn(self, func: Callable[..., Coroutine[Any, Any, Any]], original_input: Any, *args, **kwargs) -> GuardedResult:
        trace_id = str(uuid.uuid4())
        trace = Trace(
            id=trace_id,
            started_at=datetime.utcnow().isoformat() + "Z",
            original_input=original_input,
            last_action=func.__name__
        )
        
        start_time = datetime.utcnow()
        try:
            result = await func(*args, **kwargs)
        except Exception as e:
            # Re-raise exceptions from the agent
            raise e
            
        duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        trace.steps.append(TraceStep(
            step_index=1,
            timestamp=datetime.utcnow().isoformat() + "Z",
            action=func.__name__,
            input=original_input,
            output=result,
            duration_ms=duration
        ))

        ctx = RuleContext(
            result=result,
            trace=trace,
            guard_options=self.options
        )
        
        violations = await run_all_rules(self.rules, ctx)
        
        if violations:
            # Blocked
            explanation = await self.explainer.explain_block(violations, trace)
            highest_severity = "CRITICAL" if any(v.severity == "CRITICAL" for v in violations) else "HIGH"
            
            guarded_result = GuardedResult(
                audit_id=trace.id,
                blocked=True,
                reason=explanation,
                explanation=explanation,
                risk_level=highest_severity, # type: ignore
                audit_trail=trace.steps,
                violations=violations,
                timestamp=datetime.utcnow().isoformat() + "Z",
                metadata=self.options.metadata
            )
        else:
            # Allowed
            explanation = await self.explainer.explain_allow(result, trace)
            
            guarded_result = GuardedResult(
                audit_id=trace.id,
                blocked=False,
                explanation=explanation,
                risk_level="LOW",
                audit_trail=trace.steps,
                result=result,
                timestamp=datetime.utcnow().isoformat() + "Z",
                metadata=self.options.metadata
            )
            
        if self.store:
            self.store.save(guarded_result)
            
        return guarded_result

    def wrap(self, agent: Any) -> Any:
        """
        Creates a proxy-like wrapper around an agent instance.
        Intercepts 'invoke', 'run', 'chat', etc.
        """
        class AgentProxy:
            def __init__(self, target, guard):
                self._target = target
                self._guard = guard
                
            def __getattr__(self, name):
                target_attr = getattr(self._target, name)
                
                if name in ['invoke', 'run', 'chat', 'generate', 'call', '__call__'] and inspect.iscoroutinefunction(target_attr):
                    async def wrapper(*args, **kwargs):
                        # Extract first arg as the input for tracing if possible
                        original_input = args[0] if args else kwargs
                        return await self._guard.guard_fn(target_attr, original_input, *args, **kwargs)
                    return wrapper
                return target_attr
                
            async def __call__(self, *args, **kwargs):
                if inspect.iscoroutinefunction(self._target) or (hasattr(self._target, '__call__') and inspect.iscoroutinefunction(self._target.__call__)):
                    original_input = args[0] if args else kwargs
                    target_func = self._target if inspect.iscoroutinefunction(self._target) else self._target.__call__
                    return await self._guard.guard_fn(target_func, original_input, *args, **kwargs)
                raise TypeError("Wrapped target is not an async callable.")
                
        return AgentProxy(agent, self)
