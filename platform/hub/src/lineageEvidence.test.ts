import { describe, expect, it } from 'vitest';
import { lineageEvidence } from './lineageEvidence.js';

describe('lineage evidence display', () => {
  it('uses a solid link only when the exact source name occurs in the note', () => {
    expect(lineageEvidence({ sourceVarName: 'H01', statcanNote: 'Derived based on H01 and H02.', reviewStatus: 'verified' })).toBe('named');
    expect(lineageEvidence({ sourceVarName: 'H01', statcanNote: 'Derived based on H010.', reviewStatus: 'verified' })).toBe('mapped');
  });

  it('marks a mapped component or range member as less direct evidence', () => {
    expect(lineageEvidence({ sourceVarName: 'M21S', statcanNote: 'Derived based on M21.', reviewStatus: 'verified' })).toBe('mapped');
    expect(lineageEvidence({ sourceVarName: 'E20A', statcanNote: 'Derived from E14A to E28A.', reviewStatus: 'verified' })).toBe('mapped');
    expect(lineageEvidence({ sourceVarName: 'POSTAL_CODE', statcanNote: 'Identical to POSTAL_CODE.', reviewStatus: 'needs_review' })).toBe('provisional');
  });
});
