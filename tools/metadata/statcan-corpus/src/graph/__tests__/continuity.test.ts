import { describe, expect, it } from 'vitest';
import type { CorpusVariable } from '../../types.js';
import {
  buildContinuityMesh,
  canonicalSeriesName,
  cleanedSubstantiveMeaning,
  evaluateContinuityPair,
} from '../continuity.js';

function makeVar(overrides: Partial<CorpusVariable> & { name: string; year: number }): CorpusVariable {
  const surveyGroup = overrides.source?.surveyGroup ?? 'CCHS_ESCC';
  return {
    recordId: overrides.recordId ?? `00000000-0000-5000-8000-${String(overrides.year).padStart(12, '0')}`,
    name: overrides.name,
    concept: overrides.concept,
    questionText: overrides.questionText,
    universe: overrides.universe,
    note: overrides.note,
    codes: overrides.codes ?? [],
    source: {
      bundle: 'RDC',
      path: `${surveyGroup}_${overrides.year}.pdf`,
      tcode: 'T15.6',
      docKind: 'data-dictionary',
      surveyGroup,
      surveyAcronym: surveyGroup.split('_')[0],
      year: overrides.year,
      page: 10,
      lang: 'en',
      ...overrides.source,
    },
  };
}

describe('Phase 27: Cross-Cycle Concept Continuity & Longitudinal Lineage Mesh', () => {
  it('normalizes CCHS 3-digit variable mnemonics to 2-digit longitudinal series keys', () => {
    expect(canonicalSeriesName('GEN_005', 'CCHS_ESCC')).toBe('GEN_05');
    expect(canonicalSeriesName('PAA_010B', 'CCHS_ESCC')).toBe('PAA_10B');
    expect(canonicalSeriesName('FSC_010', 'CCHS_ESCC')).toBe('FSC_10');
    expect(canonicalSeriesName('ONL_SHOP', 'CIUS_ECUI')).toBe('ONL_SHOP');
  });

  it('strips generic DDI/dictionary suffixes and falls back to questionText when concept is a placeholder', () => {
    const v1 = makeVar({
      name: 'ONL_SHOP',
      year: 2020,
      concept: 'Online shoppers - Derived variable',
      universe: 'All respondents',
    });
    const v2 = makeVar({
      name: 'ONL_SHOP',
      year: 2022,
      concept: 'Derived variable',
      questionText: 'Online shoppers',
      universe: 'AC_090A=1',
    });
    expect(cleanedSubstantiveMeaning(v1)).toBe('online shoppers');
    expect(cleanedSubstantiveMeaning(v2)).toBe('online shoppers');
  });

  it('links universe shifts across cycles while enforcing Two-Clause Epistemic Transparency', () => {
    const earlier = makeVar({
      recordId: '11111111-1111-5000-8000-000000002018',
      name: 'GEN_01',
      year: 2018,
      concept: 'Perceived health',
      questionText: 'In general, would you say your health is...?',
      universe: 'All respondents aged 12 and over',
    });
    const later = makeVar({
      recordId: '22222222-2222-5000-8000-000000002022',
      name: 'GEN_01',
      year: 2022,
      concept: 'Perceived health',
      questionText: 'In general, would you say your health is...?',
      universe: 'All respondents aged 18 and over',
    });

    const edge = evaluateContinuityPair(earlier, later);
    expect(edge).not.toBeNull();
    expect(edge?.breakKind).toBe('universe_shift');
    expect(edge?.rationale).toContain('Evidence from data dictionary:');
    expect(edge?.rationale).toContain('AI interpretation and action:');
    expect(edge?.evidence).toContain('Evidence from data dictionary:');
    expect(edge?.evidence).toContain('AI interpretation and action:');
  });

  it('links CCHS 3-digit to 2-digit renumbered variables when construct meaning matches and rejects unrelated renumberings', () => {
    const fsc2020 = makeVar({
      recordId: '33333333-3333-5000-8000-000000002020',
      name: 'FSC_010',
      year: 2020,
      concept: 'Food worried - run out before money to buy more',
      questionText: 'You and other household members worried that food would run out before you got money to buy more.',
      universe: 'All respondents',
    });
    const fsc2022 = makeVar({
      recordId: '44444444-4444-5000-8000-000000002022',
      name: 'FSC_10',
      year: 2022,
      concept: 'Food worried - run out before money to buy more',
      questionText: 'You and other household members worried that food would run out before you got money to buy more.',
      universe: 'Respondents in provinces',
    });

    const validEdge = evaluateContinuityPair(fsc2020, fsc2022);
    expect(validEdge).not.toBeNull();
    expect(validEdge?.breakKind).toBe('cycle_renumbering');

    // Unrelated renumbering (PAY_050 leisure sweat vs PAY_50 other physical activities) must be rejected
    const pay2020 = makeVar({
      recordId: '55555555-5555-5000-8000-000000002020',
      name: 'PAY_050',
      year: 2020,
      concept: 'Leisure time physical activities - sweat',
      questionText: 'How much of this time did you sweat?',
      universe: 'PAY_045 = 1',
    });
    const pay2022 = makeVar({
      recordId: '66666666-6666-5000-8000-000000002022',
      name: 'PAY_50',
      year: 2022,
      concept: 'Other physical activities - 7 d',
      questionText: 'In the last 7 days, did you do any other physical activities for leisure?',
      universe: 'All respondents',
    });

    expect(evaluateContinuityPair(pay2020, pay2022)).toBeNull();
  });

  it('connects consecutive distinct conceptual_variable_id epochs without duplicate pairs', () => {
    const v2018 = makeVar({
      recordId: 'aaaa0000-0000-5000-8000-000000002018',
      name: 'ONL_SHOP',
      year: 2018,
      concept: 'Online shoppers - Derived variable',
      universe: 'All respondents',
      source: { bundle: 'RDC', path: 'cius2018.pdf', tcode: 'T15.6', docKind: 'data-dictionary', surveyGroup: 'CIUS_ECUI', year: 2018, page: 1, lang: 'en' },
    });
    const v2020 = makeVar({
      recordId: 'bbbb0000-0000-5000-8000-000000002020',
      name: 'ONL_SHOP',
      year: 2020,
      concept: 'Online shoppers - Derived variable',
      universe: 'All respondents',
      source: { bundle: 'RDC', path: 'cius2020.pdf', tcode: 'T15.6', docKind: 'data-dictionary', surveyGroup: 'CIUS_ECUI', year: 2020, page: 1, lang: 'en' },
    });
    const v2022 = makeVar({
      recordId: 'cccc0000-0000-5000-8000-000000002022',
      name: 'ONL_SHOP',
      year: 2022,
      concept: 'Derived variable',
      questionText: 'Online shoppers',
      universe: 'AC_090A=1',
      source: { bundle: 'RDC', path: 'cius2022.pdf', tcode: 'T15.6', docKind: 'data-dictionary', surveyGroup: 'CIUS_ECUI', year: 2022, page: 1, lang: 'en' },
    });

    const mesh = buildContinuityMesh([v2018, v2020, v2022]);
    // 2018 and 2020 share the exact same conceptualVariableId, so the bridge connects 2020 -> 2022
    expect(mesh).toHaveLength(1);
    expect(mesh[0]?.earlierYear).toBe(2020);
    expect(mesh[0]?.laterYear).toBe(2022);
  });
});
