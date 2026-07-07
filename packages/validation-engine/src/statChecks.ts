/**
 * Level 3 (Eurostat) — within-dataset statistical checks: robust univariate outliers,
 * duplicate submissions, straight-lining, speeders, and item-nonresponse (missingness).
 * See docs/validator-plan.md §5.3.
 */
import { instanceKey } from '@mobilesurvey/runtime-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { baseName } from './keys.js';
import type { DraftFlag, MissingnessEntry, ValidatorResponse } from './types.js';
import { walkQuestions } from './walkQuestions.js';

function toFiniteNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

// ── Outliers (Modified Z-Score via MAD) ──────────────────────────────────────

interface NumericObservation {
  responseId: string;
  respondentId: string;
  instanceKey: string;
  value: number;
}

function collectNumericObservations(responses: ValidatorResponse[]): Map<string, NumericObservation[]> {
  const byVar = new Map<string, NumericObservation[]>();
  for (const r of responses) {
    for (const [key, v] of Object.entries(r.answers)) {
      const n = toFiniteNumber(v);
      if (!Number.isFinite(n)) continue;
      const name = baseName(key);
      let arr = byVar.get(name);
      if (!arr) {
        arr = [];
        byVar.set(name, arr);
      }
      arr.push({ responseId: r.id, respondentId: r.respondentId, instanceKey: key, value: n });
    }
  }
  return byVar;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/**
 * Modified z-score via MAD (median absolute deviation) — robust to the heavy tails typical of
 * establishment data, unlike a stddev-based z-score which gets masked by the very outliers it
 * hunts for. 0.6745 is the constant that makes MAD a consistent estimator of stddev under
 * normality (Iglewicz & Hoaglin's standard choice).
 */
function modifiedZScores(values: number[]): number[] {
  const m = median(values);
  const absDevs = values.map((v) => Math.abs(v - m));
  const mad = median(absDevs);
  if (mad === 0) return values.map(() => 0);
  return values.map((v) => (0.6745 * (v - m)) / mad);
}

export function runOutlierChecks(
  responses: ValidatorResponse[],
  threshold: number,
  minObservations: number,
): { flags: DraftFlag[]; skipped: { checkId: string; reason: string }[] } {
  const byVar = collectNumericObservations(responses);
  const flags: DraftFlag[] = [];
  const skipped: { checkId: string; reason: string }[] = [];

  for (const [name, obs] of byVar) {
    if (obs.length < minObservations) {
      skipped.push({ checkId: `mad:${name}`, reason: `only ${obs.length} observed values (< ${minObservations})` });
      continue;
    }
    const zs = modifiedZScores(obs.map((o) => o.value));
    obs.forEach((o, i) => {
      const z = zs[i]!;
      if (Math.abs(z) <= threshold) return;
      const suspicion = Math.min(1, 0.5 + (Math.abs(z) - threshold) / (threshold * 2));
      flags.push({
        responseId: o.responseId,
        respondentId: o.respondentId,
        variableName: name,
        instanceKey: o.instanceKey,
        checkKind: 'stat',
        checkId: `mad:${name}`,
        severity: 'query',
        message: `Value ${o.value} is a statistical outlier for "${name}" (modified z-score ${z.toFixed(1)}).`,
        expected: `within ~${threshold} MAD of the median`,
        observed: o.value,
        suspicion,
      });
    });
  }
  return { flags, skipped };
}

// ── Duplicates ────────────────────────────────────────────────────────────────

export function runDuplicateChecks(responses: ValidatorResponse[]): DraftFlag[] {
  const flags: DraftFlag[] = [];

  const hashToResponses = new Map<string, ValidatorResponse[]>();
  for (const r of responses) {
    const hash = JSON.stringify(Object.entries(r.answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    let arr = hashToResponses.get(hash);
    if (!arr) {
      arr = [];
      hashToResponses.set(hash, arr);
    }
    arr.push(r);
  }
  for (const group of hashToResponses.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      flags.push({
        responseId: r.id,
        respondentId: r.respondentId,
        variableName: null,
        instanceKey: null,
        checkKind: 'stat',
        checkId: 'duplicate-exact',
        severity: 'query',
        message: `This response is identical to ${group.length - 1} other response(s).`,
        observed: undefined,
        suspicion: 0.7,
      });
    }
  }

  const byRespondent = new Map<string, ValidatorResponse[]>();
  for (const r of responses) {
    if (!r.completed) continue;
    let arr = byRespondent.get(r.respondentId);
    if (!arr) {
      arr = [];
      byRespondent.set(r.respondentId, arr);
    }
    arr.push(r);
  }
  for (const [respondentId, group] of byRespondent) {
    if (group.length < 2) continue;
    for (const r of group) {
      flags.push({
        responseId: r.id,
        respondentId,
        variableName: null,
        instanceKey: null,
        checkKind: 'stat',
        checkId: 'duplicate-respondent',
        severity: 'query',
        message: `This respondent has ${group.length} completed responses to this survey.`,
        observed: undefined,
        suspicion: 0.7,
      });
    }
  }

  return flags;
}

// ── Speeders (paradata-adjacent, but derived from duration_ms on the response itself) ────────

export function runSpeederChecks(
  responses: ValidatorResponse[],
  speederMs: number,
): { flags: DraftFlag[]; skipped: { checkId: string; reason: string }[] } {
  const completedDurations = responses
    .filter((r) => r.completed && r.durationMs !== null)
    .map((r) => r.durationMs!);

  if (completedDurations.length === 0) {
    return { flags: [], skipped: [{ checkId: 'speeder', reason: 'no completed responses with a recorded duration' }] };
  }

  // Effective threshold = max(configured floor, dataset's own 5th percentile) once there are
  // enough completed responses to make a percentile meaningful.
  let threshold = speederMs;
  if (completedDurations.length >= 10) {
    const sorted = [...completedDurations].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)]!;
    threshold = Math.max(speederMs, p5);
  }

  const flags: DraftFlag[] = [];
  for (const r of responses) {
    if (!r.completed || r.durationMs === null || r.durationMs >= threshold) continue;
    flags.push({
      responseId: r.id,
      respondentId: r.respondentId,
      variableName: null,
      instanceKey: null,
      checkKind: 'stat',
      checkId: 'speeder',
      severity: 'query',
      message: `Completed in ${(r.durationMs / 1000).toFixed(0)}s, faster than the ${(threshold / 1000).toFixed(0)}s threshold.`,
      observed: r.durationMs,
      suspicion: 0.7,
    });
  }
  return { flags, skipped: [] };
}

// ── Straight-lining (grid questions only — every row answered identically) ───────────────────

function collectGridQuestions(instrument: Instrument): { variablePrefix: string; rowCodes: string[] }[] {
  const schemeById = new Map(instrument.categorySchemes.map((s) => [s.id, s]));
  const out: { variablePrefix: string; rowCodes: string[] }[] = [];
  walkQuestions(instrument, (q) => {
    if (q.responseDomain.type !== 'grid') return;
    const rd = q.responseDomain;
    const rowCodes = (schemeById.get(rd.rowSchemeRef)?.categories ?? []).map((c) => c.code);
    out.push({ variablePrefix: rd.variablePrefix, rowCodes });
  });
  return out;
}

export function runStraightLineChecks(instrument: Instrument, responses: ValidatorResponse[]): DraftFlag[] {
  const gridQuestions = collectGridQuestions(instrument);
  if (gridQuestions.length === 0) return [];

  const flags: DraftFlag[] = [];
  for (const r of responses) {
    for (const { variablePrefix, rowCodes } of gridQuestions) {
      if (rowCodes.length < 3) continue; // not enough rows for "straight-lining" to be meaningful
      const values = rowCodes.map((code) => r.answers[instanceKey(`${variablePrefix}_${code}`, [])]);
      if (values.some((v) => v === undefined || v === null || v === '')) continue; // only flag fully-answered grids
      if (!values.every((v) => v === values[0])) continue;
      flags.push({
        responseId: r.id,
        respondentId: r.respondentId,
        variableName: variablePrefix,
        instanceKey: null,
        checkKind: 'stat',
        checkId: `straight-line:${variablePrefix}`,
        severity: 'query',
        message: `Every row of this grid question has the identical answer ("${String(values[0])}").`,
        observed: values[0],
        suspicion: 0.6,
      });
    }
  }
  return flags;
}

// ── Missingness (variable-level, informational — see MissingnessEntry) ───────────────────────

export function computeMissingness(
  instrument: Instrument,
  responses: ValidatorResponse[],
  flagThreshold = 0.5,
): MissingnessEntry[] {
  if (responses.length === 0) return [];

  const scalarVars: string[] = [];
  walkQuestions(instrument, (q, inLoop) => {
    // Rostered variables need a per-iteration denominator (roster count varies per response) —
    // out of scope for this simple dataset-level rate; restrict to top-level scalar questions.
    if (inLoop) return;
    if (['numeric', 'text', 'datetime', 'boolean', 'code', 'lookup'].includes(q.responseDomain.type)) {
      scalarVars.push(q.variableRef);
    }
  });

  const total = responses.length;
  const entries: MissingnessEntry[] = [];
  for (const name of scalarVars) {
    const rootKey = instanceKey(name, []);
    let observed = 0;
    for (const r of responses) {
      const v = r.answers[rootKey];
      if (v !== undefined && v !== null && v !== '') observed += 1;
    }
    const rate = observed / total;
    if (1 - rate >= flagThreshold) {
      entries.push({ variableName: name, observedRate: rate, totalResponses: total });
    }
  }
  return entries;
}
