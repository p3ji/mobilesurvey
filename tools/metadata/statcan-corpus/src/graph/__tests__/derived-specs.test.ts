import { describe, it, expect } from 'vitest';
import {
  extractDerivedSpecTokens,
  parseTemporaryReformats,
  parseDerivedSpecBlocks,
  formatT154Attribution,
  conceptSimilarity,
} from '../derived-specs.js';

describe('Phase 25: T15.4 Derived Variable Specification Engine', () => {
  it('extracts candidate tokens and expands ranges from Based on lines', () => {
    const tokens = extractDerivedSpecTokens('ADL_005, ADL_010 to ADL_012, SAMPLEID');
    expect(tokens).toEqual(['ADL_005', 'ADL_010', 'ADL_011', 'ADL_012']);
    expect(tokens).not.toContain('SAMPLEID');
  });

  it('parses Temporary Reformat mappings and resolves XXXTNNN aliases', () => {
    const sample = `
Temporary Reformat
Value Condition(s) Description Notes
ADLT005
(ADL_005 - 1) ADL_005 <= 4 Rescale the question answers

1) Instrumental activity of daily living index - home support
Variable name: ADLDVIHS
Based on: ADLT005, ADL_010, ADL_015, ADL_030
Description: This variable uses an index to discern the degree to which an individual has difficulty.
Specifications
Value Condition(s)
`;
    const temp = parseTemporaryReformats(sample);
    expect(temp.get('ADLT005')).toBeDefined();
    expect([...(temp.get('ADLT005') ?? [])]).toContain('ADL_005');

    const blocks = parseDerivedSpecBlocks(sample);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.targetVarName).toBe('ADLDVIHS');
    expect(blocks[0]?.sourceTokens).toContain('ADL_005');
    expect(blocks[0]?.sourceTokens).toContain('ADL_010');
    expect(blocks[0]?.description).toContain('This variable uses an index');
  });

  it('parses numbered headers when Variable name line is omitted (CCAHS layout)', () => {
    const sample = `
2) RAGO16A - Variant of NOC for highly aggregated data
Based on: RACOC16
Description: This variant of NOC is a departmental standard.
Internet site: http://www23.statcan.gc.ca/
`;
    const blocks = parseDerivedSpecBlocks(sample);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.targetVarName).toBe('RAGO16A');
    expect(blocks[0]?.sourceTokens).toEqual(['RACOC16']);
  });

  it('formats Two-Clause Epistemic Transparency Contract for exact and propagated cycles', () => {
    const exact = formatT154Attribution({
      docTitle: 'cchs_2017_f1_T15.4_v1.pdf',
      targetVarName: 'ADLDVIHS',
      sourceVarName: 'ADL_005',
      basedOnRaw: 'ADL_005, ADL_010, ADL_015, ADL_030',
      description: 'Index of home support difficulty.',
      surveyGroup: 'CCHS_ESCC',
      cycle: '2017',
      specCycle: '2017',
    });
    expect(exact.expressionSummary).toContain('Evidence from data dictionary:');
    expect(exact.expressionSummary).toContain('AI interpretation and action:');
    expect(exact.expressionSummary).toContain('Extracted from official T15.4');

    const propagated = formatT154Attribution({
      docTitle: 'cchs_2020_f1_T15-4_v1.pdf',
      targetVarName: 'ADLDVIHS',
      sourceVarName: 'ADL_005',
      basedOnRaw: 'ADL_005, ADL_010, ADL_015, ADL_030',
      description: 'Index of home support difficulty.',
      surveyGroup: 'CCHS_ESCC',
      cycle: '2021',
      specCycle: '2020',
    });
    expect(propagated.expressionSummary).toContain('See documentation on derived variables');
    expect(propagated.expressionSummary).toContain('applied program T15.4 specification');
  });

  it('guards 3-digit to 2-digit CCHS renumbering using concept similarity', () => {
    expect(
      conceptSimilarity(
        'Active transportation - Tuesday',
        'Active transportation - Tuesday',
      ),
    ).toBeGreaterThanOrEqual(0.7);
    expect(
      conceptSimilarity(
        'Physical activities - leisure time - sweat',
        'Other physical activities - 7 d',
      ),
    ).toBeLessThan(0.7);
  });
});
