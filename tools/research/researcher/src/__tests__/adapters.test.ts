import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOpenAlexWork } from '../adapters/openalex.js';
import { fetchCrossrefDoi, parseCrossrefWork } from '../adapters/crossref.js';
import { parseCrdcnHtml } from '../adapters/crdcn.js';
import { isStatisticsCanadaPublication, reconstructAbstract, stripXml } from '../model.js';
import { ResearchQueue } from '../queue.js';

describe('Researcher Adapters', () => {
  it('reconstructs abstract from OpenAlex inverted index', () => {
    const invertedIndex = {
      We: [0],
      analyzed: [1],
      the: [2, 5],
      Canadian: [3],
      Internet: [4],
      Use: [6], // intentional out of order test
      Survey: [7],
      'data.': [8],
    };
    // Expected words in position order:
    // 0: We, 1: analyzed, 2: the, 3: Canadian, 4: Internet, 5: the, 6: Use, 7: Survey, 8: data.
    const reconstructed = reconstructAbstract(invertedIndex);
    expect(reconstructed).toBe('We analyzed the Canadian Internet the Use Survey data.');
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });

  it('parses OpenAlex work correctly and sets restricted abstract rights', () => {
    const raw = {
      id: 'https://openalex.org/W123456789',
      doi: 'https://doi.org/10.1016/J.PUBPOL.2021.01.002',
      title: 'Digital Divide in Rural Canada',
      publication_year: 2021,
      type: 'journal-article',
      primary_location: {
        landing_page_url: 'https://sciencedirect.com/article/123',
        pdf_url: 'https://sciencedirect.com/article/123.pdf',
        source: {
          display_name: 'Policy Studies Journal',
          host_organization_name: 'Wiley-Blackwell',
        },
      },
      abstract_inverted_index: {
        This: [0],
        study: [1],
        examines: [2],
        broadband: [3],
        'access.': [4],
      },
      concepts: [{ display_name: 'Digital divide' }, { display_name: 'Broadband' }],
    };

    const parsed = parseOpenAlexWork(raw);
    expect(parsed.title).toBe('Digital Divide in Rural Canada');
    expect(parsed.doi).toBe('10.1016/j.pubpol.2021.01.002');
    expect(parsed.source).toBe('OpenAlex');
    expect(parsed.issuingOrganization).toBe('Wiley-Blackwell');
    expect(parsed.abstract).toBe('This study examines broadband access.');
    expect(parsed.abstractRights).toBe('restricted');
    expect(parsed.openAccessUrl).toBe('https://sciencedirect.com/article/123.pdf');
    expect(parsed.topics).toContain('Digital divide');
  });

  it('strips XML tags from Crossref JATS abstracts', () => {
    const rawAbstract = '<jats:title>Abstract</jats:title><jats:p>This study analyzed the <jats:italic>Canadian Community Health Survey</jats:italic> (CCHS) 2017/2018 cycle.</jats:p>';
    expect(stripXml(rawAbstract)).toBe('Abstract This study analyzed the Canadian Community Health Survey (CCHS) 2017/2018 cycle.');
    expect(stripXml(null)).toBeNull();
  });

  it('parses Crossref work and extracts publisher and year', () => {
    const raw = {
      DOI: '10.1371/journal.pone.0200127',
      title: ['Trend analysis for national surveys'],
      URL: 'http://dx.doi.org/10.1371/journal.pone.0200127',
      publisher: 'Public Library of Science (PLoS)',
      type: 'journal-article',
      published: { 'date-parts': [[2018, 7, 12]] },
      abstract: '<jats:p>Application to Canadian Health Measures Survey.</jats:p>',
    };

    const parsed = parseCrossrefWork(raw);
    expect(parsed.title).toBe('Trend analysis for national surveys');
    expect(parsed.doi).toBe('10.1371/journal.pone.0200127');
    expect(parsed.year).toBe(2018);
    expect(parsed.issuingOrganization).toBe('Public Library of Science (PLoS)');
    expect(parsed.abstract).toBe('Application to Canadian Health Measures Survey.');
    expect(parsed.abstractRights).toBe('restricted');
  });

  it('parses CRDCN publication HTML and extracts metadata with candidate leads', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Top dietary sources of energy among Canadians: insights from CCHS 2015" />
        </head>
        <body>
          <h1 class="entry-title">Top dietary sources of energy among Canadians: insights from CCHS 2015</h1>
          <div class="publication-meta">
            <span class="publication-year">2019</span>
            <a href="https://doi.org/10.1139/apnm-2018-0570">DOI: 10.1139/apnm-2018-0570</a>
          </div>
          <div class="publication-abstract">
            <p>We evaluated nutrient intake using the 2015 Canadian Community Health Survey - Nutrition.</p>
          </div>
          <div class="data-used">
            <h3>Data Used</h3>
            <ul>
              <li>Canadian Community Health Survey (CCHS)</li>
            </ul>
          </div>
        </body>
      </html>
    `;

    const parsed = parseCrdcnHtml(html, 'https://crdcn.ca/publication/dietary-sources');
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain('Top dietary sources');
    expect(parsed!.doi).toBe('10.1139/apnm-2018-0570');
    expect(parsed!.year).toBe(2019);
    expect(parsed!.abstract).toContain('2015 Canadian Community Health Survey');
    expect(parsed!.suggestedPrograms).toContain('CCHS');
    expect(parsed!.source).toBe('CRDCN');
    expect(parsed!.abstractRights).toBe('unknown');
  });

  it('identifies Statistics Canada publications by DOI, URL, or issuing organization', () => {
    expect(isStatisticsCanadaPublication({ doi: '10.25318/36280001202200400004-eng' })).toBe(true);
    expect(isStatisticsCanadaPublication({ url: 'https://www150.statcan.gc.ca/n1/pub/article.htm' })).toBe(true);
    expect(isStatisticsCanadaPublication({ issuingOrganization: 'Statistics Canada' })).toBe(true);
    expect(isStatisticsCanadaPublication({ issuingOrganization: 'Statistique Canada' })).toBe(true);
    expect(isStatisticsCanadaPublication({ issuingOrganization: 'StatCan' })).toBe(true);

    // Outside works
    expect(isStatisticsCanadaPublication({ doi: '10.1371/journal.pone.0200127', url: 'https://example.org/article', issuingOrganization: 'PLOS' })).toBe(false);
    expect(isStatisticsCanadaPublication({ url: 'https://crdcn.ca/publication/sample', issuingOrganization: 'University of Toronto' })).toBe(false);
  });

  it('checkpoints adapter responses in queue SQLite database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'adapter-cache-'));
    const q = new ResearchQueue(path.join(dir, 'test.db'));
    try {
      const mockFetch = async () => ({
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ message: { title: ['Cached Article'], DOI: '10.1000/182', publisher: 'Springer' } }),
      } as any);

      // First fetch caches response
      const work1 = await fetchCrossrefDoi('10.1000/182', { queue: q, fetchImpl: mockFetch });
      expect(work1?.title).toBe('Cached Article');

      // Verify cached in database
      const cached = q.getCachedResponse('Crossref', 'doi:10.1000/182');
      expect(cached).not.toBeNull();
      expect(cached?.statusCode).toBe(200);

      // Second fetch reads from cache (with throwing fetchImpl)
      const throwingFetch = async () => { throw new Error('Network call should not occur'); };
      const work2 = await fetchCrossrefDoi('10.1000/182', { queue: q, fetchImpl: throwingFetch as any });
      expect(work2?.title).toBe('Cached Article');
    } finally {
      q.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
