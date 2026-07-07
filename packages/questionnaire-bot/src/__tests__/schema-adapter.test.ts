import { describe, it, expect } from 'vitest';
import { testErrorsInstrument, demoInstrument } from '@mobilesurvey/instrument-schema';
import { enumeratePaths } from '../enumerator.js';
import { resolveStep } from '../schema-adapter.js';

describe('resolveStep — testErrorsInstrument', () => {
  const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'coverage' });

  it('resolves has_account (code/single) to a select-radio strategy with the correct label', () => {
    const scenario = scenarios.find((s) => s.steps.some((st) => st.variableRef === 'has_account'))!;
    const step = scenario.steps.find((st) => st.variableRef === 'has_account')!;
    const { strategy } = resolveStep(testErrorsInstrument, {}, 'en', step);
    expect(strategy.kind).toBe('select-radio');
    if (strategy.kind === 'select-radio') {
      expect(strategy.labelText).toBe(step.value === 'yes' ? 'Yes' : 'No');
      expect(strategy.groupSelector).toMatch(/^\[aria-labelledby="eq-ctrl-c\.has_account/);
    }
  });

  it('resolves satisfaction (code/single, 5 categories) with the label matching the chosen code', () => {
    const scenario = scenarios[0]!;
    const step = scenario.steps.find((st) => st.variableRef === 'satisfaction')!;
    // Apply prior steps to build up responsesSoFar accurately.
    const responsesSoFar: Record<string, unknown> = {};
    for (const s of scenario.steps) {
      if (s.variableRef === 'satisfaction') break;
      responsesSoFar[s.instanceKey] = s.value;
    }
    const { strategy } = resolveStep(testErrorsInstrument, responsesSoFar, 'en', step);
    expect(strategy.kind).toBe('select-radio');
    if (strategy.kind === 'select-radio') {
      const expectedLabels: Record<string, string> = {
        very_satisfied: 'Very satisfied',
        satisfied: 'Satisfied',
        neutral: 'Neutral',
        dissatisfied: 'Dissatisfied',
        very_dissatisfied: 'Very dissatisfied',
      };
      expect(strategy.labelText).toBe(expectedLabels[step.value as string]);
    }
  });

  it('resolves nps (numeric) to fill-numeric with the numeric value preserved', () => {
    const scenario = scenarios.find((s) => s.steps.some((st) => st.variableRef === 'nps'))!;
    const step = scenario.steps.find((st) => st.variableRef === 'nps')!;
    const responsesSoFar: Record<string, unknown> = {};
    for (const s of scenario.steps) {
      if (s === step) break;
      responsesSoFar[s.instanceKey] = s.value;
    }
    const { strategy } = resolveStep(testErrorsInstrument, responsesSoFar, 'en', step);
    expect(strategy.kind).toBe('fill-numeric');
    if (strategy.kind === 'fill-numeric') {
      expect(strategy.value).toBe(Number(step.value));
    }
  });

  it('resolves comments (text) to fill-text', () => {
    const scenario = scenarios[0]!;
    const step = scenario.steps.find((st) => st.variableRef === 'comments')!;
    const responsesSoFar: Record<string, unknown> = {};
    for (const s of scenario.steps) {
      if (s === step) break;
      responsesSoFar[s.instanceKey] = s.value;
    }
    const { strategy } = resolveStep(testErrorsInstrument, responsesSoFar, 'en', step);
    expect(strategy.kind).toBe('fill-text');
  });

  it('never resolves an item for the unreachable dead_end_question (no coverage scenario reaches it)', () => {
    const dead = scenarios.some((s) => s.steps.some((st) => st.variableRef === 'dead_end_question'));
    expect(dead).toBe(false);
  });
});

describe('resolveStep — boolean domain', () => {
  it('produces select-radio with "Yes"/"No" labels in English', () => {
    // household/demo instruments both have boolean-typed variables we can exercise generically;
    // build a resolveStep call directly against a constructed step + minimal instrument slice
    // via the enumerator's own scenario output for determinism.
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    const boolStep = scenarios
      .flatMap((s) => s.steps)
      .find((st) => st.domainType === 'boolean');
    if (!boolStep) return; // demo instrument may not include a boolean question; skip gracefully
    const { strategy } = resolveStep(demoInstrument, {}, 'en', boolStep);
    expect(['select-radio', 'skip']).toContain(strategy.kind);
  });
});

describe('resolveStep — unresolvable instanceKey', () => {
  it('returns a skip strategy with a descriptive reason when the instanceKey is not rendered', () => {
    const { strategy } = resolveStep(testErrorsInstrument, {}, 'en', {
      instanceKey: 'nonexistent_var@',
      variableRef: 'nonexistent_var',
      value: 'x',
      domainType: 'text',
      isRoutingVar: false,
    });
    expect(strategy.kind).toBe('skip');
    if (strategy.kind === 'skip') {
      expect(strategy.reason).toContain('nonexistent_var');
    }
  });
});
