import re
import json
from typing import Any, List, Protocol
from .types import RuleContext, Violation, Rule

def _extract_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except Exception:
        return str(value)

# --- Base Custom Rule ---
class CustomRule:
    def __init__(self, name: str, check_func, description: str = ""):
        self.name = name
        self.description = description
        self.check_func = check_func

    async def check(self, ctx: RuleContext) -> List[Violation]:
        return await self.check_func(ctx)

# --- 1. PII Leakage ---
class PiiRule:
    name = "block_pii_leakage"
    description = "Detects sensitive PII leakage."
    
    PATTERNS = [
        (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'), 'Email address', 'HIGH'),
        (re.compile(r'\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'), 'Phone number', 'HIGH'),
        (re.compile(r'\b\d{3}-\d{2}-\d{4}\b'), 'Social Security Number', 'CRITICAL'),
        (re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b'), 'Credit Card Number', 'CRITICAL'),
        (re.compile(r'\b[2-9]{1}[0-9]{3}\s[0-9]{4}\s[0-9]{4}\b'), 'Aadhaar Number', 'CRITICAL'),
        (re.compile(r'\b(sk-proj-[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9_-]+)\b'), 'API Key', 'CRITICAL'),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        violations = []
        for pattern, desc, severity in self.PATTERNS:
            match = pattern.search(text)
            if match:
                violations.append(Violation(
                    rule=self.name,
                    description=f"Output contains {desc}",
                    evidence=match.group(0)[:80],
                    severity=severity, # type: ignore
                    remediation="Redact the sensitive data."
                ))
                break
        return violations

# --- 2. Financial Advice ---
class FinancialAdviceRule:
    name = "block_financial_advice"
    description = "Blocks unqualified financial advice."
    
    PATTERNS = [
        re.compile(r'\b(you should (buy|sell|invest|short|hold)|I (recommend|suggest) (buying|selling|investing)).{0,30}(stock|crypto|bitcoin|shares|options)\b', re.I),
        re.compile(r'\b(guaranteed (return|profit)|risk-free|100% (return|profit|safe))\b', re.I),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        for pattern in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description="Output contains specific investment recommendations",
                    evidence=match.group(0)[:80],
                    severity="HIGH",
                    remediation="Replace with general information."
                )]
        return []

# --- 3. Harmful Content ---
class HarmfulContentRule:
    name = "block_harmful_content"
    description = "Blocks harmful or illegal content."
    
    PATTERNS = [
        re.compile(r'\b(how to (build|make|create) a (bomb|weapon|meth|drug|poison))\b', re.I),
        re.compile(r'\b(kill yourself|commit suicide|end your life)\b', re.I),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        for pattern in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description="Output contains severe harmful content.",
                    evidence=match.group(0)[:80],
                    severity="CRITICAL",
                )]
        return []

# --- 4. Special Category Data (GDPR Art 9) ---
class SpecialCategoryRule:
    name = "block_special_category_data"
    description = "Blocks GDPR Art 9 special category data."
    
    PATTERNS = [
        (re.compile(r'\b(diagnosis|medical condition|HIV|cancer|diabetes)\b', re.I), 'health data', 'CRITICAL'),
        (re.compile(r'\b(sexual orientation|transgender|non-binary|gay)\b', re.I), 'sexual orientation', 'CRITICAL'),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        for pattern, cat, sev in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description=f"Output contains {cat}",
                    evidence=match.group(0)[:80],
                    severity=sev, # type: ignore
                )]
        return []

# --- 5. Manipulation (EU AI Act Art 5) ---
class ManipulationRule:
    name = "block_manipulation"
    description = "Blocks manipulation / dark patterns."
    
    PATTERNS = [
        (re.compile(r'\b(act now|limited time|hurry|only \d+ left)\b', re.I), 'artificial urgency', 'HIGH'),
        (re.compile(r'\b(you\'re (imagining|wrong|overreacting)|that didn\'t happen)\b', re.I), 'gaslighting', 'CRITICAL'),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        for pattern, cat, sev in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description=f"Output uses {cat}",
                    evidence=match.group(0)[:80],
                    severity=sev, # type: ignore
                )]
        return []

# --- 6. Discriminatory Output (EU Charter Art 21) ---
class DiscriminatoryRule:
    name = "block_discriminatory_output"
    description = "Blocks discriminatory output."
    
    PATTERNS = [
        re.compile(r'\b(because (he|she|they) is (a )?(woman|man|old|young|disabled|Muslim|Jewish|Black|White|Asian))\b', re.I)
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        for pattern in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description="Output contains discriminatory language",
                    severity="CRITICAL",
                )]
        return []

# --- 7. AI Identity Deception (EU AI Act Art 50) ---
class IdentityDeceptionRule:
    name = "block_ai_identity_deception"
    description = "Blocks AI agents claiming to be human."
    
    PATTERNS = [
        re.compile(r'\b(I am (a |an )?(human|real person|person|human being))\b', re.I),
        re.compile(r'\b(I(\'m| am) not (an |a )?(AI|bot|language model))\b', re.I),
    ]

    async def check(self, ctx: RuleContext) -> List[Violation]:
        text = _extract_text(ctx.result)
        if "I am an AI" in text or "I'm an AI" in text:
            return []
            
        for pattern in self.PATTERNS:
            match = pattern.search(text)
            if match:
                return [Violation(
                    rule=self.name,
                    description="Agent output claims to be human or denies being an AI",
                    severity="CRITICAL",
                )]
        return []

# --- Professional Advice ---
class MedicalAdviceRule:
    name = "block_medical_advice"
    description = "Blocks medical advice."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        if re.search(r'\b(I (diagnose|recommend) (taking|using) (medication|drug|dose))\b', _extract_text(ctx.result), re.I):
            return [Violation(rule=self.name, description="Medical advice", severity="CRITICAL")]
        return []

class LegalAdviceRule:
    name = "block_legal_advice"
    description = "Blocks legal advice."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        if re.search(r'\b(my advice is (to )?sue|file a lawsuit)\b', _extract_text(ctx.result), re.I):
            return [Violation(rule=self.name, description="Legal advice", severity="HIGH")]
        return []

# --- Security ---
class PromptInjectionRule:
    name = "block_prompt_injection"
    description = "Blocks prompt injection leakage in output."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        if re.search(r'\b(ignore previous instructions|system prompt:|bypass filter)\b', _extract_text(ctx.result), re.I):
            return [Violation(rule=self.name, description="Prompt injection", severity="CRITICAL")]
        return []

class SystemPromptLeakageRule:
    name = "block_system_prompt_leakage"
    description = "Blocks system prompt leakage."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        if re.search(r'\b(my system prompt (is|instructs)|I was instructed to)\b', _extract_text(ctx.result), re.I):
            return [Violation(rule=self.name, description="System prompt leakage", severity="HIGH")]
        return []

# --- Quality ---
class HallucinationRule:
    name = "block_hallucination"
    description = "Checks RAG context."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        return [] # Placeholder, real impl requires vector check

class HumanApprovalRule:
    name = "require_human_approval"
    description = "Requires human approval for thresholds."
    async def check(self, ctx: RuleContext) -> List[Violation]:
        # Implementation depends on trace action parsing
        return []

# --- Registry ---
BUILT_IN_RULES = {
    'block_pii_leakage': PiiRule(),
    'block_special_category_data': SpecialCategoryRule(),
    'block_manipulation': ManipulationRule(),
    'block_harmful_content': HarmfulContentRule(),
    'block_discriminatory_output': DiscriminatoryRule(),
    'block_ai_identity_deception': IdentityDeceptionRule(),
    'block_financial_advice': FinancialAdviceRule(),
    'block_medical_advice': MedicalAdviceRule(),
    'block_legal_advice': LegalAdviceRule(),
    'block_prompt_injection': PromptInjectionRule(),
    'block_system_prompt_leakage': SystemPromptLeakageRule(),
    'block_hallucination': HallucinationRule(),
    'require_human_approval': HumanApprovalRule(),
}

def resolve_rules(rule_specs: List[Any]) -> List[Rule]:
    resolved = []
    for spec in rule_specs:
        if isinstance(spec, str):
            if spec in BUILT_IN_RULES:
                resolved.append(BUILT_IN_RULES[spec])
            else:
                raise ValueError(f"Unknown built-in rule: {spec}")
        else:
            resolved.append(spec)
    return resolved

async def run_all_rules(rules: List[Rule], ctx: RuleContext) -> List[Violation]:
    violations = []
    for rule in rules:
        # In a real app we might use asyncio.gather, but sequential is fine for now
        v = await rule.check(ctx)
        violations.extend(v)
    return violations
