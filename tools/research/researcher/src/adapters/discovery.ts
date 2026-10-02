import {
  canonicalDoi,
  CANONICAL_SURVEYS,
  getSurveyCandidates,
  hash,
  isStatisticsCanadaPublication,
  validateSource,
  type CandidateWork,
  type SourceWork,
} from '../model.js';

export interface AssembleOptions {
  targetSurveys?: string[];
  requireAbstract?: boolean;
}

export function deduplicateCandidates(candidates: CandidateWork[]): CandidateWork[] {
  const byKey = new Map<string, CandidateWork[]>();

  for (const c of candidates) {
    if (isStatisticsCanadaPublication(c)) continue; // Exclude StatCan-issued works immediately
    const doi = canonicalDoi(c.doi);
    let key: string;
    if (doi) {
      key = `doi:${doi}`;
    } else {
      try {
        key = `url:${hash(new URL(c.url).toString().replace(/\/$/, ''))}`;
      } catch {
        key = `raw:${c.url}`;
      }
    }
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }

  const merged: CandidateWork[] = [];
  for (const group of byKey.values()) {
    const first = group[0];
    if (!first) continue;
    // Prioritize OpenAlex / Crossref / CRDCN fields
    const base: CandidateWork = { ...first };
    const allSources = [...new Set(group.map(g => g.source))];
    const allTopics = [...new Set(group.flatMap(g => g.topics ?? []))];
    const allPrograms = [...new Set(group.flatMap(g => g.suggestedPrograms ?? []))];

    for (const other of group.slice(1)) {
      if (!base.doi && other.doi) base.doi = other.doi;
      if ((!base.year || base.year < 1900) && other.year) base.year = other.year;
      if (!base.issuingOrganization && other.issuingOrganization) base.issuingOrganization = other.issuingOrganization;
      if (!base.workType && other.workType) base.workType = other.workType;
      if ((!base.abstract || base.abstract.length < (other.abstract?.length ?? 0)) && other.abstract) {
        base.abstract = other.abstract;
        base.abstractRights = other.abstractRights;
      }
      if (!base.openAccessUrl && other.openAccessUrl) base.openAccessUrl = other.openAccessUrl;
      if (!base.passage && other.passage) {
        base.passage = other.passage;
        base.passageLocation = other.passageLocation;
      }
    }
    base.topics = allTopics;
    base.suggestedPrograms = allPrograms;
    // Record source representation
    base.source = allSources.join('+');
    merged.push(base);
  }

  return merged;
}

export function candidateToSourceWork(
  candidate: CandidateWork,
  options: AssembleOptions = {}
): SourceWork | null {
  if (isStatisticsCanadaPublication(candidate)) return null;

  const targetSurveys = options.targetSurveys ?? Object.keys(CANONICAL_SURVEYS);
  const passageText = (candidate.passage && candidate.passage.length >= 20)
    ? candidate.passage
    : (candidate.abstract && candidate.abstract.length >= 40)
    ? candidate.abstract
    : candidate.title;
  const passageLocation = candidate.passageLocation ?? (
    (candidate.abstract && candidate.abstract.length >= 40)
      ? 'Abstract'
      : 'Title'
  );

  if (options.requireAbstract && passageLocation !== 'Abstract') return null;

  // Determine relevant survey candidates
  const matchedPrograms = new Set<string>(candidate.suggestedPrograms ?? []);
  const passageLower = passageText.toLowerCase();

  for (const progKey of targetSurveys) {
    const spec = CANONICAL_SURVEYS[progKey.toUpperCase()];
    if (!spec) continue;
    if (matchedPrograms.has(spec.program)) continue;
    if (spec.aliases.some(alias => passageLower.includes(alias.toLowerCase()))) {
      matchedPrograms.add(spec.program);
    }
  }

  // Filter out works that have no connection to any target survey
  if (matchedPrograms.size === 0) return null;

  const surveyCandidates = getSurveyCandidates([...matchedPrograms].slice(0, 5));

  const sourceWork: SourceWork = {
    title: candidate.title,
    doi: canonicalDoi(candidate.doi) ?? undefined,
    url: candidate.url,
    source: candidate.source,
    sourceId: candidate.sourceId ?? candidate.url,
    year: candidate.year,
    workType: candidate.workType,
    issuingOrganization: candidate.issuingOrganization,
    abstract: candidate.abstract,
    abstractRights: candidate.abstractRights,
    passage: passageText,
    passageLocation,
    surveyCandidates,
  };

  return validateSource(sourceWork);
}

export function assembleCandidates(
  candidates: CandidateWork[],
  options: AssembleOptions = {}
): SourceWork[] {
  const deduped = deduplicateCandidates(candidates);
  const result: SourceWork[] = [];
  for (const c of deduped) {
    const sw = candidateToSourceWork(c, options);
    if (sw) result.push(sw);
  }
  return result;
}
