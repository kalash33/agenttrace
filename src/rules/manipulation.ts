/**
 * Rule: block_manipulation
 *
 * Detects psychological manipulation techniques in agent output.
 *
 * Regulatory basis:
 *   - EU AI Act Article 5(1)(a): Prohibited AI that uses subliminal techniques
 *     beyond a person's consciousness or purposefully manipulative techniques
 *     exploiting vulnerabilities to materially distort behaviour.
 *   - EU AI Act Article 5(1)(b): Exploiting vulnerabilities of specific groups
 *     (age, disability, social/economic situation).
 *   - NIST AI RMF: GOVERN 1.7 — Processes for detecting and responding to
 *     harmful manipulation by AI systems.
 *   - FTC Act Section 5: Deceptive and unfair practices.
 *
 * Detects:
 *   - Artificial urgency and scarcity (dark patterns)
 *   - Fear, uncertainty, and doubt (FUD)
 *   - Exploiting vulnerability cues (debt, illness, grief, loneliness)
 *   - False authority claims
 *   - Social proof manipulation
 *   - Gaslighting / reality distortion
 */

import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Pattern Groups ───────────────────────────────────────────────────────────

interface PatternGroup {
  patterns: RegExp[];
  description: string;
  severity: Violation['severity'];
  remediation: string;
}

const MANIPULATION_GROUPS: PatternGroup[] = [
  {
    patterns: [
      /\b(act now|limited time|offer expires|last chance|only \d+ left|selling fast|hurry|don'?t wait|time is running out|expires (tonight|today|soon)|flash sale)\b/i,
      /\b(urgent|emergency|immediate action required|respond immediately|before it'?s too late)\b/i,
    ],
    description: 'Output creates artificial urgency or false scarcity (dark pattern)',
    severity: 'HIGH',
    remediation: 'Remove time-pressure language. Present information without urgency manipulation.',
  },
  {
    patterns: [
      /\b(you will (lose|miss|regret|fail)|if you don'?t .{0,30}(you will|you'?ll|you may)|risk losing|can'?t afford to miss|consequences of (inaction|waiting|delay))\b/i,
      /\b(fear|danger|threat|warning|at risk|in danger|catastrophic|devastating)\b.{0,50}\b(if you|unless you|without)\b/i,
    ],
    description: 'Output uses fear-based manipulation to drive behaviour',
    severity: 'HIGH',
    remediation: 'Replace fear-based framing with factual risk information.',
  },
  {
    patterns: [
      /\b(struggling with debt|financial difficulties|medical condition|serious illness|recently (lost|bereaved|divorced)|mental health|loneliness|isolated|vulnerable)\b.{0,100}\b(offer|solution|help|save|protect)\b/i,
    ],
    description: 'Output appears to exploit personal vulnerabilities (EU AI Act Art 5(1)(b))',
    severity: 'CRITICAL',
    remediation: 'Agents must not exploit personal vulnerabilities. Refer to appropriate support services.',
  },
  {
    patterns: [
      /\b(experts (agree|say|recommend)|studies (show|prove|confirm) .{0,30}(100%|all|every|always)|scientifically proven|guaranteed|no risk|zero risk|100% safe|clinically proven)\b/i,
    ],
    description: 'Output makes false or unverifiable authority/certainty claims',
    severity: 'MEDIUM',
    remediation: 'Replace absolute claims with qualified, evidence-based statements.',
  },
  {
    patterns: [
      /\b(everyone (is|has|does)|most people (have|are|do)|you'?re the only (one|person)|don'?t be left behind|join (millions|thousands|everyone))\b/i,
    ],
    description: 'Output uses manipulative social proof techniques',
    severity: 'MEDIUM',
    remediation: 'Use specific, accurate statistics rather than social proof manipulation.',
  },
  {
    patterns: [
      /\b(you'?re (imagining|wrong|confused|mistaken|overreacting)|that didn'?t (happen|occur)|you must have (misunderstood|misremembered)|I never said|you'?re being (irrational|paranoid|too sensitive))\b/i,
    ],
    description: 'Output exhibits gaslighting or reality-distortion patterns',
    severity: 'CRITICAL',
    remediation: 'Agent must not deny, minimize, or distort the user\'s stated experience.',
  },
];

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export const blockManipulation: Rule = {
  name: 'block_manipulation',
  description:
    'Blocks psychological manipulation: artificial urgency, fear tactics, ' +
    'vulnerability exploitation, false authority, social proof abuse, gaslighting. ' +
    'Maps to EU AI Act Art 5(1)(a) and Art 5(1)(b).',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const group of MANIPULATION_GROUPS) {
      for (const pattern of group.patterns) {
        const match = pattern.exec(text);
        if (match) {
          violations.push({
            rule: 'block_manipulation',
            description: group.description,
            evidence: match[0].slice(0, 100),
            severity: group.severity,
            remediation: group.remediation,
          });
          break; // One violation per group
        }
      }
    }

    return violations;
  },
};
