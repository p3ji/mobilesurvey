/**
 * Subject-taxonomy tests. The parser matters more than the suggester: the mapping is edited by
 * hand in a spreadsheet, so its failure modes are stray whitespace and misspelt subjects, and a
 * misspelt subject creates a facet nobody can ever select.
 */
import { describe, expect, it } from 'vitest';
import {
  isStatCanSubject,
  parseSurveySubjects,
  STATCAN_SUBJECTS,
  subjectsFromName,
} from '../subjects.js';

describe('STATCAN_SUBJECTS', () => {
  it('is the published taxonomy, not an approximation of it', () => {
    // Captured from the subject facet on www150.statcan.gc.ca/n1/en/type/data. A reader filtering
    // by subject should see the words Statistics Canada uses, not ours.
    expect(STATCAN_SUBJECTS).toHaveLength(31);
    expect(STATCAN_SUBJECTS).toContain('Health');
    expect(STATCAN_SUBJECTS).toContain('Income, pensions, spending and wealth');
    expect(STATCAN_SUBJECTS).toContain('Older adults and population aging');
  });

  it('has no duplicates', () => {
    expect(new Set(STATCAN_SUBJECTS).size).toBe(STATCAN_SUBJECTS.length);
  });

  it('rejects a near-miss spelling', () => {
    expect(isStatCanSubject('Health')).toBe(true);
    expect(isStatCanSubject('health')).toBe(false);
    expect(isStatCanSubject('Health and wellbeing')).toBe(false);
  });
});

describe('subjectsFromName', () => {
  it('gets the two surveys the content-based inference got wrong', () => {
    // Content keywords filed the Canadian Health Measures Survey under Languages and left it
    // untagged on a second attempt, because its variables are lab values. Its *name* is not
    // ambiguous at all.
    expect(subjectsFromName('Canadian Health Measures Survey (CHMS)')).toContain('Health');
    expect(subjectsFromName('Canadian Community Health Survey - Annual Component')).toContain('Health');
  });

  it('returns several subjects, because one is the wrong shape', () => {
    // Statistics Canada files one program under several subjects.
    const subjects = subjectsFromName('Survey of Young Canadians - Health and Education');
    expect(subjects).toContain('Health');
    expect(subjects).toContain('Education, training and learning');
  });

  it('offers nothing rather than a guess when a title says nothing', () => {
    // Not "General Social Survey", which legitimately suggests Society and community off the word
    // `Social` — the point is that a title carrying no subject word yields no subject.
    expect(subjectsFromName('Longitudinal Administrative Databank')).toEqual([]);
    expect(subjectsFromName('Cycle 32')).toEqual([]);
  });

  it('never invents a subject outside the taxonomy', () => {
    for (const subject of subjectsFromName('Canadian Community Health Survey')) {
      expect(isStatCanSubject(subject)).toBe(true);
    }
  });
});

describe('parseSurveySubjects', () => {
  const header = 'survey_group\tacronym\trecords\tofficial_name\tsuggest_name\tsubjects\tsuggest_content';

  it('reads the editable column and ignores the suggestions beside it', () => {
    const { rows } = parseSurveySubjects(
      [header, 'CCHS_ESCC\tCCHS\t14651\tCanadian Community Health Survey\tHealth\tHealth\tHealth|Transportation'].join('\n'),
    );
    expect(rows).toEqual([{ surveyGroup: 'CCHS_ESCC', subjects: ['Health'] }]);
  });

  it('splits several subjects on the pipe', () => {
    const { rows } = parseSurveySubjects(
      [header, 'APS\tAPS\t100\t\t\tIndigenous peoples|Languages\t'].join('\n'),
    );
    expect(rows[0]!.subjects).toEqual(['Indigenous peoples', 'Languages']);
  });

  it('treats a blank cell as unclassified rather than as an error', () => {
    // Most of the file starts blank. An untagged survey is shown as unclassified, which is true.
    const { rows } = parseSurveySubjects([header, 'LSIC_ELIC\tLSIC\t6973\t\t\t\t'].join('\n'));
    expect(rows).toEqual([]);
  });

  it('survives hand editing — blank lines, comments, trailing newline, stray spaces', () => {
    const { rows } = parseSurveySubjects(
      ['# a comment', '', header, 'A\t\t\t\t\t  Health  \t', '', ''].join('\n'),
    );
    expect(rows).toEqual([{ surveyGroup: 'A', subjects: ['Health'] }]);
  });

  it('reports a misspelt subject instead of dropping it', () => {
    // Dropped silently, a typo creates a facet nobody can select and nothing else notices.
    const { rows, unknownSubjects } = parseSurveySubjects(
      [header, 'A\t\t\t\t\tHealth|Helth\t'].join('\n'),
    );
    expect(rows[0]!.subjects).toEqual(['Health']);
    expect(unknownSubjects).toEqual(['Helth']);
  });

  it('does not let the header become a survey', () => {
    expect(parseSurveySubjects(header).rows).toEqual([]);
  });

  it('collapses a subject repeated in one cell', () => {
    const { rows } = parseSurveySubjects([header, 'A\t\t\t\t\tHealth|Health\t'].join('\n'));
    expect(rows[0]!.subjects).toEqual(['Health']);
  });
});
