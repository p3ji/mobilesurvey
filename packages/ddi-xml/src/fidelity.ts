/**
 * Fidelity reporting for DDI-XML import.
 *
 * The client's gating requirement is "import 10 real DDI instruments and show nothing breaks." A
 * silent best-effort import is not enough — every approximation or dropped element must be visible,
 * so "nothing breaks" is a *measured* claim. Every import therefore returns a list of notes.
 */

/**
 * - `info`        — recognized and mapped cleanly.
 * - `approximated` — mapped, but with a documented loss of nuance.
 * - `dropped`      — an element/attribute we did not recognize and did not carry over.
 * - `error`        — the result is not a valid instrument (shape or referential-integrity failure).
 */
export type FidelityLevel = 'info' | 'approximated' | 'dropped' | 'error';

export interface FidelityNote {
  level: FidelityLevel;
  /** Location in the source document, e.g. `Instrument > Variables > Variable[2]`. */
  path: string;
  message: string;
}

export interface ImportResult {
  /** True only when the imported document is a schema-valid, referentially-sound instrument. */
  ok: boolean;
  /** Best-effort instrument, even when `ok` is false (so the report can point at what's wrong). */
  instrument: import('@mobilesurvey/instrument-schema').Instrument | null;
  notes: FidelityNote[];
}

/** Convenience: true when no `dropped`/`error` notes are present (i.e. a fully faithful import). */
export function isFaithful(notes: FidelityNote[]): boolean {
  return !notes.some((n) => n.level === 'dropped' || n.level === 'error');
}
