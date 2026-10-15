import { canonicalDoi, stripXml, type CandidateWork, CANONICAL_SURVEYS } from '../model.js';
import type { ResearchQueue } from '../queue.js';
import { fetchWithBackoff } from './openalex.js';

export interface CrdcnOptions {
  queue?: ResearchQueue;
  fetchImpl?: typeof fetch;
  minDelayMs?: number;
}

export interface CrdcnHarvestOptions extends CrdcnOptions {
  sitemapIndices?: number[];
  minYear?: number;
  maxYear?: number;
  maxRecords?: number;
  concurrency?: number;
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

  // Extract structured details from the Details table
  const tableRows: Record<string, string> = {};
  const tableMatch = html.match(/<table[^>]*class=["'][^"']*table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch?.[1]) {
    const rowMatches = tableMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi);
    for (const match of rowMatches) {
      const key = stripXml(match[1])?.trim().toLowerCase() ?? '';
      const val = stripXml(match[2])?.trim() ?? '';
      if (key && val) tableRows[key] = val;
    }
  }

  // DOI extraction
  let doi: string | undefined;
  const tableDoi = tableRows['doi'];
  if (tableDoi) {
    const m = tableDoi.match(/10\.\d{4,9}\/[^\s<"']+/);
    if (m?.[0]) doi = canonicalDoi(m[0]) ?? undefined;
  }
  if (!doi) {
    const doiHrefMatch = html.match(/href=["']https?:\/\/(?:dx\.)?doi\.org\/([^"'\s]+)["']/i);
    if (doiHrefMatch) {
      doi = canonicalDoi(doiHrefMatch[1]) ?? undefined;
    } else {
      const doiTextMatch = html.match(/\b(?:doi|DOI):\s*(10\.\d{4,9}\/[^\s<"']+)/i);
      if (doiTextMatch) doi = canonicalDoi(doiTextMatch[1]) ?? undefined;
    }
  }

  // Publication Year extraction
  let year: number | undefined;
  const tableYear = tableRows['publication year'] || tableRows['year'] || tableRows['date'];
  if (tableYear) {
    const m = tableYear.match(/\b(19\d{2}|20\d{2})\b/);
    if (m?.[1]) year = Number(m[1]);
  }
  if (!year) {
    const yearElemMatch = html.match(/<[^>]+(?:class|id)=["'][^"']*(?:publication-year|publication-date|pub-year|year)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (yearElemMatch?.[1]) {
      const m = yearElemMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
      if (m?.[1]) year = Number(m[1]);
    }
  }
  if (!year) {
    const metaBlockMatch = html.match(/<(?:div|section|p)[^>]*class=["'][^"']*(?:publication-meta|entry-meta|byline)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|p)>/i);
    if (metaBlockMatch?.[1]) {
      const m = metaBlockMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
      if (m?.[1]) year = Number(m[1]);
    }
  }

  // Work Type mapping
  const rawType = tableRows['type']?.toLowerCase() ?? '';
  let workType: 'article' | 'report' | 'working_paper' | 'publication' = 'publication';
  if (/journal\s+article|peer-reviewed/i.test(rawType)) workType = 'article';
  else if (/book\s+chapter|working\s+paper/i.test(rawType)) workType = 'working_paper';
  else if (/report|brief|whitepaper/i.test(rawType)) workType = 'report';

  // Issuing Organization or Journal Name
  const journalOrPub = tableRows['journal name'] || tableRows['publisher'] || tableRows['book title'] || 'Canadian Research Data Centre Network (CRDCN)';

  // Abstract extraction (check tab-page-1 first, then fallback selectors)
  let abstract: string | undefined;
  const tab1Match = html.match(/<div[^>]*id=["']tab-page-1["'][^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (tab1Match?.[1]) {
    const text = stripXml(tab1Match[1])?.trim();
    if (text && text.length > 50) {
      abstract = text.replace(/^Overview\s+(?:Abstract\s*(?:\([^)]*\))?)?:?\s*/i, '').trim();
    }
  }
  if (!abstract) {
    const abstractBlockMatch = html.match(/<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:abstract|summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
    if (abstractBlockMatch) {
      abstract = stripXml(abstractBlockMatch[1]) ?? undefined;
    } else {
      const afterAbstractLabel = html.match(/<strong>\s*Abstract:?\s*<\/strong>\s*<p>([\s\S]*?)<\/p>/i);
      if (afterAbstractLabel) abstract = stripXml(afterAbstractLabel[1]) ?? undefined;
    }
  }

  // "Data Used" candidate lead extraction from tab-page-3
  let dataUsed = '';
  const tab3Match = html.match(/<div[^>]*id=["']tab-page-3["'][^>]*>([\s\S]*?)<\/div>/i);
  if (tab3Match?.[1]) {
    dataUsed = stripXml(tab3Match[1])?.replace(/^Data\s+Used\s*/i, '').trim() ?? '';
  }
  if (!dataUsed) {
    const dataUsedMatch = html.match(/(?:Data\s+Used|Datasets?|Données\s+utilisées)[\s\S]*?<(?:ul|div|p)[^>]*>([\s\S]*?)<\/(?:ul|div|p)>/i);
    if (dataUsedMatch?.[1]) dataUsed = stripXml(dataUsedMatch[1])?.trim() ?? '';
  }

  // RDC location from tab-page-4
  let rdcName = '';
  const tab4Match = html.match(/<div[^>]*id=["']tab-page-4["'][^>]*>([\s\S]*?)<\/div>/i);
  if (tab4Match?.[1]) {
    rdcName = stripXml(tab4Match[1])?.replace(/^Research\s+Data\s+Centre\(s\)\s*/i, '').trim() ?? '';
  }

  // Map candidate programs from title, abstract, and Data Used
  const fullText = `${title} ${abstract ?? ''} ${dataUsed} ${rdcName}`;
  const suggestedPrograms: string[] = [];
  const lower = fullText.toLowerCase();

  for (const [code, spec] of Object.entries(CANONICAL_SURVEYS)) {
    if (spec.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
      suggestedPrograms.push(code);
    }
  }

  // Construct passage for deterministic extraction and quote verification
  const passageParts: string[] = [];
  if (abstract) passageParts.push(abstract);
  if (dataUsed) passageParts.push(`Data Used: ${dataUsed}`);
  if (rdcName) passageParts.push(`Research Data Centre: ${rdcName}`);
  const passage = passageParts.join('\n\n') || title;

  return {
    title: title.trim(),
    doi,
    url: pageUrl,
    source: 'CRDCN',
    sourceId: pageUrl,
    year,
    workType,
    issuingOrganization: journalOrPub,
    abstract: abstract?.slice(0, 3000),
    abstractRights: 'unknown',
    suggestedPrograms: [...new Set(suggestedPrograms)],
    passage: passage.slice(0, 4000),
    passageLocation: 'CRDCN - Abstract & Data Used',
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

      const res = await fetchWithBackoff(url, { 'User-Agent': 'ModularSurvey-Researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)' }, fetchImpl);
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

    const res = await fetchWithBackoff(url, { 'User-Agent': 'ModularSurvey-Researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)' }, fetchImpl);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`CRDCN HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    htmlText = res.text;
  }

  return parseCrdcnHtml(htmlText, url);
}

/**
 * Fetches publication URLs from CRDCN XML sitemaps.
 */
export async function fetchCrdcnSitemapUrls(sitemapIndices: number[] = [1, 2, 3, 4, 5, 6, 7]): Promise<string[]> {
  const allUrls: string[] = [];

  for (const idx of sitemapIndices) {
    const suffix = idx === 1 ? '' : String(idx);
    const sitemapUrl = `https://crdcn.ca/publication-sitemap${suffix}.xml`;
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'ModularSurvey-Researcher/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const locMatches = text.matchAll(/<loc>([^<]+)<\/loc>/g);
      for (const m of locMatches) {
        if (m?.[1]) {
          const u = m[1].trim();
          if (u.includes('/publication/')) allUrls.push(u);
        }
      }
    } catch {
      // Graceful sitemap error
    }
  }

  return [...new Set(allUrls)];
}

/**
 * Harvests publications from CRDCN, filtering by year range (e.g. 2015-2026).
 */
export async function harvestCrdcnPublications(
  options: CrdcnHarvestOptions = {}
): Promise<CandidateWork[]> {
  const indices = options.sitemapIndices ?? [1, 2, 3, 4, 5, 6, 7];
  const minYear = options.minYear ?? 2015;
  const maxYear = options.maxYear ?? 2026;
  const maxRecords = options.maxRecords ?? 5000;
  const concurrency = options.concurrency ?? 5;

  console.log(`\n[CRDCN Harvester] Fetching URLs from sitemaps ${indices.join(', ')}...`);
  const urls = await fetchCrdcnSitemapUrls(indices);
  console.log(`[CRDCN Harvester] Total publication URLs discovered: ${urls.length}`);

  const candidates: CandidateWork[] = [];
  const targetUrls = urls.slice(0, maxRecords);
  let processed = 0;

  // Worker queue for concurrency
  const queue = [...targetUrls];
  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;

      try {
        const cand = await fetchCrdcnPage(url, { ...options, minDelayMs: 250 });
        processed++;
        if (processed % 50 === 0 || processed === targetUrls.length) {
          console.log(`  [CRDCN Progress] ${processed}/${targetUrls.length} pages inspected (${candidates.length} in window ${minYear}–${maxYear})...`);
        }

        if (cand) {
          const y = cand.year ?? 0;
          if (y >= minYear && y <= maxYear) {
            candidates.push(cand);
          }
        }
      } catch (err) {
        // Continue worker on failure
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(`[CRDCN Harvester Complete] Harvested ${candidates.length} publications in ${minYear}–${maxYear}.`);
  return candidates;
}
