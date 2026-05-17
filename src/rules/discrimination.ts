/**
 * Rule: block_discriminatory_output
 *
 * Detects discriminatory content in agent output based on protected characteristics.
 *
 * Regulatory basis:
 *   - EU AI Act Article 10(2)(f): Data governance requirements for bias detection
 *     in high-risk AI systems covering protected attributes.
 *   - EU AI Act Annex III: High-risk use cases (employment, education, credit,
 *     essential services) where discrimination is especially harmful.
 *   - EU Charter of Fundamental Rights Article 21: Prohibition of discrimination.
 *   - GDPR Recital 71: Prohibition of automated decisions that discriminate.
 *   - US Fair Housing Act / Equal Credit Opportunity Act: Prohibited bases.
 *   - NIST AI RMF: MAP 2.1, MEASURE 2.5 — Bias and fairness testing.
 *
 * Rule: block_special_category_data
 *
 * Detects GDPR Article 9 special category data in agent output.
 *
 * Regulatory basis:
 *   - GDPR Article 9: Special categories of personal data requiring explicit consent.
 *   - EU AI Act Article 10(5): Special categories of data in high-risk AI training.
 *   - India DPDP Act 2023: Sensitive personal data.
 *   - HIPAA (US): Protected Health Information (PHI).
 */

import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ─── Discrimination Patterns ──────────────────────────────────────────────────

// Protected characteristics as per EU Charter Art 21, ECHR, and national laws
const DISCRIMINATION_PATTERNS: Array<{
  pattern: RegExp;
  characteristic: string;
  severity: Violation['severity'];
}> = [
  // Employment / capability discrimination
  {
    pattern: /\b(because (he|she|they) is (a )?(woman|man|old|young|disabled|Muslim|Jewish|Black|White|Asian|Hispanic|pregnant))\b/i,
    characteristic: 'direct discrimination based on protected characteristic',
    severity: 'CRITICAL',
  },
  // Refusal language tied to protected attributes
  {
    pattern: /\b(not (eligible|qualified|suitable|approved)) .{0,60}(race|gender|sex|age|religion|disability|nationality|ethnicity|sexual orientation|pregnancy|marital status)/i,
    characteristic: 'adverse eligibility decision citing protected characteristic',
    severity: 'CRITICAL',
  },
  // Stereotyping
  {
    pattern: /\b(people of|members of|those from|individuals with) .{0,30}(race|religion|ethnicity|nationality) (tend to|are (known to|likely to|prone to|naturally|typically|usually))/i,
    characteristic: 'racial/ethnic/religious stereotyping',
    severity: 'HIGH',
  },
  // Age discrimination (ageism in employment/services)
  {
    pattern: /\b(too old|too young|past (their|your) prime|can'?t learn new|older workers? (are|tend to|often))\b/i,
    characteristic: 'age-based discrimination or stereotyping',
    severity: 'HIGH',
  },
  // Disability discrimination
  {
    pattern: /\b(suffers? from|afflicted (by|with)|confined to|wheelchair.?bound|mentally (deficient|defective|retarded)|handicapped)\b/i,
    characteristic: 'derogatory or othering disability language',
    severity: 'HIGH',
  },
  // Hate speech indicators
  {
    pattern: /\b(subhuman|vermin|parasite|infestation|invasion).{0,50}(immigrants?|refugees?|foreigners?|minorities)/i,
    characteristic: 'dehumanizing language targeting ethnic/national group',
    severity: 'CRITICAL',
  },
  // Gender discrimination in decisions
  {
    pattern: /\b(women (should not|shouldn'?t|can'?t|are unable to)|men (are (better|more))|not (a job|a role|suitable) for (women|men|females?|males?))\b/i,
    characteristic: 'gender-based capability discrimination',
    severity: 'CRITICAL',
  },
];

export const blockDiscriminatoryOutput: Rule = {
  name: 'block_discriminatory_output',
  description:
    'Blocks discriminatory output based on protected characteristics: race, gender, age, ' +
    'disability, religion, ethnicity, sexual orientation, nationality. ' +
    'Maps to EU AI Act Art 10, EU Charter Art 21, GDPR Recital 71.',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const { pattern, characteristic, severity } of DISCRIMINATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        violations.push({
          rule: 'block_discriminatory_output',
          description: `Output contains ${characteristic}`,
          evidence: match[0].slice(0, 100),
          severity,
          remediation:
            'Remove references to protected characteristics in eligibility/capability decisions. ' +
            'Apply equal treatment. Log for bias audit under EU AI Act Art 10.',
        });
      }
    }

    return violations;
  },
};

// ─── Special Category Data (GDPR Art 9) ──────────────────────────────────────

const SPECIAL_CATEGORY_PATTERNS: Array<{
  pattern: RegExp;
  category: string;
  severity: Violation['severity'];
}> = [
  // Health data
  {
    pattern: /\b(diagnosis|diagnosed with|medical condition|prescription|HIV|cancer|diabetes|epilepsy|mental illness|depression|anxiety disorder|bipolar|schizophrenia|chronic .{0,20}disease|blood (type|group)|medical history|patient (record|data|number|ID))\b/i,
    category: 'health/medical data (GDPR Art 9(1))',
    severity: 'CRITICAL',
  },
  // Genetic / biometric data
  {
    pattern: /\b(genetic (data|information|sequence|test|profile)|DNA (sequence|profile|test|marker)|biometric (data|template|scan)|fingerprint (hash|template)|facial (recognition|template|encoding))\b/i,
    category: 'genetic or biometric data (GDPR Art 9(1))',
    severity: 'CRITICAL',
  },
  // Sexual orientation / gender identity
  {
    pattern: /\b(sexual orientation|gender identity|transgender|non-binary|gay|lesbian|bisexual|queer|LGBTQ).{0,50}(person|individual|employee|user|customer|patient)\b/i,
    category: 'sexual orientation or gender identity data (GDPR Art 9(1))',
    severity: 'CRITICAL',
  },
  // Religious / philosophical beliefs
  {
    pattern: /\b(religious belief|faith|denomination|church member|mosque|synagogue|temple|atheist|agnostic|Buddhist|Muslim|Jewish|Christian|Hindu).{0,50}\b(their|this (person|user|employee|individual|subject))\b/i,
    category: 'religious or philosophical beliefs (GDPR Art 9(1))',
    severity: 'HIGH',
  },
  // Political opinions
  {
    pattern: /\b(political (opinion|affiliation|belief|party)|party member|votes? for|politically (affiliated|aligned)).{0,50}\b(their|this (person|user|employee|individual))\b/i,
    category: 'political opinions (GDPR Art 9(1))',
    severity: 'HIGH',
  },
  // Trade union membership
  {
    pattern: /\b(trade union (member|membership)|union (member|affiliation|card)|collective bargaining representative)\b/i,
    category: 'trade union membership (GDPR Art 9(1))',
    severity: 'HIGH',
  },
  // Criminal records (special sensitivity)
  {
    pattern: /\b(criminal (record|history|conviction|offence)|prior (offence|conviction|arrest|charge)|felony|misdemeanor|DUI|sex offender|registered (offender|criminal))\b/i,
    category: 'criminal record data (requires Art 10 GDPR lawful basis)',
    severity: 'HIGH',
  },
];

export const blockSpecialCategoryData: Rule = {
  name: 'block_special_category_data',
  description:
    'Blocks GDPR Article 9 special category data: health, genetic, biometric, ' +
    'sexual orientation, religious beliefs, political opinions, trade union membership, ' +
    'criminal records. Requires explicit legal basis to process.',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const { pattern, category, severity } of SPECIAL_CATEGORY_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        violations.push({
          rule: 'block_special_category_data',
          description: `Output contains ${category}`,
          evidence: match[0].slice(0, 80),
          severity,
          remediation:
            `GDPR Art 9 prohibits processing ${category} without explicit consent or a valid exemption. ` +
            'Redact this data before returning it in agent output. Consult your DPO.',
        });
      }
    }

    return violations;
  },
};
