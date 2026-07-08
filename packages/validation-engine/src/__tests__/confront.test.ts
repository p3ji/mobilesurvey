import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import { runConfrontationChecks } from '../confront.js';
import { fixtureInstrument } from './fixtures.js';
import type { ConfrontationMapping, ReferenceDataset, ValidatorResponse } from '../types.js';

function resp(id: string, answers: Record<string, unknown>): ValidatorResponse {
  return { id, respondentId: `p-${id}`, submittedAt: '2026-07-06T00:00:00Z', durationMs: 60000, completed: true, answers };
}

function dataset(rows: Record<string, unknown>[], overrides: Partial<ReferenceDataset> = {}): ReferenceDataset {
  return {
    id: 'ds1',
    surveyId: 's1',
    name: 'Admin file',
    keyVariable: 'notes', // any text field works as a join key for these tests
    keyColumn: 'biz_id',
    columns: ['biz_id', 'revenue_admin'],
    rows,
    uploadedAt: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

function mapping(overrides: Partial<ConfrontationMapping> = {}): ConfrontationMapping {
  return {
    id: 'map1',
    datasetId: 'ds1',
    surveyExpr: '$revenue',
    refColumn: 'revenue_admin',
    severity: 'query',
    label: 'Revenue vs. admin file',
    ...overrides,
  };
}

describe('runConfrontationChecks', () => {
  it('does not flag a matched value within tolerance', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 100 })];
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping()]);
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });

  it('flags a matched value outside tolerance', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 5000 })];
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping()]);
    const flag = flags.find((f) => f.checkId === 'confront:map1');
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('query');
    expect(flag!.expected).toContain('100');
  });

  it('passes within a relative tolerance', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 1000 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 1050 })]; // 5% off
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping({ tolerancePct: 0.1 })]);
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });

  it('fails outside a relative tolerance', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 1000 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 1500 })]; // 50% off
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping({ tolerancePct: 0.1 })]);
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(1);
  });

  it('passes if within EITHER tolerance when both are set', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 1000 }]);
    // 15% off (fails pct 10%) but only 150 absolute off (passes abs 200)
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 1150 })];
    const { flags } = runConfrontationChecks(
      fixtureInstrument, responses, ds, [mapping({ tolerancePct: 0.1, toleranceAbs: 200 })],
    );
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });

  it('applies a unit-conversion transform on the reference value', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100_000 }]); // reference in dollars
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 100 })]; // survey in thousands
    const { flags } = runConfrontationChecks(
      fixtureInstrument, responses, ds, [mapping({ transform: '$ref / 1000' })],
    );
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });

  it('flags a survey response whose key has no match in the reference dataset', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'UNKNOWN-KEY', [instanceKey('revenue', [])]: 100 })];
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping()]);
    expect(flags.some((f) => f.checkId === 'confront-unmatched:ds1' && f.severity === 'query')).toBe(true);
  });

  it('reports a reference-only gap for a key never matched by any response', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }, { biz_id: 'B2', revenue_admin: 200 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 100 })];
    const { gaps } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping()]);
    expect(gaps).toEqual([{ direction: 'reference-only', datasetId: 'ds1', keyValue: 'B2' }]);
  });

  it('skips responses with no key value without crashing or flagging', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }]);
    const responses = [resp('r1', { [instanceKey('revenue', [])]: 100 })]; // notes (key) is blank
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [mapping()]);
    expect(flags).toHaveLength(0);
  });

  it('silently skips a malformed surveyExpr rather than throwing', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 100 }]);
    const responses = [resp('r1', { [instanceKey('notes', [])]: 'A1', [instanceKey('revenue', [])]: 100 })];
    const badMapping = mapping({ surveyExpr: '$revenue >>> !!! bad' });
    expect(() => runConfrontationChecks(fixtureInstrument, responses, ds, [badMapping])).not.toThrow();
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [badMapping]);
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });

  it('can reference synthetic table totals in a surveyExpr', () => {
    const ds = dataset([{ biz_id: 'A1', revenue_admin: 150 }]);
    const responses = [resp('r1', {
      [instanceKey('notes', [])]: 'A1',
      [instanceKey('T_row1_col1', [])]: 100,
      [instanceKey('T_row2_col1', [])]: 50,
    })];
    const totalsMapping = mapping({ surveyExpr: '$T_TOT_col1' });
    const { flags } = runConfrontationChecks(fixtureInstrument, responses, ds, [totalsMapping]);
    expect(flags.filter((f) => f.checkId === 'confront:map1')).toHaveLength(0);
  });
});
