import { describe, it, expect } from 'vitest';
import type { Instrument, Variable, SequenceConstruct } from '@mobilesurvey/instrument-schema';
import { flattenInstrument } from '../flatten.js';
import type { RuntimeState } from '../types.js';

function buildLargeInstrument(questionCount: number): Instrument {
  const variables: Variable[] = [];
  const sections: SequenceConstruct[] = [];
  const sectionSize = Math.ceil(questionCount / 10);

  for (let s = 0; s < 10; s++) {
    const children = [];
    for (let i = s * sectionSize + 1; i <= Math.min((s + 1) * sectionSize, questionCount); i++) {
      variables.push({
        id: `var.q${i}`,
        name: `q${i}`,
        kind: 'collected',
        label: { en: `Question ${i}` },
        representation: 'text',
      });
      children.push({
        type: 'question' as const,
        id: `q${i}`,
        variableRef: `q${i}`,
        text: { en: `What is your answer to question ${i}?` },
        responseDomain: { type: 'text' as const },
      });
    }
    sections.push({
      type: 'sequence' as const,
      id: `sec${s}`,
      label: { en: `Section ${s + 1}` },
      children,
    });
  }

  return {
    id: 'urn:ddi:mobilesurvey:scale-test:1.0',
    version: '1.0.0',
    ddiProfile: 'ddi-lifecycle-3.3',
    languages: ['en'],
    defaultLanguage: 'en',
    metadata: {
      title: { en: 'Scale Test Instrument' },
      created: '2026-01-01T00:00:00.000Z',
    },
    concepts: [],
    universes: [],
    categorySchemes: [],
    variables,
    prefillMappings: [],
    sequence: {
      type: 'sequence',
      id: 'seq.root',
      children: sections,
    },
  };
}

const emptyState = (): RuntimeState => ({ responses: {}, sample: {}, language: 'en' });

const QUESTION_COUNT = 1_000;
const instrument = buildLargeInstrument(QUESTION_COUNT);

describe('flattenInstrument scale', () => {
  it(`renders all ${QUESTION_COUNT} questions`, () => {
    const { items } = flattenInstrument(instrument, emptyState());
    const questionItems = items.filter((i) => i.kind === 'question');
    expect(questionItems).toHaveLength(QUESTION_COUNT);
  });

  it(`completes in under 200 ms`, () => {
    const start = performance.now();
    flattenInstrument(instrument, emptyState());
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('questions are ordered correctly (q1 before q1000)', () => {
    const { items } = flattenInstrument(instrument, emptyState());
    const qItems = items.filter((i) => i.kind === 'question');
    expect((qItems[0] as { instanceKey: string }).instanceKey).toContain('q1');
    expect((qItems[QUESTION_COUNT - 1] as { instanceKey: string }).instanceKey).toContain('q1000');
  });
});
