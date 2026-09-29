import { describe, it, expect } from 'vitest';
import { applyCorrections } from '../corrections.js';
import type { Correction, ValidatorResponse } from '../types.js';

function resp(id: string, answers: Record<string, unknown>): ValidatorResponse {
  return { id, respondentId: `p-${id}`, submittedAt: '2026-07-06T00:00:00Z', durationMs: 1000, completed: true, answers };
}

function correction(overrides: Partial<Correction> = {}): Correction {
  return {
    id: 'c1',
    surveyId: 's1',
    responseId: 'r1',
    instanceKey: 'revenue@',
    oldValue: 100,
    newValue: 200,
    reason: 'unit slip, respondent meant thousands',
    decidedBy: 'analyst1',
    decidedAt: '2026-07-06T01:00:00Z',
    ...overrides,
  };
}

describe('applyCorrections', () => {
  it('overlays a correction onto the matching response without mutating the input', () => {
    const raw = [resp('r1', { 'revenue@': 100 })];
    const edited = applyCorrections(raw, [correction()]);
    expect(edited[0]!.answers['revenue@']).toBe(200);
    expect(raw[0]!.answers['revenue@']).toBe(100); // raw untouched
  });

  it('leaves responses with no corrections unchanged (same reference)', () => {
    const raw = [resp('r1', { 'revenue@': 100 }), resp('r2', { 'revenue@': 50 })];
    const edited = applyCorrections(raw, [correction({ responseId: 'r1' })]);
    expect(edited[1]).toBe(raw[1]); // untouched response passes through by reference
  });

  it('applies only the latest correction when multiple exist for the same cell', () => {
    const raw = [resp('r1', { 'revenue@': 100 })];
    const corrections = [
      correction({ id: 'c1', newValue: 150, decidedAt: '2026-07-06T01:00:00Z' }),
      correction({ id: 'c2', newValue: 300, decidedAt: '2026-07-06T02:00:00Z' }),
    ];
    const edited = applyCorrections(raw, corrections);
    expect(edited[0]!.answers['revenue@']).toBe(300);
  });

  it('applies corrections to different cells independently', () => {
    const raw = [resp('r1', { 'revenue@': 100, 'notes@': 'old' })];
    const corrections = [
      correction({ instanceKey: 'revenue@', newValue: 200 }),
      correction({ id: 'c2', instanceKey: 'notes@', newValue: 'new' }),
    ];
    const edited = applyCorrections(raw, corrections);
    expect(edited[0]!.answers).toMatchObject({ 'revenue@': 200, 'notes@': 'new' });
  });
});
