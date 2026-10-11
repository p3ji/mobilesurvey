import { describe, it, expect } from 'vitest';
import { evaluateDeterministicFilter } from '../orchestrator.js';

describe('Adversarial Lineage Orchestrator - Deterministic Filter', () => {
  it('rejects self-referential loops', () => {
    const res = evaluateDeterministicFilter('DRV_AGE', 'DRV_AGE', 'Derived age from self');
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('routing_filter');
    expect(res?.rationale).toContain('identical');
  });

  it('rejects prose phrases with whitespace', () => {
    const res = evaluateDeterministicFilter('INC_TOT', 'TOTAL INCOME', 'Based on TOTAL INCOME and transfers');
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('prose_phrase');
    expect(res?.rationale).toContain('whitespace');
  });

  it('rejects generic prose tokens like INCOME or EARNINGS', () => {
    const res = evaluateDeterministicFilter('INC_TOT', 'INCOME', 'Based on respondent INCOME');
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('prose_phrase');
  });

  it('rejects external administrative tax and geography registers', () => {
    const resT1FF = evaluateDeterministicFilter('INC_FAM', 'T1FF', 'Linked with T1FF tax files');
    expect(resT1FF).not.toBeNull();
    expect(resT1FF?.classification).toBe('admin_register');

    const resGAF = evaluateDeterministicFilter('GEO_URB', 'GAF', 'From Geographic Attribute File');
    expect(resGAF).not.toBeNull();
    expect(resGAF?.classification).toBe('admin_register');
  });

  it('rejects variables explicitly documented as internal processing or not on master file', () => {
    const res = evaluateDeterministicFilter(
      'ADMFSID',
      'STATHO2',
      'Based on SAMFSIS, STATHO2 (on internal processing file; not on master file).'
    );
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('internal_processing_file');
  });

  it('rejects PMK / Proxy interview filter conditions', () => {
    const res = evaluateDeterministicFilter(
      'DOINS',
      'PMK',
      'Questions for this module were not asked when a person most knowledgeable (PMK) answered.'
    );
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('routing_filter');
  });

  it('passes genuine candidate variables through for LLM critic evaluation', () => {
    const res = evaluateDeterministicFilter(
      'DRV_BMI',
      'HWT_01',
      'Calculated as HWT_01 / (HWT_02 * HWT_02)'
    );
    expect(res).toBeNull();
  });

  it('rejects questionnaire battery category pointers and write-in recodes', () => {
    const res = evaluateDeterministicFilter(
      'CCC_60D',
      'CCC_60E',
      'In the questionnaire, this variable is found under the question CCC_Q60 category # 5. For this question, write-in responses were coded into one of the existing listed categories if the write-in information duplicated a listed category.'
    );
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('routing_filter');
    expect(res?.rationale).toContain('questionnaire structure');
  });

  it('rejects simultaneous activity exclusion conditions in time use surveys', () => {
    const res = evaluateDeterministicFilter(
      'DUR05',
      'TUI_03B',
      'This derived variable indicates the total duration (in minutes) for meal preparation. It does not include any time that may have been reported as a simultaneous activity (TUI_03B).'
    );
    expect(res).not.toBeNull();
    expect(res?.classification).toBe('routing_filter');
    expect(res?.rationale).toContain('simultaneous activity');
  });
});
