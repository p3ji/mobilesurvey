import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import { buildFieldRegistry, runMetadataChecks } from '../metadataChecks.js';
import { fixtureInstrument } from './fixtures.js';
import type { ValidatorResponse } from '../types.js';

function resp(answers: Record<string, unknown>): ValidatorResponse {
  return { id: 'r1', respondentId: 'p1', submittedAt: '2026-07-06T00:00:00Z', durationMs: 60000, completed: true, answers };
}

describe('buildFieldRegistry', () => {
  it('registers scalar, grid, markAll, and table-generated field names', () => {
    const reg = buildFieldRegistry(fixtureInstrument);
    expect(reg.get('revenue')).toMatchObject({ kind: 'numeric', min: 0, max: 100000 });
    expect(reg.get('status')).toMatchObject({ kind: 'code', multi: false });
    expect(reg.get('G_r1')).toMatchObject({ kind: 'gridRow' });
    expect(reg.get('M_a')).toMatchObject({ kind: 'markAllCategory' });
    expect(reg.get('T_row1_col1')).toMatchObject({ kind: 'tableCell', disabled: false });
    expect(reg.get('T_row1_col2')).toMatchObject({ kind: 'tableCell', disabled: true });
  });
});

describe('runMetadataChecks', () => {
  it('flags a numeric value below the minimum', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('revenue', [])]: -5 }));
    expect(flags.some((f) => f.checkId === 'range:revenue' && f.severity === 'fatal')).toBe(true);
  });

  it('flags a numeric value above the maximum', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 999999 }));
    expect(flags.some((f) => f.checkId === 'range:revenue' && f.severity === 'fatal')).toBe(true);
  });

  it('does not flag an in-range numeric value', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 500 }));
    expect(flags.some((f) => f.variableName === 'revenue')).toBe(false);
  });

  it('flags an out-of-scheme code as fatal', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('status', [])]: 'bogus' }));
    expect(flags.some((f) => f.checkId === 'code:status' && f.severity === 'fatal')).toBe(true);
  });

  it('accepts a valid code', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('status', [])]: 'active' }));
    expect(flags.some((f) => f.variableName === 'status')).toBe(false);
  });

  it('flags a disabled table cell that has a value', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('T_row1_col2', [])]: 10 }));
    expect(flags.some((f) => f.checkId === 'tablebounds:T_row1_col2' && f.severity === 'fatal')).toBe(true);
  });

  it('flags a table cell outside its bounds', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('T_row1_col1', [])]: 5000 }));
    expect(flags.some((f) => f.checkId === 'tablebounds:T_row1_col1' && f.severity === 'fatal')).toBe(true);
  });

  it('flags an invalid grid row selection', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('G_r1', [])]: 'nope' }));
    expect(flags.some((f) => f.checkId === 'code:G_r1' && f.severity === 'fatal')).toBe(true);
  });

  it('flags an invalid markAll dichotomous code', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('M_a', [])]: 42 }));
    expect(flags.some((f) => f.checkId === 'code:M_a' && f.severity === 'fatal')).toBe(true);
  });

  it('accepts valid markAll codes (1 and 2)', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('M_a', [])]: 1, [instanceKey('M_b', [])]: 2 }));
    expect(flags.some((f) => f.variableName === 'M_a' || f.variableName === 'M_b')).toBe(false);
  });

  it('flags an answer key with no matching variable as "orphan"', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ 'stale_var@': 'x' }));
    expect(flags.some((f) => f.checkId === 'orphan' && f.severity === 'query')).toBe(true);
  });

  it('does not flag blank values (required is handled by editRerun, not metadata)', () => {
    const flags = runMetadataChecks(fixtureInstrument, resp({ [instanceKey('revenue', [])]: '' }));
    expect(flags).toHaveLength(0);
  });
});
