/** PII redaction utilities for response data export and display. */
import type { Instrument } from './types.js';

export const PII_PLACEHOLDER = '[REDACTED]';

/**
 * Returns a copy of `responses` with values for PII-tagged variables replaced by
 * `'[REDACTED]'`. Response keys follow the runtime convention `varName@` (simple) or
 * `varName@loopName.index` (roster), so the part before the first `@` is the variable name.
 *
 * Non-PII keys and keys that don't match any variable pass through unchanged.
 */
export function redactResponses(
  responses: Record<string, unknown>,
  instrument: Instrument,
): Record<string, unknown> {
  const piiNames = new Set(
    instrument.variables.filter((v) => v.isPII).map((v) => v.name),
  );
  if (piiNames.size === 0) return { ...responses };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responses)) {
    const varName = key.includes('@') ? key.slice(0, key.indexOf('@')) : key;
    result[key] = piiNames.has(varName) ? PII_PLACEHOLDER : value;
  }
  return result;
}

/** Returns the set of variable names in the instrument that are PII-tagged. */
export function piiVariableNames(instrument: Instrument): Set<string> {
  return new Set(instrument.variables.filter((v) => v.isPII).map((v) => v.name));
}
