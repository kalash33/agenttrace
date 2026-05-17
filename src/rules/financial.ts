import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Financial Advice Keywords ────────────────────────────────────────────────

const FINANCIAL_ADVICE_PHRASES = [
  // Investment recommendations
  'buy this stock',
  'sell this stock',
  'invest in',
  'invest your money',
  'put your money in',
  'you should buy',
  'you should sell',
  'i recommend buying',
  'i recommend selling',
  'best investment',
  'guaranteed returns',
  'guaranteed profit',
  'high returns',
  // Loan/credit advice
  'take out a loan',
  'apply for a loan',
  'you should borrow',
  'max out your credit',
  'refinance your mortgage',
  // Insurance advice
  'you need life insurance',
  'cancel your insurance',
  'switch your insurance',
  // Risky phrases
  'this is not financial advice',  // often precedes financial advice
  'not a financial advisor',       // same
  'dyor',                          // "do your own research" — crypto context
  'to the moon',
  'rug pull',
  'pump and dump',
];

const FINANCIAL_ADVICE_RE = new RegExp(
  FINANCIAL_ADVICE_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Transaction patterns: large dollar amounts in an action context
const LARGE_TRANSACTION_RE =
  /\$[\d,]+(?:\.\d{2})?|\b(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR)\b/g;

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function findMatches(text: string, re: RegExp): string[] {
  re.lastIndex = 0;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push(m[0] ?? '');
  }
  return matches;
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
}

export const blockFinancialAdvice: Rule = {
  name: 'block_financial_advice',
  description:
    'Blocks agent output that contains unqualified financial advice, ' +
    'investment recommendations, or large unauthorised transactions.',

  async check({ result, guardOptions }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    // 1. Detect financial advice language
    const adviceMatches = findMatches(text, FINANCIAL_ADVICE_RE);
    if (adviceMatches.length > 0) {
      violations.push({
        rule: 'block_financial_advice',
        description: `Output contains financial advice language: "${adviceMatches.slice(0, 2).join('", "')}"`,
        evidence: adviceMatches.slice(0, 3).join(', '),
        severity: 'HIGH',
      });
    }

    // 2. Detect large transactions (configurable threshold)
    const threshold =
      guardOptions.humanApproval?.threshold ?? 1000;
    const amounts = findMatches(text, LARGE_TRANSACTION_RE);
    for (const raw of amounts) {
      const amount = parseAmount(raw);
      if (amount >= threshold) {
        violations.push({
          rule: 'block_financial_advice',
          description: `Output references transaction of ${raw} which exceeds threshold of $${threshold}`,
          evidence: raw,
          severity: amount >= 10_000 ? 'CRITICAL' : 'HIGH',
        });
        break; // one violation per run is enough
      }
    }

    return violations;
  },
};
