/**
 * Rules: block_medical_advice, block_legal_advice
 *
 * Detects unqualified professional advice that could cause harm.
 *
 * Regulatory basis:
 *   - Medical: FDA Regulations, GMC/AMA professional standards, WHO safe communication.
 *     Providing medical diagnosis/treatment recommendations without licensure is
 *     illegal in most jurisdictions.
 *   - Legal: Unauthorised Practice of Law (UPL) statutes (all US states, UK SRA,
 *     EU Bar Directives). AI systems giving legal advice without a licensed attorney
 *     violate UPL laws.
 *   - EU AI Act Annex III: Medical devices (Class IIa+) and legal AI are explicitly
 *     high-risk categories requiring strict conformity assessment.
 *   - NIST AI RMF: GOVERN 1.2 — High-risk AI use case classification for healthcare
 *     and legal decision support.
 *
 * Note: Providing *information* is different from providing *advice/recommendations*.
 *       These rules target the latter — specific prescriptive guidance.
 */

import type { Rule, RuleContext, Violation } from '../types.js';

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ─── Medical Advice Rule ──────────────────────────────────────────────────────

const MEDICAL_ADVICE_PATTERNS = [
  // Direct diagnosis
  /\b(you (have|likely have|probably have|are suffering from|may have)|I (diagnose|believe you have|think you have))\s+[A-Z][a-z]+(itis|osis|emia|oma|pathy|syndrome|disorder|disease|virus|infection|condition)\b/i,
  // Treatment recommendations
  /\b(you should (take|use|start|stop|increase|decrease|try)|I (recommend|suggest|advise) (taking|using|stopping))\s+(medication|pills?|tablets?|drug|dose|dosage|prescription|antibiotics|chemotherapy|insulin|steroids?)\b/i,
  // Dosage instructions
  /\b(take \d+\s?(mg|ml|mcg|units?|tablets?|pills?|capsules?|drops?|cc)|dosage (is|should be|recommended|maximum|daily))\b/i,
  // Surgical / procedural advice
  /\b(you (need|should have|should get|require|must have))\s+(surgery|operation|procedure|biopsy|transplant|chemotherapy|radiation|dialysis)\b/i,
  // Self-treatment for serious conditions
  /\b(home (remedy|treatment|cure) for .{0,40}(cancer|diabetes|HIV|hepatitis|tuberculosis|stroke|heart attack|meningitis))\b/i,
  // Medication stopping advice
  /\b(stop (taking|using)|discontinue).{0,30}(your medication|your prescription|your treatment|prescribed)\b/i,
];

export const blockMedicalAdvice: Rule = {
  name: 'block_medical_advice',
  description:
    'Blocks unqualified medical advice: diagnosis, treatment recommendations, ' +
    'dosage instructions, surgical advice, or medication management. ' +
    'Unauthorised medical advice is illegal in most jurisdictions and is an ' +
    'EU AI Act Annex III high-risk use case.',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const pattern of MEDICAL_ADVICE_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        violations.push({
          rule: 'block_medical_advice',
          description: 'Output contains unqualified medical diagnosis or treatment recommendation',
          evidence: match[0].slice(0, 100),
          severity: 'CRITICAL',
          remediation:
            'Replace specific medical advice with: "Please consult a qualified healthcare ' +
            'professional for medical advice, diagnosis, or treatment." ' +
            'Providing medical advice without licensure is illegal. ' +
            'See EU AI Act Annex III for high-risk AI classification.',
        });
        break; // One violation per rule is sufficient
      }
    }

    return violations;
  },
};

// ─── Legal Advice Rule ────────────────────────────────────────────────────────

const LEGAL_ADVICE_PATTERNS = [
  // Direct legal recommendation
  /\b(you (should|must|need to)|I (advise|recommend)|my (advice|recommendation) is)\s+(sue|file (a )?lawsuit|take .{0,20} to court|pursue legal action|file (a )?claim|contest|appeal .{0,20}(court|tribunal)|sign .{0,20}(contract|agreement))\b/i,
  // Legal outcome prediction
  /\b(you (will|would|should) win|you (have|have got) a (strong|good|solid|winning) case|they are (clearly|definitely|obviously|certainly) liable|you (can|could|will) (recover|receive|get) damages)\b/i,
  // Contract interpretation as advice
  /\b(this (clause|contract|agreement|term) (means|requires|obligates|entitles) you to|under this (contract|agreement) you (must|are required to|have to|are entitled to))\b/i,
  // Specific legal strategy advice
  /\b(your best (legal )?(strategy|option|course of action) is to|to (avoid|minimise|limit) your (legal )?liability you should|I (recommend|suggest|advise) (invoking|citing|using))\s+(statute|regulation|law|article|section|clause)/i,
  // Immigration advice
  /\b(you (qualify|are eligible|should apply) for .{0,30}(visa|green card|residency|citizenship|asylum|work permit|naturalisation))\b/i,
];

export const blockLegalAdvice: Rule = {
  name: 'block_legal_advice',
  description:
    'Blocks Unauthorised Practice of Law (UPL): specific legal recommendations, ' +
    'outcome predictions, contract interpretation, and legal strategy advice. ' +
    'UPL is a criminal offence in most jurisdictions (US, UK, EU).',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const pattern of LEGAL_ADVICE_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        violations.push({
          rule: 'block_legal_advice',
          description: 'Output contains specific legal advice that may constitute Unauthorised Practice of Law (UPL)',
          evidence: match[0].slice(0, 100),
          severity: 'HIGH',
          remediation:
            'Replace specific legal advice with: "Please consult a qualified lawyer ' +
            'for legal advice specific to your situation." Do not predict legal outcomes ' +
            'or provide case strategy. This may violate UPL statutes.',
        });
        break;
      }
    }

    return violations;
  },
};
