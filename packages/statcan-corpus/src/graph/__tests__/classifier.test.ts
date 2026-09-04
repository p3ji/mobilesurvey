import { describe, it, expect } from 'vitest';
import type { CorpusVariable } from '../../types.js';
import { classifyVariableRole } from '../classifier.js';
import { extractModuleCode, resolveModule } from '../modules.js';
import { extractDerivationLineage } from '../derivation.js';

function mockVar(partial: Partial<CorpusVariable>): CorpusVariable {
  return {
    recordId: '00000000-0000-0000-0000-000000000001',
    name: 'VAR',
    codes: [],
    source: {
      bundle: 'b',
      path: 'p',
      page: 1,
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'CCHS_ESCC',
      surveyAcronym: 'CCHS',
      cycle: '2015',
      year: 2015,
      lang: 'en',
    },
    ...partial,
  };
}

describe('Variable Role Classifier (2D GSIM)', () => {
  it('classifies direct questions as collected + base', () => {
    const v = mockVar({
      name: 'DHH_SEX',
      concept: 'Sex',
      questionText: 'Is respondent male or female?',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('collected');
    expect(result.origin).toBe('collected');
    expect(result.derivation).toBe('base');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies derived variables with (D) flag as collected origin + derived status', () => {
    const v = mockVar({
      name: 'HWTDVBMI',
      concept: 'Body Mass Index (BMI) - self-reported - (D)',
      note: 'Based on DHH_AGE, HWTDHTM, HWTDWTK.',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('derived');
    expect(result.origin).toBe('collected');
    expect(result.derivation).toBe('derived');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('classifies administrative tax data that is derived with administrative origin + derived status (resolves CCHS anomaly)', () => {
    const v = mockVar({
      name: 'T1FF_INC',
      concept: 'Total income from T1FF tax data linkage - (D)',
      note: 'Linked from CRA administrative file.',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('derived');
    expect(result.origin).toBe('administrative');
    expect(result.derivation).toBe('derived');
  });

  it('classifies base administrative variables as administrative origin + base status', () => {
    const v = mockVar({
      name: 'GEO_PRV',
      concept: 'Province of residence',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('administrative');
    expect(result.origin).toBe('administrative');
    expect(result.derivation).toBe('base');
  });

  it('classifies PUMF grouped recodes with (G) marker as derived and isGrouped: true', () => {
    const v = mockVar({
      name: 'DHHGAGE',
      concept: 'Age - grouped - (G)',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('derived');
    expect(result.derivation).toBe('derived');
    expect(result.isGrouped).toBe(true);
    expect(result.rule).toBe('pumf_grouped_variable');
  });

  it('classifies sampling weights across standard and longitudinal patterns', () => {
    for (const name of ['WTS_M', 'WT01', 'FWEIGHT', 'HWEIGHT', 'BOOTWT']) {
      const v = mockVar({ name, concept: 'Survey weight' });
      const result = classifyVariableRole(v);
      expect(result.role).toBe('process');
      expect(result.origin).toBe('process');
      expect(result.rule).toBe('sampling_weight');
    }
  });

  it('classifies system identifiers as process with isIdentifier: true', () => {
    const v = mockVar({
      name: 'PERSONID',
      concept: 'Person identifier of selected respondent',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('process');
    expect(result.origin).toBe('process');
    expect(result.isIdentifier).toBe(true);
    expect(result.rule).toBe('system_identifier_name');
  });

  it('classifies CCHS inclusion flags (DOHWT) as process', () => {
    const v = mockVar({
      name: 'DOHWT',
      concept: 'Height and weight - Inclusion Flag - (F)',
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('process');
    expect(result.origin).toBe('process');
    expect(result.rule).toBe('inclusion_or_flow_flag');
  });

  it('does NOT default continuous quantitative measures to process when codes and question text are absent', () => {
    const v = mockVar({
      name: 'TOTALINC',
      concept: 'Total annual earnings in dollars',
      length: '8',
      codes: [], // Continuous quantitative measure has no codebook categories
    });
    const result = classifyVariableRole(v);
    expect(result.role).toBe('collected');
    expect(result.origin).toBe('collected');
    expect(result.rule).toBe('continuous_collected_measure');
  });
});

describe('Content Module Extractor & Statistical Units', () => {
  it('extracts module codes from standard names', () => {
    expect(extractModuleCode('DHH_SEX')).toBe('DHH');
    expect(extractModuleCode('GEN_01')).toBe('GEN');
    expect(extractModuleCode('SMK_010')).toBe('SMK');
    expect(extractModuleCode('HWTDVBMI')).toBe('HWT');
    expect(extractModuleCode('WTS_M')).toBe('WTS');
    expect(extractModuleCode('FWEIGHT')).toBe('WTS');
    expect(extractModuleCode('SAMPLEID')).toBe('SYS');
  });

  it('resolves module metadata and identifies harmonized core modules', () => {
    const dhh = resolveModule('DHH');
    expect(dhh.kind).toBe('harmonized_core');
    expect(dhh.label).toBe('Demographics and Household');
    expect(dhh.unitOfAnalysis).toBe('person');

    const smk = resolveModule('SMK');
    expect(smk.kind).toBe('rotating_thematic');
    expect(smk.label).toContain('Smoking');

    const wts = resolveModule('WTS');
    expect(wts.kind).toBe('process_system');
  });

  it('identifies CIS family and household statistical units', () => {
    const cfc = resolveModule('CFC');
    expect(cfc.kind).toBe('statistical_unit');
    expect(cfc.unitOfAnalysis).toBe('census_family');
    expect(cfc.label).toContain('Census Family');

    const efc = resolveModule('EFC');
    expect(efc.kind).toBe('statistical_unit');
    expect(efc.unitOfAnalysis).toBe('economic_family');

    const hhc = resolveModule('HHC');
    expect(hhc.kind).toBe('statistical_unit');
    expect(hhc.unitOfAnalysis).toBe('household');
  });
});

describe('Derivation Lineage Extractor & Grounding', () => {
  it('extracts input source variables from Based on notes and cleans boundaries', () => {
    const v = mockVar({
      name: 'HWTDBMI',
      concept: 'Body Mass Index (BMI) - self-report - (D)',
      note: 'Based on DHH_AGE, HWTFHW, HWTDHTM, HWTDWTK, WHC_03. Users are advised to check sample notes.',
    });
    const lineage = extractDerivationLineage(v);
    expect(lineage).not.toBeNull();
    expect(lineage?.targetVarName).toBe('HWTDBMI');
    expect(lineage?.sourceVarNames).toContain('DHH_AGE');
    expect(lineage?.sourceVarNames).toContain('HWTDHTM');
    expect(lineage?.sourceVarNames).toContain('HWTDWTK');
    expect(lineage?.sourceVarNames).toContain('WHC_03');
    // Stopwords should be filtered out
    expect(lineage?.sourceVarNames).not.toContain('USERS');
    expect(lineage?.sourceVarNames).not.toContain('ARE');
  });

  it('strips parenthetical processing notes cleanly without creating junk tokens', () => {
    const v = mockVar({
      name: 'ADMFSID',
      concept: 'Derived flag',
      note: 'Based on SAMFSIS and STATHO2 (on internal processing file; not on master file).',
    });
    const lineage = extractDerivationLineage(v);
    expect(lineage).not.toBeNull();
    expect(lineage?.sourceVarNames).toContain('SAMFSIS');
    expect(lineage?.sourceVarNames).toContain('STATHO2');
    expect(lineage?.sourceVarNames).not.toContain('ANDB_01');
    expect(lineage?.sourceVarNames).not.toContain('INTERNAL');
  });

  it('grounds source variables to UUIDv5 record IDs when cycle index is provided', () => {
    const v = mockVar({
      name: 'HWTDVBMI',
      concept: 'BMI',
      note: 'Based on DHH_AGE and HWTDHTM.',
    });

    const cycleVarIndex = new Map<string, string>([
      ['DHH_AGE', 'uuid-dhh-age-12345'],
      ['HWTDHTM', 'uuid-hwtdhtm-67890'],
    ]);

    const lineage = extractDerivationLineage(v, cycleVarIndex);
    expect(lineage).not.toBeNull();
    expect(lineage?.sourceRecordIds).toEqual([
      'uuid-dhh-age-12345',
      'uuid-hwtdhtm-67890',
    ]);
    expect(lineage?.unresolvedVarNames).toEqual([]);
  });

  it('flags ungrounded external variables when not found in cycle index', () => {
    const v = mockVar({
      name: 'HWTDVBMI',
      concept: 'BMI',
      note: 'Based on DHH_AGE and INTERNAL_FILE_VAR.',
    });

    const cycleVarIndex = new Map<string, string>([
      ['DHH_AGE', 'uuid-dhh-age-12345'],
    ]);

    const lineage = extractDerivationLineage(v, cycleVarIndex);
    expect(lineage).not.toBeNull();
    expect(lineage?.sourceRecordIds).toEqual(['uuid-dhh-age-12345']);
    expect(lineage?.unresolvedVarNames).toEqual(['INTERNAL_FILE_VAR']);
  });
});
