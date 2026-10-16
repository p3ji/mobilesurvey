import {
  type CandidateWork,
  CANONICAL_SURVEYS,
  isStatisticsCanadaPublication,
  isCanadianGrounded,
  hasForeignDisqualifier,
} from '../model.js';
import { getGreyLiteratureCandidates } from './grey-literature.js';

export interface CkanEndpoint {
  name: string;
  tier: 'federal' | 'provincial' | 'cma';
  jurisdiction: string;
  baseUrl: string;
}

export interface SocrataEndpoint {
  name: string;
  tier: 'provincial' | 'cma';
  jurisdiction: string;
  baseUrl: string;
}

export const CANADIAN_CKAN_REGISTRY: CkanEndpoint[] = [
  // ── Tier 1: Federal ───────────────────────────────────────────────────────
  {
    name: 'Government of Canada Open Data',
    tier: 'federal',
    jurisdiction: 'Canada',
    baseUrl: 'https://open.canada.ca/data',
  },
  // ── Tier 2: Provincial & Territorial ──────────────────────────────────────
  {
    name: 'Ontario Data Catalogue',
    tier: 'provincial',
    jurisdiction: 'Ontario',
    baseUrl: 'https://data.ontario.ca',
  },
  {
    name: 'Données Québec',
    tier: 'provincial',
    jurisdiction: 'Quebec',
    baseUrl: 'https://www.donneesquebec.ca/recherche',
  },
  {
    name: 'BC Data Catalogue',
    tier: 'provincial',
    jurisdiction: 'British Columbia',
    baseUrl: 'https://catalogue.data.gov.bc.ca',
  },
  {
    name: 'Alberta Open Data Portal',
    tier: 'provincial',
    jurisdiction: 'Alberta',
    baseUrl: 'https://open.alberta.ca',
  },
  {
    name: 'Yukon Open Government',
    tier: 'provincial',
    jurisdiction: 'Yukon',
    baseUrl: 'https://open.yukon.ca',
  },
  {
    name: 'GNWT Open Data',
    tier: 'provincial',
    jurisdiction: 'Northwest Territories',
    baseUrl: 'https://opendata.gov.nt.ca',
  },
  // ── Tier 3: Census Metropolitan Areas (CMAs) ─────────────────────────────
  {
    name: 'Open Data Toronto',
    tier: 'cma',
    jurisdiction: 'Toronto CMA',
    baseUrl: 'https://ckan0.cf.opendata.inter.prod-toronto.ca',
  },
  {
    name: 'Données ouvertes Montréal',
    tier: 'cma',
    jurisdiction: 'Montreal CMA',
    baseUrl: 'https://donnees.montreal.ca',
  },
];

export const CANADIAN_SOCRATA_REGISTRY: SocrataEndpoint[] = [
  // ── Tier 2: Provincial ───────────────────────────────────────────────────
  {
    name: 'Nova Scotia Open Data',
    tier: 'provincial',
    jurisdiction: 'Nova Scotia',
    baseUrl: 'https://data.novascotia.ca',
  },
  {
    name: 'New Brunswick Open Data',
    tier: 'provincial',
    jurisdiction: 'New Brunswick',
    baseUrl: 'https://gnb.socrata.com',
  },
  // ── Tier 3: CMAs ─────────────────────────────────────────────────────────
  {
    name: 'Calgary Open Data',
    tier: 'cma',
    jurisdiction: 'Calgary CMA',
    baseUrl: 'https://data.calgary.ca',
  },
  {
    name: 'Edmonton Open Data',
    tier: 'cma',
    jurisdiction: 'Edmonton CMA',
    baseUrl: 'https://data.edmonton.ca',
  },
  {
    name: 'Winnipeg Open Data',
    tier: 'cma',
    jurisdiction: 'Winnipeg CMA',
    baseUrl: 'https://data.winnipeg.ca',
  },
];

export interface OpenDataSoftEndpoint {
  name: string;
  tier: 'cma' | 'provincial';
  jurisdiction: string;
  baseUrl: string;
}

export const CANADIAN_OPENDATASOFT_REGISTRY: OpenDataSoftEndpoint[] = [
  {
    name: 'City of Vancouver Open Data',
    tier: 'cma',
    jurisdiction: 'Vancouver CMA',
    baseUrl: 'https://opendata.vancouver.ca',
  },
];

export interface DcatApEndpoint {
  name: string;
  tier: 'cma' | 'provincial';
  jurisdiction: string;
  feedUrl: string;
  portalBaseUrl: string;
}

export const CANADIAN_DCAT_REGISTRY: DcatApEndpoint[] = [
  {
    name: 'City of Ottawa Open Data',
    tier: 'cma',
    jurisdiction: 'Ottawa-Gatineau CMA',
    feedUrl: 'https://open.ottawa.ca/api/feed/dcat-ap/2.0.1.json',
    portalBaseUrl: 'https://open.ottawa.ca',
  },
  {
    name: 'Halifax Regional Municipality Open Data',
    tier: 'cma',
    jurisdiction: 'Halifax CMA',
    feedUrl: 'https://catalogue-hrm.opendata.arcgis.com/api/feed/dcat-ap/2.0.1.json',
    portalBaseUrl: 'https://catalogue-hrm.opendata.arcgis.com',
  },
  {
    name: 'Region of Waterloo Open Data',
    tier: 'cma',
    jurisdiction: 'Kitchener-Cambridge-Waterloo CMA',
    feedUrl: 'https://rowopendata-rmw.opendata.arcgis.com/api/feed/dcat-ap/2.0.1.json',
    portalBaseUrl: 'https://rowopendata-rmw.opendata.arcgis.com',
  },
];

export interface PanCanadianHarvestOptions {
  includeFederal?: boolean;
  includeProvincial?: boolean;
  includeCma?: boolean;
  includeNgoRegistry?: boolean;
  maxRowsPerQuery?: number;
}

const TARGET_SURVEY_QUERIES = [
  '"Canadian Community Health Survey"',
  '"Enquête sur la santé dans les collectivités canadiennes"',
  '"Canadian Income Survey"',
  '"Enquête canadienne sur le revenu"',
  '"Canadian Survey on Disability"',
  '"Enquête canadienne sur l\'incapacité"',
  '"Labour Force Survey"',
  '"Enquête sur la population active"',
  '"General Social Survey"',
  '"Enquête sociale générale"',
  '"Survey of Household Spending"',
  '"Enquête sur les dépenses des ménages"',
  '"Canadian Housing Survey"',
  '"Enquête canadienne sur le logement"',
  '"Survey of Financial Security"',
  '"Canadian Internet Use Survey"',
];

/**
 * Harvests a single CKAN portal with query parameters, filtering out Statistics Canada releases.
 */
async function harvestCkanEndpoint(
  endpoint: CkanEndpoint,
  query: string,
  maxRows: number
): Promise<CandidateWork[]> {
  const fqParam = (endpoint.tier === 'federal' || endpoint.baseUrl.includes('open.canada.ca'))
    ? '&fq=-organization:statcan'
    : '';
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/api/3/action/package_search?q=${encodeURIComponent(query)}${fqParam}&rows=${maxRows}`;
  const candidates: CandidateWork[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'mobilesurvey-researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      success: boolean;
      result?: {
        results?: Array<{
          id: string;
          title: string;
          notes?: string;
          url?: string;
          organization?: { title?: string; name?: string };
          resources?: Array<{ name?: string; url?: string; description?: string }>;
          metadata_created?: string;
          metadata_modified?: string;
          portal_release_date?: string;
        }>;
      };
    };

    if (!data.success || !Array.isArray(data.result?.results)) return [];

    for (const pkg of data.result.results) {
      const orgName = pkg.organization?.title || pkg.organization?.name || endpoint.jurisdiction;

      // Discard Statistics Canada's own publications
      if (
        /statistics\s+canada|statistique\s+canada|statcan/i.test(orgName) ||
        isStatisticsCanadaPublication({ issuingOrganization: orgName })
      ) {
        continue;
      }

      const notes = pkg.notes || '';
      const resText = (pkg.resources || [])
        .map(r => `${r.name || ''} ${r.description || ''}`)
        .join(' ')
        .trim();
      const fullText = `${pkg.title} ${notes} ${resText}`;

      if (!isCanadianGrounded(fullText) || hasForeignDisqualifier(fullText)) {
        continue;
      }

      const matchedPrograms: string[] = [];
      const lower = fullText.toLowerCase();
      for (const [code, spec] of Object.entries(CANONICAL_SURVEYS)) {
        if (spec.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
          matchedPrograms.push(code);
        }
      }
      if (matchedPrograms.length === 0) continue;

      let year: number | undefined;
      const dateStr = pkg.metadata_created || pkg.portal_release_date || pkg.metadata_modified;
      if (dateStr) {
        const y = parseInt(dateStr.slice(0, 4), 10);
        if (!isNaN(y) && y >= 1990 && y <= 2030) year = y;
      }

      const rawUrl = pkg.resources?.[0]?.url || pkg.url || `${endpoint.baseUrl}/dataset/${pkg.id}`;
      let primaryUrl: string;
      try {
        primaryUrl = new URL(rawUrl, endpoint.baseUrl).href;
      } catch {
        primaryUrl = `${endpoint.baseUrl}/dataset/${pkg.id}`;
      }

      let passage = notes.length >= 40 ? notes : pkg.title;
      if (resText.length >= 20 && !notes.toLowerCase().includes('survey') && !notes.toLowerCase().includes('enquête')) {
        passage = notes.length > 0 ? `${notes}\n\n${resText.slice(0, 1500)}` : resText.slice(0, 1500);
      }

      candidates.push({
        title: pkg.title,
        url: primaryUrl,
        source: `${endpoint.name} (${endpoint.tier.toUpperCase()})`,
        sourceId: `${endpoint.name.toLowerCase().replace(/\s+/g, '-')}:${pkg.id}`,
        year,
        workType: 'report',
        issuingOrganization: orgName.replace(/\s*\|\s*.*$/, '').trim(),
        abstract: notes.slice(0, 2500) || resText.slice(0, 2500),
        abstractRights: 'permitted',
        suggestedPrograms: matchedPrograms,
        passage: passage.slice(0, 3000),
        passageLocation: `${endpoint.name} - Description`,
      });
    }
  } catch {
    // Graceful timeout or failure on portal
  }

  return candidates;
}

/**
 * Harvests a Socrata SODA open data portal across views.
 */
async function harvestSocrataEndpoint(
  endpoint: SocrataEndpoint,
  query: string,
  maxRows: number
): Promise<CandidateWork[]> {
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/api/views.json?query=${encodeURIComponent(query)}&limit=${maxRows}`;
  const candidates: CandidateWork[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'mobilesurvey-researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as Array<{
      id: string;
      name: string;
      description?: string;
      attribution?: string;
      createdAt?: number;
      rowsUpdatedAt?: number;
    }>;

    if (!Array.isArray(data)) return [];

    for (const view of data) {
      const orgName = view.attribution || endpoint.jurisdiction;
      const desc = view.description || '';
      const fullText = `${view.name} ${desc}`;

      if (!isCanadianGrounded(fullText) || hasForeignDisqualifier(fullText)) {
        continue;
      }

      const matchedPrograms: string[] = [];
      const lower = fullText.toLowerCase();
      for (const [code, spec] of Object.entries(CANONICAL_SURVEYS)) {
        if (spec.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
          matchedPrograms.push(code);
        }
      }
      if (matchedPrograms.length === 0) continue;

      let year: number | undefined;
      const ts = view.createdAt || view.rowsUpdatedAt;
      if (ts) {
        const y = new Date(ts * 1000).getFullYear();
        if (y >= 1990 && y <= 2030) year = y;
      }

      candidates.push({
        title: view.name,
        url: `${endpoint.baseUrl}/d/${view.id}`,
        source: `${endpoint.name} (${endpoint.tier.toUpperCase()})`,
        sourceId: `${endpoint.name.toLowerCase().replace(/\s+/g, '-')}:${view.id}`,
        year,
        workType: 'report',
        issuingOrganization: orgName.trim(),
        abstract: desc.slice(0, 2500),
        abstractRights: 'permitted',
        suggestedPrograms: matchedPrograms,
        passage: desc.length >= 40 ? desc : view.name,
        passageLocation: `${endpoint.name} - Dataset Summary`,
      });
    }
  } catch {
    // Graceful error
  }

  return candidates;
}

/**
 * Harvests OpenDataSoft catalog APIs (e.g., City of Vancouver).
 */
async function harvestOpenDataSoftEndpoint(
  endpoint: OpenDataSoftEndpoint,
  query: string,
  maxRows: number
): Promise<CandidateWork[]> {
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/api/explore/v2.1/catalog/datasets?where=search(%22${encodeURIComponent(query)}%22)&limit=${maxRows}`;
  const candidates: CandidateWork[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'mobilesurvey-researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      total_count?: number;
      results?: Array<{
        dataset_id: string;
        metas?: {
          default?: {
            title?: string;
            description?: string;
            publisher?: string;
            modified?: string;
          };
        };
      }>;
    };

    if (!Array.isArray(data.results)) return [];

    for (const item of data.results) {
      const metas = item.metas?.default;
      if (!metas?.title) continue;

      const title = metas.title;
      const orgName = metas.publisher || endpoint.jurisdiction;

      if (
        /statistics\s+canada|statistique\s+canada|statcan/i.test(orgName) ||
        isStatisticsCanadaPublication({ issuingOrganization: orgName })
      ) {
        continue;
      }

      const rawDesc = metas.description || '';
      const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const fullText = `${title} ${cleanDesc}`;

      if (!isCanadianGrounded(fullText) || hasForeignDisqualifier(fullText)) {
        continue;
      }

      const matchedPrograms: string[] = [];
      const lower = fullText.toLowerCase();
      for (const [code, spec] of Object.entries(CANONICAL_SURVEYS)) {
        if (spec.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
          matchedPrograms.push(code);
        }
      }
      if (matchedPrograms.length === 0) continue;

      let year: number | undefined;
      if (metas.modified) {
        const y = parseInt(metas.modified.slice(0, 4), 10);
        if (!isNaN(y) && y >= 1990 && y <= 2030) year = y;
      }

      candidates.push({
        title,
        url: `${endpoint.baseUrl}/explore/dataset/${item.dataset_id}/information/`,
        source: `${endpoint.name} (${endpoint.tier.toUpperCase()})`,
        sourceId: `${endpoint.name.toLowerCase().replace(/\s+/g, '-')}:${item.dataset_id}`,
        year,
        workType: 'report',
        issuingOrganization: orgName.replace(/\s*\|\s*.*$/, '').trim(),
        abstract: cleanDesc.slice(0, 2500),
        abstractRights: 'permitted',
        suggestedPrograms: matchedPrograms,
        passage: cleanDesc.length >= 40 ? cleanDesc.slice(0, 500) : title,
        passageLocation: `${endpoint.name} - Dataset Information`,
      });
    }
  } catch {
    // Graceful error
  }

  return candidates;
}

/**
 * Harvests DCAT-AP open data feeds (e.g., Ottawa, Halifax, Waterloo Region).
 */
async function harvestDcatApEndpoint(
  endpoint: DcatApEndpoint
): Promise<CandidateWork[]> {
  const candidates: CandidateWork[] = [];

  try {
    const res = await fetch(endpoint.feedUrl, {
      headers: {
        'User-Agent': 'mobilesurvey-researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      'dcat:dataset'?: Array<{
        '@id'?: string;
        'dct:identifier'?: string;
        'dct:title'?: string;
        'dct:description'?: string;
        'dct:publisher'?: { 'foaf:name'?: string } | string;
        'dct:issued'?: string;
        'dct:modified'?: string;
      }>;
    };

    const datasets = data['dcat:dataset'];
    if (!Array.isArray(datasets)) return [];

    for (const ds of datasets) {
      const title = ds['dct:title'];
      if (!title) continue;

      let publisherName = endpoint.jurisdiction;
      if (typeof ds['dct:publisher'] === 'string') {
        publisherName = ds['dct:publisher'];
      } else if (ds['dct:publisher']?.['foaf:name']) {
        publisherName = ds['dct:publisher']['foaf:name'];
      }

      if (
        /statistics\s+canada|statistique\s+canada|statcan/i.test(publisherName) ||
        isStatisticsCanadaPublication({ issuingOrganization: publisherName })
      ) {
        continue;
      }

      const rawDesc = ds['dct:description'] || '';
      const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const fullText = `${title} ${cleanDesc}`;

      if (!isCanadianGrounded(fullText) || hasForeignDisqualifier(fullText)) {
        continue;
      }

      const matchedPrograms: string[] = [];
      const lower = fullText.toLowerCase();
      for (const [code, spec] of Object.entries(CANONICAL_SURVEYS)) {
        if (spec.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
          matchedPrograms.push(code);
        }
      }
      if (matchedPrograms.length === 0) continue;

      let year: number | undefined;
      const dateStr = ds['dct:issued'] || ds['dct:modified'];
      if (dateStr) {
        const y = parseInt(dateStr.slice(0, 4), 10);
        if (!isNaN(y) && y >= 1990 && y <= 2030) year = y;
      }

      const workId = ds['dct:identifier'] || ds['@id']?.split('/').pop() || Math.random().toString(36).substring(7);
      const url = ds['@id'] || `${endpoint.portalBaseUrl}/datasets/${workId}`;

      candidates.push({
        title,
        url,
        source: `${endpoint.name} (${endpoint.tier.toUpperCase()})`,
        sourceId: `${endpoint.name.toLowerCase().replace(/\s+/g, '-')}:${workId}`,
        year,
        workType: 'report',
        issuingOrganization: publisherName.replace(/\s*\|\s*.*$/, '').trim(),
        abstract: cleanDesc.slice(0, 2500),
        abstractRights: 'permitted',
        suggestedPrograms: matchedPrograms,
        passage: cleanDesc.length >= 40 ? cleanDesc.slice(0, 500) : title,
        passageLocation: `${endpoint.name} - Catalog Description`,
      });
    }
  } catch {
    // Graceful error
  }

  return candidates;
}

/**
 * Executes a full Pan-Canadian Jurisdictional Scan:
 * Tier 1 (Federal), Tier 2 (All Provinces/Territories), Tier 3 (CMAs), Tier 4 (NGOs/Think Tanks).
 */
export async function harvestPanCanadianJurisdictions(
  options: PanCanadianHarvestOptions = {}
): Promise<CandidateWork[]> {
  const allCandidates: CandidateWork[] = [];
  const maxRows = options.maxRowsPerQuery ?? 25;

  console.log('\n[PanCanadianHarvester] Initializing 4-Tier Jurisdictional Scanning System:');
  console.log('  - Tier 1: Federal Repositories (open.canada.ca)');
  console.log('  - Tier 2: Provinces & Territories (Ontario, Quebec, BC, Alberta, Nova Scotia, New Brunswick, Yukon, NWT)');
  console.log('  - Tier 3: Census Metropolitan Areas (Toronto, Montreal, Vancouver, Calgary, Edmonton, Winnipeg, Ottawa, Halifax, Waterloo)');
  console.log('  - Tier 4: Canadian Policy NGOs & Think Tanks');

  // 1. Curated Policy NGO Registry
  if (options.includeNgoRegistry !== false) {
    const curated = getGreyLiteratureCandidates();
    allCandidates.push(...curated);
    console.log(`\n[Tier 4 NGO] Loaded ${curated.length} verified NGO, think-tank and health agency reports.`);
  }

  // 2. CKAN Registry (Federal, Provincial, CMA)
  const ckanEndpoints = CANADIAN_CKAN_REGISTRY.filter(ep => {
    if (ep.tier === 'federal' && options.includeFederal === false) return false;
    if (ep.tier === 'provincial' && options.includeProvincial === false) return false;
    if (ep.tier === 'cma' && options.includeCma === false) return false;
    return true;
  });

  for (const ep of ckanEndpoints) {
    console.log(`\n[${ep.tier.toUpperCase()} Scan: ${ep.name}] Querying portal (${ep.jurisdiction})...`);
    for (const q of TARGET_SURVEY_QUERIES) {
      const hits = await harvestCkanEndpoint(ep, q, maxRows);
      if (hits.length > 0) {
        console.log(`  ✓ ${ep.jurisdiction} (${q}): ${hits.length} candidates`);
        allCandidates.push(...hits);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // 3. Socrata Registry (Provincial, CMA)
  const socrataEndpoints = CANADIAN_SOCRATA_REGISTRY.filter(ep => {
    if (ep.tier === 'provincial' && options.includeProvincial === false) return false;
    if (ep.tier === 'cma' && options.includeCma === false) return false;
    return true;
  });

  for (const ep of socrataEndpoints) {
    console.log(`\n[${ep.tier.toUpperCase()} Scan: ${ep.name}] Querying portal (${ep.jurisdiction})...`);
    for (const q of ['"Community Health"', '"Labour Force"', '"Household Spending"', '"Income Survey"']) {
      const hits = await harvestSocrataEndpoint(ep, q, maxRows);
      if (hits.length > 0) {
        console.log(`  ✓ ${ep.jurisdiction} (${q}): ${hits.length} candidates`);
        allCandidates.push(...hits);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // 4. OpenDataSoft Registry (Vancouver CMA)
  if (options.includeCma !== false) {
    for (const ep of CANADIAN_OPENDATASOFT_REGISTRY) {
      console.log(`\n[CMA Scan: ${ep.name}] Querying OpenDataSoft catalog (${ep.jurisdiction})...`);
      for (const q of ['health survey', 'labour force', 'income survey', 'census']) {
        const hits = await harvestOpenDataSoftEndpoint(ep, q, maxRows);
        if (hits.length > 0) {
          console.log(`  ✓ ${ep.jurisdiction} (${q}): ${hits.length} candidates`);
          allCandidates.push(...hits);
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  // 5. DCAT-AP Registry (Ottawa, Halifax, Waterloo Region CMAs)
  if (options.includeCma !== false) {
    for (const ep of CANADIAN_DCAT_REGISTRY) {
      console.log(`\n[CMA Scan: ${ep.name}] Harvesting DCAT-AP feed (${ep.jurisdiction})...`);
      const hits = await harvestDcatApEndpoint(ep);
      if (hits.length > 0) {
        console.log(`  ✓ ${ep.jurisdiction}: ${hits.length} candidates`);
        allCandidates.push(...hits);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`\n[PanCanadianHarvester Complete] Total harvested candidates across all tiers: ${allCandidates.length}`);
  return allCandidates;
}
