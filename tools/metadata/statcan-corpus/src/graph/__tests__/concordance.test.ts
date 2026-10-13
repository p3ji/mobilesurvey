import { describe, it, expect } from 'vitest';
import {
  normalizeQuestionOrVarCode,
  isSelfQuestionCodeReference,
  generateStructuralConcordanceCandidates,
  formatConcordanceAttribution,
} from '../concordance.js';

describe('Phase 26: Questionnaire-to-Dataset Variable Concordance Resolver', () => {
  it('normalizes question and variable codes consistently', () => {
    expect(normalizeQuestionOrVarCode('AADA_Q005B')).toBe('AADA5B');
    expect(normalizeQuestionOrVarCode('AADA_05B')).toBe('AADA5B');
    expect(normalizeQuestionOrVarCode('SED_Q12M')).toBe('SED12M');
    expect(normalizeQuestionOrVarCode('SED12M')).toBe('SED12M');
  });

  it('detects self-referential question codes and battery option self-references', () => {
    // Direct self question code: AADA_05B <- AADA_Q005B
    expect(
      isSelfQuestionCodeReference(
        'AADA_05B',
        'AADA_Q005B',
        'Difficulty seeing',
        true,
      ),
    ).toBe(true);

    // Battery option self question code: ME_25D <- ME_Q25 (where ME_25D is option D, not a DV)
    expect(
      isSelfQuestionCodeReference(
        'ME_25D',
        'ME_Q25',
        'Member of the following group: Political party or group',
        true,
      ),
    ).toBe(true);

    // Genuine derived variable: DV_FC19 <- C19_Q18B
    expect(
      isSelfQuestionCodeReference(
        'DV_FC19',
        'C19_Q18B',
        'COVID-19 vaccination status - (D)',
        false,
      ),
    ).toBe(false);
  });

  it('generates structural concordance candidates including LSIC wave infixes', () => {
    const cads = generateStructuralConcordanceCandidates('SED_Q12M', '2019');
    expect(cads).toContain('SED12M');
    expect(cads).toContain('SED_12M');

    const lsic = generateStructuralConcordanceCandidates('ED_Q01A', '1');
    expect(lsic).toContain('ED1Q001A');
    expect(lsic).toContain('ED1Q001');
    expect(lsic).toContain('ED1G001');
  });

  it('formats Two-Clause Epistemic Transparency Contract for concordance resolution', () => {
    const note = formatConcordanceAttribution({
      rawEvidence: 'Based on RRS_Q12 and household roster.',
      targetVarName: 'HCOMP',
      originalQuestionCode: 'RRS_Q12',
      resolvedVarName: 'RRS_12',
      rule: 'structural question-to-variable concordance (RRS_Q12 -> RRS_12)',
      surveyGroup: 'CIUS_ECUI_2020',
      cycle: '2020',
    });
    expect(note).toContain('Evidence from data dictionary: "Based on RRS_Q12 and household roster."');
    expect(note).toContain('AI interpretation and action: Resolved questionnaire code RRS_Q12 to published dataset variable RRS_12');
  });
});
