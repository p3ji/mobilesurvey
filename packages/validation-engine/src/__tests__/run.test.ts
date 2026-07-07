import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import { runValidation } from '../run.js';
import { applyCorrections } from '../corrections.js';
import { fixtureInstrument } from './fixtures.js';
import type { Correction, ValidatorResponse, ValidatorRule } from '../types.js';

function resp(id: string, answers: Record<string, unknown>): ValidatorResponse {
  return { id, respondentId: `p-${id}`, submittedAt: '2026-07-06T00:00:00Z', durationMs: 120000, completed: true, answers };
}

describe('runValidation (orchestrator)', () => {
  it('combines metadata, instrument-edit, rule, and stat checks into one scored, sorted queue', () => {
    const responses = [
      resp('r1', {}), // blank required field -> instrument-edit fatal
      resp('r2', { [instanceKey('revenue', [])]: -50 }), // out-of-range -> metadata fatal
      resp('r3', { [instanceKey('revenue', [])]: 500 }), // clean
    ];
    const rules: ValidatorRule[] = [
      {
        id: 'rule.high',
        surveyId: 's1',
        name: 'High revenue',
        when: '$revenue > 400',
        message: 'Revenue is high',
        severity: 'query',
        variableName: 'revenue',
        source: 'authored',
        active: true,
        createdAt: '2026-07-06T00:00:00Z',
      },
    ];

    const result = runValidation({
      runId: 'run1',
      surveyId: 's1',
      startedAt: '2026-07-06T00:00:00Z',
      instrument: fixtureInstrument,
      responses,
      rules,
    });

    expect(result.run.summary.responsesAnalyzed).toBe(3);
    expect(result.flags.some((f) => f.responseId === 'r1' && f.checkKind === 'instrument-edit')).toBe(true);
    expect(result.flags.some((f) => f.responseId === 'r2' && f.checkKind === 'metadata')).toBe(true);
    expect(result.flags.some((f) => f.responseId === 'r3' && f.checkKind === 'rule')).toBe(true);
    // sorted descending by score
    for (let i = 1; i < result.flags.length; i++) {
      expect(result.flags[i - 1]!.score).toBeGreaterThanOrEqual(result.flags[i]!.score);
    }
    expect(result.run.summary.flagCount).toBe(result.flags.length);
    expect(result.run.summary.fatalCount + result.run.summary.queryCount).toBe(result.flags.length);
  });

  it('respects the config to disable individual check families', () => {
    const responses = [resp('r1', {})]; // would fire required (instrument-edit) if enabled
    const result = runValidation({
      runId: 'run1',
      surveyId: 's1',
      startedAt: '2026-07-06T00:00:00Z',
      instrument: fixtureInstrument,
      responses,
      config: { metadata: false, instrumentEdits: false, rules: false, stats: false },
    });
    expect(result.flags).toHaveLength(0);
  });

  it('validates against the edited view when corrections are applied before the run', () => {
    const raw = [resp('r1', { [instanceKey('revenue', [])]: -50 })];
    const corrections: Correction[] = [
      {
        id: 'c1',
        surveyId: 's1',
        responseId: 'r1',
        instanceKey: instanceKey('revenue', []),
        oldValue: -50,
        newValue: 500,
        reason: 'sign error, respondent meant positive',
        decidedBy: 'analyst1',
        decidedAt: '2026-07-06T01:00:00Z',
      },
    ];
    const edited = applyCorrections(raw, corrections);

    const rawResult = runValidation({
      runId: 'run-raw',
      surveyId: 's1',
      startedAt: '2026-07-06T00:00:00Z',
      instrument: fixtureInstrument,
      responses: raw,
    });
    const editedResult = runValidation({
      runId: 'run-edited',
      surveyId: 's1',
      startedAt: '2026-07-06T00:00:00Z',
      instrument: fixtureInstrument,
      responses: edited,
    });

    expect(rawResult.flags.some((f) => f.checkId === 'range:revenue')).toBe(true);
    expect(editedResult.flags.some((f) => f.checkId === 'range:revenue')).toBe(false);
    expect(raw[0]!.answers[instanceKey('revenue', [])]).toBe(-50); // raw never mutated
  });

  it('reports skipped checks (e.g. too few observations for outliers) with a reason', () => {
    const responses = [resp('r1', { [instanceKey('revenue', [])]: 500 })];
    const result = runValidation({
      runId: 'run1',
      surveyId: 's1',
      startedAt: '2026-07-06T00:00:00Z',
      instrument: fixtureInstrument,
      responses,
    });
    expect(result.run.summary.skipped.some((s) => s.checkId === 'mad:revenue')).toBe(true);
  });
});
