import type { Rule, RuleContext, Violation } from '../types.js';

// ─── PII Patterns ─────────────────────────────────────────────────────────────

const PATTERNS = {
  email:   /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // US phone (various formats)
  phone:   /(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g,
  // US Social Security Number
  ssn:     /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  // Major card brands (Visa, MC, Amex, Diners, Discover)
  cc: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  // Indian Aadhaar (12 digit, optionally spaced in groups of 4)
  aadhaar: /\b\d{4}[\s]?\d{4}[\s]?\d{4}\b/g,
  // UK National Insurance Number
  nino:    /\b[A-Z]{2}\d{6}[A-D]\b/gi,
  // Passport-like numbers (simplified)
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  // AWS Access Key IDs
  awsKey:  /\bAKIA[0-9A-Z]{16}\b/g,
  // Generic long hex secrets (e.g. API tokens)
  hexSecret: /\b[0-9a-fA-F]{32,64}\b/g,
} as const;

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function findAll(text: string, re: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) results.push(m[0] ?? '');
  return results;
}

// Luhn algorithm to reduce false positives for credit cards
function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '').split('').reverse().map(Number);
  return digits.reduce((sum, d, i) => {
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    return sum + d;
  }, 0) % 10 === 0;
}

export const blockPiiLeakage: Rule = {
  name: 'block_pii_leakage',
  description:
    'Blocks agent output containing PII: emails, phones, SSNs, credit cards, ' +
    'Aadhaar, NI numbers, passports, AWS keys, or long hex secrets.',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    // Email
    const emails = findAll(text, PATTERNS.email);
    if (emails.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${emails.length} email address(es)`,
        evidence: emails.slice(0, 2).map((e) => e.replace(/(?<=.{3}).+(?=@)/, '***')).join(', '),
        severity: 'HIGH',
        remediation: 'Redact email addresses before returning output to users.',
      });
    }

    // Phone
    const phones = findAll(text, PATTERNS.phone);
    if (phones.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${phones.length} phone number(s)`,
        evidence: phones.slice(0, 2).map(() => '***-***-****').join(', '),
        severity: 'HIGH',
        remediation: 'Redact phone numbers before returning output.',
      });
    }

    // SSN
    const ssns = findAll(text, PATTERNS.ssn);
    if (ssns.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${ssns.length} potential Social Security Number(s)`,
        evidence: '***-**-****',
        severity: 'CRITICAL',
        remediation: 'SSNs must never appear in agent output. Remove from all data sources.',
      });
    }

    // Credit card (with Luhn validation to reduce false positives)
    const ccs = findAll(text, PATTERNS.cc).filter((c) => luhn(c));
    if (ccs.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${ccs.length} valid credit card number(s)`,
        evidence: '**** **** **** ****',
        severity: 'CRITICAL',
        remediation: 'Credit card numbers must be tokenized. Never pass raw PANs to agents.',
      });
    }

    // Aadhaar
    const aadhaars = findAll(text, PATTERNS.aadhaar);
    if (aadhaars.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${aadhaars.length} potential Aadhaar number(s)`,
        evidence: 'XXXX XXXX XXXX',
        severity: 'CRITICAL',
        remediation: 'Aadhaar numbers are protected under India\'s DPDP Act.',
      });
    }

    // AWS Key
    const awsKeys = findAll(text, PATTERNS.awsKey);
    if (awsKeys.length > 0) {
      violations.push({
        rule: 'block_pii_leakage',
        description: `Output contains ${awsKeys.length} AWS Access Key ID(s)`,
        evidence: 'AKIA****************',
        severity: 'CRITICAL',
        remediation: 'Rotate all exposed AWS keys immediately.',
      });
    }

    return violations;
  },
};
