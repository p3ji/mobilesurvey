/**
 * Clustering tests. The cascade is an *inference*, so what matters most is that it groups the
 * things a reader would group, keeps apart the things they would keep apart, and stays away from
 * the extracted facts entirely (D3).
 */
import { describe, expect, it } from 'vitest';
import {
  buildClusters,
  conceptualVariableId,
  meaningOf,
  normalizeKey,
  representationOf,
} from '../cluster.js';
import type { CodeEntry, CorpusVariable } from '../types.js';

let seq = 0;
function occurrence(overrides: Partial<CorpusVariable> = {}): CorpusVariable {
  const { source, ...rest } = overrides;
  return {
    recordId: `record-${(seq += 1)}`,
    name: 'MARST',
    concept: 'Marital status',
    universe: 'All respondents aged 15 and over',
    codes: [] as CodeEntry[],
    ...rest,
    source: {
      bundle: 'b.zip',
      path: 'CCHS/doc.pdf',
      page: 1,
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'CCHS_ESCC',
      year: 2015,
      lang: 'en',
      ...source,
    },
  };
}

describe('normalizeKey', () => {
  it('folds case, punctuation and spacing, which are noise for matching', () => {
    expect(normalizeKey('Marital  status?')).toBe('marital status');
    expect(normalizeKey('MARITAL-STATUS')).toBe('marital status');
  });

  it('does not stem or expand synonyms', () => {
    // A looser key merges genuinely different measures invisibly; a stricter one leaves two
    // groups a reader can see are the same. Only the second failure is self-correcting.
    expect(normalizeKey('marital statuses')).not.toBe(normalizeKey('marital status'));
  });
});

describe('meaningOf', () => {
  it('prefers the concept label', () => {
    expect(meaningOf(occurrence({ concept: 'Marital status', questionText: 'Are you married?' }))).toBe(
      'marital status',
    );
  });

  it('falls back to question wording when the layout records no concept', () => {
    // The collection family prints prose and no concept at all; keying on `concept` alone would
    // leave every one of its records unplaced.
    expect(meaningOf(occurrence({ concept: undefined, questionText: 'Are you married?' }))).toBe(
      'are you married',
    );
  });
});

describe('representationOf', () => {
  it('ignores frequencies', () => {
    // Every cycle of an identically-coded question carries different counts. Including them would
    // make each cycle its own representation and fire the "coding changed" signal on everything.
    const a = occurrence({ codes: [{ code: '1', label: 'Married', frequency: 100 }] });
    const b = occurrence({ codes: [{ code: '1', label: 'Married', frequency: 250 }] });
    expect(representationOf(a)).toBe(representationOf(b));
  });

  it('separates lists whose labels differ', () => {
    const a = occurrence({ codes: [{ code: '1', label: 'Married' }] });
    const b = occurrence({ codes: [{ code: '1', label: 'Married or common-law' }] });
    expect(representationOf(a)).not.toBe(representationOf(b));
  });
});

describe('buildClusters', () => {
  it('groups the same measure across cycles and surveys', () => {
    const result = buildClusters([
      occurrence({ source: { year: 2015, surveyGroup: 'CCHS_ESCC' } as never }),
      occurrence({ source: { year: 2019, surveyGroup: 'CCHS_ESCC' } as never }),
      occurrence({ source: { year: 2021, surveyGroup: 'GSS_ESG' } as never }),
    ]);

    expect(result.conceptualVariables).toHaveLength(1);
    expect(result.conceptualVariables[0]).toMatchObject({
      label: 'Marital status',
      occurrences: 3,
      surveys: 2,
      years: 3,
      year_min: 2015,
      year_max: 2021,
    });
  });

  it('separates the same concept measured on different populations', () => {
    // Concept + Universe is what DDI calls a ConceptualVariable, and the universe is load-bearing:
    // marital status of everyone 15+ is not the same measure as marital status of lone parents.
    const result = buildClusters([
      occurrence({ universe: 'All respondents aged 15 and over' }),
      occurrence({ universe: 'Lone parents' }),
    ]);
    expect(result.concepts).toHaveLength(1);
    expect(result.conceptualVariables).toHaveLength(2);
  });

  it('counts a coding change as a second representation of one conceptual variable', () => {
    // This is the whole reason for keeping DDI's three levels rather than one cluster: "which
    // cycles changed the coding" is a property of the group, not a query over its members.
    const result = buildClusters([
      occurrence({ source: { year: 2015 } as never, codes: [{ code: '1', label: 'Married' }] }),
      occurrence({
        source: { year: 2019 } as never,
        codes: [{ code: '1', label: 'Married or common-law' }],
      }),
    ]);
    expect(result.conceptualVariables).toHaveLength(1);
    expect(result.conceptualVariables[0]!.representations).toBe(2);
    expect(result.representedVariables).toHaveLength(2);
  });

  it('links every represented variable to its parent', () => {
    const result = buildClusters([
      occurrence({ codes: [{ code: '1', label: 'Married' }] }),
      occurrence({ codes: [{ code: '1', label: 'Single' }] }),
    ]);
    const parent = result.conceptualVariables[0]!.conceptual_variable_id;
    for (const rv of result.representedVariables) {
      expect(rv.conceptual_variable_id).toBe(parent);
    }
  });

  it('shows a group under the spelling the documents most often use', () => {
    const result = buildClusters([
      occurrence({ concept: 'Marital status' }),
      occurrence({ concept: 'Marital status' }),
      occurrence({ concept: 'MARITAL STATUS' }),
    ]);
    expect(result.conceptualVariables[0]!.label).toBe('Marital status');
  });

  it('leaves occurrences with no meaning text unplaced rather than inventing a group', () => {
    // Grouping those by variable name would put unrelated administrative fields from different
    // surveys together — a confident answer where there is no evidence.
    const result = buildClusters([
      occurrence({ concept: undefined, questionText: undefined }),
      occurrence(),
    ]);
    expect(result.unplaced).toBe(1);
    expect(result.members).toHaveLength(1);
  });

  it('never writes to the occurrence records (D3)', () => {
    const one = occurrence();
    const before = JSON.stringify(one);
    buildClusters([one]);
    expect(JSON.stringify(one)).toBe(before);
  });

  it('is deterministic — same input, identical output including order (D9)', () => {
    const input = () => [
      occurrence({ recordId: 'a', concept: 'Age' }),
      occurrence({ recordId: 'b', concept: 'Marital status' }),
      occurrence({ recordId: 'c', concept: 'Sex' }),
    ];
    const a = buildClusters(input());
    const b = buildClusters(input());
    expect(JSON.stringify(a.conceptualVariables)).toBe(JSON.stringify(b.conceptualVariables));
    expect(JSON.stringify(a.concepts)).toBe(JSON.stringify(b.concepts));
  });

  it('mints ids that survive a re-run, so a citation stays valid', () => {
    expect(conceptualVariableId('marital status', 'all respondents')).toBe(
      conceptualVariableId('marital status', 'all respondents'),
    );
    expect(conceptualVariableId('marital status', 'all respondents')).not.toBe(
      conceptualVariableId('marital status', 'lone parents'),
    );
  });
});
