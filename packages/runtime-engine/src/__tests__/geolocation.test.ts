/**
 * Sensor module S1: the geolocation render item — consent gating, sub-variable keys,
 * required behaviour, numbering, and the deterministic sensor mock.
 */
import { describe, it, expect } from 'vitest';
import { demoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import { flattenInstrument } from '../flatten.js';
import { createMockSensorServices } from '../integrations.js';
import { numberQuestions, pageHasHardEdits, paginate } from '../paginate.js';
import type { RenderItem, RuntimeState } from '../types.js';

type GeoItem = Extract<RenderItem, { kind: 'geolocation' }>;

function stateWith(responses: Record<string, unknown>): RuntimeState {
  return { responses, sample: {}, language: 'en' };
}

function geoItem(instrument: Instrument, responses: Record<string, unknown>): GeoItem {
  const { items } = flattenInstrument(instrument, stateWith(responses));
  const item = items.find((i): i is GeoItem => i.kind === 'geolocation');
  expect(item).toBeDefined();
  return item!;
}

describe('geolocation render item', () => {
  it('emits a geolocation item with the generated sub-variable keys', () => {
    const item = geoItem(demoInstrument, {});
    expect(item.instanceKey).toBe('demoLoc@');
    expect(item.subKeys).toEqual({
      lat: 'demoLoc_LAT@',
      lon: 'demoLoc_LON@',
      acc: 'demoLoc_ACC@',
      ts: 'demoLoc_TS@',
      src: 'demoLoc_SRC@',
    });
    // Root-scoped so `$CONSENT_GEOLOCATION` resolves in routing expressions.
    expect(item.consentKey).toBe('CONSENT_GEOLOCATION@');
    expect(item.precision).toBe(2); // the demo deliberately coarsens to ~1 km
    expect(item.manualFallback).toBe(true);
  });

  it('reads the consent decision from the reserved session-global variable', () => {
    expect(geoItem(demoInstrument, {}).consent).toBeUndefined();
    expect(geoItem(demoInstrument, { 'CONSENT_GEOLOCATION@': 'granted' }).consent).toBe('granted');
    expect(geoItem(demoInstrument, { 'CONSENT_GEOLOCATION@': 'declined' }).consent).toBe('declined');
    // Garbage in the variable is treated as "not yet decided", never as consent.
    expect(geoItem(demoInstrument, { 'CONSENT_GEOLOCATION@': 42 }).consent).toBeUndefined();
  });

  it('localizes the consent purpose text from the sensor declaration', () => {
    const item = geoItem(demoInstrument, {});
    expect(item.purpose).toContain('public demo');
    expect(item.retention).toContain('cleared');
  });

  it('is counted in question numbering and gates pages via hard edits when required', () => {
    const required: Instrument = JSON.parse(JSON.stringify(demoInstrument));
    const walk = (nodes: { type: string; id?: string; children?: unknown[] }[]): void => {
      for (const n of nodes) {
        if (n.type === 'question' && n.id === 'q.demoLoc') (n as { required?: boolean }).required = true;
        if (Array.isArray(n.children)) walk(n.children as typeof nodes);
      }
    };
    walk([required.sequence as unknown as { type: string; children: unknown[] }]);

    const { items } = flattenInstrument(required, stateWith({}));
    const { pages } = paginate(items);
    const numbers = numberQuestions(pages);
    const item = items.find((i): i is GeoItem => i.kind === 'geolocation')!;
    expect(numbers.get(item.key)).toBeGreaterThan(0);
    expect(item.firedEdits.some((e) => e.type === 'hard')).toBe(true);
    const sensorPage = pages.find((p) => p.some((i) => i.kind === 'geolocation'))!;
    expect(pageHasHardEdits(sensorPage)).toBe(true);

    // An answer (from either a fix or the manual fallback) satisfies required.
    const answered = flattenInstrument(required, stateWith({ 'demoLoc@': 'Ottawa' }));
    const answeredItem = answered.items.find((i): i is GeoItem => i.kind === 'geolocation')!;
    expect(answeredItem.firedEdits).toHaveLength(0);
  });

  it('renders an empty purpose when the sensor is not declared (runtime refuses capture)', () => {
    const undeclared: Instrument = JSON.parse(JSON.stringify(demoInstrument));
    delete (undeclared as { sensors?: unknown }).sensors;
    const item = geoItem(undeclared, {});
    expect(item.purpose).toBe('');
  });
});

describe('createMockSensorServices', () => {
  it('returns a deterministic Ottawa-area fix', async () => {
    const mock = createMockSensorServices();
    const res = await mock.captureLocation();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fix.lat).toBeCloseTo(45.42, 1);
      expect(res.fix.lon).toBeCloseTo(-75.7, 1);
      expect(res.fix.accuracyM).toBe(12);
    }
  });
});
