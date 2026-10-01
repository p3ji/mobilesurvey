import { describe, it, expect } from 'vitest';
import { matchesTextualRange, expandRangeToken, findComponentSiblings, renderVerifiedSql, isPublishableEdge, isTextuallyGrounded, type CandidateEdgeRow } from '../reviewer.js';
import { parseAliasBlocks } from '../aliases.js';

describe('matchesTextualRange', () => {
  const note = 'Derived from questions E06, and E14A to E28A.';

  it('accepts members of a prefix+number+suffix range', () => {
    expect(matchesTextualRange('E15A', note)).toBe(true);
    expect(matchesTextualRange('E28A', note)).toBe(true);
    expect(matchesTextualRange('E13A', note)).toBe(false);
    expect(matchesTextualRange('E29A', note)).toBe(false);
  });

  it('accepts members of an alphabetical suffix range', () => {
    expect(matchesTextualRange('C13M', 'Derived from C13A to C13X.')).toBe(true);
    expect(matchesTextualRange('C14M', 'Derived from C13A to C13X.')).toBe(false);
  });

  it('accepts members of a numeric suffix range', () => {
    expect(matchesTextualRange('ADL_03', 'from ADL_01 through ADL_05')).toBe(true);
    expect(matchesTextualRange('ADL_06', 'from ADL_01 through ADL_05')).toBe(false);
  });

  it('supports French separators', () => {
    expect(matchesTextualRange('E20A', 'dérivé de E14A à E28A')).toBe(true);
  });
});

describe('verified SQL export', () => {
  it('resolves English records and names the natural-key conflict arbiter', () => {
    const edge = {
      target_var_name: 'DAGEYRSG', source_var_name: 'DAGEYRS', survey_group: 'ACS_EEA_2006',
      cycle: '2006', derivation_type: 'recode', expression_summary: "Child's age",
      raw_evidence: "Derived from child's DAGEYRS.", extraction_method: 'llm_qwen3.8',
      confidence: 0.98, review_status: 'verified',
    } as CandidateEdgeRow;
    const sql = renderVerifiedSql([edge]);
    expect(sql).toContain("v.lang = 'en'");
    expect(sql).toContain('source.path = target.path');
    expect(sql).toContain('target.cycle is not distinct from i.cycle');
    expect(sql).toContain('on conflict (target_record_id, (upper(btrim(source_var_name)))) do nothing');
    expect(sql).toContain("Child''s age");
    expect(sql).not.toContain('edge_id');
  });

  it('withholds contextual identifiers and analogies from published lineage', () => {
    const base = {
      target_var_name: 'DHHDSZ', source_var_name: 'AGE', survey_group: 'CCHS_ESCC',
      cycle: '2019', raw_evidence: 'Based on AGE.', review_status: 'verified',
    } as CandidateEdgeRow;
    expect(isPublishableEdge(base)).toBe(true);
    expect(isPublishableEdge({ ...base, source_var_name: 'SAMPLEID' })).toBe(false);
    expect(isPublishableEdge({ ...base, raw_evidence: 'Calculated the same as AGE.' })).toBe(false);
    expect(isPublishableEdge({ ...base, survey_group: 'BC_CB_K12' })).toBe(false);
    expect(isPublishableEdge({ ...base, review_status: 'needs_review' })).toBe(false);
  });

  it('permits human-approved suggestions regardless of evidence wording and sets epistemic authority', () => {
    const humanEdge = {
      target_var_name: 'DNUMDENT', source_var_name: 'C06A', survey_group: 'CSIT_ECCI',
      cycle: '2023', derivation_type: 'formula', expression_summary: 'DNUMDENT derived from C06A',
      raw_evidence: "Human-approved suggestion for unresolved source 'Q06A'",
      extraction_method: 'human_review', auditor: 'human_suggestion_accept',
      confidence: 0.95, review_status: 'verified',
    } as CandidateEdgeRow;
    expect(isPublishableEdge(humanEdge)).toBe(true);
    const sql = renderVerifiedSql([humanEdge]);
    expect(sql).toContain("case when i.extraction_method = 'human_review' then 'human_verified' else 'ai_inferred' end");
    expect(sql).toContain("case when i.extraction_method = 'human_review' then 'human_suggestion_accept' else 'reviewer_agent_v1' end");
  });
});

describe('isTextuallyGrounded', () => {
  it('requires whole-word identifier matches to prevent substring hallucinations', () => {
    expect(isTextuallyGrounded('AGE', 'Derived based on AGEGRP.')).toBe(false);
    expect(isTextuallyGrounded('AGE', 'Derived based on DAGE.')).toBe(false);
    expect(isTextuallyGrounded('F31A', 'Derived based on F31AB and F31AC.')).toBe(false);
    expect(isTextuallyGrounded('C13A', 'Derived based on C13A_1.')).toBe(false);
  });

  it('accepts whole-word identifier matches across punctuation and whitespace', () => {
    expect(isTextuallyGrounded('AGE', 'Derived based on AGE.')).toBe(true);
    expect(isTextuallyGrounded('AGE', 'Derived based on (AGE), rounded')).toBe(true);
    expect(isTextuallyGrounded('AGE', 'Derived from AGE and SEX.')).toBe(true);
    expect(isTextuallyGrounded('F31A', 'Derived based on F31A, F31B.')).toBe(true);
    expect(isTextuallyGrounded('C13A_1', 'Derived based on C13A_1.')).toBe(true);
  });
});

describe('expandRangeToken', () => {
  it("expands hyphenated range tokens (equivalent to 'X to Y')", () => {
    const members = expandRangeToken('E14A-E28A');
    expect(members).not.toBeNull();
    expect(members![0]).toBe('E14A');
    expect(members![members!.length - 1]).toBe('E28A');
    expect(members).toContain('E20A');
    expect(members!.length).toBe(15);
  });

  it('expands numeric ranges preserving zero padding', () => {
    expect(expandRangeToken('Q01-Q05')).toEqual(['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);
  });

  it('expands alphabetical suffix ranges with equal stems', () => {
    const members = expandRangeToken('C13A-C13E');
    expect(members).toEqual(['C13A', 'C13B', 'C13C', 'C13D', 'C13E']);
  });

  it('returns null for non-range tokens', () => {
    expect(expandRangeToken('E14A')).toBeNull();
    expect(expandRangeToken('DHLTHCON')).toBeNull();
    expect(expandRangeToken('A9-B2')).toBeNull(); // mismatched prefixes
    expect(expandRangeToken('E14A-E28B')).toBeNull(); // mismatched alpha suffixes
  });

  it('refuses runaway ranges', () => {
    expect(expandRangeToken('X0-X9999')).toBeNull();
  });
});

describe('findComponentSiblings', () => {
  const acs = ['A02_DOB', 'A02_MOB', 'A02_YOB', 'A03A', 'A03B', 'A03C', 'A05', 'DAGEMTH'];

  it('finds underscore component columns for a question item (date split)', () => {
    expect(findComponentSiblings('A02', acs)).toEqual(['A02_DOB', 'A02_MOB', 'A02_YOB']);
  });

  it('finds single-letter suffix components', () => {
    expect(findComponentSiblings('A03', acs)).toEqual(['A03A', 'A03B', 'A03C']);
  });

  it('does not match digit-suffixed or unrelated names', () => {
    expect(findComponentSiblings('A0', ['A02_DOB', 'A05'])).toEqual([]);
    expect(findComponentSiblings('DAGEMTH', acs)).toEqual([]);
  });

  it('does not match the variable itself', () => {
    expect(findComponentSiblings('A05', acs)).toEqual([]);
  });
});

describe('parseAliasBlocks', () => {
  const dict = `
Variable Name: SEX Length: 1.0 Position: 21
Question Name: AGS_Q05
Concept: Respondent's sex at birth
Universe: All respondents
Answer Categories Code
Male 1
Variable Name: ALC_45 Length: 1.0 Position: 63
Question Name: ALC_Q45
Concept: Have had a drink - 30 days
Note:
Variable Name: MASTERID Length: 5.0 Position: 1
Question Name:
Concept: Master identifier
`;

  it('pairs each Question Name with its own Variable Name', () => {
    const pairs = parseAliasBlocks(dict);
    expect(pairs).toEqual([
      { questionName: 'AGS_Q05', variableName: 'SEX' },
      { questionName: 'ALC_Q45', variableName: 'ALC_45' },
    ]);
  });

  it('does not capture the next field label after an empty Question Name:', () => {
    const pairs = parseAliasBlocks(dict);
    expect(pairs.some((p) => p.questionName === 'CONCEPT')).toBe(false);
  });
});

import { boundedEditDistance, normalizeName, lexicalCandidates, reverseNoteCandidates, resolveBestMatch } from '../suggester.js';

describe('Check 4 suggester helpers', () => {
  it('bounded edit distance respects the cap', () => {
    expect(boundedEditDistance('CANQ30A', 'CANQ30B', 2)).toBe(1);
    expect(boundedEditDistance('ABC', 'XYZABCDEF', 2)).toBe(3); // length gap > cap
    expect(boundedEditDistance('F31A', 'F38A', 2)).toBe(1);
  });

  it('normalizeName strips underscores, dashes and case', () => {
    expect(normalizeName('can_q30-a')).toBe('CANQ30A');
  });

  it('lexicalCandidates finds near-miss published names only', () => {
    const pool = ['F38A', 'F29A', 'D2AGWRD5', 'INC_05'];
    const hits = lexicalCandidates('F31A', pool).map((c) => c.name);
    expect(hits).toContain('F38A'); // one substitution
    expect(hits).not.toContain('D2AGWRD5');
    expect(lexicalCandidates('INC05', pool).map((c) => c.name)).toEqual([]); // exact alias excluded
  });
});

describe('reverseNoteCandidates', () => {
  const pool = [
    { name: 'D2WORDYN', note: 'Has the child ever expressed needs using a single word?' },
    { name: 'D2WORD5', note: 'Derived based on F29A, F30A, F31A and F31B.' },
    { name: 'D2AGWRD5', note: 'Derived based on F29A, F30A and F31A.' },
    { name: 'F31X', note: 'Derived based on F31AB and F31AC.' }, // substring must NOT match
    { name: 'PLAIN', note: 'Collected directly from the household roster.' },
  ];
  it('finds derived proxies whose own note cites the token as a whole word', () => {
    const hits = reverseNoteCandidates('F31A', pool).map((c) => c.name);
    expect(hits.sort()).toEqual(['D2AGWRD5', 'D2WORD5']);
  });
  it('excludes non-derived notes and substring-only mentions', () => {
    const names = reverseNoteCandidates('F31A', pool).map((c) => c.name);
    expect(names).not.toContain('PLAIN');
    expect(names).not.toContain('F31X');
  });
  it('carries the citing note for reviewer evidence', () => {
    const hit = reverseNoteCandidates('F31A', pool).find((c) => c.name === 'D2AGWRD5');
    expect(hit?.method).toBe('reverse_note');
    expect(hit?.note).toContain('Derived based on F29A');
  });
});

describe('resolveBestMatch', () => {
  const names = ['C06A', 'DNUMDENT', 'D2WORDYN'];
  it('accepts exact and decorated names', () => {
    expect(resolveBestMatch('c06a', names)).toBe('C06A');
    expect(resolveBestMatch('**DNUMDENT**', names)).toBe('DNUMDENT');
  });
  it('extracts a name embedded in prose, longest token first', () => {
    expect(resolveBestMatch('Candidate 2 (DNUMDENT) matches best', names)).toBe('DNUMDENT');
  });
  it('treats null-ish and unresolvable answers as abstain', () => {
    expect(resolveBestMatch('', names)).toBeNull();
    expect(resolveBestMatch('None of the candidates fit', names)).toBeNull(); // "None" is not a candidate name
    expect(resolveBestMatch('ZZZ9', names)).toBeNull();
  });
});
