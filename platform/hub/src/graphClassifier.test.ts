import { describe, it, expect } from 'vitest';
import { classifyHit } from './graphClassifier.js';
import type { CorpusMeta } from '@mobilesurvey/metadata-registry';

function mockMeta(overrides: Partial<CorpusMeta> = {}): CorpusMeta {
  return {
    surveyGroup: 'TEST',
    bundle: 'test.zip',
    file: 'doc.pdf',
    page: 1,
    variableName: 'VAR1',
    codes: [],
    citation: 'Test citation',
    lang: 'en',
    ...overrides,
  };
}

describe('classifyHit', () => {
  it('correctly classifies DSMOYRS with DV concept as derived', () => {
    const meta = mockMeta({
      variableName: 'DSMOYRS',
      surveyGroup: 'APS_EAPA_2012',
    });
    const result = classifyHit(meta, 'DV - Daily smokers - age started');
    expect(result.role).toBe('derived');
    expect(result.derivation).toBe('derived');
  });

  it('correctly classifies CSD mobility aids as collected, not process', () => {
    const meta = mockMeta({
      variableName: 'ADM_005A',
      surveyGroup: 'CSD_ECI_2017',
    });
    const result = classifyHit(meta, 'Physical aids - Use - Cane, walking stick or crutches');
    expect(result.role).toBe('collected');
    expect(result.origin).toBe('collected');
  });

  it('correctly classifies CCHS interview variables as process', () => {
    const meta = mockMeta({
      variableName: 'ADM_040',
      surveyGroup: 'CCHS_ESCC',
    });
    const result = classifyHit(meta, 'Interview by telephone or in person');
    expect(result.role).toBe('process');
  });

  it('correctly classifies methamphetamine variables as collected, not process', () => {
    const meta = mockMeta({
      variableName: 'MET_05',
      surveyGroup: 'CADS_ECAD_2019',
    });
    const result = classifyHit(meta, 'Used or tried amphetamines or methamphetamine - ever');
    expect(result.role).toBe('collected');
  });

  it('correctly classifies bare weights and imputation flags as process', () => {
    const wt = classifyHit(mockMeta({ variableName: 'WTPM', surveyGroup: 'ACS_EEA_2006' }));
    expect(wt.role).toBe('process');

    const flag = classifyHit(
      mockMeta({ variableName: 'FLAGRR', surveyGroup: 'SGVP_EDBP_2023' }),
      'Imputation flag for INC - Respondent income'
    );
    expect(flag.role).toBe('process');

    const imp = classifyHit(
      mockMeta({ variableName: 'PVTI01', surveyGroup: 'SYC_EJC_2010' }),
      undefined,
      'Imputation Flag - Standard Score for PPVT-R'
    );
    expect(imp.role).toBe('process');
  });
});
