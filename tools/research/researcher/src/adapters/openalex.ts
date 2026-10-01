import { canonicalDoi, reconstructAbstract, type CandidateWork } from '../model.js';
import type { ResearchQueue } from '../queue.js';

export interface OpenAlexSearchOptions {
  perPage?: number;
  cursor?: string;
  filter?: string;
  politeEmail?: string;
  queue?: ResearchQueue;
  fetchImpl?: typeof fetch;
}

export function parseOpenAlexWork(raw: any): CandidateWork {
  const doi = canonicalDoi(raw.doi);
  const primaryLoc = raw.primary_location ?? {};
  const sourceVenue = primaryLoc.source ?? {};
  const issuingOrg = sourceVenue.host_organization_name ?? sourceVenue.display_name ?? undefined;
  const abstract = reconstructAbstract(raw.abstract_inverted_index) ?? undefined;
  const landingUrl = primaryLoc.landing_page_url || (doi ? `https://doi.org/${doi}` : raw.id);
  const oaUrl = raw.open_access?.oa_url || primaryLoc.pdf_url || undefined;
  const topics = Array.isArray(raw.concepts) ? raw.concepts.map((c: any) => String(c.display_name)).filter(Boolean).slice(0, 5) : [];

  return {
    title: String(raw.title ?? 'Untitled').trim(),
    doi: doi ?? undefined,
    url: landingUrl,
    source: 'OpenAlex',
    sourceId: String(raw.id ?? landingUrl),
    year: typeof raw.publication_year === 'number' ? raw.publication_year : undefined,
    workType: raw.type ? String(raw.type) : undefined,
    issuingOrganization: issuingOrg ? String(issuingOrg).trim() : undefined,
    abstract,
    abstractRights: 'restricted', // OpenAlex does not grant plaintext redistribution rights
    openAccessUrl: oaUrl,
    topics,
  };
}

export async function fetchWithBackoff(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  maxRetries = 3
): Promise<{ status: number; text: string }> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const response = await fetchImpl(url, { headers });
    if (response.status === 429) {
      const retryAfterHeader = response.headers?.get('retry-after');
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1500 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, Math.min(waitMs, 10000)));
      continue;
    }
    const text = await response.text();
    return { status: response.status, text };
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries (status 429 rate limit)`);
}

export async function searchOpenAlex(
  query: string,
  options: OpenAlexSearchOptions = {}
): Promise<{ works: CandidateWork[]; totalCount: number; nextCursor?: string }> {
  const politeEmail = options.politeEmail ?? process.env.RESEARCHER_POLITE_EMAIL ?? 'researcher@msurvey.peji.ca';
  const perPage = Math.min(options.perPage ?? 25, 100);
  const cursor = options.cursor ?? '*';
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams();
  if (query) {
    const formattedQuery = (query.includes(' ') && !query.startsWith('"')) ? `"${query}"` : query;
    params.set('search', formattedQuery);
  }
  params.set('per-page', String(perPage));
  params.set('cursor', cursor);
  params.set('mailto', politeEmail);
  if (options.filter) params.set('filter', options.filter);

  const requestUrl = `https://api.openalex.org/works?${params.toString()}`;
  const cacheKey = `search:${requestUrl}`;

  let responseText: string;
  if (options.queue) {
    const cached = options.queue.getCachedResponse('OpenAlex', cacheKey);
    if (cached && cached.statusCode === 200) {
      responseText = cached.responseBody;
    } else {
      const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
      if (res.status !== 200) throw new Error(`OpenAlex HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      responseText = res.text;
      options.queue.setCachedResponse('OpenAlex', cacheKey, requestUrl, res.status, responseText);
    }
  } else {
    const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
    if (res.status !== 200) throw new Error(`OpenAlex HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    responseText = res.text;
  }

  const data = JSON.parse(responseText);
  const results = Array.isArray(data.results) ? data.results : [];
  const works = results.map(parseOpenAlexWork);
  return {
    works,
    totalCount: data.meta?.count ?? works.length,
    nextCursor: data.meta?.next_cursor ?? undefined,
  };
}

export async function getOpenAlexByDois(
  dois: string[],
  options: OpenAlexSearchOptions = {}
): Promise<CandidateWork[]> {
  const validDois = dois.map(canonicalDoi).filter(Boolean) as string[];
  if (!validDois.length) return [];
  const chunkSize = 50;
  const allWorks: CandidateWork[] = [];

  for (let i = 0; i < validDois.length; i += chunkSize) {
    const chunk = validDois.slice(i, i + chunkSize);
    const filter = `doi:${chunk.map(d => `https://doi.org/${d}`).join('|')}`;
    const result = await searchOpenAlex('', { ...options, filter, perPage: chunk.length });
    allWorks.push(...result.works);
  }
  return allWorks;
}
