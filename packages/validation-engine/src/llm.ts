/**
 * Level 5 (V3) — LLM assistance building blocks. See docs/validator-plan.md §8.3. Deliberately
 * pure and network-free (consistent with this package's "no IO" design — see run.ts's
 * docstring): prompt construction and response validation live here; the actual HTTP call to a
 * model provider is the hub's responsibility (apps/hub/src/validatorLlm.ts), which is also where
 * the "feature hidden without a configured key" gate lives.
 *
 * Every candidate rule a model proposes is compile-gated and variable-checked before it is ever
 * shown to an analyst — a malformed or hallucinated draft is dropped silently, never surfaced.
 * This is what makes it safe to let a model draft *executable* expressions: the worst case is an
 * empty result, never a broken or unreviewable one.
 */
import { compile, variablesUsed } from '@mobilesurvey/expression-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import type { Severity, ValidationFlag } from './types.js';

export interface LlmRuleDraftCandidate {
  when: string;
  message: string;
  severity: Severity;
}

/**
 * Prompt for annotation -> rule drafting (docs/validator-plan.md §8.3.1). Includes the
 * expression grammar so the model's output is reviewable, compile-gated text, not opaque model
 * behavior — the same "one rule language everywhere" principle as the rest of the Validator.
 */
export function buildRuleDraftPrompt(params: {
  variableName: string;
  annotationNote: string;
  /** Recent observed values for this variable — caller must redact PII before passing these in. */
  observedSamples: unknown[];
}): string {
  const samples = params.observedSamples.slice(0, 20).map((v) => JSON.stringify(v)).join(', ');
  return [
    `You are drafting a data-validation rule for the survey variable "$${params.variableName}".`,
    `An analyst wrote this domain note about it: "${params.annotationNote}"`,
    `Recent observed values: ${samples || '(none available)'}`,
    '',
    'Write 1-3 candidate rules as a JSON array of objects: {"when": string, "message": string, "severity": "fatal"|"query"}.',
    '`when` must be a boolean expression in this grammar: variables as $name, numeric/string/boolean',
    'literals, arithmetic (+ - * /), comparisons (< <= > >= == !=), boolean (&& || !), and these',
    'functions only: isAnswered, len, contains, matches, upper, lower, abs, round, floor, ceil, min, max, sum.',
    'IMPORTANT: use == and != only — there is no === or !== in this grammar.',
    '`when` should evaluate to true exactly when the value is suspicious, grounded in the analyst\'s note above.',
    'Respond with ONLY the JSON array, no other text, no markdown code fences.',
  ].join('\n');
}

function extractJsonArray(text: string): string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  return start !== -1 && end !== -1 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Parses and validates a model's rule-draft response. Every candidate must compile AND every
 * variable it references must exist in the instrument — anything else is dropped silently, per
 * docs/validator-plan.md §8.3 ("rejected drafts are dropped silently").
 */
export function parseLlmRuleDrafts(rawText: string, instrument: Instrument): LlmRuleDraftCandidate[] {
  const knownNames = new Set(instrument.variables.map((v) => v.name));
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(rawText));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: LlmRuleDraftCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const when = (item as Record<string, unknown>).when;
    const message = (item as Record<string, unknown>).message;
    const severity = (item as Record<string, unknown>).severity;
    if (typeof when !== 'string' || typeof message !== 'string') continue;
    if (severity !== 'fatal' && severity !== 'query') continue;
    if (!compile(when).ok) continue;
    const usedVars = variablesUsed(when);
    if (usedVars.some((n) => !knownNames.has(n))) continue;
    out.push({ when, message, severity });
  }
  return out;
}

/** Prompt for per-record anomaly explanation (docs/validator-plan.md §8.3.2). */
export function buildFlagExplanationPrompt(params: {
  flag: ValidationFlag;
  annotationNote?: string;
  similarPastDispositions: { reason: string; action: string }[];
}): string {
  const past = params.similarPastDispositions
    .slice(0, 5)
    .map((d, i) => `${i + 1}. ${d.action}: "${d.reason}"`)
    .join('\n') || '(none)';
  return [
    'A validation flag needs a plain-language explanation for an analyst.',
    `Flag: ${params.flag.message}`,
    `Variable: ${params.flag.variableName ?? '(record-level)'}`,
    `Observed value: ${JSON.stringify(params.flag.observed)}`,
    params.annotationNote ? `Analyst's domain note on this variable: "${params.annotationNote}"` : '',
    'Similar past dispositions on this same check:',
    past,
    '',
    'In 2-3 sentences, explain what might be going on and suggest (but do not decide) a likely',
    "disposition. Ground your reasoning in the domain note and past dispositions above where",
    'relevant — do not invent domain facts not given to you.',
  ].filter(Boolean).join('\n');
}
