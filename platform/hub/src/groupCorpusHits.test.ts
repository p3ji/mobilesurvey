import { describe, expect, it } from 'vitest';
import type { SearchHit } from '@mobilesurvey/metadata-registry';
import { groupCorpusHits } from './groupCorpusHits.js';

function hit(id: string, question: string | null, cycle = '2022'): SearchHit {
  return {
    entry: {
      entryId: id,
      ddi: question === null ? {} : { description: { en: question } },
      corpus: { surveyGroup: 'CIUS', cycle, lang: 'en' },
    } as SearchHit['entry'],
    score: 1,
    matched: [],
  };
}

describe('groupCorpusHits', () => {
  it('collapses repeated columns while preserving every variable and distinct cycles', () => {
    const groups = groupCorpusHits([
      hit('a', 'Which artificial intelligence tools have you used?'),
      hit('b', 'Which artificial-intelligence tools have you used?'),
      hit('c', 'Which artificial intelligence tools have you used?', '2023'),
      hit('d', null),
    ]);
    expect(groups.map((group) => group.hits.map((item) => item.entry.entryId))).toEqual([
      ['a', 'b'], ['c'], ['d'],
    ]);
  });
});
