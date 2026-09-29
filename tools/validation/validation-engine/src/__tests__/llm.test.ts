import { describe, it, expect } from 'vitest';
import { buildFlagExplanationPrompt, buildRuleDraftPrompt, parseLlmRuleDrafts } from '../llm.js';
import { fixtureInstrument } from './fixtures.js';
import type { ValidationFlag } from '../types.js';

describe('buildRuleDraftPrompt', () => {
  it('includes the variable name, annotation note, and grammar constraints', () => {
    const prompt = buildRuleDraftPrompt({ variableName: 'revenue', annotationNote: 'Rarely negative.', observedSamples: [100, 200] });
    expect(prompt).toContain('$revenue');
    expect(prompt).toContain('Rarely negative.');
    expect(prompt).toContain('== and != only');
    expect(prompt).toContain('100');
    expect(prompt).toContain('200');
  });

  it('handles an empty sample list without crashing', () => {
    const prompt = buildRuleDraftPrompt({ variableName: 'revenue', annotationNote: 'note', observedSamples: [] });
    expect(prompt).toContain('(none available)');
  });
});

describe('parseLlmRuleDrafts', () => {
  it('accepts a well-formed candidate that compiles and references known variables', () => {
    const raw = JSON.stringify([{ when: '$revenue > 1000', message: 'High revenue', severity: 'query' }]);
    const out = parseLlmRuleDrafts(raw, fixtureInstrument);
    expect(out).toHaveLength(1);
    expect(out[0]!.when).toBe('$revenue > 1000');
  });

  it('extracts a JSON array embedded in surrounding prose', () => {
    const raw = `Here are the rules:\n[{"when": "$revenue > 1000", "message": "High", "severity": "query"}]\nHope this helps!`;
    const out = parseLlmRuleDrafts(raw, fixtureInstrument);
    expect(out).toHaveLength(1);
  });

  it('drops a candidate that references an unknown variable', () => {
    const raw = JSON.stringify([{ when: '$totallyMadeUpVariable > 1', message: 'x', severity: 'query' }]);
    expect(parseLlmRuleDrafts(raw, fixtureInstrument)).toHaveLength(0);
  });

  it('drops a candidate with a malformed expression', () => {
    const raw = JSON.stringify([{ when: '$revenue >>> !!! bad', message: 'x', severity: 'query' }]);
    expect(parseLlmRuleDrafts(raw, fixtureInstrument)).toHaveLength(0);
  });

  it('drops a candidate with an invalid severity', () => {
    const raw = JSON.stringify([{ when: '$revenue > 1', message: 'x', severity: 'critical' }]);
    expect(parseLlmRuleDrafts(raw, fixtureInstrument)).toHaveLength(0);
  });

  it('returns an empty array for non-JSON garbage rather than throwing', () => {
    expect(() => parseLlmRuleDrafts('not json at all', fixtureInstrument)).not.toThrow();
    expect(parseLlmRuleDrafts('not json at all', fixtureInstrument)).toHaveLength(0);
  });

  it('returns an empty array when the top-level value is not an array', () => {
    const raw = JSON.stringify({ when: '$revenue > 1', message: 'x', severity: 'query' });
    expect(parseLlmRuleDrafts(raw, fixtureInstrument)).toHaveLength(0);
  });

  it('keeps only the valid candidates out of a mixed batch', () => {
    const raw = JSON.stringify([
      { when: '$revenue > 1000', message: 'good', severity: 'query' },
      { when: '$unknownVar > 1', message: 'bad var', severity: 'query' },
      { when: '$revenue >>> bad', message: 'bad expr', severity: 'query' },
    ]);
    const out = parseLlmRuleDrafts(raw, fixtureInstrument);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toBe('good');
  });
});

describe('buildFlagExplanationPrompt', () => {
  const baseFlag: ValidationFlag = {
    id: 'f1', runId: 'run1', responseId: 'r1', respondentId: 'p1',
    variableName: 'revenue', instanceKey: 'revenue@', checkKind: 'metadata',
    checkId: 'range:revenue', severity: 'fatal', message: 'Value is out of range.',
    observed: -50, suspicion: 1, impact: 0.5, score: 0.5,
  };

  it('includes the flag message, variable, and observed value', () => {
    const prompt = buildFlagExplanationPrompt({ flag: baseFlag, similarPastDispositions: [] });
    expect(prompt).toContain('Value is out of range.');
    expect(prompt).toContain('revenue');
    expect(prompt).toContain('-50');
    expect(prompt).toContain('(none)');
  });

  it('includes the annotation note when provided', () => {
    const prompt = buildFlagExplanationPrompt({ flag: baseFlag, annotationNote: 'Refunds go negative.', similarPastDispositions: [] });
    expect(prompt).toContain('Refunds go negative.');
  });

  it('includes past dispositions when provided', () => {
    const prompt = buildFlagExplanationPrompt({
      flag: baseFlag,
      similarPastDispositions: [{ reason: 'refund period', action: 'accept' }],
    });
    expect(prompt).toContain('accept: "refund period"');
  });
});
