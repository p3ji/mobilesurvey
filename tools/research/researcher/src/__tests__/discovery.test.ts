import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleCandidates, deduplicateCandidates } from '../adapters/discovery.js';
import type { CandidateWork } from '../model.js';
import { ResearchQueue } from '../queue.js';

describe('Discovery & Assembly', () => {
  const openAlexCandidate: CandidateWork = {
    title: 'Digital Divide across Canadian Regions',
    doi: '10.1016/j.pubpol.2021.01.002',
    url: 'https://doi.org/10.1016/j.pubpol.2021.01.002',
    source: 'OpenAlex',
    sourceId: 'W12345',
    year: 2021,
    issuingOrganization: 'Elsevier',
    abstract: 'We used data from the Canadian Internet Use Survey (CIUS) to assess internet connectivity.',
    abstractRights: 'restricted',
    topics: ['Broadband', 'Internet'],
    suggestedPrograms: ['CIUS'],
  };

  const crossrefCandidate: CandidateWork = {
    title: 'Digital Divide across Canadian Regions: A Study',
    doi: '10.1016/J.PUBPOL.2021.01.002', // uppercase DOI test
    url: 'https://sciencedirect.com/article/123',
    source: 'Crossref',
    sourceId: '10.1016/J.PUBPOL.2021.01.002',
    year: 2021,
    issuingOrganization: 'Elsevier Inc.',
    abstract: 'We used data from the Canadian Internet Use Survey (CIUS) to assess internet connectivity across Canadian provinces.',
    abstractRights: 'restricted',
  };

  const statCanWork: CandidateWork = {
    title: 'Digital Adoption during COVID-19',
    doi: '10.25318/36280001202200400004-eng',
    url: 'https://www150.statcan.gc.ca/n1/pub/36-28-0001/2022004/article/00004-eng.htm',
    source: 'OpenAlex',
    sourceId: 'W99999',
    issuingOrganization: 'Statistics Canada',
    abstract: 'StatCan analysis of digital economy.',
    abstractRights: 'permitted',
  };

  it('deduplicates candidate works and combines sources while excluding StatCan works', () => {
    const raw = [openAlexCandidate, crossrefCandidate, statCanWork];
    const deduped = deduplicateCandidates(raw);

    // StatCan work excluded
    expect(deduped).toHaveLength(1);
    const work = deduped[0]!;
    expect(work.doi).toBe('10.1016/j.pubpol.2021.01.002');
    expect(work.source).toContain('OpenAlex');
    expect(work.source).toContain('Crossref');
    // Longer abstract preferred
    expect(work.abstract).toContain('provinces');
  });

  it('assembles SourceWorks with valid passage and candidate survey mappings', () => {
    const sources = assembleCandidates([openAlexCandidate], { targetSurveys: ['CIUS', 'CCHS'] });
    expect(sources).toHaveLength(1);
    const s = sources[0]!;
    expect(s.title).toBe(openAlexCandidate.title);
    expect(s.passageLocation).toBe('Abstract');
    expect(s.passage).toBe(openAlexCandidate.abstract);
    expect(s.surveyCandidates.some(c => c.program === 'CIUS')).toBe(true);
    expect(s.surveyCandidates.find(c => c.program === 'CIUS')?.aliases).toContain('Canadian Internet Use Survey');
  });

  it('generates a comprehensive report from ResearchQueue', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'queue-report-'));
    const q = new ResearchQueue(path.join(dir, 'test.db'));
    try {
      const source = assembleCandidates([openAlexCandidate])[0]!;
      q.seed(source, 'test-model');
      const rep = q.report();

      expect(rep.inventory.totalWorks).toBe(1);
      expect(rep.inventory.worksWithDoi).toBe(1);
      expect(rep.inventory.worksWithAbstract).toBe(0); // restricted abstracts are omitted from persistent plaintext work.abstract
      expect(rep.inventory.abstractRights).toEqual([{ rights: 'restricted', count: 1 }]);
      expect(rep.sources.singleSource).toBe(1);
      expect(rep.jobs.byStatus.some(s => s.status === 'pending')).toBe(true);
    } finally {
      q.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
