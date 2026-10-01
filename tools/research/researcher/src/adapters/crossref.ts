import { canonicalDoi, stripXml, type CandidateWork } from '../model.js';
import type { ResearchQueue } from '../queue.js';
import { fetchWithBackoff } from './openalex.js';

export interface CrossrefOptions {
  politeEmail?: string;
  queue?: ResearchQueue;
  fetchImpl?: typeof fetch;
}

export interface CrossrefSearchOptions extends CrossrefOptions {
  rows?: number;
  offset?: number;
  filter?: string;
}

export function parseCrossrefWork(raw: any): CandidateWork {
  const doi = canonicalDoi(raw.DOI);
  const title = (Array.isArray(raw.title) && raw.title.length)
    ? String(raw.title[0]).trim()
    : String(raw.title ?? 'Untitled').trim();
  const url = raw.URL || (doi ? `https://doi.org/${doi}` : undefined) || 'https://crossref.org';
  const pubDateParts = raw.published?.['date-parts']?.[0]
    ?? raw['published-print']?.['date-parts']?.[0]
    ?? raw['published-online']?.['date-parts']?.[0]
    ?? raw.created?.['date-parts']?.[0];
  const year = Array.isArray(pubDateParts) && typeof pubDateParts[0] === 'number' ? pubDateParts[0] : undefined;
  const abstract = stripXml(raw.abstract) ?? undefined;

  return {
    title,
    doi: doi ?? undefined,
    url,
    source: 'Crossref',
    sourceId: String(raw.DOI ?? url),
    year,
    workType: raw.type ? String(raw.type) : undefined,
    issuingOrganization: raw.publisher ? String(raw.publisher).trim() : undefined,
    abstract,
    abstractRights: 'restricted', // Crossref deposited abstracts remain under publisher/author copyright
  };
}

export async function fetchCrossrefDoi(
  doi: string,
  options: CrossrefOptions = {}
): Promise<CandidateWork | null> {
  const cDoi = canonicalDoi(doi);
  if (!cDoi) return null;
  const politeEmail = options.politeEmail ?? process.env.RESEARCHER_POLITE_EMAIL ?? 'researcher@msurvey.peji.ca';
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestUrl = `https://api.crossref.org/works/${encodeURIComponent(cDoi)}`;
  const cacheKey = `doi:${cDoi}`;

  let responseText: string;
  if (options.queue) {
    const cached = options.queue.getCachedResponse('Crossref', cacheKey);
    if (cached) {
      if (cached.statusCode === 404) return null;
      if (cached.statusCode === 200) responseText = cached.responseBody;
      else throw new Error(`Crossref cached HTTP ${cached.statusCode}`);
    } else {
      const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
      options.queue.setCachedResponse('Crossref', cacheKey, requestUrl, res.status, res.text);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`Crossref HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      responseText = res.text;
    }
  } else {
    const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`Crossref HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    responseText = res.text;
  }

  const data = JSON.parse(responseText);
  if (!data.message) return null;
  return parseCrossrefWork(data.message);
}

export async function searchCrossref(
  query: string,
  options: CrossrefSearchOptions = {}
): Promise<{ works: CandidateWork[]; totalCount: number }> {
  const politeEmail = options.politeEmail ?? process.env.RESEARCHER_POLITE_EMAIL ?? 'researcher@msurvey.peji.ca';
  const rows = Math.min(options.rows ?? 25, 100);
  const offset = options.offset ?? 0;
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams();
  if (query) params.set('query.bibliographic', query);
  params.set('rows', String(rows));
  params.set('offset', String(offset));
  if (options.filter) params.set('filter', options.filter);

  const requestUrl = `https://api.crossref.org/works?${params.toString()}`;
  const cacheKey = `search:${requestUrl}`;

  let responseText: string;
  if (options.queue) {
    const cached = options.queue.getCachedResponse('Crossref', cacheKey);
    if (cached && cached.statusCode === 200) {
      responseText = cached.responseBody;
    } else {
      const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
      if (res.status !== 200) throw new Error(`Crossref HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      responseText = res.text;
      options.queue.setCachedResponse('Crossref', cacheKey, requestUrl, res.status, responseText);
    }
  } else {
    const res = await fetchWithBackoff(requestUrl, { 'User-Agent': `ModularSurvey-Researcher (mailto:${politeEmail})` }, fetchImpl);
    if (res.status !== 200) throw new Error(`Crossref HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    responseText = res.text;
  }

  const data = JSON.parse(responseText);
  const items = Array.isArray(data.message?.items) ? data.message.items : [];
  const works = items.map(parseCrossrefWork);
  return {
    works,
    totalCount: data.message?.['total-results'] ?? works.length,
  };
}
