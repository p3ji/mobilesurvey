/**
 * Roster-aware variable resolution. A variable answered inside nested loops is stored under an
 * instance key encoding the loop path (`employerName@m=1;e=2`). Resolving a reference from a
 * given scope walks outward through ancestor scopes, so inner questions can read outer answers.
 */
import { evaluate, parse, type EvalContext } from '@mobilesurvey/expression-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import type { Scope } from './types.js';

export function scopeKey(scope: Scope): string {
  return scope.map((s) => `${s.name}=${s.index}`).join(';');
}

/** Storage key for a variable at a given scope, e.g. `memberName@m=1`. */
export function instanceKey(name: string, scope: Scope): string {
  return `${name}@${scopeKey(scope)}`;
}

/**
 * Synthetic table totals: names like `SALES_TOT_val` that are never stored, but resolve on
 * read as the sum of their contributing cell variable names. Registered by `flattenInstrument`
 * from `table` response domains, so any expression (edits, routing, piping) can reference a
 * table total regardless of document order.
 */
export interface SyntheticTotal {
  /** Base (unscoped) names of the input cells this total sums. */
  cellNames: string[];
}
export type SyntheticTotals = Map<string, SyntheticTotal>;

/**
 * Build an {@link EvalContext} for evaluating expressions/piping at a scope. Resolution order:
 * loop index → stored answer at this/ancestor scope → synthetic table total → derived variable
 * (lazy compute) → sample.
 */
export function makeContext(
  instrument: Instrument,
  responses: Record<string, unknown>,
  sample: Record<string, unknown>,
  scope: Scope,
  synthetic?: SyntheticTotals,
): EvalContext {
  const inProgress = new Set<string>();

  const resolve = (name: string): unknown => {
    // 1. Loop index variable in the current scope.
    const loop = scope.find((s) => s.name === name);
    if (loop) return loop.index;

    // 2. Stored answer at this scope or any ancestor (longest match first).
    for (let k = scope.length; k >= 0; k--) {
      const key = instanceKey(name, scope.slice(0, k));
      if (Object.prototype.hasOwnProperty.call(responses, key)) return responses[key];
    }

    // 2b. Synthetic table total — sum of contributing cells, computed on read.
    //     All-blank contributors yield undefined so `isAnswered()` reports unanswered.
    const syn = synthetic?.get(name);
    if (syn && !inProgress.has(name)) {
      inProgress.add(name);
      try {
        let any = false;
        let total = 0;
        for (const cell of syn.cellNames) {
          const v = resolve(cell);
          if (v === undefined || v === null || v === '') continue;
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) {
            any = true;
            total += n;
          }
        }
        return any ? total : undefined;
      } finally {
        inProgress.delete(name);
      }
    }

    // 3. Derived variable — compute lazily (guarded against cycles).
    const variable = instrument.variables.find((v) => v.name === name);
    if (variable?.kind === 'derived' && variable.compute && !inProgress.has(name)) {
      inProgress.add(name);
      try {
        return evaluate(parse(variable.compute), { resolve });
      } catch {
        return undefined;
      } finally {
        inProgress.delete(name);
      }
    }

    // 4. Raw sample field (pre-fill fallback).
    if (Object.prototype.hasOwnProperty.call(sample, name)) return sample[name];
    return undefined;
  };

  return { resolve };
}

/** Seed root-scoped responses from pre-fill mappings against a sample profile. */
export function seedPrefill(
  instrument: Instrument,
  sample: Record<string, unknown>,
): Record<string, unknown> {
  const seeded: Record<string, unknown> = {};
  for (const mapping of instrument.prefillMappings) {
    if (Object.prototype.hasOwnProperty.call(sample, mapping.sampleField)) {
      seeded[instanceKey(mapping.targetVariable, [])] = sample[mapping.sampleField];
    }
  }
  return seeded;
}
