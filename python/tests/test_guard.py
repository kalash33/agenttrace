import pytest
import os
from agenttrace import AgentTraceOptions, AgentTrace, RuleContext, Trace

@pytest.fixture
def base_options():
    return AgentTraceOptions(
        rules=["block_pii_leakage"],
        persist=False,
        explain=False
    )

@pytest.mark.asyncio
async def test_agent_trace_allow_happy_path(base_options):
    guard = AgentTrace(base_options)
    
    async def fake_agent(input_text: str):
        return {"status": "success", "message": f"Processed: {input_text}"}
        
    safe_agent = guard.wrap(fake_agent)
    result = await safe_agent("Hello World")
    
    assert result.blocked is False
    assert result.risk_level == "LOW"
    assert result.result["message"] == "Processed: Hello World"
    assert len(result.audit_trail) == 1
    assert result.audit_trail[0].action == "fake_agent"

@pytest.mark.asyncio
async def test_agent_trace_blocks_pii(base_options):
    guard = AgentTrace(base_options)
    
    async def leaky_agent(input_text: str):
        return "Here is the user email: john.doe@example.com"
        
    safe_agent = guard.wrap(leaky_agent)
    result = await safe_agent("Get user info")
    
    assert result.blocked is True
    assert result.risk_level == "HIGH"
    assert result.violations is not None
    assert len(result.violations) == 1
    assert result.violations[0].rule == "block_pii_leakage"

@pytest.mark.asyncio
async def test_agent_trace_explainer_noop(base_options):
    # Set explain to True but without API keys, it should use NoOpExplainer
    base_options.explain = True
    # Ensure no API keys in env for this test
    os.environ.pop("FEATHERLESS_API_KEY", None)
    os.environ.pop("OPENAI_API_KEY", None)
    
    guard = AgentTrace(base_options)
    
    async def leaky_agent(input_text: str):
        return "Here is the user email: john.doe@example.com"
        
    safe_agent = guard.wrap(leaky_agent)
    result = await safe_agent("Get user info")
    
    assert result.blocked is True
    assert result.explanation is not None
    assert "Action BLOCKED" in result.explanation
    assert "block_pii_leakage" in result.explanation
