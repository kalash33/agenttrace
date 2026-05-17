from typing import Any, Dict, List, Literal, Optional, Protocol, Union
from datetime import datetime
from pydantic import BaseModel, Field

RiskLevel = Literal['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

class TraceStep(BaseModel):
    step_index: int
    timestamp: str
    action: str
    input: Any
    output: Any
    duration_ms: int
    metadata: Optional[Dict[str, Any]] = None

class Trace(BaseModel):
    id: str
    started_at: str
    original_input: Any
    steps: List[TraceStep] = Field(default_factory=list)
    last_action: str = ""
    token_usage: Optional[Dict[str, int]] = None

class AgentTraceOptions(BaseModel):
    rules: List[Union[str, 'Rule']] = Field(default_factory=list)
    explain: bool = False
    persist: bool = True
    storage_path: str = ".agenttrace/traces.ndjson"
    human_approval_threshold: Optional[float] = 1000.0
    context: Optional[List[str]] = None
    debug: bool = False
    metadata: Optional[Dict[str, Any]] = None

class RuleContext(BaseModel):
    result: Any
    trace: Trace
    guard_options: AgentTraceOptions

class Violation(BaseModel):
    rule: str
    description: str
    evidence: Optional[str] = None
    severity: RiskLevel
    remediation: Optional[str] = None

class Rule(Protocol):
    name: str
    description: str
    
    async def check(self, ctx: RuleContext) -> List[Violation]:
        ...

class ExplainerProvider(Protocol):
    async def explain_allow(self, result: Any, trace: Trace) -> str:
        ...
        
    async def explain_block(self, violations: List[Violation], trace: Trace) -> str:
        ...

class GuardedResult(BaseModel):
    audit_id: str
    blocked: bool
    reason: Optional[str] = None
    explanation: Optional[str] = None
    risk_level: RiskLevel
    audit_trail: List[TraceStep] = Field(default_factory=list)
    violations: Optional[List[Violation]] = None
    result: Optional[Any] = None
    timestamp: str
    metadata: Optional[Dict[str, Any]] = None
