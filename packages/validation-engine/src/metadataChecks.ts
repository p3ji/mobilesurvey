/**
 * Level 1 (Eurostat) — structural/cell-level checks generated entirely from instrument
 * metadata: no authoring required, because the instrument schema already encodes type, range,
 * code-list membership, and table bounds. See docs/validator-plan.md §5.1.
 *
 * Required/unexpected-answer checks are deliberately NOT here — they need routing/visibility
 * evaluation, which `editRerun.ts` already gets for free from `flattenInstrument`. Duplicating
 * that pass here would mean flattening every response twice.
 */
import { DICHOTOMOUS_CODES, type Instrument } from '@mobilesurvey/instrument-schema';
import { baseName } from './keys.js';
import type { DraftFlag, ValidatorResponse } from './types.js';
import { walkQuestions } from './walkQuestions.js';

type FieldSpec =
  | { kind: 'numeric'; min?: number; max?: number; decimals?: number }
  | { kind: 'code'; codes: Set<string>; multi: boolean; advisory?: boolean }
  | { kind: 'text'; maxLength?: number; pattern?: string }
  | { kind: 'datetime' }
  | { kind: 'boolean' }
  | { kind: 'tableCell'; min?: number; max?: number; decimals?: number; disabled: boolean }
  | { kind: 'gridRow'; codes: Set<string> }
  | { kind: 'markAllCategory' };

/**
 * Builds a registry mapping every answerable field's base name (as it appears after
 * `baseName()`-stripping a stored instance key) to its expected shape, by walking the
 * instrument once. `table`/`grid`/`markAll` questions explode into one entry per generated
 * variable (`{prefix}_{row}_{col}` etc.) exactly the way `runtime-engine`'s flatten does.
 */
export function buildFieldRegistry(instrument: Instrument): Map<string, FieldSpec> {
  const registry = new Map<string, FieldSpec>();
  const schemeById = new Map(instrument.categorySchemes.map((s) => [s.id, s]));

  walkQuestions(instrument, (q) => {
    const rd = q.responseDomain;
    switch (rd.type) {
      case 'numeric':
        registry.set(q.variableRef, { kind: 'numeric', min: rd.min, max: rd.max, decimals: rd.decimals });
        return;
      case 'text':
        registry.set(q.variableRef, { kind: 'text', maxLength: rd.maxLength, pattern: rd.pattern });
        return;
      case 'datetime':
        registry.set(q.variableRef, { kind: 'datetime' });
        return;
      case 'boolean':
        registry.set(q.variableRef, { kind: 'boolean' });
        return;
      case 'file':
        return; // no meaningful structural check on a file placeholder
      case 'code': {
        const codes = new Set((schemeById.get(rd.categorySchemeRef)?.categories ?? []).map((c) => c.code));
        registry.set(q.variableRef, { kind: 'code', codes, multi: rd.selection === 'multiple' });
        return;
      }
      case 'lookup': {
        // Respondent-typed free text matched against a scheme via auto-suggest — advisory
        // (query), not fatal, since a legitimate answer can miss the suggestion list.
        const codes = new Set((schemeById.get(rd.categorySchemeRef)?.categories ?? []).map((c) => c.code));
        registry.set(q.variableRef, { kind: 'code', codes, multi: false, advisory: true });
        return;
      }
      case 'grid': {
        const rowCodes = (schemeById.get(rd.rowSchemeRef)?.categories ?? []).map((c) => c.code);
        const colCodes = new Set((schemeById.get(rd.colSchemeRef)?.categories ?? []).map((c) => c.code));
        for (const rowCode of rowCodes) {
          registry.set(`${rd.variablePrefix}_${rowCode}`, { kind: 'gridRow', codes: colCodes });
        }
        return;
      }
      case 'markAll': {
        const catCodes = (schemeById.get(rd.categorySchemeRef)?.categories ?? []).map((c) => c.code);
        for (const catCode of catCodes) {
          registry.set(`${rd.variablePrefix}_${catCode}`, { kind: 'markAllCategory' });
        }
        return;
      }
      case 'geolocation': {
        // Base variable is the pipeable text summary; the capture's generated sub-variables
        // get typed entries so stored lat/lon/accuracy values are structurally checked.
        registry.set(q.variableRef, { kind: 'text' });
        registry.set(`${q.variableRef}_LAT`, { kind: 'numeric', min: -90, max: 90 });
        registry.set(`${q.variableRef}_LON`, { kind: 'numeric', min: -180, max: 180 });
        registry.set(`${q.variableRef}_ACC`, { kind: 'numeric', min: 0 });
        registry.set(`${q.variableRef}_TS`, { kind: 'datetime' });
        registry.set(`${q.variableRef}_SRC`, {
          kind: 'code',
          codes: new Set(['gps', 'manual', 'declined']),
          multi: false,
        });
        return;
      }
      case 'table': {
        const rowCodes = (schemeById.get(rd.rowSchemeRef)?.categories ?? []).map((c) => c.code);
        const colCodes = (schemeById.get(rd.colSchemeRef)?.categories ?? []).map((c) => c.code);
        const disabled = new Set(rd.disabledCells ?? []);
        for (const rowCode of rowCodes) {
          for (const colCode of colCodes) {
            registry.set(`${rd.variablePrefix}_${rowCode}_${colCode}`, {
              kind: 'tableCell',
              min: rd.min,
              max: rd.max,
              decimals: rd.decimals,
              disabled: disabled.has(`${rowCode}:${colCode}`),
            });
          }
        }
        return;
      }
      default: {
        const exhaustive: never = rd;
        return exhaustive;
      }
    }
  });

  return registry;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

interface RawIssue {
  checkId: string;
  severity: 'fatal' | 'query';
  message: string;
  expected?: string;
  suspicion: number;
}

function checkValue(spec: FieldSpec, value: unknown): RawIssue[] {
  const issues: RawIssue[] = [];
  switch (spec.kind) {
    case 'numeric': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        issues.push({ checkId: 'type', severity: 'fatal', message: `Expected a number, got ${JSON.stringify(value)}.`, suspicion: 1 });
        break;
      }
      if (spec.min !== undefined && n < spec.min) {
        issues.push({ checkId: 'range', severity: 'fatal', message: `Value ${n} is below the minimum ${spec.min}.`, expected: `>= ${spec.min}`, suspicion: 1 });
      }
      if (spec.max !== undefined && n > spec.max) {
        issues.push({ checkId: 'range', severity: 'fatal', message: `Value ${n} is above the maximum ${spec.max}.`, expected: `<= ${spec.max}`, suspicion: 1 });
      }
      if (spec.decimals !== undefined) {
        const factor = 10 ** spec.decimals;
        if (Math.round(n * factor) / factor !== n) {
          issues.push({ checkId: 'precision', severity: 'query', message: `Value ${n} has more decimal places than the allowed ${spec.decimals}.`, suspicion: 0.5 });
        }
      }
      break;
    }
    case 'tableCell': {
      if (spec.disabled) {
        issues.push({ checkId: 'tablebounds', severity: 'fatal', message: 'This cell is disabled and should not have a value.', suspicion: 1 });
        break;
      }
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        issues.push({ checkId: 'type', severity: 'fatal', message: `Expected a number, got ${JSON.stringify(value)}.`, suspicion: 1 });
        break;
      }
      if (spec.min !== undefined && n < spec.min) {
        issues.push({ checkId: 'tablebounds', severity: 'fatal', message: `Value ${n} is below the minimum ${spec.min}.`, expected: `>= ${spec.min}`, suspicion: 1 });
      }
      if (spec.max !== undefined && n > spec.max) {
        issues.push({ checkId: 'tablebounds', severity: 'fatal', message: `Value ${n} is above the maximum ${spec.max}.`, expected: `<= ${spec.max}`, suspicion: 1 });
      }
      break;
    }
    case 'code': {
      const codesToCheck = spec.multi ? (Array.isArray(value) ? value : [value]) : [value];
      for (const c of codesToCheck) {
        if (typeof c !== 'string' || !spec.codes.has(c)) {
          issues.push({
            checkId: 'code',
            severity: spec.advisory ? 'query' : 'fatal',
            message: `"${String(c)}" is not a valid code for this question.`,
            suspicion: spec.advisory ? 0.4 : 1,
          });
        }
      }
      break;
    }
    case 'gridRow': {
      if (typeof value !== 'string' || !spec.codes.has(value)) {
        issues.push({ checkId: 'code', severity: 'fatal', message: `"${String(value)}" is not a valid column code for this row.`, suspicion: 1 });
      }
      break;
    }
    case 'markAllCategory': {
      const valid = new Set(Object.values(DICHOTOMOUS_CODES) as number[]);
      if (typeof value !== 'number' || !valid.has(value)) {
        issues.push({ checkId: 'code', severity: 'fatal', message: `${JSON.stringify(value)} is not a valid dichotomous code.`, suspicion: 1 });
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        issues.push({ checkId: 'type', severity: 'fatal', message: `Expected true/false, got ${JSON.stringify(value)}.`, suspicion: 1 });
      }
      break;
    }
    case 'text': {
      if (typeof value !== 'string') {
        issues.push({ checkId: 'type', severity: 'query', message: `Expected text, got ${JSON.stringify(value)}.`, suspicion: 0.6 });
        break;
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        issues.push({ checkId: 'range', severity: 'query', message: `Text exceeds the maximum length of ${spec.maxLength}.`, suspicion: 0.5 });
      }
      if (spec.pattern) {
        try {
          if (!new RegExp(spec.pattern).test(value)) {
            issues.push({ checkId: 'pattern', severity: 'query', message: 'Text does not match the expected pattern.', suspicion: 0.5 });
          }
        } catch {
          // Malformed pattern was authored upstream — not the response's fault; ignore.
        }
      }
      break;
    }
    case 'datetime': {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        issues.push({ checkId: 'type', severity: 'fatal', message: `"${String(value)}" is not a valid date/time.`, suspicion: 1 });
      }
      break;
    }
    default: {
      const exhaustive: never = spec;
      return exhaustive;
    }
  }
  return issues;
}

/**
 * Runs every L1 check for one response. Pass a pre-built `registry` when validating many
 * responses against the same instrument to avoid rebuilding it per response.
 */
export function runMetadataChecks(
  instrument: Instrument,
  response: ValidatorResponse,
  registry: Map<string, FieldSpec> = buildFieldRegistry(instrument),
): DraftFlag[] {
  const knownVariableNames = new Set(instrument.variables.map((v) => v.name));
  const flags: DraftFlag[] = [];

  for (const [key, value] of Object.entries(response.answers)) {
    if (isBlank(value)) continue; // presence/required is routing-aware -- handled by editRerun.ts
    const name = baseName(key);
    const spec = registry.get(name);
    if (!spec) {
      if (!knownVariableNames.has(name)) {
        flags.push({
          responseId: response.id,
          respondentId: response.respondentId,
          variableName: name,
          instanceKey: key,
          checkKind: 'metadata',
          checkId: 'orphan',
          severity: 'query',
          message: `"${key}" does not correspond to any variable in this instrument.`,
          observed: value,
          suspicion: 0.3,
        });
      }
      continue;
    }
    for (const issue of checkValue(spec, value)) {
      flags.push({
        responseId: response.id,
        respondentId: response.respondentId,
        variableName: name,
        instanceKey: key,
        checkKind: 'metadata',
        checkId: `${issue.checkId}:${name}`,
        severity: issue.severity,
        message: issue.message,
        expected: issue.expected,
        observed: value,
        suspicion: issue.suspicion,
      });
    }
  }
  return flags;
}
