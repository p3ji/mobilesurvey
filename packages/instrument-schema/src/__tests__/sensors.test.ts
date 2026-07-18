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
    expect(issuesOf(inst).join('\n')).toContain('requires a matching');
  });

  it('flags a photo question when only geolocation is declared (kinds are independent)', () => {
    const inst = clone();
    inst.sensors!.sensors = inst.sensors!.sensors.filter((s) => s.kind !== 'camera');
    const msgs = issuesOf(inst).join('\n');
    expect(msgs).toContain('"camera" declaration');
    expect(msgs).not.toContain('"geolocation" declaration');
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

  it('flags a recognition itemSchemeRef that names no scheme', () => {
    const inst = clone();
    const page = inst.sequence.children.find(
      (c): c is SequenceConstruct => c.type === 'sequence' && c.id === 'pg.sensor',
    )!;
    const q = page.children.find(
      (c): c is QuestionConstruct => c.type === 'question' && c.id === 'q.demoPhoto',
    )!;
    (q.responseDomain as { recognition: { itemSchemeRef?: string } }).recognition.itemSchemeRef =
      'cs.nope';
    expect(issuesOf(inst).join('\n')).toContain('Unknown category scheme "cs.nope"');
  });

  it('flags a recognition variablePrefix colliding with another generator', () => {
    const inst = clone();
    const page = inst.sequence.children.find(
      (c): c is SequenceConstruct => c.type === 'sequence' && c.id === 'pg.sensor',
    )!;
    const q = page.children.find(
      (c): c is QuestionConstruct => c.type === 'question' && c.id === 'q.demoPhoto',
    )!;
    (q.responseDomain as { recognition: { variablePrefix: string } }).recognition.variablePrefix =
      'demoLoc'; // already claimed by the geolocation question
    expect(issuesOf(inst).join('\n')).toContain('would collide');
  });

  it('sensor declarations require a purpose text', () => {
    const inst = clone();
    (inst.sensors!.sensors[0]! as { purpose: Record<string, string> }).purpose = {};
    const res = validateInstrument(inst);
    expect(res.ok).toBe(false);
  });
});
