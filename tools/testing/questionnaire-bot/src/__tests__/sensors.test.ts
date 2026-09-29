/**
 * Sensor module S4: the enumerator treats sensor questions as answerable — consent is a
 * branch (granted/declined both enumerated outside canonical mode), captures are filled with
 * deterministic bot values, so instruments with sensor pages still complete.
 */
import { describe, it, expect } from 'vitest';
import { demoInstrument } from '@mobilesurvey/instrument-schema';
import { enumeratePaths } from '../enumerator.js';

describe('sensor questions in path enumeration', () => {
  it('coverage scenarios complete the demo (which ends in a sensor page)', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });

  it('fills consent, capture, and confirmed recognition variables', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    const answersOf = (s: (typeof scenarios)[number]): Record<string, unknown> =>
      Object.fromEntries(s.steps.map((st) => [st.instanceKey, st.value]));
    const granted = scenarios
      .map(answersOf)
      .find((a) => a['CONSENT_GEOLOCATION@'] === 'granted');
    expect(granted).toBeDefined();
    expect(String(granted!['demoLoc@'])).toContain('45.42');
    expect(granted!['CONSENT_CAMERA@']).toBeDefined();
    if (granted!['CONSENT_CAMERA@'] === 'granted') {
      expect(granted!['demoPhoto@']).toBe('bot/q.demoPhoto.jpg');
    }
  });

  it('all-paths enumerates both consent branches', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'all-paths', maxPaths: 200 });
    const answersOf = (s: (typeof scenarios)[number]): Record<string, unknown> =>
      Object.fromEntries(s.steps.map((st) => [st.instanceKey, st.value]));
    const geoDecisions = new Set(scenarios.map((s) => answersOf(s)['CONSENT_GEOLOCATION@']));
    expect(geoDecisions.has('granted')).toBe(true);
    expect(geoDecisions.has('declined')).toBe(true);
    // A declined geolocation still completes via the manual fallback.
    const declinedIdx = scenarios.findIndex((s) => answersOf(s)['CONSENT_GEOLOCATION@'] === 'declined');
    expect(declinedIdx).toBeGreaterThanOrEqual(0);
    expect(answersOf(scenarios[declinedIdx]!)['demoLoc@']).toBe('Bot City');
    expect(scenarios[declinedIdx]!.complete).toBe(true);
  });
});
