/**
 * Sensor module S1: schema + referential-integrity rules for the geolocation domain and
 * the instrument-level SensorConfig declarations.
 */
import { describe, it, expect } from 'vitest';
import { demoInstrument } from '../examples/demo.instrument.js';
import { validateInstrument } from '../validate.js';
import type { Instrument, QuestionConstruct, SequenceConstruct } from '../types.js';

function clone(): Instrument {
  return JSON.parse(JSON.stringify(demoInstrument)) as Instrument;
}

function issuesOf(inst: Instrument): string[] {
  const res = validateInstrument(inst);
  return res.ok ? [] : res.issues.map((i) => i.message);
}

describe('geolocation domain validation', () => {
  it('the demo instrument (with its sensor declaration) validates clean', () => {
    expect(issuesOf(demoInstrument as Instrument)).toEqual([]);
  });

  it('flags a geolocation question whose sensor is not declared', () => {
    const inst = clone();
    delete inst.sensors;
    expect(issuesOf(inst).join('\n')).toContain('requires a matching declaration');
  });

  it('flags a variableRef colliding with a markAll/grid variablePrefix', () => {
    const inst = clone();
    // Point an existing markAll-style generator at the geolocation base name.
    const page = inst.sequence.children.find(
      (c): c is SequenceConstruct => c.type === 'sequence' && c.id === 'pg.sensor',
    )!;
    page.children.push({
      type: 'question',
      id: 'q.clash',
      variableRef: 'topic',
      text: { en: 'Clash' },
      responseDomain: { type: 'markAll', categorySchemeRef: 'cs.topics', variablePrefix: 'demoLoc' },
    } as QuestionConstruct);
    expect(issuesOf(inst).join('\n')).toContain('would collide');
  });

  it('rejects authored variables that use the reserved consent names', () => {
    const inst = clone();
    inst.variables.push({
      id: 'v.badConsent',
      name: 'CONSENT_GEOLOCATION',
      kind: 'collected',
      label: { en: 'nope' },
      representation: 'text',
    });
    expect(issuesOf(inst).join('\n')).toContain('reserved');
  });

  it('rejects out-of-range precision via Zod', () => {
    const inst = clone();
    const page = inst.sequence.children.find(
      (c): c is SequenceConstruct => c.type === 'sequence' && c.id === 'pg.sensor',
    )!;
    const q = page.children.find((c): c is QuestionConstruct => c.type === 'question')!;
    (q.responseDomain as { precision: number }).precision = 9;
    const res = validateInstrument(inst);
    expect(res.ok).toBe(false);
  });

  it('sensor declarations require a purpose text', () => {
    const inst = clone();
    (inst.sensors!.sensors[0]! as { purpose: Record<string, string> }).purpose = {};
    const res = validateInstrument(inst);
    expect(res.ok).toBe(false);
  });
});
