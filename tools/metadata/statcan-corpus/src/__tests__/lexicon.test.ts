/**
 * Lexicon tests. The ranking is the part worth pinning: the two cases below are real queries whose
 * obvious answer is the wrong one, and both were found by measuring the corpus rather than by
 * imagining what a typo looks like.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLexicon,
  lexiconTextOf,
  MIN_RECORDS,
  rankSuggestions,
  similarity,
  suggestionScore,
  wordsOf,
} from '../lexicon.js';
import type { CorpusVariable } from '../types.js';

let seq = 0;
function record(overrides: Partial<CorpusVariable> = {}): CorpusVariable {
  return {
    recordId: `r${(seq += 1)}`,
    name: 'OPI_40F',
    concept: 'Risk of developing an opioid dependency',
    codes: [],
    ...overrides,
    source: {
      bundle: 'b.zip',
      path: 'S/doc.pdf',
      page: 1,
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'S',
      lang: 'en',
      ...overrides.source,
    },
  };
}

describe('wordsOf', () => {
  it('reads words as a person types them, not as Postgres stems them', () => {
    // Offering `smok` as a correction for `smokeing` is unreadable; the reader typed a word and
    // expects a word back.
    expect(wordsOf('Smoking status')).toContain('smoking');
    expect(wordsOf('Smoking status')).not.toContain('smok');
  });

  it('drops fragments too short to be worth suggesting', () => {
    expect(wordsOf('a of an to the')).toEqual(new Set(['the']));
  });

  it('keeps accented words, since half the corpus is French', () => {
    expect(wordsOf('Fréquence pondérée')).toEqual(new Set(['fréquence', 'pondérée']));
  });

  it('counts a word once per record however often it repeats', () => {
    expect(wordsOf('opioid opioid opioid')).toEqual(new Set(['opioid']));
  });
});

describe('lexiconTextOf', () => {
  it('covers every prose field the search index does', () => {
    // A word in the vocabulary that the search cannot find is a correction leading to a second
    // empty page.
    const text = lexiconTextOf(
      record({
        concept: 'Concept',
        questionText: 'Question',
        universe: 'Universe',
        note: 'Note',
        codes: [{ code: '1', label: 'Category' }],
      }),
    );
    for (const part of ['Concept', 'Question', 'Universe', 'Note', 'Category']) {
      expect(text).toContain(part);
    }
  });

  it('excludes the variable name, whose fragments are not words', () => {
    // `OPI_40F` yields `opi`, which appears in 93 records and outranked `opioids` as the
    // correction for `opiod` — the exact query this feature was built for, answered with a
    // three-letter fragment. Mnemonic lookup is served by the trigram index on `name` instead.
    expect(lexiconTextOf(record({ name: 'OPI_40F', concept: 'Opioid risk' }))).not.toContain(
      'OPI_40F',
    );
  });
});

describe('buildLexicon', () => {
  it('counts records, not occurrences', () => {
    const lexicon = buildLexicon([
      record({ concept: 'opioid opioid opioid' }),
      record({ concept: 'opioid' }),
    ]);
    expect(lexicon.find((t) => t.term === 'opioid')?.records).toBe(2);
  });

  it('drops the long tail of extraction noise', () => {
    // Suggesting `ddiabete` to someone who typed `diabetis` implies the corpus holds a variable
    // spelled that way. The tail is fused glyphs and lost accents, not vocabulary.
    const lexicon = buildLexicon([record({ concept: 'diabetes ddiabete' }), record({ concept: 'diabetes' })]);
    expect(lexicon.map((t) => t.term)).toContain('diabetes');
    expect(lexicon.map((t) => t.term)).not.toContain('ddiabete');
    expect(MIN_RECORDS).toBe(2);
  });

  it('is sorted, so a re-run writes the same rows in the same order (D9)', () => {
    const one = buildLexicon([record({ concept: 'zebra apple' }), record({ concept: 'zebra apple' })]);
    expect(one.map((t) => t.term)).toEqual(['apple', 'zebra']);
  });
});

describe('similarity', () => {
  it('matches pg_trgm on a word identical to itself', () => {
    expect(similarity('opioid', 'opioid')).toBe(1);
  });

  it('rates a one-letter omission well above unrelated words', () => {
    expect(similarity('opiod', 'opioid')).toBeGreaterThan(0.4);
    expect(similarity('opiod', 'marital')).toBeLessThan(0.1);
  });

  it('ignores case and surrounding space', () => {
    expect(similarity(' OPIOID ', 'opioid')).toBe(1);
  });
});

describe('suggestionScore', () => {
  it('breaks a similarity tie toward the word the corpus actually uses', () => {
    // `maritial` is equally close to `marital` (616 records) and `martial` (6). Similarity alone
    // cannot separate them, and picking `martial` sends the reader to six irrelevant records.
    const marital = suggestionScore(0.55, 616);
    const martial = suggestionScore(0.55, 6);
    expect(marital).toBeGreaterThan(martial);
  });

  it('lets a much commoner word overtake a slightly closer rare one', () => {
    // `diabetis` is closer to `diabetic` (0.64, 72 records) than to `diabetes` (0.50, 442) — and
    // `diabetes` is what was meant.
    expect(suggestionScore(0.5, 442)).toBeGreaterThan(suggestionScore(0.64, 72));
  });

  it('does not let frequency alone win — a distant word stays distant', () => {
    expect(suggestionScore(0.05, 100000)).toBeLessThan(suggestionScore(0.9, 5));
  });
});

describe('rankSuggestions', () => {
  const terms = [
    { term: 'opioid', records: 35 },
    { term: 'opioids', records: 62 },
    { term: 'opium', records: 17 },
    { term: 'marital', records: 616 },
    { term: 'martial', records: 6 },
    { term: 'diabetes', records: 442 },
    { term: 'diabetic', records: 72 },
  ];

  it('rescues the query that prompted all of this', () => {
    // Asserts the family, not the exact form. `opioids` (62 records) edges out `opioid` (35) on
    // the frequency term, and that is the blend working as designed rather than a defect: both
    // stem to the same lexeme, so either correction returns the same 96 records. Weighting
    // similarity harder would put `opioid` first and would simultaneously break `diabetis`,
    // which is a real error and this is a cosmetic one.
    expect(rankSuggestions('opiod', terms)[0]!.term).toMatch(/^opioid/);
  });

  it('corrects maritial to marital, not martial', () => {
    expect(rankSuggestions('maritial', terms)[0]!.term).toBe('marital');
  });

  it('corrects diabetis to diabetes, not diabetic', () => {
    expect(rankSuggestions('diabetis', terms)[0]!.term).toBe('diabetes');
  });

  it('offers nothing rather than something wrong for an unrelated query', () => {
    // `narcotic` appears nowhere in the corpus and is close to nothing in it. An empty suggestion
    // list is the honest answer; a bad one implies we found something.
    expect(rankSuggestions('narcotic', terms)).toEqual([]);
  });

  it('is deterministic when scores tie', () => {
    const tied = [{ term: 'aaa', records: 5 }, { term: 'aab', records: 5 }];
    expect(rankSuggestions('aaa', tied)).toEqual(rankSuggestions('aaa', tied));
  });
});

describe('variable references in prose', () => {
  it('drops them whole rather than leaving their prefix behind', () => {
    // `universe` is full of routing conditions. A word matcher stops at the underscore and leaves
    // `smk` and `opi` looking like vocabulary; `opi` reached 63 records that way and outranked
    // `opioids` as the correction for `opiod` — the query this feature exists for.
    const words = wordsOf('Universe: SMK_12 = 2 and OPI_35 = 1');
    expect(words).not.toContain('smk');
    expect(words).not.toContain('opi');
    expect(words).toContain('universe');
  });

  it('keeps the real words in the same sentence', () => {
    const words = wordsOf('Respondents aged 15 and over who answered CIH_005 = 1');
    expect(words).toContain('respondents');
    expect(words).toContain('aged');
    expect(words).toContain('over');
    expect(words).not.toContain('cih');
  });

  it('does not mistake an ordinary hyphenated word for a reference', () => {
    expect(wordsOf('low-dose codeine')).toContain('codeine');
    expect(wordsOf('common-law partner')).toContain('partner');
  });
});
