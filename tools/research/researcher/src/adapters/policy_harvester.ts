import {
  type CandidateWork,
  CANONICAL_SURVEYS,
  isStatisticsCanadaPublication,
  isCanadianGrounded,
  hasForeignDisqualifier,
} from '../model.js';
import { getGreyLiteratureCandidates } from './grey-literature.js';

export interface OpenCanadaPackage {
  id: string;
  title: string;
  notes?: string;
  url?: string;
  organization?: {
    title?: string;
    name?: string;
  };
  resources?: Array<{
    name?: string;
    url?: string;
    format?: string;
  }>;
  metadata_created?: string;
  metadata_modified?: string;
  portal_release_date?: string;
}

export interface PolicyHarvestOptions {
  includeFederalOpenData?: boolean;
  maxOpenDataRowsPerQuery?: number;
}

/**
 * Harvests Canadian federal department packages from open.canada.ca (CKAN API).
 * Filters out Statistics Canada's own publications to retain external federal analyses
 * (e.g. Health Canada, PHAC, ESDC, CMHC, Indigenous Services Canada).
 */
export async function harvestFederalOpenData(
  query: string,
  maxRows: number = 25
): Promise<CandidateWork[]> {
  const url = `https://open.canada.ca/data/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${maxRows}`;
  const candidates: CandidateWork[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'mobilesurvey-researcher/1.0 (https://msurvey.peji.ca; contact@peji.ca)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[PolicyHarvester] open.canada.ca HTTP ${res.status} for query "${query}"`);
      return [];
    }

    const data = (await res.json()) as {
      success: boolean;
      result?: {
        results?: OpenCanadaPackage[];
      };
    };

    if (!data.success || !Array.isArray(data.result?.results)) {
      return [];
    }

    for (const pkg of data.result.results) {
      const orgName = pkg.organization?.title || pkg.organization?.name || '';
      
      // Strict rule: Discard Statistics Canada's own releases
      if (
        /statistics\s+canada|statistique\s+canada|statcan/i.test(orgName) ||
        isStatisticsCanadaPublication({ issuingOrganization: orgName })
      ) {
        continue;
      }

      const notes = pkg.notes || '';
      const fullText = `${pkg.title} ${notes}`;
      
      // Ensure positive Canadian grounding and no foreign disqualifiers
      if (!isCanadianGrounded(fullText) || hasForeignDisqualifier(fullText)) {
        continue;
      }

      // Check survey match
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

      const primaryUrl = pkg.resources?.[0]?.url || pkg.url || `https://open.canada.ca/data/en/dataset/${pkg.id}`;

      candidates.push({
        title: pkg.title,
        url: primaryUrl,
        source: 'Federal Open Data (open.canada.ca)',
        sourceId: `open.canada.ca:${pkg.id}`,
        year,
        workType: 'report',
        issuingOrganization: orgName.replace(/\s*\|\s*.*$/, '').trim(), // e.g. "Health Canada | Santé Canada" -> "Health Canada"
        abstract: notes.slice(0, 2500),
        abstractRights: 'permitted',
        suggestedPrograms: matchedPrograms,
        passage: notes.length >= 40 ? notes : pkg.title,
        passageLocation: 'Dataset Description & Methodology',
      });
    }
  } catch (err: any) {
    console.warn(`[PolicyHarvester] Error harvesting open.canada.ca: ${err.message || err}`);
  }

  return candidates;
}

/**
 * Harvests Canadian policy reports across NGOs, municipal, provincial, and federal sources.
 * Combines curated policy records with live open.canada.ca harvesting.
 */
export async function harvestAllCanadianPolicyLiterature(
  options: PolicyHarvestOptions = {}
): Promise<CandidateWork[]> {
  const allCandidates: CandidateWork[] = [];

  // 1. Curated NGOs, think tanks, municipal and provincial public health profiles
  const curated = getGreyLiteratureCandidates();
  allCandidates.push(...curated);
  console.log(`[PolicyHarvester] Loaded ${curated.length} curated Canadian NGO, think-tank and municipal reports.`);

  // 2. Federal departmental analyses via open.canada.ca
  if (options.includeFederalOpenData !== false) {
    const targetQueries = [
      '"Canadian Community Health Survey"',
      '"Canadian Income Survey"',
      '"Canadian Survey on Disability"',
      '"Labour Force Survey"',
      '"General Social Survey"',
      '"Survey of Household Spending"',
      '"Canadian Housing Survey"',
    ];

    console.log(`[PolicyHarvester] Querying open.canada.ca for federal departmental microdata analyses...`);
    for (const q of targetQueries) {
      const fedCandidates = await harvestFederalOpenData(q, options.maxOpenDataRowsPerQuery ?? 25);
      if (fedCandidates.length > 0) {
        console.log(`  ✓ open.canada.ca ("${q}"): ${fedCandidates.length} departmental candidates`);
        allCandidates.push(...fedCandidates);
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return allCandidates;
}
