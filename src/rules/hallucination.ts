import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Hallucination Detection (RAG) ───────────────────────────────────────────
//
// Strategy: simple keyword / claim extraction from the agent output, then
// cross-check against the provided context documents.
//
// For production use, a vector-similarity check or LLM-as-judge is better —
// but this deterministic version has zero extra API cost and zero latency.
//

const FACTUAL_CLAIM_MARKERS = [
  'the answer is',
  'the result is',
  'according to',
  'the data shows',
  'as of',
  'the rate is',
  'the price is',
  'the figure is',
  'research shows',
  'studies show',
  'it is a fact',
  'confirmed that',
  'verified that',
];

const FACTUAL_CLAIM_RE = new RegExp(
  FACTUAL_CLAIM_MARKERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
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

/**
 * Very lightweight "overlap" check — not semantic, but good enough for a first pass.
 * Checks if important words from a claim appear in the provided context.
 */
function isClaimSupportedByContext(claim: string, context: string[]): boolean {
  if (context.length === 0) return true; // no context = no check possible

  const combinedContext = context.join(' ').toLowerCase();

  // Extract meaningful words from the claim (drop stopwords)
  const stopwords = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'to','of','in','for','on','with','at','by','from','as','that','this',
    'and','or','but','not','it','its','they','their','we','i',
  ]);

  const words = claim
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));

  if (words.length === 0) return true;

  // At least 50% of meaningful words should appear in the context
  const found = words.filter((w) => combinedContext.includes(w));
  return found.length / words.length >= 0.5;
}

export const blockHallucination: Rule = {
  name: 'block_hallucination',
  description:
    'Detects factual claims in the agent output that are not supported ' +
    'by the provided context documents (RAG hallucination detection).',

  async check({ result, guardOptions }: RuleContext): Promise<Violation[]> {
    const context = guardOptions.context ?? [];
    if (context.length === 0) {
      // Cannot check without context documents
      return [];
    }

    const text = extractText(result);
    const violations: Violation[] = [];

    // Find sentences that contain factual claim markers
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);

    for (const sentence of sentences) {
      FACTUAL_CLAIM_RE.lastIndex = 0;
      if (!FACTUAL_CLAIM_RE.test(sentence)) continue;

      if (!isClaimSupportedByContext(sentence, context)) {
        violations.push({
          rule: 'block_hallucination',
          description: `Factual claim not supported by provided context: "${sentence.slice(0, 120)}${sentence.length > 120 ? '...' : ''}"`,
          evidence: sentence.slice(0, 200),
          severity: 'HIGH',
        });

        // Cap at 3 violations per run
        if (violations.length >= 3) break;
      }
    }

    return violations;
  },
};
