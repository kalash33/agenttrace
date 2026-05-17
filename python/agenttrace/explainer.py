import os
import json
from typing import Any, List, Optional
from openai import AsyncOpenAI
from .types import ExplainerProvider, Trace, Violation

class NoOpExplainer(ExplainerProvider):
    async def explain_allow(self, result: Any, trace: Trace) -> str:
        return "Action completed successfully and passed all safety checks."
        
    async def explain_block(self, violations: List[Violation], trace: Trace) -> str:
        rules_str = ", ".join(v.rule for v in violations)
        return f"Action BLOCKED. Violated rule(s): {rules_str}. Human review required."

class OpenAICompatibleExplainer(ExplainerProvider):
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, model: Optional[str] = None):
        # Default to Featherless if available
        featherless_key = os.environ.get("FEATHERLESS_API_KEY")
        openai_key = os.environ.get("OPENAI_API_KEY")
        
        self.api_key = api_key or featherless_key or openai_key
        self.base_url = base_url or ("https://api.featherless.ai/v1" if featherless_key else None)
        self.model = model or ("deepseek-ai/DeepSeek-R1-Distill-Qwen-14B" if featherless_key else "gpt-3.5-turbo")
        
        if self.api_key:
            self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        else:
            self.client = None

    async def explain_allow(self, result: Any, trace: Trace) -> str:
        if not self.client:
            return await NoOpExplainer().explain_allow(result, trace)
            
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system", 
                        "content": "You are an AI decision auditor. Explain WHY the agent produced this output in 2-3 sentences. Mention key factors, reasoning pattern, and confidence level. Write for a non-technical person."
                    },
                    {
                        "role": "user",
                        "content": f"TASK: {json.dumps(trace.original_input)}\nSTEPS TAKEN: {json.dumps([s.model_dump() for s in trace.steps])}\nFINAL OUTPUT: {json.dumps(result)}"
                    }
                ],
                max_tokens=300
            )
            return response.choices[0].message.content or await NoOpExplainer().explain_allow(result, trace)
        except Exception as e:
            return await NoOpExplainer().explain_allow(result, trace)

    async def explain_block(self, violations: List[Violation], trace: Trace) -> str:
        if not self.client:
            return await NoOpExplainer().explain_block(violations, trace)
            
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system", 
                        "content": "You are an AI compliance officer. Explain WHY this agent action was BLOCKED. Be clear, authoritative, and mention the specific rule violation."
                    },
                    {
                        "role": "user",
                        "content": f"VIOLATIONS: {json.dumps([v.model_dump() for v in violations])}\nATTEMPTED ACTION: {trace.last_action}"
                    }
                ],
                max_tokens=300
            )
            return response.choices[0].message.content or await NoOpExplainer().explain_block(violations, trace)
        except Exception:
            return await NoOpExplainer().explain_block(violations, trace)
