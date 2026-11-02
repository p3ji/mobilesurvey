/**
 * WatSPEED Remine-Inspired Quality Gate 0 and Zero-Numeral Fact Token Binder
 * Ported and adapted from stats/remine/editor.py and WatSPEED Project Concept
 */

import type { FactToken, ObservationRow, StatCanQualitySymbol } from '../types.js';

export const STATCAN_QUALITY_MAP: Record<StatCanQualitySymbol, { label: string; reliable: boolean; warning?: string }> = {
  A: { label: 'Excellent (CV 0.0% to 4.9%)', reliable: true },
  B: { label: 'Very good (CV 5.0% to 9.9%)', reliable: true },
  C: { label: 'Good (CV 10.0% to 14.9%)', reliable: true },
  D: { label: 'Acceptable (CV 15.0% to 24.9%)', reliable: true },
  E: {
    label: 'Use with caution (CV 25.0% to 34.9%)',
    reliable: true,
    warning: 'High sampling variability; interpret with caution.',
  },
  F: {
    label: 'Too unreliable to publish (CV >= 35.0%)',
    reliable: false,
    warning: 'Data suppressed due to extreme sampling variability.',
  },
  x: {
    label: 'Confidentiality suppression',
    reliable: false,
    warning: 'Suppressed to meet confidentiality requirements of the Statistics Act.',
  },
  '': { label: 'Standard observation', reliable: true },
};

export const SCALE_FACTOR_MAP: Record<number, { multiplier: number; label: string }> = {
  0: { multiplier: 1, label: 'Units' },
  1: { multiplier: 10, label: 'Tens' },
  2: { multiplier: 100, label: 'Hundreds' },
  3: { multiplier: 1_000, label: 'Thousands' },
  4: { multiplier: 10_000, label: 'Tens of thousands' },
  5: { multiplier: 100_000, label: 'Hundreds of thousands' },
  6: { multiplier: 1_000_000, label: 'Millions' },
  9: { multiplier: 1_000_000_000, label: 'Billions' },
};

/**
 * Gate 0: Code Bouncer
 * Deterministic pre-filter that inspects observations before the LLM or chart sees them.
 */
export function gateZeroFilter(rawPoints: any[], scaleFactorCode = 0): {
  rows: ObservationRow[];
  suppressedCount: number;
  highVariabilityCount: number;
  caveats: string[];
} {
  const scale = SCALE_FACTOR_MAP[scaleFactorCode] || { multiplier: 1, label: 'Units' };
  const rows: ObservationRow[] = [];
  let suppressedCount = 0;
  let highVariabilityCount = 0;
  const caveats: string[] = [];

  for (const pt of rawPoints) {
    const symbol = (pt.symbol || '') as StatCanQualitySymbol;
    const quality = STATCAN_QUALITY_MAP[symbol] || { label: 'Unknown', reliable: true };
    const rawVal = pt.value != null ? Number(pt.value) : null;

    const isSuppressed = symbol === 'F' || symbol === 'x';
    const isHighVariability = symbol === 'E';

    if (isSuppressed) {
      suppressedCount++;
    }
    if (isHighVariability) {
      highVariabilityCount++;
    }

    // In Gate 0: suppressed points have their plotted numeric value nullified to prevent false charts
    const trueValue = isSuppressed || rawVal == null ? null : rawVal * scale.multiplier;

    rows.push({
      period: pt.refPer,
      value: trueValue,
      rawValue: rawVal,
      scaleFactor: scale.multiplier,
      scaleFactorDesc: scale.label,
      status: symbol,
      qualityDesc: quality.label,
      isSuppressed,
      isHighVariability,
      vectorId: pt.vectorId != null ? Number(pt.vectorId) : undefined,
      decimals: pt.decimals != null ? Number(pt.decimals) : undefined,
    });
  }

  if (suppressedCount > 0) {
    caveats.push(`${suppressedCount} observation(s) suppressed for reliability (F) or confidentiality (x).`);
  }
  if (highVariabilityCount > 0) {
    caveats.push(
      `${highVariabilityCount} observation(s) flagged with symbol E (high sampling variability, CV 25%-35%).`
    );
  }
  if (scale.multiplier > 1) {
    caveats.push(`Values are reported in ${scale.label.toLowerCase()} (scaled by ×${scale.multiplier.toLocaleString()}).`);
  }

  return { rows, suppressedCount, highVariabilityCount, caveats };
}

/**
 * Generate Remine-style verified Fact Tokens from rows.
 */
export function extractFactTokens(
  rows: ObservationRow[],
  dimensionLabels: Record<string, string>,
  metricName = 'Value'
): FactToken[] {
  const facts: FactToken[] = [];

  rows.forEach((row, idx) => {
    if (row.value == null || row.isSuppressed) return;

    const id = `fact_${idx + 1}`;
    const formatted =
      row.decimals != null
        ? row.value.toLocaleString('en-CA', { minimumFractionDigits: row.decimals, maximumFractionDigits: row.decimals })
        : row.value.toLocaleString('en-CA');

    facts.push({
      id,
      period: row.period,
      value: row.value,
      formatted: `${formatted} ${row.scaleFactorDesc !== 'Units' ? row.scaleFactorDesc : ''}`.trim(),
      metric: metricName,
      cut: { ...dimensionLabels, period: row.period },
      vectorId: row.vectorId,
    });
  });

  return facts;
}

const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\([^)]*\)/g;
const CODE_SPAN_REGEX = /`[^`]*`/g;
const TOKEN_REGEX = /\{\{\s*fact_\d+(\.\w+)?\s*\}\}/g;
const NUMERAL_REGEX = /\b\d+(?:,\d{3})*(?:\.\d+)?(?:%|\b)/g;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/;
const ORDINAL_REGEX = /\b\d+(?:st|nd|rd|th)\b/i;

/**
 * Remine's Zero-Numeral Contract Inspector
 * Detects whether the model wrote freehand numbers rather than referencing verified fact tokens.
 * Automatically excludes markdown links and code backticks where Table PIDs or coordinates reside.
 */
export function checkBareNumerals(text: string): { valid: boolean; bareNumerals: string[]; resolvedText?: string } {
  // Strip allowed markdown links, code spans, and fact tokens before scanning
  const stripped = text
    .replace(MARKDOWN_LINK_REGEX, ' ')
    .replace(CODE_SPAN_REGEX, ' ')
    .replace(TOKEN_REGEX, ' ');

  const badNumerals: string[] = [];

  const matches = stripped.match(NUMERAL_REGEX) || [];
  for (const raw of matches) {
    // Years (e.g. 2024) and ordinals (e.g. 1st) are exempt
    if (YEAR_REGEX.test(raw) || ORDINAL_REGEX.test(raw)) {
      continue;
    }
    badNumerals.push(raw);
  }

  return {
    valid: badNumerals.length === 0,
    bareNumerals: badNumerals,
  };
}

/**
 * Bind fact tokens into narrative text, replacing {{fact_1.value}} or {{fact_1}} with computed figures.
 */
export function bindFactTokens(templateText: string, facts: FactToken[]): string {
  const factMap = new Map(facts.map((f) => [f.id, f]));

  return templateText.replace(/\{\{\s*(fact_\d+)(?:\.(\w+))?\s*\}\}/g, (match, factId, field) => {
    const fact = factMap.get(factId);
    if (!fact) return match;

    if (field === 'value') return String(fact.value);
    if (field === 'period') return fact.period;
    if (field === 'metric') return fact.metric;
    return fact.formatted;
  });
}
