import { describe, it, expect } from 'vitest';
import {
  gateZeroFilter,
  checkBareNumerals,
  bindFactTokens,
  extractFactTokens,
} from '../src/engine/fact-binder.js';

describe('Gate 0 Code Bouncer', () => {
  it('nullifies suppressed points (F, x) to prevent chart spikes', () => {
    const rawDataPoints = [
      { refPer: '2024-01', value: '45.2', symbol: 'A' },
      { refPer: '2024-02', value: '999.0', symbol: 'F' }, // Unreliable / suppressed
      { refPer: '2024-03', value: '0.0', symbol: 'x' },   // Confidentiality suppression
    ];

    const { rows, suppressedCount, caveats } = gateZeroFilter(rawDataPoints, 0);

    expect(suppressedCount).toBe(2);
    expect(rows[0]?.value).toBe(45.2);
    expect(rows[1]?.value).toBeNull();
    expect(rows[1]?.isSuppressed).toBe(true);
    expect(rows[2]?.value).toBeNull();
    expect(rows[2]?.isSuppressed).toBe(true);
    expect(caveats.length).toBeGreaterThan(0);
    expect(caveats[0]).toContain('suppressed');
  });

  it('flags high variability (symbol E) and scales values properly', () => {
    const rawDataPoints = [
      { refPer: '2024-01', value: '12.5', symbol: 'E' },
    ];

    // Scale factor 3 = thousands (x 1,000)
    const { rows, highVariabilityCount, caveats } = gateZeroFilter(rawDataPoints, 3);

    expect(highVariabilityCount).toBe(1);
    expect(rows[0]?.value).toBe(12500); // 12.5 * 1000
    expect(rows[0]?.rawValue).toBe(12.5);
    expect(rows[0]?.scaleFactor).toBe(1000);
    expect(rows[0]?.isHighVariability).toBe(true);
    expect(caveats.some((c) => c.includes('symbol E'))).toBe(true);
    expect(caveats.some((c) => c.includes('thousands'))).toBe(true);
  });
});

describe('Zero-Numeral Contract', () => {
  it('detects unverified bare numerals written freehand', () => {
    const freehandProse = 'Employment in Ontario reached 14.5% last month.';
    const check = checkBareNumerals(freehandProse);

    expect(check.valid).toBe(false);
    expect(check.bareNumerals).toContain('14.5%');
  });

  it('allows years and ordinals as legitimate non-data references', () => {
    const validProse = 'In 2024, Canada published the 1st quarterly report.';
    const check = checkBareNumerals(validProse);

    expect(check.valid).toBe(true);
    expect(check.bareNumerals.length).toBe(0);
  });

  it('allows bound fact tokens without triggering bare numeral violations', () => {
    const tokenProse = 'Between {{fact_1.period}} and {{fact_2.period}}, the rate was {{fact_1}}.';
    const check = checkBareNumerals(tokenProse);

    expect(check.valid).toBe(true);
    expect(check.bareNumerals.length).toBe(0);
  });

  it('binds fact tokens deterministically from observation rows', () => {
    const rows = [
      {
        period: '2024-08',
        value: 6.8,
        scaleFactorDesc: 'Units',
        decimals: 1,
      },
      {
        period: '2024-09',
        value: 6.9,
        scaleFactorDesc: 'Units',
        decimals: 1,
      },
    ];

    const facts = extractFactTokens(rows as any, { geography: 'Ontario' });
    expect(facts.length).toBe(2);
    expect(facts[0]?.id).toBe('fact_1');
    expect(facts[0]?.value).toBe(6.8);

    const template = 'Ontario unemployment moved from {{fact_1}} to {{fact_2}} in {{fact_2.period}}.';
    const bound = bindFactTokens(template, facts);

    expect(bound).toBe('Ontario unemployment moved from 6.8 to 6.9 in 2024-09.');
  });
});
