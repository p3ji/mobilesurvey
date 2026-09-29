/**
 * Level 4 (Eurostat, V2) — cross-source confrontation against a user-uploaded reference
 * dataset. See docs/validator-plan.md §5.4 for the design and the entity-resolution scoping
 * decision (exact-match join on a user-supplied key only; no fuzzy linkage).
 */
import { buildSyntheticTotals, instanceKey, makeContext } from '@mobilesurvey/runtime-engine';
import { evaluateSource, type EvalContext } from '@mobilesurvey/expression-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import type {
  ConfrontationGap,
  ConfrontationMapping,
  DraftFlag,
  ReferenceDataset,
  ValidatorResponse,
} from './types.js';

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/** Passes if within EITHER tolerance when both are set; exact match when neither is set. */
function withinTolerance(a: number, b: number, pct?: number, abs?: number): boolean {
  if (pct === undefined && abs === undefined) return a === b;
  const diff = Math.abs(a - b);
  const passPct = pct !== undefined && b !== 0 && diff / Math.abs(b) <= pct;
  const passAbs = abs !== undefined && diff <= abs;
  return passPct || passAbs;
}

function toleranceLabel(mapping: ConfrontationMapping): string {
  const parts: string[] = [];
  if (mapping.tolerancePct !== undefined) parts.push(`±${(mapping.tolerancePct * 100).toFixed(0)}%`);
  if (mapping.toleranceAbs !== undefined) parts.push(`±${mapping.toleranceAbs}`);
  return parts.join(' or ');
}

function refContext(rawRef: unknown): EvalContext {
  return { resolve: (name) => (name === 'ref' ? rawRef : undefined) };
}

export function runConfrontationChecks(
  instrument: Instrument,
  responses: ValidatorResponse[],
  dataset: ReferenceDataset,
  mappings: ConfrontationMapping[],
): { flags: DraftFlag[]; gaps: ConfrontationGap[] } {
  const synthetic = buildSyntheticTotals(instrument);
  const refByKey = new Map<string, Record<string, unknown>>();
  for (const row of dataset.rows) {
    const k = row[dataset.keyColumn];
    if (k !== undefined && k !== null && k !== '') refByKey.set(String(k), row);
  }

  const matchedKeys = new Set<string>();
  const flags: DraftFlag[] = [];
  const gaps: ConfrontationGap[] = [];
  const keyIKey = instanceKey(dataset.keyVariable, []);

  for (const r of responses) {
    const keyValueRaw = r.answers[keyIKey];
    if (keyValueRaw === undefined || keyValueRaw === null || keyValueRaw === '') continue; // no key -> not this check's job
    const keyValue = String(keyValueRaw);
    const refRow = refByKey.get(keyValue);
    if (!refRow) {
      flags.push({
        responseId: r.id,
        respondentId: r.respondentId,
        variableName: dataset.keyVariable,
        instanceKey: keyIKey,
        checkKind: 'confront',
        checkId: `confront-unmatched:${dataset.id}`,
        severity: 'query',
        message: `No matching row found in reference dataset "${dataset.name}" for key "${keyValue}".`,
        observed: keyValue,
        suspicion: 0.4,
      });
      continue;
    }
    matchedKeys.add(keyValue);

    const ctx = makeContext(instrument, r.answers, {}, [], synthetic);
    for (const mapping of mappings) {
      let surveyValue: number;
      try {
        surveyValue = toNum(evaluateSource(mapping.surveyExpr, ctx));
      } catch {
        continue; // malformed mapping expression -- author's responsibility, gated at save-time
      }
      if (!Number.isFinite(surveyValue)) continue;

      const rawRef = refRow[mapping.refColumn];
      let refValue = toNum(rawRef);
      if (mapping.transform) {
        try {
          refValue = toNum(evaluateSource(mapping.transform, refContext(rawRef)));
        } catch {
          continue;
        }
      }
      if (!Number.isFinite(refValue)) continue;

      if (withinTolerance(surveyValue, refValue, mapping.tolerancePct, mapping.toleranceAbs)) continue;

      const tol = toleranceLabel(mapping);
      const suspicion = Math.min(1, 0.5 + Math.abs(surveyValue - refValue) / (Math.abs(refValue) || 1));
      flags.push({
        responseId: r.id,
        respondentId: r.respondentId,
        variableName: mapping.surveyExpr,
        instanceKey: null,
        checkKind: 'confront',
        checkId: `confront:${mapping.id}`,
        severity: mapping.severity,
        message: `${mapping.label}: survey value ${surveyValue} does not match reference value ${refValue}${tol ? ` (tolerance ${tol})` : ''}.`,
        expected: `ref: ${refValue}${tol ? ` ${tol}` : ''}`,
        observed: surveyValue,
        suspicion,
      });
    }
  }

  for (const keyValue of refByKey.keys()) {
    if (!matchedKeys.has(keyValue)) gaps.push({ direction: 'reference-only', datasetId: dataset.id, keyValue });
  }

  return { flags, gaps };
}
