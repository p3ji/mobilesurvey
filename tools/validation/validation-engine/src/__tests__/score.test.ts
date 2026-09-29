import { describe, it, expect } from 'vitest';
import { computeImpact, finalizeFlags } from '../score.js';
import type { DraftFlag, Suppression, ValidatorResponse } from '../types.js';

function resp(id: string, answers: Record<string, unknown>): ValidatorResponse {
  return { id, respondentId: `p-${id}`, submittedAt: '2026-07-06T00:00:00Z', durationMs: 1000, completed: true, answers };
}

function draft(overrides: Partial<DraftFlag> = {}): DraftFlag {
  return {
    responseId: 'r1',
    respondentId: 'p1',
    variableName: 'revenue',
    instanceKey: 'revenue@',
    checkKind: 'metadata',
    checkId: 'range:revenue',
    severity: 'fatal',
    message: 'test',
    observed: 100,
    suspicion: 1,
    ...overrides,
  };
}

describe('computeImpact', () => {
  it('returns 0.5 for record-level flags (no variableName)', () => {
    const responses = [resp('r1', { 'revenue@': 100 })];
    expect(computeImpact(draft({ variableName: null }), responses)).toBe(0.5);
  });

  it('returns a value proportional to the observed share of the column total', () => {
    const responses = [resp('r1', { 'revenue@': 100 }), resp('r2', { 'revenue@': 900 })];
    const impact = computeImpact(draft({ observed: 900 }), responses);
    expect(impact).toBeCloseTo(0.9, 5);
  });

  it('returns 0.5 when the column total is zero', () => {
    const responses = [resp('r1', { 'revenue@': 0 })];
    const impact = computeImpact(draft({ observed: 0 }), responses);
    expect(impact).toBe(0.5);
  });
});

describe('finalizeFlags', () => {
  it('assigns id, runId, impact, and score = suspicion * impact', () => {
    const responses = [resp('r1', { 'revenue@': 100 })];
    const flags = finalizeFlags([draft({ suspicion: 0.8 })], 'run1', responses, []);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.runId).toBe('run1');
    expect(flags[0]!.id).toBeTruthy();
    expect(flags[0]!.score).toBeCloseTo(flags[0]!.suspicion * flags[0]!.impact, 10);
  });

  it('sorts flags by score descending', () => {
    const responses = [resp('r1', { 'revenue@': 100 }), resp('r2', { 'revenue@': 100 })];
    const flags = finalizeFlags(
      [
        draft({ responseId: 'r1', suspicion: 0.2 }),
        draft({ responseId: 'r2', suspicion: 0.9 }),
      ],
      'run1',
      responses,
      [],
    );
    expect(flags[0]!.responseId).toBe('r2');
    expect(flags[1]!.responseId).toBe('r1');
  });

  it('suppresses a flag matching an accepted (checkId, instanceKey, value) triple', () => {
    const responses = [resp('r1', { 'revenue@': 100 })];
    const suppression: Suppression = {
      surveyId: 's1',
      responseId: 'r1',
      checkId: 'range:revenue',
      instanceKey: 'revenue@',
      acceptedValue: 100,
      flagId: 'old-flag',
    };
    const flags = finalizeFlags([draft({ observed: 100 })], 'run1', responses, [suppression]);
    expect(flags).toHaveLength(0);
  });

  it('does not suppress when the value has changed since the accepted disposition', () => {
    const responses = [resp('r1', { 'revenue@': 200 })];
    const suppression: Suppression = {
      surveyId: 's1',
      responseId: 'r1',
      checkId: 'range:revenue',
      instanceKey: 'revenue@',
      acceptedValue: 100, // accepted at 100, but this flag is for the new value 200
      flagId: 'old-flag',
    };
    const flags = finalizeFlags([draft({ observed: 200 })], 'run1', responses, [suppression]);
    expect(flags).toHaveLength(1);
  });
});
