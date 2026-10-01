import { describe, expect, it } from 'vitest';
import { evaluateExtractionAgainstGold, type GoldRecord } from '../evaluation.js';

describe('Evaluation against Gold Set', () => {
  const goldSet: GoldRecord[] = [
    {
      id: 'doi:10.1234/paper1',
      title: 'Health Study in Canada',
      claims: [
        { program: 'CCHS', role: 'analyzed', exactCycles: ['2017', '2018'] },
        { program: 'CHMS', role: 'background_mention' },
      ],
      primaryTheme: 'health',
    },
    {
      id: 'doi:10.1234/paper2',
      title: 'Digital Divide in Rural Areas',
      claims: [
        { program: 'CIUS', role: 'analyzed', exactCycles: ['2022'] },
      ],
      primaryTheme: 'digital society',
    },
  ];

  it('measures perfect precision and recall when extractions match gold records', () => {
    const extracted = [
      {
        id: 'doi:10.1234/paper1',
        claims: [
          { program: 'CCHS', role: 'analyzed', exactCycles: ['2017', '2018'] },
          { program: 'CHMS', role: 'background_mention', exactCycles: [] },
        ],
        themes: [{ primary: 'health' }],
      },
      {
        id: 'doi:10.1234/paper2',
        claims: [
          { program: 'CIUS', role: 'analyzed', exactCycles: ['2022'] },
        ],
        themes: [{ primary: 'digital society' }],
      },
    ];

    const report = evaluateExtractionAgainstGold(goldSet, extracted);
    expect(report.evaluatedWorks).toBe(2);
    expect(report.programMetric.precision).toBe(1);
    expect(report.programMetric.recall).toBe(1);
    expect(report.roleMetric.precision).toBe(1);
    expect(report.exactCycleMatches.accuracy).toBe(1);
    expect(report.themeMatches.accuracy).toBe(1);
    expect(report.mismatches).toHaveLength(0);
  });

  it('flags mismatches when extracted claims differ in role, cycle, or program', () => {
    const extractedWithErrors = [
      {
        id: 'doi:10.1234/paper1',
        claims: [
          // Role mismatch: background_mention instead of analyzed
          { program: 'CCHS', role: 'background_mention', exactCycles: ['2017', '2018'] },
        ],
        themes: [{ primary: 'labour' }], // Theme mismatch
      },
      // paper2 completely missing
    ];

    const report = evaluateExtractionAgainstGold(goldSet, extractedWithErrors);
    expect(report.evaluatedWorks).toBe(1);
    expect(report.programMetric.recall).toBeLessThan(1);
    expect(report.roleMetric.precision).toBeLessThan(1);
    expect(report.mismatches.length).toBeGreaterThan(0);
  });
});
