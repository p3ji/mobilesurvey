import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import { runInstrumentEditRerun } from '../editRerun.js';
import { fixtureInstrument } from './fixtures.js';
import type { ValidatorResponse } from '../types.js';

function resp(answers: Record<string, unknown>): ValidatorResponse {
  return { id: 'r1', respondentId: 'p1', submittedAt: '2026-07-06T00:00:00Z', durationMs: 60000, completed: true, answers };
}

describe('runInstrumentEditRerun', () => {
  it('fires the required edit for a blank required question', () => {
    const flags = runInstrumentEditRerun(fixtureInstrument, resp({}));
    expect(flags.some((f) => f.checkId === 'required:revenue' && f.severity === 'fatal')).toBe(true);
  });

  it('fires the authored hard edit (backward reference to a table synthetic total)', () => {
    const answers = {
      [instanceKey('revenue', [])]: 100,
      [instanceKey('T_row1_col1', [])]: 100,
      [instanceKey('T_row2_col1', [])]: 50,
      [instanceKey('T_row2_col2', [])]: 25,
      [instanceKey('budget', [])]: 100, // mismatched: T_TOT_TOT = 175
    };
    const flags = runInstrumentEditRerun(fixtureInstrument, resp(answers));
    expect(flags.some((f) => f.checkId === 'edit.budget.balance' && f.severity === 'fatal')).toBe(true);
  });

  it('clears the hard edit once the budget matches the table grand total', () => {
    const answers = {
      [instanceKey('revenue', [])]: 100,
      [instanceKey('T_row1_col1', [])]: 100,
      [instanceKey('T_row2_col1', [])]: 50,
      [instanceKey('T_row2_col2', [])]: 25,
      [instanceKey('budget', [])]: 175,
    };
    const flags = runInstrumentEditRerun(fixtureInstrument, resp(answers));
    expect(flags.some((f) => f.checkId === 'edit.budget.balance')).toBe(false);
  });

  it('fires the soft edit and marks it as query severity', () => {
    const answers = { [instanceKey('revenue', [])]: 100, [instanceKey('budget', [])]: 950 };
    const flags = runInstrumentEditRerun(fixtureInstrument, resp(answers));
    const soft = flags.find((f) => f.checkId === 'edit.budget.large');
    expect(soft?.severity).toBe('query');
  });

  it('attaches question-level edits to the base variable name and instance key', () => {
    const flags = runInstrumentEditRerun(fixtureInstrument, resp({}));
    const required = flags.find((f) => f.checkId === 'required:revenue');
    expect(required?.variableName).toBe('revenue');
    expect(required?.instanceKey).toBe(instanceKey('revenue', []));
  });
});
