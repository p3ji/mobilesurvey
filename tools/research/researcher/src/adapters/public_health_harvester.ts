import {
  type CandidateWork,
  isStatisticsCanadaPublication,
  isCanadianGrounded,
  hasForeignDisqualifier,
} from '../model.js';
import { parseOpenAlexWork, fetchWithBackoff, type OpenAlexSearchOptions } from './openalex.js';

export interface HealthAuthority {
  id: string; // OpenAlex institution ID (without prefix)
  name: string;
  source: string;
  jurisdiction: string;
}

export const CANADIAN_HEALTH_AUTHORITIES: HealthAuthority[] = [
  {
    id: 'I4210125326',
    name: 'Public Health Ontario',
    source: 'Public Health Ontario Surveillance',
    jurisdiction: 'Ontario',
  },
  {
    id: 'I4210095493',
    name: 'Institut national de santé publique du Québec',
    source: 'INSPQ Surveillance Épidémiologique',
    jurisdiction: 'Quebec',
  },
  {
    id: 'I2802940977',
    name: 'BC Centre for Disease Control',
    source: 'BCCDC Public Health Surveillance',
    jurisdiction: 'British Columbia',
  },
  {
    id: 'I126859394',
    name: 'Alberta Health Services',
    source: 'Alberta Health Services Epidemiological Report',
    jurisdiction: 'Alberta',
  },
  {
    id: 'I152658341',
    name: 'Canadian Institute for Health Information',
    source: 'CIHI Health Indicators Analysis',
    jurisdiction: 'Canada',
  },
  {
    id: 'I177235860',
    name: 'Public Health Agency of Canada',
    source: 'PHAC Epidemiological Surveillance',
    jurisdiction: 'Canada',
  },
  {
    id: 'I184430034',
    name: 'Toronto Public Health',
    source: 'Toronto Public Health Equity Profile',
    jurisdiction: 'Toronto CMA',
  },
  {
    id: 'I4210143003',
    name: 'Ottawa Public Health',
    source: 'Ottawa Public Health Status Report',
    jurisdiction: 'Ottawa CMA',
  },
  {
    id: 'I2802394193',
    name: 'Nova Scotia Health Authority',
    source: 'Nova Scotia Health Surveillance',
    jurisdiction: 'Nova Scotia',
  },
  {
    id: 'I23625684',
    name: 'Saskatchewan Health Authority',
    source: 'Saskatchewan Health Population Health Report',
    jurisdiction: 'Saskatchewan',
  },
];

export const HEALTH_SURVEY_QUERIES = [
  { program: 'CCHS', query: '"Canadian Community Health Survey"' },
  { program: 'CCHS', query: '"Enquête sur la santé dans les collectivités canadiennes"' },
  { program: 'CHMS', query: '"Canadian Health Measures Survey"' },
  { program: 'CHMS', query: '"Enquête canadienne sur les mesures de la santé"' },
  { program: 'CTADS', query: '"Canadian Tobacco, Alcohol and Drugs Survey"' },
  { program: 'CTADS', query: '"Enquête canadienne sur le tabac, l’alcool et les drogues"' },
  { program: 'CTNS', query: '"Canadian Tobacco and Nicotine Survey"' },
  { program: 'CTNS', query: '"Enquête canadienne sur le tabac et la nicotine"' },
  { program: 'CSD', query: '"Canadian Survey on Disability"' },
  { program: 'CSD', query: '"Enquête canadienne sur l\'incapacité"' },
  { program: 'CHSCY', query: '"Canadian Health Survey on Children and Youth"' },
  { program: 'CHSCY', query: '"Enquête canadienne sur la santé des enfants et des jeunes"' },
  { program: 'SCMH', query: '"Survey on COVID-19 and Mental Health"' },
  { program: 'CADS', query: '"Canadian Alcohol and Drugs Survey"' },
  { program: 'SMHSE', query: '"Survey on Mental Health and Stressful Events"' },
  { program: 'GSS', query: '"General Social Survey" "Statistics Canada"' },
  { program: 'CIS', query: '"Canadian Income Survey"' },
  { program: 'SHS', query: '"Survey of Household Spending"' },
  { program: 'CAFHS', query: '"Canadian Armed Forces Health Survey"' },
  { program: 'CNICS', query: '"Childhood National Immunization Coverage Survey"' },
];

export async function harvestHealthAuthority(
  authority: HealthAuthority,
  queryItem: { program: string; query: string },
  options: OpenAlexSearchOptions & { minYear?: number } = {}
): Promise<CandidateWork[]> {
  const politeEmail = options.politeEmail ?? process.env.RESEARCHER_POLITE_EMAIL ?? 'researcher@msurvey.peji.ca';
  const fetchImpl = options.fetchImpl ?? fetch;
  const minYear = options.minYear ?? 2015;
  const candidates: CandidateWork[] = [];

  const params = new URLSearchParams();
  params.set('search', queryItem.query);
  params.set('filter', `institutions.id:${authority.id},from_publication_date:${minYear}-01-01`);
  params.set('per-page', '50');
  params.set('mailto', politeEmail);
  const apiKey = options.apiKey ?? process.env.OPENALEX_API_KEY;
  if (apiKey) params.set('api_key', apiKey);

  const requestUrl = `https://api.openalex.org/works?${params.toString()}`;
  const cacheKey = `health:${authority.id}:${queryItem.program}:${queryItem.query}`;

  let responseText: string;
  try {
    if (options.queue) {
      const cached = options.queue.getCachedResponse(authority.source, cacheKey);
      if (cached && cached.statusCode === 200) {
        responseText = cached.responseBody;
      } else {
        const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
        if (res.status !== 200) return [];
        responseText = res.text;
        options.queue.setCachedResponse(authority.source, cacheKey, requestUrl, res.status, responseText);
      }
    } else {
      const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
      if (res.status !== 200) return [];
      responseText = res.text;
    }

    const data = JSON.parse(responseText);
    const results = Array.isArray(data.results) ? data.results : [];

    for (const raw of results) {
      const parsed = parseOpenAlexWork(raw);
      if (parsed.year && parsed.year < minYear) continue;

      // Discard StatCan's own publications
      if (isStatisticsCanadaPublication({ issuingOrganization: authority.name, url: parsed.url, doi: parsed.doi })) {
        continue;
      }

      // Check Canadian grounding & reject foreign disqualifiers
      const text = `${parsed.title} ${parsed.abstract || ''}`;
      if (!isCanadianGrounded(text)) continue;
      if (hasForeignDisqualifier(text)) continue;

      // Set explicit health authority provenance
      parsed.source = authority.source;
      parsed.issuingOrganization = authority.name;
      parsed.suggestedPrograms = [queryItem.program];
      candidates.push(parsed);
    }
  } catch {
    // Continue politely
  }

  return candidates;
}

export async function harvestAllHealthAuthorities(
  options: OpenAlexSearchOptions & { minYear?: number; onProgress?: (msg: string) => void } = {}
): Promise<CandidateWork[]> {
  const allCandidates: CandidateWork[] = [];
  const log = options.onProgress ?? console.log;

  log(`\n[Canadian Public Health Harvester] Scanning ${CANADIAN_HEALTH_AUTHORITIES.length} public health authorities across ${HEALTH_SURVEY_QUERIES.length} survey programs...`);

  for (let a = 0; a < CANADIAN_HEALTH_AUTHORITIES.length; a++) {
    const authority = CANADIAN_HEALTH_AUTHORITIES[a]!;
    log(`\n[${a + 1}/${CANADIAN_HEALTH_AUTHORITIES.length}] Scanning ${authority.name} (${authority.jurisdiction})...`);
    let authCount = 0;

    for (const q of HEALTH_SURVEY_QUERIES) {
      const works = await harvestHealthAuthority(authority, q, options);
      for (const w of works) {
        allCandidates.push(w);
      }
      authCount += works.length;
      // Polite pacing
      await new Promise(r => setTimeout(r, 150));
    }

    log(`  ✓ ${authority.name}: ${authCount} epidemiological surveillance works retrieved.`);
  }

  log(`\n[Public Health Harvester Complete] Total candidate surveillance works harvested: ${allCandidates.length}`);
  return allCandidates;
}
