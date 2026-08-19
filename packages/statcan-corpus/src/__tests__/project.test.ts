/**
 * Projection tests: {@link toCorpusRow} is the seam between the ETL's model and the database's,
 * so what it drops or renames is what silently disappears from search.
 */
import { describe, expect, it } from 'vitest';
import { buildSearchText, toCorpusRow } from '../project.js';
import type { CorpusVariable } from '../types.js';

function variable(overrides: Partial<CorpusVariable> = {}): CorpusVariable {
  return {
    recordId: '00000000-0000-5000-8000-000000000001',
    name: 'DHHGAGE',
    position: '31',
    length: '2',
    concept: 'Age of respondent',
    questionText: 'What is your age?',
    universe: 'All respondents',
    note: 'Derived from date of birth.',
    codes: [
      { code: '1', label: '12 to 14 years', frequency: 1200, weighted: 98000 },
      { code: '99', label: 'Not stated', frequency: 3 },
    ],
    source: {
      bundle: 'RDC Nonconfidential Documentation (1).zip',
      path: 'CCHS_ESCC_2014/cchs_2014_T15.6_eng.pdf',
      page: 42,
      tcode: 'T15.6',
      docKind: 'data-dictionary',
      surveyGroup: 'CCHS_ESCC_2014',
      surveyAcronym: 'CCHS',
      cycle: '2014',
      year: 2014,
      lang: 'en',
    },
    ...overrides,
  };
}

describe('buildSearchText', () => {
  it('folds the category labels in, because that is where the plain language lives', () => {
    // "12 to 14 years" is searchable vocabulary; `DHHGAGE` is not. An index built only from the
    // mnemonic and the concept would fail every query an external reader actually types.
    const text = buildSearchText(variable());
    expect(text).toContain('12 to 14 years');
    expect(text).toContain('Not stated');
  });

  it('excludes codes and frequencies', () => {
    // Indexing the numbers makes every variable match every numeric query.
    const text = buildSearchText(variable());
    expect(text).not.toContain('98000');
    expect(text).not.toContain('1200');
  });

  it('collapses whitespace so the same record always yields the same string (D9)', () => {
    const text = buildSearchText(variable({ concept: 'Age   of\n respondent' }));
    expect(text).toContain('Age of respondent');
    expect(text).not.toMatch(/\s{2,}/);
  });

  it('omits absent fields rather than emitting a gap', () => {
    const text = buildSearchText(
      variable({ concept: undefined, questionText: undefined, note: undefined, universe: undefined }),
    );
    expect(text).toBe('DHHGAGE 12 to 14 years Not stated');
  });
});

describe('toCorpusRow', () => {
  it('carries every provenance field the licence requires (D8)', () => {
    const row = toCorpusRow(variable());
    expect(row).toMatchObject({
      bundle: 'RDC Nonconfidential Documentation (1).zip',
      path: 'CCHS_ESCC_2014/cchs_2014_T15.6_eng.pdf',
      page: 42,
      tcode: 'T15.6',
      survey_group: 'CCHS_ESCC_2014',
      survey_acronym: 'CCHS',
      cycle: '2014',
      year: 2014,
      lang: 'en',
    });
  });

  it('maps absent optionals to null, not to empty string', () => {
    // Postgres treats '' and NULL differently, and `question_text is not null` is how the stats
    // function counts variables that were actually asked. Empty strings would inflate it.
    const row = toCorpusRow(
      variable({ questionText: undefined, universe: '   ', note: '', cycle: undefined } as Partial<CorpusVariable>),
    );
    expect(row.question_text).toBeNull();
    expect(row.universe).toBeNull();
    expect(row.note).toBeNull();
  });

  it('shortens the code keys but keeps optional counts optional', () => {
    const row = toCorpusRow(variable());
    expect(row.codes).toEqual([
      { c: '1', l: '12 to 14 years', f: 1200, w: 98000 },
      { c: '99', l: 'Not stated', f: 3 },
    ]);
    // A missing weighted count must not become `w: undefined` — that serializes as a null in the
    // JSON column and reads as "weighted was zero" downstream.
    expect(Object.keys(row.codes[1]!)).toEqual(['c', 'l', 'f']);
  });

  it('records code_count so `has categories` is a filter, not a JSON scan', () => {
    expect(toCorpusRow(variable()).code_count).toBe(2);
    expect(toCorpusRow(variable({ codes: [] })).code_count).toBe(0);
  });

  it('is a pure function of the record — the same input gives the same row (D9)', () => {
    expect(toCorpusRow(variable())).toEqual(toCorpusRow(variable()));
  });
});
