import { describe, it, expect } from 'vitest';
import {
  makeCartItemId,
  parseDataCartJson,
  exportDataCartJson,
  exportDataCartCsv,
  formatVariableNamesList,
  computeSurveySummary,
  CartVariableItem,
} from './useDataCart.js';

describe('useDataCart helpers', () => {
  const sampleItems: CartVariableItem[] = [
    {
      id: makeCartItemId('CCHS_2022', 'GEN_01', 'en'),
      variableName: 'GEN_01',
      surveyGroup: 'CCHS_2022',
      surveyAcronym: 'CCHS',
      year: 2022,
      lang: 'en',
      label: 'Perceived health',
      question: 'In general, would you say your health is: Excellent, Very good, Good, Fair, or Poor?',
      universe: 'All respondents',
      role: 'collected',
      isHarmonized: true,
      codes: [
        { c: '1', l: 'Excellent' },
        { c: '2', l: 'Very good' },
      ],
      userNotes: 'Key outcome measure',
      addedAt: 1600000000000,
    },
    {
      id: makeCartItemId('CCHS_2022', 'SMK_01', 'en'),
      variableName: 'SMK_01',
      surveyGroup: 'CCHS_2022',
      surveyAcronym: 'CCHS',
      year: 2022,
      lang: 'en',
      label: 'Smoking status',
      question: 'Do you smoke cigarettes?',
      universe: 'Aged 12 and older',
      role: 'collected',
      addedAt: 1600000001000,
    },
    {
      id: makeCartItemId('GSS_2020', 'ACT_10', 'en'),
      variableName: 'ACT_10',
      surveyGroup: 'GSS_2020',
      surveyAcronym: 'GSS',
      year: 2020,
      lang: 'en',
      label: 'Time spent working',
      role: 'derived',
      addedAt: 1600000002000,
    },
  ];

  it('generates consistent, normalized composite IDs', () => {
    expect(makeCartItemId('cchs_2022', 'gen_01', 'EN')).toBe('CCHS_2022:GEN_01:en');
    expect(makeCartItemId('  lfs  ', ' lfsstat ', ' ')).toBe('LFS:LFSSTAT:');
  });

  it('formats variable name lists for various statistical languages', () => {
    expect(formatVariableNamesList(sampleItems, 'comma')).toBe('GEN_01, SMK_01, ACT_10');
    expect(formatVariableNamesList(sampleItems, 'space')).toBe('GEN_01 SMK_01 ACT_10');
    expect(formatVariableNamesList(sampleItems, 'newline')).toBe('GEN_01\nSMK_01\nACT_10');
    expect(formatVariableNamesList(sampleItems, 'r')).toBe('c("GEN_01", "SMK_01", "ACT_10")');
    expect(formatVariableNamesList(sampleItems, 'stata')).toBe('keep GEN_01 SMK_01 ACT_10');
    expect(formatVariableNamesList(sampleItems, 'sas')).toBe('keep GEN_01 SMK_01 ACT_10;');
  });

  it('computes accurate survey and cycle summaries', () => {
    const summary = computeSurveySummary(sampleItems);
    expect(summary.distinctSurveys).toBe(2); // CCHS and GSS
    expect(summary.distinctCycles).toBe(2);  // 2022 and 2020
  });

  it('exports valid JSON and re-imports cleanly', () => {
    const jsonStr = exportDataCartJson(sampleItems);
    const parsed = parseDataCartJson(jsonStr);

    expect(parsed.success).toBe(true);
    expect(parsed.items.length).toBe(3);
    expect(parsed.items[0]?.variableName).toBe('GEN_01');
    expect(parsed.items[0]?.userNotes).toBe('Key outcome measure');
  });

  it('handles invalid import formats gracefully', () => {
    expect(parseDataCartJson('invalid json').success).toBe(false);
    expect(parseDataCartJson('{"notAnArray": 123}').items).toEqual([]);
  });

  it('exports valid CSV with proper column escaping', () => {
    const csv = exportDataCartCsv(sampleItems);
    expect(csv).toContain('Variable Name,Survey Program');
    expect(csv).toContain('"GEN_01","CCHS_2022","CCHS","2022","en","Perceived health"');
    expect(csv).toContain('"Key outcome measure"');
    expect(csv).toContain('"1: Excellent; 2: Very good"');
  });
});
