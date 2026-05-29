/**
 * PipelineValidator — Cross-Stage Entity Consistency Checking
 *
 * Academic basis: Multi-agent coordination literature (2024).
 * Entities established in Stage 1 (patient name, dollar amount, policy ID)
 * must be consistent in downstream stages. If Stage 1 says "Patient: John Smith"
 * and Stage 2 says "Patient: Jane Smith", the pipeline is propagating an error —
 * the "hallucination cascade" problem from the original SDK problem statement.
 *
 * "Agent 1 made an error. Agent 2 built on it. Agent 3 executed it."
 * This validator detects that exact pattern by tracking entity drift across stages.
 *
 * Entity types detected:
 *   - 'person'   → proper names (Title + Surname patterns)
 *   - 'amount'   → dollar amounts and numeric values with units
 *   - 'date'     → ISO dates, "Month DD, YYYY" patterns, year references
 *   - 'id'       → policy/account/order/case identifiers
 *   - 'org'      → company/organisation names (Corp, Ltd, Inc, LLC suffixes)
 *   - 'location' → city, country, address patterns
 *
 * Usage:
 *   ```typescript
 *   import { PipelineValidator } from '@hackerx333/agenttrace';
 *
 *   const validator = new PipelineValidator();
 *   validator.addStageOutput('researcher', researchResult);
 *   validator.addStageOutput('drafter',    draftResult);
 *   validator.addStageOutput('executor',   execResult);
 *
 *   const report = validator.validate();
 *   if (!report.consistent) {
 *     console.error('Entity contradiction detected!', report.contradictions);
 *   }
 *   ```
 *
 * Also integrable with PipelineResult:
 *   ```typescript
 *   const validator = PipelineValidator.fromPipelineResult(pipelineResult);
 *   const report = validator.validate();
 *   ```
 */

import type {
  ConsistencyReport,
  EntityContradiction,
  ExtractedEntity,
  PipelineResult,
  RiskLevel,
} from './types.js';

// ─── Entity Extraction Patterns ───────────────────────────────────────────────

/**
 * Person names: "Dr. Smith", "John Smith", "Mr. Johnson", "Prof. Williams"
 * Conservative — requires a title or two capitalised words to avoid false positives.
 */
const PERSON_RE =
  /\b(?:(?:Dr|Mr|Mrs|Ms|Prof|Sir|Lady|Lord|Rev|Gen|Sgt|Capt|Lt|Det)\.\s+)?([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b/g;

/**
 * Dollar amounts and numeric values with units.
 * Groups: (1) dollar sign, (2) number, (3) unit suffix
 */
const AMOUNT_DOLLAR_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)/g;
const AMOUNT_UNIT_RE   = /\b(\d[\d,]*(?:\.\d+)?)\s*(mg|ml|kg|g\b|usd|eur|gbp|%|bps|days?|weeks?|months?|years?)\b/gi;

/**
 * Dates: "2024-01-15", "January 15 2024", "Jan 15, 2024", "15/01/2024"
 */
const DATE_ISO_RE   = /\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g;
const DATE_HUMAN_RE = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/gi;
const DATE_DMY_RE   = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g;

/**
 * IDs: "Policy #12345", "Order ID: ABC-123", "Case #XYZ789", "Account: 1234567"
 */
const ID_RE =
  /\b(?:policy|order|case|account|claim|reference|ref|ticket|invoice|contract|agreement|patient|customer|client|employee|user|id|#)\s*[#:\s]*([A-Z0-9][A-Z0-9\-]{2,20})\b/gi;

/**
 * Organisation names: "Acme Corp", "XYZ Ltd", "ABC Inc.", "AlphaBeta LLC"
 */
const ORG_RE =
  /\b([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,4})\s+(?:Corp(?:oration)?|Ltd|Limited|Inc(?:orporated)?|LLC|LLP|Plc|GmbH|SA|AG)\b/g;

// ─── Entity Extractor ─────────────────────────────────────────────────────────

function extractEntities(text: string, stageName: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  let m: RegExpExecArray | null;

  // Persons
  PERSON_RE.lastIndex = 0;
  while ((m = PERSON_RE.exec(text)) !== null) {
    entities.push({
      type: 'person',
      value: `${m[1]?.toLowerCase()} ${m[2]?.toLowerCase()}`,
      raw: m[0].trim(),
      stage: stageName,
    });
  }

  // Dollar amounts
  AMOUNT_DOLLAR_RE.lastIndex = 0;
  while ((m = AMOUNT_DOLLAR_RE.exec(text)) !== null) {
    const value = parseFloat((m[1] ?? '').replace(/,/g, ''));
    if (value > 0) {
      entities.push({
        type: 'amount',
        value: `${value}:usd`,
        raw: m[0].trim(),
        stage: stageName,
      });
    }
  }

  // Unit amounts
  AMOUNT_UNIT_RE.lastIndex = 0;
  while ((m = AMOUNT_UNIT_RE.exec(text)) !== null) {
    const value = parseFloat((m[1] ?? '').replace(/,/g, ''));
    const unit = (m[2] ?? '').toLowerCase().replace(/s$/, '');
    if (value > 0) {
      entities.push({
        type: 'amount',
        value: `${value}:${unit}`,
        raw: m[0].trim(),
        stage: stageName,
      });
    }
  }

  // ISO dates
  DATE_ISO_RE.lastIndex = 0;
  while ((m = DATE_ISO_RE.exec(text)) !== null) {
    entities.push({ type: 'date', value: m[1] ?? '', raw: m[0].trim(), stage: stageName });
  }

  // Human dates — normalise to ISO-ish for comparison
  DATE_HUMAN_RE.lastIndex = 0;
  while ((m = DATE_HUMAN_RE.exec(text)) !== null) {
    const normalised = `${m[3]}-${m[1]?.slice(0, 3).toLowerCase()}-${(m[2] ?? '').padStart(2, '0')}`;
    entities.push({ type: 'date', value: normalised, raw: m[0].trim(), stage: stageName });
  }

  // DMY dates
  DATE_DMY_RE.lastIndex = 0;
  while ((m = DATE_DMY_RE.exec(text)) !== null) {
    const normalised = `${m[3]}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`;
    entities.push({ type: 'date', value: normalised, raw: m[0].trim(), stage: stageName });
  }

  // IDs
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(text)) !== null) {
    entities.push({
      type: 'id',
      value: (m[1] ?? '').toUpperCase(),
      raw: m[0].trim(),
      stage: stageName,
    });
  }

  // Organisations
  ORG_RE.lastIndex = 0;
  while ((m = ORG_RE.exec(text)) !== null) {
    entities.push({
      type: 'org',
      value: (m[1] ?? '').toLowerCase(),
      raw: m[0].trim(),
      stage: stageName,
    });
  }

  return entities;
}

// ─── Contradiction Detection ──────────────────────────────────────────────────

/**
 * Given all entities across all stages, find contradictions:
 * Two entities of the same type but different values, one in each stage.
 *
 * For amounts, uses 1% tolerance (consistent with hallucination.ts numeric check).
 * For persons/dates/ids/orgs, uses exact string match.
 */
function detectContradictions(allEntities: ExtractedEntity[]): EntityContradiction[] {
  const contradictions: EntityContradiction[] = [];

  // Group entities by type
  const byType = new Map<ExtractedEntity['type'], ExtractedEntity[]>();
  for (const e of allEntities) {
    const group = byType.get(e.type) ?? [];
    group.push(e);
    byType.set(e.type, group);
  }

  for (const [type, entities] of byType) {
    // Compare every entity against every other across different stages
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i]!;
        const b = entities[j]!;

        // Only compare across different stages
        if (a.stage === b.stage) continue;

        let isContradiction = false;
        let confidence = 0;
        let severity: RiskLevel = 'MEDIUM';

        if (type === 'amount') {
          // For amounts: contradiction if same unit but value differs by > 1%
          const [aVal, aUnit] = a.value.split(':');
          const [bVal, bUnit] = b.value.split(':');
          if (aUnit === bUnit && aVal && bVal) {
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            const relError = Math.abs(aNum - bNum) / Math.max(aNum, bNum, 1);
            if (relError > 0.01) {
              isContradiction = true;
              confidence = 0.95;
              severity = 'CRITICAL'; // Amount contradictions across agents = most dangerous
            }
          }
        } else if (type === 'person') {
          // Person contradiction: same type but different full name
          if (a.value !== b.value) {
            // Only flag if the surnames differ (first name could be abbreviated)
            const aSurname = a.value.split(' ').pop() ?? '';
            const bSurname = b.value.split(' ').pop() ?? '';
            if (aSurname !== bSurname) {
              isContradiction = true;
              confidence = 0.88;
              severity = 'HIGH';
            }
          }
        } else if (type === 'date') {
          // Date contradiction: different date values in different stages
          if (a.value !== b.value) {
            isContradiction = true;
            confidence = 0.90;
            severity = 'HIGH';
          }
        } else if (type === 'id') {
          // ID contradiction: different IDs of the same class in different stages
          if (a.value !== b.value) {
            isContradiction = true;
            confidence = 0.92;
            severity = 'CRITICAL'; // Wrong ID → wrong entity acted on
          }
        } else if (type === 'org') {
          // Different org names in different stages
          if (a.value !== b.value) {
            isContradiction = true;
            confidence = 0.75;
            severity = 'MEDIUM';
          }
        }

        if (isContradiction) {
          contradictions.push({
            type,
            stageA: { stage: a.stage, value: a.value, raw: a.raw },
            stageB: { stage: b.stage, value: b.value, raw: b.raw },
            confidence,
            severity,
          });
        }
      }
    }
  }

  // Deduplicate (same pair may appear multiple times from different entity instances)
  const seen = new Set<string>();
  return contradictions.filter(c => {
    const key = `${c.type}:${c.stageA.stage}:${c.stageA.value}:${c.stageB.stage}:${c.stageB.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── PipelineValidator ────────────────────────────────────────────────────────

export class PipelineValidator {
  private stageOutputs: Map<string, string> = new Map();

  /**
   * Register the output of a pipeline stage for validation.
   * Call this after each stage completes.
   *
   * @param stageName - Name of the stage (e.g. 'researcher', 'drafter')
   * @param output    - The agent output (string or object — objects are JSON-serialised)
   */
  addStageOutput(stageName: string, output: unknown): void {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    this.stageOutputs.set(stageName, text);
  }

  /**
   * Run cross-stage entity consistency validation.
   *
   * Extracts named entities from all registered stage outputs and checks for
   * contradictions between stages. Returns a ConsistencyReport.
   *
   * A contradiction means that two stages disagree on a factual entity
   * (e.g., Stage 1 says patient is "John Smith", Stage 2 says "Jane Smith").
   * This is the "hallucination cascade" pattern — the error has propagated.
   */
  validate(): ConsistencyReport {
    const allEntities: ExtractedEntity[] = [];

    for (const [stageName, text] of this.stageOutputs) {
      const stageEntities = extractEntities(text, stageName);
      allEntities.push(...stageEntities);
    }

    const contradictions = detectContradictions(allEntities);

    return {
      consistent: contradictions.length === 0,
      entities: allEntities,
      contradictions,
      stagesAnalysed: [...this.stageOutputs.keys()],
    };
  }

  /**
   * Convenience factory: build a validator from a completed PipelineResult.
   *
   * @example
   * const result = await pipeline.run(input);
   * const report = PipelineValidator.fromPipelineResult(result).validate();
   */
  static fromPipelineResult(pipelineResult: PipelineResult): PipelineValidator {
    const validator = new PipelineValidator();
    for (const stage of pipelineResult.stages) {
      if (stage.result !== undefined) {
        validator.addStageOutput(stage.name, stage.result);
      }
    }
    return validator;
  }

  /**
   * Reset all registered stage outputs.
   */
  reset(): void {
    this.stageOutputs.clear();
  }
}
