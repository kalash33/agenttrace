import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Human Approval Gate ──────────────────────────────────────────────────────
//
// This rule blocks high-impact agent actions and (optionally) calls a
// user-provided callback to seek real-time human approval.
//
// Configuration (via guardOptions.humanApproval):
//   threshold    — USD amount above which approval is required (default $1,000)
//   onApprovalRequired — async callback that returns true (approve) or false (reject)
//

const AMOUNT_RE =
  /\$\s*([\d,]+(?:\.\d{2})?)/gi;

const HIGH_IMPACT_PHRASES = [
  'send email to all',
  'delete all',
  'drop table',
  'truncate table',
  'mass delete',
  'bulk delete',
  'deploy to production',
  'push to main',
  'irreversible',
  'cannot be undone',
  'permanent deletion',
];

const HIGH_IMPACT_RE = new RegExp(
  HIGH_IMPACT_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function largestAmount(text: string): number {
  AMOUNT_RE.lastIndex = 0;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const val = parseFloat((m[1] ?? '0').replace(/,/g, ''));
    if (val > max) max = val;
  }
  return max;
}

export const requireHumanApproval: Rule = {
  name: 'require_human_approval',
  description:
    'Blocks agent actions that exceed a configurable monetary threshold ' +
    'or perform high-impact irreversible operations, requiring explicit human approval.',

  async check({ result, trace, guardOptions }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];
    const threshold = guardOptions.humanApproval?.threshold ?? 1000;
    const onApproval = guardOptions.humanApproval?.onApprovalRequired;

    // 1. Check for high-impact destructive phrases
    HIGH_IMPACT_RE.lastIndex = 0;
    const impactMatch = HIGH_IMPACT_RE.exec(text);
    if (impactMatch) {
      let approved = false;
      if (onApproval) {
        approved = await onApproval({
          trace,
          description: `High-impact action detected: "${impactMatch[0]}"`,
        });
      }

      if (!approved) {
        violations.push({
          rule: 'require_human_approval',
          description: `High-impact action detected: "${impactMatch[0]}". Human approval required.`,
          evidence: impactMatch[0],
          severity: 'HIGH',
        });
      }
    }

    // 2. Check monetary threshold
    const amount = largestAmount(text);
    if (amount >= threshold) {
      let approved = false;
      if (onApproval) {
        approved = await onApproval({
          trace,
          description: `Transaction of $${amount.toLocaleString()} exceeds threshold of $${threshold.toLocaleString()}`,
          amount,
        });
      }

      if (!approved) {
        violations.push({
          rule: 'require_human_approval',
          description: `Transaction amount $${amount.toLocaleString()} exceeds approval threshold of $${threshold.toLocaleString()}`,
          evidence: `$${amount.toLocaleString()}`,
          severity: amount >= 10_000 ? 'CRITICAL' : 'HIGH',
        });
      }
    }

    return violations;
  },
};
