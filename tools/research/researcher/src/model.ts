import { createHash } from 'node:crypto';

export const PROMPT_VERSION = 'researcher-extract-v1';
export const THEMES = [
  'health', 'digital society', 'income and inequality', 'labour', 'education',
  'immigration', 'families', 'housing', 'environment', 'Indigenous peoples',
  'aging', 'crime and justice', 'other',
] as const;

export interface SourceWork {
  title: string;
  doi?: string;
  url: string;
  source: string;
  sourceId?: string;
  year?: number;
  workType?: string;
  issuingOrganization?: string;
  abstract?: string;
  abstractRights?: 'permitted' | 'restricted' | 'unknown';
  passage: string;
  passageLocation: string;
  surveyCandidates: Array<{ program: string; aliases: string[]; validCycles?: string[] }>;
}

export interface Claim {
  surveyText: string;
  program: string;
  role: 'analyzed' | 'comparison' | 'background_mention';
  cycleText: string;
  precision: 'exact_cycles' | 'range' | 'program_only';
  exactCycles: string[];
  quote: string;
  location: string;
}

export interface Extraction {
  claims: Claim[];
  primaryTheme: string | null;
  additionalThemes: string[];
  themeRationale: string;
  variables: Array<{ text: string; quote: string; location: string }>;
}

export interface CandidateWork {
  title: string;
  doi?: string;
  url: string;
  source: string;
  sourceId?: string;
  year?: number;
  workType?: string;
  issuingOrganization?: string;
  abstract?: string;
  abstractRights: 'permitted' | 'restricted' | 'unknown';
  openAccessUrl?: string;
  topics?: string[];
  suggestedPrograms?: string[];
  passage?: string;
  passageLocation?: string;
}

export interface SurveyCandidateSpec {
  program: string;
  name: string;
  aliases: string[];
  validCycles?: string[];
}

export const CANONICAL_SURVEYS: Record<string, SurveyCandidateSpec> = {
  CIUS: {
    program: 'CIUS',
    name: 'Canadian Internet Use Survey',
    aliases: ['Canadian Internet Use Survey', 'CIUS', "Enquête canadienne sur l'utilisation d'Internet", 'ECUI'],
    validCycles: ['2005', '2007', '2009', '2010', '2012', '2018', '2020', '2022', '2024'],
  },
  CCHS: {
    program: 'CCHS',
    name: 'Canadian Community Health Survey',
    aliases: ['Canadian Community Health Survey', 'Canadian Community Health Survey - Annual Component', 'CCHS', "Enquête sur la santé dans les collectivités canadiennes", 'ESCC'],
    validCycles: [
      '2000', '2001', '2002', '2003', '2004', '2005',
      '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024',
    ],
  },
  CHMS: {
    program: 'CHMS',
    name: 'Canadian Health Measures Survey',
    aliases: ['Canadian Health Measures Survey', 'CHMS', "Enquête canadienne sur les mesures de la santé", 'ECMS'],
    validCycles: [
      '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2022', '2023',
    ],
  },
  GSS: {
    program: 'GSS',
    name: 'General Social Survey',
    aliases: ['General Social Survey', 'GSS', "Enquête sociale générale", 'ESG'],
    validCycles: Array.from({ length: 40 }, (_, i) => String(1985 + i)),
  },
  LFS: {
    program: 'LFS',
    name: 'Labour Force Survey',
    aliases: ['Labour Force Survey', 'LFS', "Enquête sur la population active", 'EPA'],
    validCycles: Array.from({ length: 51 }, (_, i) => String(1976 + i)),
  },
  CIS: {
    program: 'CIS',
    name: 'Canadian Income Survey',
    aliases: ['Canadian Income Survey', 'CIS', "Enquête canadienne sur le revenu", 'ECR'],
    validCycles: ['2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'],
  },
  CSD: {
    program: 'CSD',
    name: 'Canadian Survey on Disability',
    aliases: ['Canadian Survey on Disability', 'CSD', "Enquête canadienne sur l'incapacité", 'ECI'],
    validCycles: ['2012', '2017', '2022'],
  },
  SHS: {
    program: 'SHS',
    name: 'Survey of Household Spending',
    aliases: ['Survey of Household Spending', 'SHS', "Enquête sur les dépenses des ménages", 'EDM'],
    validCycles: [
      '1997', '1998', '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010',
      '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2019', '2021', '2023',
    ],
  },
};

export function getSurveyCandidates(programs: string[]): Array<{ program: string; aliases: string[]; validCycles?: string[] }> {
  return programs.map(p => {
    const spec = CANONICAL_SURVEYS[p.toUpperCase()];
    if (!spec) return { program: p, aliases: [p] };
    return { program: spec.program, aliases: spec.aliases, validCycles: spec.validCycles };
  });
}

export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function canonicalDoi(value?: string | null): string | null {
  if (!value) return null;
  const doi = decodeURIComponent(value.trim()).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\/[\w.()/:;+-]+$/i.test(doi) ? doi : null;
}

export function workId(work: { doi?: string; url: string }): string {
  const doi = canonicalDoi(work.doi);
  return doi ? `doi:${doi}` : `url:${hash(new URL(work.url).toString().replace(/\/$/, ''))}`;
}

export function isStatisticsCanadaPublication(work: {
  url?: string | null;
  doi?: string | null;
  issuingOrganization?: string | null;
}): boolean {
  if (work.doi) {
    const cDoi = canonicalDoi(work.doi);
    if (cDoi?.startsWith('10.25318/')) return true;
  }
  if (work.url) {
    try {
      const hostname = new URL(work.url).hostname.toLowerCase();
      if (hostname === 'statcan.gc.ca' || hostname.endsWith('.statcan.gc.ca')) return true;
    } catch {
      // not a valid absolute URL
    }
  }
  const org = (work.issuingOrganization ?? '').trim().toLowerCase();
  return /^(statistics canada|statistique canada|statcan|government of canada - statistics canada)$/i.test(org);
}

export function reconstructAbstract(invertedIndex?: Record<string, number[]> | null): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  const entries = Object.entries(invertedIndex);
  if (entries.length === 0) return null;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of entries) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && Number.isInteger(pos) && pos >= 0) {
        words.push([pos, word]);
      }
    }
  }
  if (words.length === 0) return null;
  words.sort((a, b) => a[0] - b[0]);
  const lastWord = words[words.length - 1];
  if (!lastWord) return null;
  const maxPos = lastWord[0];
  if (maxPos > 10000) return null;
  const array: string[] = new Array(maxPos + 1).fill('');
  for (const [pos, word] of words) {
    array[pos] = word;
  }
  return array.filter(w => w.length > 0).join(' ').trim() || null;
}

export function stripXml(text?: string | null): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

export function validateSource(value: unknown): SourceWork {
  if (!value || typeof value !== 'object') throw new Error('Source must be an object');
  const w = value as Partial<SourceWork>;
  for (const key of ['title', 'url', 'source', 'passage', 'passageLocation'] as const) {
    if (typeof w[key] !== 'string' || !w[key]?.trim()) throw new Error(`Missing ${key}`);
  }
  const url = new URL(w.url!);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must be http(s)');
  if (!Array.isArray(w.surveyCandidates) || w.surveyCandidates.length > 12 ||
      w.surveyCandidates.some(c => !c || typeof c.program !== 'string' || !Array.isArray(c.aliases) || c.aliases.some(a => typeof a !== 'string')))
    throw new Error('surveyCandidates must contain up to 12 program/aliases entries');
  if (w.year !== undefined && (!Number.isInteger(w.year) || w.year < 1800 || w.year > 2100)) throw new Error('Invalid year');
  if (w.issuingOrganization !== undefined && (typeof w.issuingOrganization !== 'string' || !w.issuingOrganization.trim())) throw new Error('Invalid issuingOrganization');
  if (w.abstractRights && !['permitted', 'restricted', 'unknown'].includes(w.abstractRights)) throw new Error('Invalid abstractRights');
  return w as SourceWork;
}

export function chunks(text: string, size = 2400, overlap = 250): string[] {
  if (size <= overlap || overlap < 0) throw new Error('Invalid chunk bounds');
  const result: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    result.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return result;
}

export const CANADIAN_PATTERNS: RegExp[] = [
  /\b(?:canada|canadian|canadians|canadien|canadienne|canadiens|canadiennes)\b/iu,
  /\b(?:statistics\s+canada|statistique\s+canada|statcan|stat\s+can)\b/iu,
  /\b(?:alberta|british\s+columbia|colombie-britannique|manitoba|new\s+brunswick|nouveau-brunswick)\b/iu,
  /\b(?:newfoundland|terre-neuve|labrador|nova\s+scotia|nouvelle-écosse|ontario)\b/iu,
  /\b(?:prince\s+edward\s+island|île-du-prince-édouard|quebec|québec|saskatchewan)\b/iu,
  /\b(?:northwest\s+territories|territoires\s+du\s+nord-ouest|nunavut|yukon)\b/iu,
  /\b(?:toronto|montreal|montréal|vancouver|calgary|edmonton|ottawa|winnipeg|quebec\s+city|ville\s+de\s+québec|halifax|victoria)\b/iu,
  /\b(?:crdcn|rdrdc|cihr|irsc|sshrc|crsh|cmaj)\b/iu,
];

export function isCanadianGrounded(text: string): boolean {
  return CANADIAN_PATTERNS.some(p => p.test(text));
}

export const FOREIGN_DISQUALIFIER_PATTERNS: RegExp[] = [
  /\b(?:australian\s+bureau\s+of\s+statistics|abs\s+(?:labour|survey)|in\s+australia|australian\s+labour|australia|australian)\b/iu,
  /\b(?:office\s+for\s+national\s+statistics|ons\s+(?:labour|survey)|in\s+the\s+uk|in\s+the\s+united\s+kingdom|au\s+royaume-uni|great\s+britain|united\s+kingdom)\b/iu,
  /\b(?:british\s+labour\s+force|british\s+household)\b/iu,
  /\b(?:insee|en\s+france|française?\s+(?:de\s+statistique|sur\s+l'emploi)|de\s+l'insee|france\s+métropolitaine)\b/iu,
  /\b(?:bureau\s+of\s+labor\s+statistics|bls\s+(?:survey|data)|norc\s+(?:at\s+the\s+university|general)|u\.?s\.?\s+general\s+social\s+survey|united\s+states\s+general\s+social)\b/iu,
  /\b(?:encuesta\s+de\s+población\s+activa|en\s+espagne|instituto\s+nacional\s+de\s+estadística|spain|spanish)\b/iu,
  /\b(?:korean?\s+(?:household|labour|survey)|en\s+corée|korea)\b/iu,
  /\b(?:beyrouth|beirut|direction\s+centrale\s+de\s+la\s+statistique|lebanon|liban)\b/iu,
];

export function hasForeignDisqualifier(text: string): boolean {
  return FOREIGN_DISQUALIFIER_PATTERNS.some(p => p.test(text));
}

const inPassage = (needle: string, passage: string) => needle.length > 0 && passage.includes(needle);

export function validateExtraction(raw: unknown, passage: string, candidates: SourceWork['surveyCandidates'], title?: string): { value: Extraction; issues: string[] } {
  if (!raw || typeof raw !== 'object') throw new Error('Extraction must be an object');
  const value = raw as Extraction;
  if (!Array.isArray(value.claims) || !Array.isArray(value.variables) || !Array.isArray(value.additionalThemes) ||
      typeof value.themeRationale !== 'string' || !(value.primaryTheme === null || typeof value.primaryTheme === 'string')) throw new Error('Invalid extraction shape');
  const issues: string[] = [];
  if (value.primaryTheme !== null && !THEMES.includes(value.primaryTheme as typeof THEMES[number])) issues.push('unknown primary theme');
  if (value.additionalThemes.some(t => !THEMES.includes(t as typeof THEMES[number]))) issues.push('unknown additional theme');
  if (value.claims.length > 20 || value.variables.length > 30) throw new Error('Too many claims or variables');
  for (const [i, claim] of value.claims.entries()) {
    if (!claim || !['analyzed', 'comparison', 'background_mention'].includes(claim.role) ||
        !['exact_cycles', 'range', 'program_only'].includes(claim.precision) ||
        !Array.isArray(claim.exactCycles) || ![claim.surveyText, claim.program, claim.cycleText, claim.quote, claim.location].every(x => typeof x === 'string')) throw new Error(`Invalid claim ${i}`);
    if (!inPassage(claim.quote, passage)) issues.push(`claim ${i}: evidence quote absent`);
    if (!inPassage(claim.surveyText, passage)) issues.push(`claim ${i}: survey wording absent`);
    const candidate = candidates.find(c => c.program === claim.program);
    if (!candidate || ![candidate.program, ...candidate.aliases].some(a => a.toLowerCase() === claim.surveyText.toLowerCase())) issues.push(`claim ${i}: unresolved survey alias`);
    const isExplicitlyCanadian = /canad|statcan|statistics\s+canada|statistique\s+canada/iu.test(claim.surveyText);
    if (!isExplicitlyCanadian) {
      if (hasForeignDisqualifier(claim.quote) && !isCanadianGrounded(claim.quote)) {
        issues.push(`claim ${i}: foreign jurisdiction disqualifier in quote`);
      }
      const groundingText = (title ? `${title} ` : '') + passage + ' ' + claim.quote;
      if (!isCanadianGrounded(groundingText)) {
        issues.push(`claim ${i}: lacks positive Canadian grounding for generic survey`);
      }
    }
    if (claim.precision === 'exact_cycles') {
      if (!claim.exactCycles.length || claim.exactCycles.some(c => !inPassage(c, claim.quote))) {
        issues.push(`claim ${i}: unsupported exact cycle`);
      }
      if (candidate?.validCycles && candidate.validCycles.length > 0) {
        const invalidCycles = claim.exactCycles.filter(c => !candidate.validCycles!.includes(c));
        if (invalidCycles.length > 0) {
          issues.push(`claim ${i}: non-existent survey cycle(s) for ${claim.program}: ${invalidCycles.join(', ')}`);
        }
      }
    }
    if (claim.precision === 'range' && !inPassage(claim.cycleText, claim.quote)) issues.push(`claim ${i}: unsupported range`);
    if (claim.precision === 'program_only' && claim.exactCycles.length) issues.push(`claim ${i}: program-only contains cycles`);
  }
  for (const [i, v] of value.variables.entries()) {
    if (!v || typeof v.text !== 'string' || typeof v.quote !== 'string' || typeof v.location !== 'string') throw new Error(`Invalid variable ${i}`);
    if (!inPassage(v.quote, passage) || !inPassage(v.text, v.quote)) issues.push(`variable ${i}: evidence absent`);
  }
  return { value, issues };
}
