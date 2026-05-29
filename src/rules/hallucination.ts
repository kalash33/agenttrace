import type { Rule, RuleContext, Violation } from '../types.js';

// ─── Hallucination Detection (RAG) — v3 ──────────────────────────────────────
//
// Academic basis for this implementation:
//
//  [1] RAGTruth (Niu et al., ACL 2024): Validated word/claim-level grounding
//      checks as a viable first-tier detector. Recommended claim decomposition
//      over whole-response evaluation.
//
//  [2] SemEval-2024 Task 7 / Deterministic Post-Processing (2024): Recommended
//      wrapping numbers as distinct entities and using exact post-processing
//      to verify numeric values in output against source context — not relying
//      on semantic similarity for numeric grounding.
//
//  [3] Heuristic Fallbacks (Industry, 2026): Production systems use lightweight
//      "healing" layers with regex to catch numeric contradictions and negation
//      flips in under 50ms, bypassing expensive LLM judges.
//
//  [4] Claim Decomposition (NLI literature, 2024): Breaking response into atomic
//      sentences and verifying each independently — reducing noise from irrelevant
//      surrounding text.
//
//  [5] Temporal Misgrounding (arXiv 2024, ACL anthology): Temporal hallucination
//      is when the model generates dates/years that are inconsistent with the
//      provided context. "As of 2019" when context says "as of 2024" is a
//      critical factual error. Detected via year-extraction + context comparison.
//
//  [6] Confidence Scoring (arXiv 2024): Severity calibration research found that
//      binary pass/fail guardrails are insufficient. Each violation now carries
//      a confidence score (0–1) reflecting how certain the detector is.
//
// Detection layers (all deterministic, zero-API-cost, <1ms each):
//
//  Layer 1 — NUMERIC EXACT-MATCH (confidence 0.98)
//  Layer 2 — NEGATION FLIP (confidence 0.85)
//  Layer 3 — BIGRAM OVERLAP (confidence proportional to overlap score, 0.5–0.75)
//  Layer 4 — EXPANDED CLAIM MARKERS (enables all other layers)
//  Layer 5 — TEMPORAL GROUNDING (confidence 0.9)
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Layer 4: Expanded Factual Claim Markers ──────────────────────────────────
// Academic basis: claim decomposition starts with identifying epistemic markers
// (phrases that signal the speaker is asserting a fact, not speculating).

const FACTUAL_CLAIM_MARKERS = [
  // Original markers
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
  // New markers (expanded coverage)
  'the record shows',
  'the document states',
  'based on the',
  'per the',
  'as stated in',
  'as noted in',
  'as per',
  'the value is',
  'the amount is',
  'the dose is',
  'the dosage is',
  'the total is',
  'the current',
  'it states that',
  'it indicates that',
  'the policy states',
  'the policy says',
  'the guidelines state',
  'the specification',
  'is defined as',
  'is set to',
  'is equal to',
  'is currently',
  'has been confirmed',
  'has been verified',
] as const;

const FACTUAL_CLAIM_RE = new RegExp(
  FACTUAL_CLAIM_MARKERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// ─── Layer 2: Negation Patterns ───────────────────────────────────────────────
// When the claim contains a negation that inverts its meaning, simple word overlap
// will still "pass" the check (because all the meaningful words appear in context,
// just with different polarity). This layer catches those semantic inversions.
//
// Academic basis: Negation handling is a known gap in keyword-overlap methods,
// identified in multiple RAG evaluation papers (2023–2024). Rule-based negation
// detection at <50ms is the recommended lightweight mitigation.

const NEGATION_WORDS = [
  'not', 'no', 'never', 'none', 'neither', "n't",
  'without', 'except', 'unless', 'cannot', "can't",
  'does not', "doesn't", 'is not', "isn't", 'are not', "aren't",
  'will not', "won't", 'should not', "shouldn't", 'must not', "mustn't",
  'need not', "needn't", 'do not', "don't",
] as const;

const NEGATION_RE = new RegExp(
  NEGATION_WORDS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Positive anchors in context that negation in output would contradict
const POSITIVE_OBLIGATION_RE = /\b(required|mandatory|must|approval needed|needs approval|requires|obligatory|compulsory|essential)\b/i;
const POSITIVE_QUANTITY_MARKER = /\b(maximum|minimum|limit|cap|threshold|ceiling|floor)\b/i;

/**
 * Detect negation flip: output negates something the context asserts positively.
 *
 * Example:
 *   Context:  "Supervisor approval is required for amounts over $200."
 *   Claim:    "No approval is needed for any amount."
 *   → Negation flip detected (context has "required", claim has "no...needed")
 */
function hasNegationFlip(claim: string, context: string[]): boolean {
  const claimHasNegation = NEGATION_RE.test(claim);
  NEGATION_RE.lastIndex = 0;

  if (!claimHasNegation) return false;

  const combinedContext = context.join(' ');

  // If context contains a positive obligation and claim negates it → flip
  if (POSITIVE_OBLIGATION_RE.test(combinedContext)) {
    POSITIVE_OBLIGATION_RE.lastIndex = 0;
    // e.g., claim says "no approval needed" but context says "approval required"
    const claimNegatesObligation =
      /\b(no|not|never|without)\b.{0,30}\b(approval|required|mandatory|permission)\b/i.test(claim) ||
      /\b(approval|required|mandatory|permission)\b.{0,10}\b(not|no|never)\b/i.test(claim);
    if (claimNegatesObligation) return true;
  }

  // If context specifies a quantity limit and claim negates it → flip
  if (POSITIVE_QUANTITY_MARKER.test(combinedContext)) {
    POSITIVE_QUANTITY_MARKER.lastIndex = 0;
    const claimNegatesLimit =
      /\b(no|any amount|unlimited|without limit|no limit|no cap|no maximum|no minimum)\b/i.test(claim);
    if (claimNegatesLimit) return true;
  }

  return false;
}

// ─── Layer 1: Numeric Exact-Match ─────────────────────────────────────────────
// Academic basis: SemEval-2024 Task 7 found that numeric hallucinations are the
// most dangerous class and require deterministic post-processing — not semantic
// similarity — because embeddings treat "500mg" and "5000mg" as nearly identical.
//
// Two separate regexes for clean numeric entity extraction:
//  DOLLAR_RE: captures "$5000", "$499.50" etc. → unit = 'usd'
//  UNIT_RE:   captures "5000mg", "500ml", "35%" etc. → unit = matched suffix
//
// Using two regexes avoids the alternation ambiguity that caused "$5000" to
// be matched as "$500" + leftover "0" with a combined regex.

interface NumericEntity {
  value: number;
  unit: string;   // normalised unit: 'mg', 'usd', '%', etc. — '' for dimensionless
  raw: string;    // original matched string for error messages
}

const DOLLAR_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)/g;
const UNIT_RE =
  /\b(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|ml\b|g\b|kg\b|units?|tablets?|capsules?|doses?|iu|usd|eur|gbp|inr|%|bps|ms\b|seconds?|minutes?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi;


function extractNumericEntities(text: string): NumericEntity[] {
  const entities: NumericEntity[] = [];

  // Dollar-prefixed amounts
  DOLLAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOLLAR_RE.exec(text)) !== null) {
    const value = parseFloat((m[1] ?? '').replace(/,/g, ''));
    if (!isNaN(value) && value > 0) {
      entities.push({ value, unit: 'usd', raw: m[0].trim() });
    }
  }

  // Unit-suffixed numbers (mg, %, days, etc.)
  UNIT_RE.lastIndex = 0;
  while ((m = UNIT_RE.exec(text)) !== null) {
    const value = parseFloat((m[1] ?? '').replace(/,/g, ''));
    if (!isNaN(value) && value > 0) {
      entities.push({
        value,
        unit: (m[2] ?? '').toLowerCase().replace(/s$/, ''),
        raw: m[0].trim(),
      });
    }
  }

  return entities;
}

/**
 * Check that every numeric value in the claim appears in context.
 * Uses 1% relative tolerance to handle rounding/formatting differences.
 *
 * Dollar-prefixed amounts ($5000) are matched against context numbers tagged as 'usd'.
 * Plain dollar sign in context (like "$500") → extracted as { value:500, unit:'usd' }.
 *
 * Example:
 *   Claim:   "dose is 5000mg"    → entity: { value: 5000, unit: 'mg' }
 *   Context: "dose is 500mg"     → entity: { value: 500,  unit: 'mg' }
 *   |5000-500|/5000 = 90% error → NOT within 1% → VIOLATION
 */
function allNumericValuesGrounded(claim: string, context: string[]): {
  grounded: boolean;
  ungroundedEntities: NumericEntity[];
} {
  const claimEntities = extractNumericEntities(claim);

  // No numbers in claim → nothing to check
  if (claimEntities.length === 0) return { grounded: true, ungroundedEntities: [] };

  const combinedContext = context.join(' ');
  const contextEntities = extractNumericEntities(combinedContext);

  const ungroundedEntities: NumericEntity[] = [];

  for (const ce of claimEntities) {
    // Skip small unit-less numbers (1-9) — too common to be meaningful
    if (ce.value < 10 && ce.unit === '') continue;

    // Find a matching entity in context:
    //   - Same unit (or both unit-less)
    //   - Within 1% relative error
    // Special case: 'usd' unit matches '$' prefix in context
    const matched = contextEntities.some((ctx) => {
      const unitMatch =
        ctx.unit === ce.unit ||
        (ctx.unit === '' && ce.unit === '') ||
        (ctx.unit === 'usd' && ce.unit === 'usd');
      if (!unitMatch) return false;
      const relativeError = Math.abs(ctx.value - ce.value) / Math.max(ctx.value, ce.value, 1);
      return relativeError <= 0.01;  // 1% tolerance
    });

    if (!matched) ungroundedEntities.push(ce);
  }

  return {
    grounded: ungroundedEntities.length === 0,
    ungroundedEntities,
  };
}

// ─── Layer 3: Bigram Overlap ──────────────────────────────────────────────────
// Academic basis: RAGTruth (ACL 2024) and related work showed that bigram overlap
// captures more semantic content than unigrams while remaining computationally free.
// "blood pressure" is more specific than "blood" or "pressure" independently.
//
// We use a hybrid: bigrams where possible, fall back to unigrams for short claims.

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'to','of','in','for','on','with','at','by','from','as','that','this',
  'and','or','but','not','it','its','they','their','we','i','you','your',
  'he','she','which','who','what','when','where','how','all','each','every',
]);

function extractMeaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

/**
 * Bigram-aware overlap check (improved from v1's pure unigram check).
 *
 * For claims with ≥4 meaningful tokens, uses bigrams as primary signal.
 * Falls back to unigrams for short claims.
 * Threshold: ≥55% of claim bigrams must appear in context (looser than unigram
 *            threshold to allow for valid paraphrasing of context content).
 */
function isClaimSupportedByContext(claim: string, context: string[]): {
  supported: boolean;
  score: number;
} {
  if (context.length === 0) return { supported: true, score: 1.0 };

  const combinedContext = context.join(' ').toLowerCase();
  const claimTokens = extractMeaningfulTokens(claim);

  if (claimTokens.length === 0) return { supported: true, score: 1.0 };

  // Use bigrams for longer claims
  if (claimTokens.length >= 4) {
    const claimBigrams = extractBigrams(claimTokens);
    if (claimBigrams.length > 0) {
      const foundBigrams = claimBigrams.filter((bg) => combinedContext.includes(bg));
      const bigramScore = foundBigrams.length / claimBigrams.length;
      if (bigramScore >= 0.55) return { supported: true, score: bigramScore };
      
      const foundTokens = claimTokens.filter((t) => combinedContext.includes(t));
      const unigramScore = foundTokens.length / claimTokens.length;
      return { supported: unigramScore >= 0.60, score: unigramScore };
    }
  }

  const foundTokens = claimTokens.filter((t) => combinedContext.includes(t));
  const score = foundTokens.length / claimTokens.length;
  return { supported: score >= 0.55, score };
}

// ─── Layer 5: Temporal Grounding ──────────────────────────────────────────────────
// Academic basis: Temporal misgrounding research (arXiv 2024, ACL anthology).
// "As of" date mismatches are a critical factual error class — temporal
// hallucinations are especially dangerous in healthcare, finance, and legal
// contexts where guidelines change year-to-year.
//
// Strategy:
//  1. Extract year references from the claim (e.g. "2019", "2024")
//  2. Extract year references from context
//  3. If claim contains years NOT present in context → temporal mismatch
//  4. Also detect "as of [year]" constructions as high-priority temporal claims

// Matches 4-digit years in range 1900–2099
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;

// High-signal temporal claim phrases ("as of 2019", "since 2022", etc.)
const TEMPORAL_PHRASE_RE =
  /\b(?:as of|since|until|before|after|in|by|from|through|effective|starting|beginning|ending)\s+(19\d{2}|20\d{2})\b/gi;

interface TemporalMismatch {
  claimYear: number;
  contextYears: number[];
  raw: string;
}

/**
 * Extract years referenced in a temporal claim phrase from the text.
 * Returns only years that appear within a temporal assertion context
 * (e.g., "as of 2019") not just any year mention.
 */
function extractTemporalYears(text: string): number[] {
  const years: number[] = [];
  TEMPORAL_PHRASE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMPORAL_PHRASE_RE.exec(text)) !== null) {
    const year = parseInt(m[1] ?? '0', 10);
    if (year >= 1900 && year <= 2099) years.push(year);
  }
  return [...new Set(years)]; // deduplicate
}

/**
 * Extract all years mentioned anywhere in text (for context scanning).
 */
function extractAllYears(text: string): number[] {
  const years: number[] = [];
  YEAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YEAR_RE.exec(text)) !== null) {
    years.push(parseInt(m[0], 10));
  }
  return [...new Set(years)];
}

/**
 * Check for temporal mismatches between claim and context.
 *
 * Example:
 *   Claim:   "As of 2019, the drug is approved."
 *   Context: "As of 2024, the drug was recalled."
 *   2019 is NOT in context (context only has 2024) → temporal mismatch.
 */
function detectTemporalMismatches(claim: string, context: string[]): TemporalMismatch[] {
  const claimTemporalYears = extractTemporalYears(claim);
  if (claimTemporalYears.length === 0) return []; // no temporal phrases in claim

  const combinedContext = context.join(' ');
  const contextYears = extractAllYears(combinedContext);

  const mismatches: TemporalMismatch[] = [];

  for (const claimYear of claimTemporalYears) {
    // A claim year is grounded if it appears anywhere in context
    const isGrounded = contextYears.includes(claimYear);
    if (!isGrounded) {
      mismatches.push({
        claimYear,
        contextYears,
        raw: `${claimYear}`,
      });
    }
  }

  return mismatches;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Main Rule Export ─────────────────────────────────────────────────────────

export const blockHallucination: Rule = {
  name: 'block_hallucination',
  description:
    'Detects factual claims in agent output that are not supported by provided context ' +
    'documents (RAG hallucination detection). Uses five detection layers: ' +
    '(1) temporal grounding, (2) numeric exact-match + confidence, (3) negation flip, ' +
    '(4) bigram overlap grounding, (5) expanded epistemic claim markers. ' +
    'Academic basis: RAGTruth (ACL 2024), SemEval-2024 Task 7, Temporal Misgrounding (arXiv 2024), ' +
    'Confidence Calibration (arXiv 2024).',

  async check({ result, guardOptions }: RuleContext): Promise<Violation[]> {
    const context = guardOptions.context ?? [];
    if (context.length === 0) return [];

    const text = extractText(result);
    const violations: Violation[] = [];

    // Decompose response into atomic sentences (claim decomposition — RAGTruth approach)
    const sentences = text.split(/[.!?;]+/).map((s) => s.trim()).filter(Boolean);

    for (const sentence of sentences) {
      FACTUAL_CLAIM_RE.lastIndex = 0;
      if (!FACTUAL_CLAIM_RE.test(sentence)) continue;

      // ── Layer 5: Temporal Grounding (confidence 0.90) ──────────────────────
      const temporalMismatches = detectTemporalMismatches(sentence, context);
      if (temporalMismatches.length > 0) {
        const yearList = temporalMismatches.map(m => m.claimYear).join(', ');
        const ctxYears = temporalMismatches[0]!.contextYears.join(', ') || 'none';
        violations.push({
          rule: 'block_hallucination',
          description:
            `Temporal claim references year(s) (${yearList}) not found in context ` +
            `(context years: ${ctxYears}). ` +
            `Claim: "${sentence.slice(0, 100)}${sentence.length > 100 ? '...' : ''}"`,
          evidence: sentence.slice(0, 200),
          severity: 'HIGH',
          confidence: 0.90,
          remediation:
            'Verify date/year references against source documents. ' +
            'Temporal hallucinations are especially dangerous in regulated domains ' +
            '(healthcare, finance, law) where guidelines change annually.',
        });
        if (violations.length >= 3) break;
        continue;
      }

      // ── Layer 1: Numeric Exact-Match (confidence 0.98 — deterministic) ─────
      const { grounded: numsGrounded, ungroundedEntities } =
        allNumericValuesGrounded(sentence, context);

      if (!numsGrounded) {
        const examples = ungroundedEntities.slice(0, 2).map((e) => e.raw).join(', ');
        violations.push({
          rule: 'block_hallucination',
          description:
            `Numeric value(s) in factual claim not found in context: ${examples}. ` +
            `Claim: "${sentence.slice(0, 100)}${sentence.length > 100 ? '...' : ''}"`,
          evidence: sentence.slice(0, 200),
          severity: 'CRITICAL',
          confidence: 0.98,
          remediation:
            'Verify all numeric values (amounts, doses, rates, dates) against source documents. ' +
            'Consider providing richer context documents or using a structured data source.',
        });
        if (violations.length >= 3) break;
        continue;
      }

      // ── Layer 2: Negation Flip (confidence 0.85) ───────────────────────────
      if (hasNegationFlip(sentence, context)) {
        violations.push({
          rule: 'block_hallucination',
          description:
            `Factual claim appears to contradict context via negation: ` +
            `"${sentence.slice(0, 100)}${sentence.length > 100 ? '...' : ''}"`,
          evidence: sentence.slice(0, 200),
          severity: 'HIGH',
          confidence: 0.85,
          remediation:
            'The agent output negates a condition positively stated in the source context. ' +
            'Review context grounding and ensure the agent does not invert requirements.',
        });
        if (violations.length >= 3) break;
        continue;
      }

      // ── Layer 3: Bigram Overlap (confidence = overlap-derived, 0.45–0.75) ──
      const { supported, score } = isClaimSupportedByContext(sentence, context);
      if (!supported) {
        const confidence = Math.round(Math.min(0.75, Math.max(0.45, (1 - score) * 0.75)) * 100) / 100;
        violations.push({
          rule: 'block_hallucination',
          description:
            `Factual claim is not sufficiently grounded in provided context ` +
            `(overlap: ${Math.round(score * 100)}%): ` +
            `"${sentence.slice(0, 120)}${sentence.length > 120 ? '...' : ''}"`,
          evidence: sentence.slice(0, 200),
          severity: 'HIGH',
          confidence,
          remediation:
            'This claim uses terms or concepts not found in the provided context documents. ' +
            'Ensure the agent is constrained to answer only from provided context.',
        });
        if (violations.length >= 3) break;
      }
    }

    return violations;
  },
};
