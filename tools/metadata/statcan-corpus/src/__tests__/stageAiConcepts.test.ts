import { describe, it, expect } from 'vitest';
import { synthesizeConceptLabel } from '../concept/stage-ai-concepts.js';

describe('synthesizeConceptLabel', () => {
  it('cleans procedural boilerplate and retains battery sub-item', () => {
    const raw = 'Which of the following population groups do your business’s cyber security employees belong to? White';
    expect(synthesizeConceptLabel(raw)).toBe('Population groups do your business’s cyber security employees belong to - White');
  });

  it('preserves substantive question when no sub-item is present', () => {
    const raw = 'In 2021, what was the total value of ransom payments made by your business?';
    expect(synthesizeConceptLabel(raw)).toBe('Total value of ransom payments made by your business');
  });

  it('cleans recall periods and prompt prefixes while retaining qualifiers', () => {
    const raw = 'In the past 12 months, did you conduct online banking activities outside of work?';
    expect(synthesizeConceptLabel(raw)).toBe('Conduct online banking activities outside of work');
  });

  it('de-hyphenates PDF line breaks', () => {
    const raw = 'In 2021, which external parties did your business work with to resolve ransomware inci-dents? Other external parties';
    expect(synthesizeConceptLabel(raw)).toBe('Work with to resolve ransomware incidents - Other external parties');
  });
});
