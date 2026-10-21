import {
  type CandidateWork,
  isStatisticsCanadaPublication,
  isCanadianGrounded,
  hasForeignDisqualifier,
} from '../model.js';
import type { ResearchQueue } from '../queue.js';

export interface ScholarisRepository {
  id: string;
  name: string;
  host: string;
  source: string;
  jurisdiction: string;
}

export const CANADIAN_SCHOLARIS_REGISTRY: ScholarisRepository[] = [
  {
    id: 'utoronto',
    name: 'University of Toronto',
    host: 'utoronto.scholaris.ca',
    source: 'University of Toronto (TSpace)',
    jurisdiction: 'Ontario',
  },
  {
    id: 'ualberta',
    name: 'University of Alberta',
    host: 'ualberta.scholaris.ca',
    source: 'University of Alberta (ERA)',
    jurisdiction: 'Alberta',
  },
  {
    id: 'ucalgary',
    name: 'University of Calgary',
    host: 'ucalgary.scholaris.ca',
    source: 'University of Calgary (PRISM)',
    jurisdiction: 'Alberta',
  },
  {
    id: 'mcgill',
    name: 'McGill University',
    host: 'mcgill.scholaris.ca',
    source: 'McGill University (eScholarship)',
    jurisdiction: 'Quebec',
  },
  {
    id: 'dal',
    name: 'Dalhousie University',
    host: 'dal.scholaris.ca',
    source: 'Dalhousie University Institutional Repository',
    jurisdiction: 'Nova Scotia',
  },
  {
    id: 'queensu',
    name: "Queen's University",
    host: 'queensu.scholaris.ca',
    source: "Queen's University (QSpace)",
    jurisdiction: 'Ontario',
  },
  {
    id: 'uwaterloo',
    name: 'University of Waterloo',
    host: 'dspacemainprd01.lib.uwaterloo.ca',
    source: 'University of Waterloo (UWSpace)',
    jurisdiction: 'Ontario',
  },
  {
    id: 'carleton',
    name: 'Carleton University',
    host: 'carleton.scholaris.ca',
    source: 'Carleton University (CURVE)',
    jurisdiction: 'Ontario',
  },
  {
    id: 'umontreal',
    name: 'Université de Montréal',
    host: 'umontreal.scholaris.ca',
    source: 'Université de Montréal (Papyrus)',
    jurisdiction: 'Quebec',
  },
];

export const INSTITUTIONAL_SURVEY_QUERIES = [
  { program: 'CCHS', query: '"Canadian Community Health Survey"' },
  { program: 'CCHS', query: '"Enquête sur la santé dans les collectivités canadiennes"' },
  { program: 'LFS', query: '"Labour Force Survey" "Statistics Canada"' },
  { program: 'LFS', query: '"Enquête sur la population active" "Statistique Canada"' },
  { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
  { program: 'GSS', query: '"Enquête sociale générale"' },
  { program: 'CSD', query: '"Canadian Survey on Disability"' },
  { program: 'CIS', query: '"Canadian Income Survey"' },
  { program: 'CHMS', query: '"Canadian Health Measures Survey"' },
  { program: 'SHS', query: '"Survey of Household Spending"' },
  { program: 'CHS', query: '"Canadian Housing Survey"' },
  { program: 'APS', query: '"Aboriginal Peoples Survey"' },
  { program: 'SFS', query: '"Survey of Financial Security"' },
  { program: 'CIUS', query: '"Canadian Internet Use Survey"' },
  { program: 'NGS', query: '"National Graduates Survey"' },
  { program: 'CHSCY', query: '"Canadian Health Survey on Children and Youth"' },
  { program: 'CTADS', query: '"Canadian Tobacco, Alcohol and Drugs Survey"' },
  { program: 'HES', query: '"Households and the Environment Survey"' },
  { program: 'LSIC', query: '"Longitudinal Survey of Immigrants to Canada"' },
  { program: 'LISA', query: '"Longitudinal and International Study of Adults"' },
];

export async function harvestScholarisRepo(
  repo: ScholarisRepository,
  query: string,
  program: string,
  options: {
    maxPages?: number;
    pageSize?: number;
    minYear?: number;
    queue?: ResearchQueue;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<CandidateWork[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 3;
  const minYear = options.minYear ?? 2015;
  const candidates: CandidateWork[] = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `https://${repo.host}/server/api/discover/search/objects?query=${encodeURIComponent(query)}&size=${pageSize}&page=${page}`;
    const cacheKey = `scholaris:${repo.id}:${query}:page${page}`;

    let responseText: string;
    try {
      if (options.queue) {
        const cached = options.queue.getCachedResponse(repo.source, cacheKey);
        if (cached && cached.statusCode === 200) {
          responseText = cached.responseBody;
        } else {
          const res = await fetchImpl(url, {
            headers: {
              'User-Agent': 'ModularSurvey-Researcher (https://msurvey.peji.ca; contact@peji.ca)',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) break;
          responseText = await res.text();
          options.queue.setCachedResponse(repo.source, cacheKey, url, res.status, responseText);
        }
      } else {
        const res = await fetchImpl(url, {
          headers: {
            'User-Agent': 'ModularSurvey-Researcher (https://msurvey.peji.ca; contact@peji.ca)',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) break;
        responseText = await res.text();
      }
    } catch {
      break;
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      break;
    }

    const objects = data._embedded?.searchResult?._embedded?.objects;
    if (!Array.isArray(objects) || objects.length === 0) break;

    for (const item of objects) {
      const indexable = item._embedded?.indexableObject;
      if (!indexable) continue;

      const meta = indexable.metadata || {};
      const title = meta['dc.title']?.[0]?.value || indexable.name || '';
      if (!title) continue;

      // Check date
      const dateStr = meta['dc.date.issued']?.[0]?.value || meta['dc.date']?.[0]?.value || '';
      const yearMatch = dateStr.match(/\b(199\d|20[0-3]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
      if (year && year < minYear) continue;

      // Extract abstract / description
      const abstract = meta['dc.description.abstract']?.[0]?.value || meta['dc.description']?.[0]?.value || '';
      if (!abstract || abstract.length < 50) continue;

      // URI / Handle
      const uri = meta['dc.identifier.uri']?.[0]?.value || (indexable.handle ? `https://hdl.handle.net/${indexable.handle}` : '');
      if (!uri) continue;

      // Degree / Type
      const degree = meta['dc.description.degree']?.[0]?.value;
      const type = meta['dc.type']?.[0]?.value || (degree ? 'Thesis' : 'Graduate Research');

      // Subjects
      const subjects = (meta['dc.subject'] || []).map((s: any) => s.value).filter(Boolean);

      // Verify Canadian grounding & reject foreign disqualifiers
      const combinedText = `${title} ${abstract} ${subjects.join(' ')}`;
      if (!isCanadianGrounded(combinedText)) continue;
      if (hasForeignDisqualifier(combinedText)) continue;
      if (isStatisticsCanadaPublication({ issuingOrganization: repo.name, url: uri })) continue;

      candidates.push({
        title: title.trim(),
        url: uri,
        source: repo.source,
        sourceId: `${repo.id}:${indexable.handle || uri}`,
        year,
        workType: type,
        issuingOrganization: repo.name,
        abstract,
        abstractRights: 'permitted', // Open access university institutional repositories
        openAccessUrl: uri,
        topics: subjects.slice(0, 5),
        suggestedPrograms: [program],
      });
    }

    const totalPages = data._embedded?.searchResult?.page?.totalPages ?? 1;
    if (page + 1 >= totalPages) break;
  }

  return candidates;
}

export async function harvestAllScholarisTheses(
  options: {
    queue?: ResearchQueue;
    maxPagesPerQuery?: number;
    minYear?: number;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<CandidateWork[]> {
  const allCandidates: CandidateWork[] = [];
  const log = options.onProgress ?? console.log;

  log(`\n[Scholaris Consortium Harvester] Commencing scan across ${CANADIAN_SCHOLARIS_REGISTRY.length} Canadian university repositories...`);

  for (let r = 0; r < CANADIAN_SCHOLARIS_REGISTRY.length; r++) {
    const repo = CANADIAN_SCHOLARIS_REGISTRY[r]!;
    log(`\n[${r + 1}/${CANADIAN_SCHOLARIS_REGISTRY.length}] Scanning ${repo.name} (${repo.host})...`);
    let repoHarvested = 0;

    for (const item of INSTITUTIONAL_SURVEY_QUERIES) {
      try {
        const works = await harvestScholarisRepo(repo, item.query, item.program, {
          queue: options.queue,
          maxPages: options.maxPagesPerQuery ?? 3,
          minYear: options.minYear ?? 2015,
        });
        for (const w of works) {
          allCandidates.push(w);
        }
        repoHarvested += works.length;
      } catch (err: any) {
        // Continue politely
      }
      // Polite pacing
      await new Promise(r => setTimeout(r, 200));
    }
    log(`  ✓ ${repo.name}: ${repoHarvested} graduate research works retrieved.`);
  }

  log(`\n[Scholaris Consortium Complete] Total candidate thesis works harvested: ${allCandidates.length}`);
  return allCandidates;
}
