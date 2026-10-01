import { canonicalDoi, stripXml, type CandidateWork } from '../model.js';
import type { ResearchQueue } from '../queue.js';
import { fetchWithBackoff } from './openalex.js';

export interface CrdcnOptions {
  queue?: ResearchQueue;
  fetchImpl?: typeof fetch;
  minDelayMs?: number;
}

export function parseCrdcnHtml(html: string, pageUrl: string): CandidateWork | null {
  if (!html || typeof html !== 'string') return null;

  // Title extraction: og:title or h1
  let title: string | undefined;
  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitleMatch) title = ogTitleMatch[1];
  else {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) title = stripXml(h1Match[1]) ?? undefined;
  }
  if (!title) return null;

  // DOI extraction
  let doi: string | undefined;
  const doiHrefMatch = html.match(/href=["']https?:\/\/(?:dx\.)?doi\.org\/([^"'\s]+)["']/i);
  if (doiHrefMatch) {
    doi = canonicalDoi(doiHrefMatch[1]) ?? undefined;
  } else {
    const doiTextMatch = html.match(/\b(?:doi|DOI):\s*(10\.\d{4,9}\/[^\s<"']+)/i);
    if (doiTextMatch) doi = canonicalDoi(doiTextMatch[1]) ?? undefined;
  }

  // Publication Year extraction: prefer explicit metadata element
  let year: number | undefined;
  const yearElemMatch = html.match(/<[^>]+(?:class|id)=["'][^"']*(?:publication-year|publication-date|pub-year|year)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (yearElemMatch?.[1]) {
    const m = yearElemMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
    if (m?.[1]) year = Number(m[1]);
  }
  if (!year) {
    const metaBlockMatch = html.match(/<(?:div|section|p)[^>]*class=["'][^"']*(?:publication-meta|entry-meta|byline)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|p)>/i);
    if (metaBlockMatch?.[1]) {
      const m = metaBlockMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
      if (m?.[1]) year = Number(m[1]);
    }
  }

  // Abstract extraction
  let abstract: string | undefined;
  const abstractBlockMatch = html.match(/<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:abstract|summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
  if (abstractBlockMatch) {
    abstract = stripXml(abstractBlockMatch[1]) ?? undefined;
  } else {
    const afterAbstractLabel = html.match(/<strong>\s*Abstract:?\s*<\/strong>\s*<p>([\s\S]*?)<\/p>/i);
    if (afterAbstractLabel) abstract = stripXml(afterAbstractLabel[1]) ?? undefined;
  }

  // "Data Used" candidate lead extraction (candidate lead only, never proof of analysis or exact cycle)
  const suggestedPrograms: string[] = [];
  const dataUsedMatch = html.match(/(?:Data\s+Used|Datasets?|Données\s+utilisées)[\s\S]*?<(?:ul|div|p)[^>]*>([\s\S]*?)<\/(?:ul|div|p)>/i);
  const dataSection = (dataUsedMatch ? dataUsedMatch[1] : html) ?? '';

  if (/\b(?:CCHS|Canadian Community Health Survey|ESCC)\b/i.test(dataSection)) suggestedPrograms.push('CCHS');
  if (/\b(?:CIUS|Canadian Internet Use Survey|ECUI)\b/i.test(dataSection)) suggestedPrograms.push('CIUS');
  if (/\b(?:CHMS|Canadian Health Measures Survey|ECMS)\b/i.test(dataSection)) suggestedPrograms.push('CHMS');
  if (/\b(?:GSS|General Social Survey|ESG)\b/i.test(dataSection)) suggestedPrograms.push('GSS');
  if (/\b(?:LFS|Labour Force Survey|EPA)\b/i.test(dataSection)) suggestedPrograms.push('LFS');

  return {
    title: title.trim(),
    doi,
    url: pageUrl,
    source: 'CRDCN',
    sourceId: pageUrl,
    year,
    workType: 'publication',
    abstract,
    abstractRights: 'unknown',
    suggestedPrograms: [...new Set(suggestedPrograms)],
  };
}

let lastFetchTime = 0;

export async function fetchCrdcnPage(
  url: string,
  options: CrdcnOptions = {}
): Promise<CandidateWork | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minDelay = options.minDelayMs ?? 1500;
  const cacheKey = `page:${url}`;

  let htmlText: string;
  if (options.queue) {
    const cached = options.queue.getCachedResponse('CRDCN', cacheKey);
    if (cached && cached.statusCode === 200) {
      htmlText = cached.responseBody;
    } else {
      const now = Date.now();
      const elapsed = now - lastFetchTime;
      if (elapsed < minDelay) {
        await new Promise(r => setTimeout(r, minDelay - elapsed));
      }
      lastFetchTime = Date.now();

      const res = await fetchWithBackoff(url, { 'User-Agent': 'ModularSurvey-Researcher/0.1.0' }, fetchImpl);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`CRDCN HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      htmlText = res.text;
      options.queue.setCachedResponse('CRDCN', cacheKey, url, res.status, htmlText);
    }
  } else {
    const now = Date.now();
    const elapsed = now - lastFetchTime;
    if (elapsed < minDelay) {
      await new Promise(r => setTimeout(r, minDelay - elapsed));
    }
    lastFetchTime = Date.now();

    const res = await fetchWithBackoff(url, { 'User-Agent': 'ModularSurvey-Researcher/0.1.0' }, fetchImpl);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`CRDCN HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    htmlText = res.text;
  }

  return parseCrdcnHtml(htmlText, url);
}
