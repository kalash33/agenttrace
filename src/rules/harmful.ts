import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Harmful Content Categories ───────────────────────────────────────────────

const HARM_CATEGORIES: Array<{
  category: string;
  patterns: string[];
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
}> = [
  {
    category: 'self_harm',
    patterns: [
      'how to kill yourself',
      'ways to commit suicide',
      'self-harm methods',
      'cutting yourself',
      'overdose on',
    ],
    severity: 'CRITICAL',
  },
  {
    category: 'violence',
    patterns: [
      'how to make a bomb',
      'build explosive',
      'how to make explosives',
      'how to hurt someone',
      'instructions for violence',
      'how to attack',
    ],
    severity: 'CRITICAL',
  },
  {
    category: 'illegal_activities',
    patterns: [
      'how to hack into',
      'how to pick a lock',
      'how to shoplift',
      'how to make meth',
      'how to synthesize drugs',
      'how to launder money',
      'how to evade taxes',
    ],
    severity: 'HIGH',
  },
  {
    category: 'hate_speech',
    patterns: [
      'i hate all',
      'all [group] should be',
      'exterminate the',
      'genocide of',
    ],
    severity: 'HIGH',
  },
  {
    category: 'misinformation',
    patterns: [
      'vaccines cause autism',
      'earth is flat',
      'covid is a hoax',
      '5g causes cancer',
      'climate change is a hoax',
    ],
    severity: 'MEDIUM',
  },
];

// Build a flat regex map per category
const HARM_RE_MAP = HARM_CATEGORIES.map(({ category, patterns, severity }) => ({
  category,
  severity,
  re: new RegExp(
    patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi'
  ),
}));

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const blockHarmfulContent: Rule = {
  name: 'block_harmful_content',
  description:
    'Blocks agent output that contains harmful, violent, illegal, or hateful content.',

  async check({ result }: RuleContext): Promise<Violation[]> {
    const text = extractText(result);
    const violations: Violation[] = [];

    for (const { category, severity, re } of HARM_RE_MAP) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) {
        violations.push({
          rule: 'block_harmful_content',
          description: `Output contains harmful content in category: ${category}`,
          evidence: m[0],
          severity,
        });
      }
    }

    return violations;
  },
};
