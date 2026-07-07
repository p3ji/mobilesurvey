import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import {
  computeMissingness,
  runDuplicateChecks,
  runOutlierChecks,
  runSpeederChecks,
  runStraightLineChecks,
} from '../statChecks.js';
import { fixtureInstrument } from './fixtures.js';
import type { ValidatorResponse } from '../types.js';

function resp(id: string, answers: Record<string, unknown>, overrides: Partial<ValidatorResponse> = {}): ValidatorResponse {
  return {
    id,
    respondentId: `p-${id}`,
    submittedAt: '2026-07-06T00:00:00Z',
    durationMs: 120000,
    completed: true,
    answers,
    ...overrides,
  };
}

describe('runOutlierChecks', () => {
  it('flags a clear outlier via modified z-score', () => {
    const responses = [
      resp('r1', { [instanceKey('revenue', [])]: 100 }),
      resp('r2', { [instanceKey('revenue', [])]: 105 }),
      resp('r3', { [instanceKey('revenue', [])]: 98 }),
      resp('r4', { [instanceKey('revenue', [])]: 102 }),
      resp('r5', { [instanceKey('revenue', [])]: 101 }),
      resp('r6', { [instanceKey('revenue', [])]: 99 }),
      resp('r7', { [instanceKey('revenue', [])]: 103 }),
      resp('r8', { [instanceKey('revenue', [])]: 100000 }), // outlier
    ];
    const { flags } = runOutlierChecks(responses, 3.5, 8);
    expect(flags.some((f) => f.responseId === 'r8' && f.checkId === 'mad:revenue')).toBe(true);
    expect(flags.some((f) => f.responseId === 'r1')).toBe(false);
  });

  it('skips a variable with too few observations and reports why', () => {
    const responses = [resp('r1', { [instanceKey('revenue', [])]: 100 })];
    const { flags, skipped } = runOutlierChecks(responses, 3.5, 8);
    expect(flags).toHaveLength(0);
    expect(skipped.some((s) => s.checkId === 'mad:revenue')).toBe(true);
  });
});

describe('runDuplicateChecks', () => {
  it('flags byte-identical responses', () => {
    const answers = { [instanceKey('revenue', [])]: 500 };
    const responses = [resp('r1', answers), resp('r2', { ...answers })];
    const flags = runDuplicateChecks(responses);
    expect(flags.filter((f) => f.checkId === 'duplicate-exact')).toHaveLength(2);
  });

  it('flags a respondent with multiple completed responses', () => {
    const r1 = resp('r1', { [instanceKey('revenue', [])]: 100 }, { respondentId: 'same-person' });
    const r2 = resp('r2', { [instanceKey('revenue', [])]: 999 }, { respondentId: 'same-person' });
    const flags = runDuplicateChecks([r1, r2]);
    expect(flags.filter((f) => f.checkId === 'duplicate-respondent')).toHaveLength(2);
  });

  it('does not flag unique single responses', () => {
    const flags = runDuplicateChecks([resp('r1', { [instanceKey('revenue', [])]: 1 })]);
    expect(flags).toHaveLength(0);
  });
});

describe('runSpeederChecks', () => {
  it('flags a response completed faster than the threshold', () => {
    const responses = [resp('r1', {}, { durationMs: 5000 })];
    const { flags } = runSpeederChecks(responses, 60000);
    expect(flags.some((f) => f.responseId === 'r1' && f.checkId === 'speeder')).toBe(true);
  });

  it('does not flag a normal-duration response', () => {
    const responses = [resp('r1', {}, { durationMs: 300000 })];
    const { flags } = runSpeederChecks(responses, 60000);
    expect(flags).toHaveLength(0);
  });

  it('reports skipped when no completed responses have a duration', () => {
    const responses = [resp('r1', {}, { completed: false, durationMs: null })];
    const { flags, skipped } = runSpeederChecks(responses, 60000);
    expect(flags).toHaveLength(0);
    expect(skipped.some((s) => s.checkId === 'speeder')).toBe(true);
  });
});

describe('runStraightLineChecks', () => {
  it('flags a grid where every row has the identical answer', () => {
    const answers = {
      [instanceKey('G_r1', [])]: 'lo',
      [instanceKey('G_r2', [])]: 'lo',
      [instanceKey('G_r3', [])]: 'lo',
    };
    const flags = runStraightLineChecks(fixtureInstrument, [resp('r1', answers)]);
    expect(flags.some((f) => f.checkId === 'straight-line:G')).toBe(true);
  });

  it('does not flag a grid with varied answers', () => {
    const answers = {
      [instanceKey('G_r1', [])]: 'lo',
      [instanceKey('G_r2', [])]: 'hi',
      [instanceKey('G_r3', [])]: 'lo',
    };
    const flags = runStraightLineChecks(fixtureInstrument, [resp('r1', answers)]);
    expect(flags).toHaveLength(0);
  });

  it('does not flag a partially-answered grid', () => {
    const answers = { [instanceKey('G_r1', [])]: 'lo' };
    const flags = runStraightLineChecks(fixtureInstrument, [resp('r1', answers)]);
    expect(flags).toHaveLength(0);
  });
});

describe('computeMissingness', () => {
  it('flags a variable with a high blank rate', () => {
    const responses = [
      resp('r1', { [instanceKey('notes', [])]: 'hi' }),
      resp('r2', {}),
      resp('r3', {}),
      resp('r4', {}),
    ];
    const entries = computeMissingness(fixtureInstrument, responses, 0.5);
    expect(entries.some((e) => e.variableName === 'notes')).toBe(true);
  });

  it('does not flag a variable that is mostly answered', () => {
    const responses = [
      resp('r1', { [instanceKey('notes', [])]: 'a' }),
      resp('r2', { [instanceKey('notes', [])]: 'b' }),
      resp('r3', { [instanceKey('notes', [])]: 'c' }),
      resp('r4', {}),
    ];
    const entries = computeMissingness(fixtureInstrument, responses, 0.5);
    expect(entries.some((e) => e.variableName === 'notes')).toBe(false);
  });
});
