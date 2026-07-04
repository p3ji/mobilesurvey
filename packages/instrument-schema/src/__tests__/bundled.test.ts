import { describe, it, expect } from 'vitest';
import { BUNDLED_SURVEYS, bundledSurvey, surveyCollectsData } from '../bundled.js';
import { validateInstrument } from '../validate.js';

describe('bundled survey registry', () => {
  it('exposes the lfs, demo, and fsep aliases', () => {
    expect(bundledSurvey('lfs')?.title).toBe('Household & Employment Survey');
    expect(bundledSurvey('demo')?.title).toBe('Feature Demo Survey');
    expect(bundledSurvey('fsep')?.title).toBe('Federal Science Expenditures and Personnel (Demo)');
  });

  it('every bundled instrument is schema-valid', () => {
    for (const s of BUNDLED_SURVEYS) {
      expect(validateInstrument(s.instrument).ok).toBe(true);
    }
  });

  describe('surveyCollectsData', () => {
    it('is false for the exploration-only Household & Employment survey', () => {
      expect(surveyCollectsData('lfs')).toBe(false);
      expect(bundledSurvey('lfs')?.collectsData).toBe(false);
    });

    it('is false for the exploration-only FSEP demo', () => {
      expect(surveyCollectsData('fsep')).toBe(false);
      expect(bundledSurvey('fsep')?.collectsData).toBe(false);
    });

    it('is true for the live Feature Demo survey', () => {
      expect(surveyCollectsData('demo')).toBe(true);
    });

    it('defaults to true for unknown (real, user-created) survey ids', () => {
      expect(surveyCollectsData('s-abc123')).toBe(true);
    });

    it('returns false for a null/undefined id (no survey selected)', () => {
      expect(surveyCollectsData(null)).toBe(false);
      expect(surveyCollectsData(undefined)).toBe(false);
    });
  });
});
