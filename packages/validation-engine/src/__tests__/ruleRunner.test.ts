import { describe, it, expect } from 'vitest';
import { instanceKey } from '@mobilesurvey/runtime-engine';
import { runValidatorRules } from '../ruleRunner.js';
import { fixtureInstrument } from './fixtures.js';
import type { ValidatorResponse, ValidatorRule } from '../types.js';

function resp(answers: Record<string, unknown>): ValidatorResponse {
  return { id: 'r1', respondentId: 'p1', submittedAt: '2026-07-06T00:00:00Z', durationMs: 60000, completed: true, answers };
}

function rule(overrides: Partial<ValidatorRule> = {}): ValidatorRule {
  return {
    id: 'rule.1',
    surveyId: 'survey1',
    name: 'Test rule',
    when: '$revenue > 1000',
    message: 'Revenue over 1000',
    severity: 'query',
    variableName: 'revenue',
    source: 'authored',
    active: true,
    createdAt: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

describe('runValidatorRules', () => {
  it('fires an authored rule when the condition is true', () => {
    const flags = runValidatorRules(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 2000 }), [rule()]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.checkId).toBe('rule.1');
    expect(flags[0]!.severity).toBe('query');
  });

  it('does not fire when the condition is false', () => {
    const flags = runValidatorRules(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 10 }), [rule()]);
    expect(flags).toHaveLength(0);
  });

  it('skips inactive rules', () => {
    const flags = runValidatorRules(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 2000 }), [rule({ active: false })]);
    expect(flags).toHaveLength(0);
  });

  it('can reference synthetic table totals at root scope', () => {
    const answers = {
      [instanceKey('T_row1_col1', [])]: 100,
      [instanceKey('T_row2_col1', [])]: 50,
    };
    const totalsRule = rule({ id: 'rule.totals', when: 'isAnswered($T_TOT_TOT) && $T_TOT_TOT > 100', variableName: null });
    const flags = runValidatorRules(fixtureInstrument, resp(answers), [totalsRule]);
    expect(flags.some((f) => f.checkId === 'rule.totals')).toBe(true);
  });

  it('silently skips a rule with a malformed expression rather than throwing', () => {
    const badRule = rule({ id: 'rule.bad', when: '$revenue >>> 5 !!!' });
    expect(() => runValidatorRules(fixtureInstrument, resp({}), [badRule])).not.toThrow();
    const flags = runValidatorRules(fixtureInstrument, resp({}), [badRule]);
    expect(flags).toHaveLength(0);
  });

  it('marks severity as fatal for hard rules and query for soft rules', () => {
    const hard = rule({ id: 'rule.hard', severity: 'fatal' });
    const flags = runValidatorRules(fixtureInstrument, resp({ [instanceKey('revenue', [])]: 2000 }), [hard]);
    expect(flags[0]!.suspicion).toBe(1.0);
  });
});
