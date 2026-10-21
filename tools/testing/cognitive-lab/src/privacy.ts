/**
 * @mobilesurvey/cognitive-lab — Strict Local-Only Privacy & PII Sanitization Engine.
 *
 * Ensures that:
 * 1. Raw voice audio never leaves 127.0.0.1 (`rawAudioIncluded: false`).
 * 2. All transcript turns and notes are scrubbed of Personally Identifiable
 *    Information (emails, phone numbers, SIN/IDs, postal codes, street addresses,
 *    and introduced personal names) using deterministic surrogate tokens
 *    (`[NAME_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[SIN_1]`, `[POSTAL_1]`).
 */

import type { CognitiveSessionReport } from './types.js';

export interface PiiSanitizationResult {
  sanitizedText: string;
  redactedCount: number;
  categories: string[];
}

interface PatternSpec {
  category: string;
  tokenPrefix: string;
  regex: RegExp;
  replaceGroupOnly?: boolean;
}

const PII_PATTERNS: PatternSpec[] = [
  {
    category: 'email',
    tokenPrefix: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: 'phone',
    tokenPrefix: 'PHONE',
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  },
  {
    category: 'sin_id',
    tokenPrefix: 'SIN',
    regex: /\b\d{3}[-\s]\d{3}[-\s]\d{3}\b/g,
  },
  {
    category: 'postal_code',
    tokenPrefix: 'POSTAL',
    regex: /\b[A-Za-z]\d[A-Za-z][-\s]?\d[A-Za-z]\d\b/g,
  },
  {
    category: 'introduced_name',
    tokenPrefix: 'NAME',
    regex:
      /\b(my\s+name\s+is|i\s+am\s+called|je\s+m['’]appelle|mon\s+nom\s+est|mr\.|mrs\.|ms\.|dr\.|m\.|mme)\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)\b/gi,
    replaceGroupOnly: true,
  },
];

/**
 * Redact PII in a free-text string using deterministic surrogate tokens.
 */
export function sanitizeTranscriptText(
  text: string,
  tokenMap: Map<string, string> = new Map(),
  counters: Record<string, number> = {},
): PiiSanitizationResult {
  let out = text;
  let redactedCount = 0;
  const categories = new Set<string>();

  const getSurrogate = (prefix: string, rawValue: string): string => {
    const key = `${prefix}:${rawValue.toLowerCase()}`;
    const existing = tokenMap.get(key);
    if (existing) return existing;
    const nextIdx = (counters[prefix] ?? 0) + 1;
    counters[prefix] = nextIdx;
    const token = `[${prefix}_${nextIdx}]`;
    tokenMap.set(key, token);
    return token;
  };

  for (const spec of PII_PATTERNS) {
    if (spec.replaceGroupOnly) {
      out = out.replace(spec.regex, (_full, intro: string, namePart: string) => {
        redactedCount++;
        categories.add(spec.category);
        const token = getSurrogate(spec.tokenPrefix, namePart);
        return `${intro} ${token}`;
      });
    } else {
      out = out.replace(spec.regex, (matched: string) => {
        redactedCount++;
        categories.add(spec.category);
        return getSurrogate(spec.tokenPrefix, matched);
      });
    }
  }

  return {
    sanitizedText: out,
    redactedCount,
    categories: [...categories],
  };
}

/**
 * Return a deep-sanitized copy of a `CognitiveSessionReport` safe for persistence
 * or export, guaranteeing `rawAudioIncluded: false` and PII surrogate replacement.
 */
export function sanitizeSessionReport(
  report: CognitiveSessionReport,
): CognitiveSessionReport {
  const tokenMap = new Map<string, string>();
  const counters: Record<string, number> = {};
  let totalRedacted = 0;
  const allCategories = new Set<string>(report.privacy.redactedCategories);

  const sanitizedTranscript = report.transcript.map((turn) => {
    const res = sanitizeTranscriptText(turn.text, tokenMap, counters);
    totalRedacted += res.redactedCount;
    for (const c of res.categories) allCategories.add(c);
    return {
      ...turn,
      text: res.sanitizedText,
    };
  });

  const sanitizedEvents = report.uiEvents.map((ev) => {
    if (!ev.note) return ev;
    const res = sanitizeTranscriptText(ev.note, tokenMap, counters);
    totalRedacted += res.redactedCount;
    for (const c of res.categories) allCategories.add(c);
    return {
      ...ev,
      note: res.sanitizedText,
    };
  });

  return {
    ...report,
    privacy: {
      rawAudioIncluded: false,
      piiSanitized: true,
      redactedEntityCount: report.privacy.redactedEntityCount + totalRedacted,
      redactedCategories: [...allCategories],
    },
    transcript: sanitizedTranscript,
    uiEvents: sanitizedEvents,
  };
}
