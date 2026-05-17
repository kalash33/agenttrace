import type { Rule, RuleContext, Violation } from '../types.js';
import { blockPiiLeakage } from './pii.js';
import { blockFinancialAdvice } from './financial.js';
import { blockHarmfulContent } from './harmful.js';
import { requireHumanApproval } from './human-approval.js';
import { blockHallucination } from './hallucination.js';
import { blockManipulation } from './manipulation.js';
import { blockDiscriminatoryOutput, blockSpecialCategoryData } from './discrimination.js';
import { blockMedicalAdvice, blockLegalAdvice } from './advice.js';
import {
  blockPromptInjection,
  blockSystemPromptLeakage,
  blockAiIdentityDeception,
} from './security.js';

export {
  blockPiiLeakage,
  blockFinancialAdvice,
  blockHarmfulContent,
  requireHumanApproval,
  blockHallucination,
  blockManipulation,
  blockDiscriminatoryOutput,
  blockSpecialCategoryData,
  blockMedicalAdvice,
  blockLegalAdvice,
  blockPromptInjection,
  blockSystemPromptLeakage,
  blockAiIdentityDeception,
};

// ─── Rule Registry ────────────────────────────────────────────────────────────

const BUILT_IN_RULES: Record<string, Rule> = {
  // ── Privacy & PII ──────────────────────────────────────────────────────────
  block_pii_leakage: blockPiiLeakage,

  // ── Special Category Data (GDPR Art 9) ────────────────────────────────────
  block_special_category_data: blockSpecialCategoryData,

  // ── EU AI Act Prohibited Practices (Art 5) ─────────────────────────────────
  block_manipulation: blockManipulation,

  // ── Safety & Harm ──────────────────────────────────────────────────────────
  block_harmful_content: blockHarmfulContent,

  // ── Professional Advice (UPL / Medical Licensing) ─────────────────────────
  block_medical_advice: blockMedicalAdvice,
  block_legal_advice: blockLegalAdvice,

  // ── Financial ──────────────────────────────────────────────────────────────
  block_financial_advice: blockFinancialAdvice,

  // ── Fairness & Non-Discrimination (EU Charter Art 21, GDPR Rec 71) ────────
  block_discriminatory_output: blockDiscriminatoryOutput,

  // ── Security (OWASP LLM Top 10) ───────────────────────────────────────────
  block_prompt_injection: blockPromptInjection,
  block_system_prompt_leakage: blockSystemPromptLeakage,

  // ── Transparency (EU AI Act Art 50) ───────────────────────────────────────
  block_ai_identity_deception: blockAiIdentityDeception,

  // ── Quality & Accuracy ────────────────────────────────────────────────────
  block_hallucination: blockHallucination,

  // ── Human Oversight (EU AI Act Art 14) ────────────────────────────────────
  require_human_approval: requireHumanApproval,
};

// ─── Compliance Bundles ───────────────────────────────────────────────────────
//
// Pre-configured rule sets for common regulatory frameworks.
// Use: resolveRules([...COMPLIANCE_BUNDLES.EU_AI_ACT])

export const COMPLIANCE_BUNDLES = {
  /** EU AI Act + GDPR minimum viable compliance bundle */
  EU_AI_ACT: [
    'block_pii_leakage',
    'block_special_category_data',
    'block_manipulation',
    'block_discriminatory_output',
    'block_ai_identity_deception',
    'block_harmful_content',
    'require_human_approval',
    'block_hallucination',
  ] as const,

  /** OWASP LLM Top 10 security bundle */
  OWASP_LLM: [
    'block_prompt_injection',
    'block_system_prompt_leakage',
    'block_pii_leakage',
    'block_harmful_content',
  ] as const,

  /** Healthcare / clinical AI bundle */
  HEALTHCARE: [
    'block_pii_leakage',
    'block_special_category_data',
    'block_medical_advice',
    'block_hallucination',
    'require_human_approval',
    'block_discriminatory_output',
  ] as const,

  /** Legal / professional services bundle */
  LEGAL: [
    'block_pii_leakage',
    'block_legal_advice',
    'block_financial_advice',
    'block_hallucination',
    'require_human_approval',
    'block_ai_identity_deception',
  ] as const,

  /** Financial services / fintech bundle */
  FINTECH: [
    'block_pii_leakage',
    'block_financial_advice',
    'block_special_category_data',
    'block_discrimination_output',
    'block_manipulation',
    'require_human_approval',
    'block_hallucination',
  ] as const,

  /** Customer-facing chatbot bundle */
  CHATBOT: [
    'block_pii_leakage',
    'block_harmful_content',
    'block_manipulation',
    'block_ai_identity_deception',
    'block_prompt_injection',
    'block_system_prompt_leakage',
    'block_medical_advice',
    'block_legal_advice',
  ] as const,
} as const;

// ─── resolveRules ─────────────────────────────────────────────────────────────

/**
 * Resolve a mix of built-in rule names and custom Rule objects into a flat Rule[].
 */
export function resolveRules(
  ruleSpecs: (string | Rule)[]
): Rule[] {
  return ruleSpecs.map((spec) => {
    if (typeof spec === 'string') {
      const rule = BUILT_IN_RULES[spec];
      if (!rule) {
        throw new Error(
          `Unknown built-in rule: "${spec}". ` +
          `Available rules: ${Object.keys(BUILT_IN_RULES).join(', ')}`
        );
      }
      return rule;
    }
    // Custom rule — validate shape
    if (typeof spec.check !== 'function' || typeof spec.name !== 'string') {
      throw new Error(
        'Custom rules must have a `name: string` and `check(ctx): Promise<Violation[]>` method.'
      );
    }
    return spec;
  });
}

/**
 * Run all rules in parallel against the given context.
 * Returns a flat array of all violations found.
 */
export async function runAllRules(
  rules: Rule[],
  ctx: RuleContext
): Promise<Violation[]> {
  const results = await Promise.all(rules.map((r) => r.check(ctx)));
  return results.flat();
}

// ─── Custom Rule Helper ───────────────────────────────────────────────────────

/**
 * Convenience factory for creating a custom rule inline.
 *
 * @example
 * const myRule = createRule('no_competitor_mentions', async ({ result }) => {
 *   const text = JSON.stringify(result);
 *   if (text.includes('CompetitorName')) {
 *     return [{ rule: 'no_competitor_mentions', description: '...', severity: 'MEDIUM' }];
 *   }
 *   return [];
 * });
 */
export function createRule(
  name: string,
  check: (ctx: RuleContext) => Promise<Violation[]>,
  description = ''
): Rule {
  return { name, description, check };
}

export type { Rule, RuleContext, Violation };
