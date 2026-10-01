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
  abstract?: string;
  abstractRights?: 'permitted' | 'restricted' | 'unknown';
  passage: string;
  passageLocation: string;
  surveyCandidates: Array<{ program: string; aliases: string[] }>;
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

export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function canonicalDoi(value?: string): string | null {
  if (!value) return null;
  const doi = decodeURIComponent(value.trim()).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\/[\w.()/:;+-]+$/i.test(doi) ? doi : null;
}

export function workId(work: SourceWork): string {
  const doi = canonicalDoi(work.doi);
  return doi ? `doi:${doi}` : `url:${hash(new URL(work.url).toString().replace(/\/$/, ''))}`;
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

const inPassage = (needle: string, passage: string) => needle.length > 0 && passage.includes(needle);

export function validateExtraction(raw: unknown, passage: string, candidates: SourceWork['surveyCandidates']): { value: Extraction; issues: string[] } {
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
    if (claim.precision === 'exact_cycles' && (!claim.exactCycles.length || claim.exactCycles.some(c => !inPassage(c, claim.quote)))) issues.push(`claim ${i}: unsupported exact cycle`);
    if (claim.precision === 'range' && !inPassage(claim.cycleText, claim.quote)) issues.push(`claim ${i}: unsupported range`);
    if (claim.precision === 'program_only' && claim.exactCycles.length) issues.push(`claim ${i}: program-only contains cycles`);
  }
  for (const [i, v] of value.variables.entries()) {
    if (!v || typeof v.text !== 'string' || typeof v.quote !== 'string' || typeof v.location !== 'string') throw new Error(`Invalid variable ${i}`);
    if (!inPassage(v.quote, passage) || !inPassage(v.text, v.quote)) issues.push(`variable ${i}: evidence absent`);
  }
  return { value, issues };
}
