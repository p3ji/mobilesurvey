/**
 * Anthropic-backed implementation of the Validator's LLM assistance (docs/validator-plan.md §8.3).
 *
 * SECURITY WARNING: this calls the Anthropic API directly from the browser using a client-bundled
 * API key (`VITE_ANTHROPIC_API_KEY`). Unlike the Supabase key used elsewhere in this app — a
 * publishable/anon key *designed* to be public, protected entirely by RLS — a real Anthropic API
 * key is a genuine secret. Bundling it client-side means anyone who opens dev tools on the
 * deployed site can extract and use it under your account. This is acceptable ONLY for a
 * personal/low-stakes demo where you knowingly accept that risk.
 *
 * For anything beyond that, do NOT set this env var directly. Put this behind a serverless proxy
 * instead (a Supabase Edge Function or a Cloudflare Worker that holds the real key server-side
 * and forwards prompts, returning only the model's response) — the browser calls your proxy, the
 * proxy calls Anthropic. That's the production-safe path; it isn't built here.
 *
 * The feature is hidden entirely when no key is configured — same graceful-absence pattern as
 * CATI without the local API (see `apps/hub/src/App.tsx`'s InterviewerView).
 */
import { piiVariableNames } from '@mobilesurvey/instrument-schema';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import {
  buildFlagExplanationPrompt,
  buildRuleDraftPrompt,
  parseLlmRuleDrafts,
  type LlmRuleDraftCandidate,
  type ValidationFlag,
} from '@mobilesurvey/validation-engine';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
const MODEL = 'claude-sonnet-5';

export function llmConfigured(): boolean {
  return Boolean(ANTHROPIC_KEY);
}

async function callAnthropic(prompt: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error('LLM assistance is not configured (VITE_ANTHROPIC_API_KEY unset).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      // Required by the SDK/API to allow a direct browser call at all -- itself a signal that
      // this is not the intended deployment shape; see the module-level warning above.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  const data: unknown = await res.json();
  const text = (data as { content?: { text?: string }[] })?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('LLM response had no text content.');
  return text;
}

/** Drafts candidate rules from a variable's annotation. PII variables never send real values --
 * unconditional redaction, matching docs/validator-plan.md's PII note. */
export async function draftRulesFromAnnotation(
  instrument: Instrument,
  variableName: string,
  annotationNote: string,
  observedSamples: unknown[],
): Promise<LlmRuleDraftCandidate[]> {
  const isPII = piiVariableNames(instrument).has(variableName);
  const prompt = buildRuleDraftPrompt({
    variableName,
    annotationNote,
    observedSamples: isPII ? observedSamples.map(() => '[REDACTED]') : observedSamples,
  });
  const raw = await callAnthropic(prompt);
  return parseLlmRuleDrafts(raw, instrument);
}

/** Explains a flagged value in plain language, grounded in the variable's annotation and similar
 * past dispositions. Advisory only -- never auto-applied. PII redacted unconditionally. */
export async function explainFlag(
  instrument: Instrument,
  flag: ValidationFlag,
  annotationNote: string | undefined,
  similarPastDispositions: { reason: string; action: string }[],
): Promise<string> {
  const isPII = flag.variableName !== null && piiVariableNames(instrument).has(flag.variableName);
  const safeFlag: ValidationFlag = isPII ? { ...flag, observed: '[REDACTED]' } : flag;
  const prompt = buildFlagExplanationPrompt({ flag: safeFlag, annotationNote, similarPastDispositions });
  return callAnthropic(prompt);
}
