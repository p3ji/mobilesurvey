/**
 * Phase 27 — Cross-Cycle Concept Continuity & Longitudinal Lineage Mesh
 *
 * Bridges cross-cycle breaks in series where the exact DDI variable cascade (`cluster.ts`)
 * rightly places earlier and later occurrences of a longitudinal survey variable into
 * distinct `l:ConceptualVariable` groups (`conceptual_variable_id`) because:
 *   1. The target population / skip-pattern universe shifted between cycles (`universe_shift`),
 *   2. The concept label was shortened, moved to `questionText`, or had a `- Derived variable` /
 *      `- (D)` / `- (G)` suffix added or dropped (`concept_relabel`),
 *   3. A CCHS 3-digit variable mnemonic (`GEN_005`, `PAA_010B`, `FSC_010`) was renumbered to a
 *      2-digit mnemonic (`GEN_05`, `PAA_10B`, `FSC_10`) alongside a universe or wording update
 *      (`cycle_renumbering`), or
 *   4. Both wording and universe evolved while retaining high substantive construct similarity
 *      (`wording_and_universe_evolution`).
 *
 * Every emitted link enforces the Two-Clause Epistemic Transparency Contract:
 *   `Evidence from data dictionary: "<verbatim_quote>"; AI interpretation and action: <rationale>`
 */

import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { conceptualVariableId, meaningOf, normalizeKey } from '../cluster.js';
import type { CorpusVariable } from '../types.js';
import { classifyVariableRole } from './classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../out');
const CORPUS_PATH = resolve(OUT_DIR, 'corpus.jsonl');
const SQL_OUT_PATH = resolve(__dirname, '../../sql/concept_continuity_mesh.sql');

export type ContinuityBreakKind =
  | 'universe_shift'
  | 'concept_relabel'
  | 'cycle_renumbering'
  | 'wording_and_universe_evolution';

export interface ContinuityEdge {
  surveyGroup: string;
  canonicalSeries: string;
  earlierRecordId: string;
  laterRecordId: string;
  earlierCvId: string;
  laterCvId: string;
  earlierName: string;
  laterName: string;
  earlierYear: number;
  laterYear: number;
  breakKind: ContinuityBreakKind;
  similarity: number;
  suggestedBy: string;
  rationale: string;
  evidence: string;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'not',
  'all',
  'any',
  'you',
  'your',
  'who',
  'what',
  'when',
  'where',
  'which',
  'how',
  'many',
  'much',
  'does',
  'did',
  'variable',
  'derived',
  'grouped',
  'temporary',
  'reformat',
  'respondent',
  'respondents',
  'question',
  'note',
  'flag',
  'indicator',
  'total',
  'number',
  'whether',
  'during',
  'past',
  'last',
]);

/**
 * Normalize a survey group or source to its longitudinal program family
 * (e.g. `APS_EAPA_2017` & `APS_EAPA_2022` -> `APS`, `CIUS_ECUI_2020` -> `CIUS`, `GSS_ESG_30` -> `GSS`).
 */
export function canonicalSurveyFamily(surveyGroup: string, surveyAcronym?: string): string {
  const base = (surveyAcronym || surveyGroup.split('_')[0] || surveyGroup).trim().toUpperCase();
  return base;
}

/**
 * Normalize a variable name to its longitudinal series key within a survey group.
 * Handles the CCHS 2022+ 3-digit to 2-digit question renumbering (`GEN_005` -> `GEN_05`,
 * `PAA_010B` -> `PAA_10B`, `FSC_010` -> `FSC_10`).
 */
export function canonicalSeriesName(name: string, surveyGroup: string, surveyAcronym?: string): string {
  const upper = name.trim().toUpperCase();
  if (canonicalSurveyFamily(surveyGroup, surveyAcronym) === 'CCHS') {
    const m = upper.match(/^([A-Z]{2,4})_0(\d{2}[A-Z]?)$/);
    if (m) {
      return `${m[1]}_${m[2]}`;
    }
  }
  return upper;
}

/**
 * Reject generic/positional variable names where reuse across cycles does not imply
 * longitudinal construct identity (e.g. `Q1`, `Q01`, `VAR1`, `ITEM_1`).
 */
export function isEligibleSeriesName(name: string): boolean {
  const upper = name.trim().toUpperCase();
  if (upper.length < 3) return false;
  if (/^(?:Q|QUESTION|VAR|ITEM|COL|ROW| SEC|SECT)_?\d+[A-Z]?$/i.test(upper)) return false;
  if (/^[A-Z]\d{1,2}$/.test(upper)) return false;
  return true;
}

/**
 * Strip generic DDI/dictionary status suffixes (`- Derived variable`, `- (D)`, `- (G)`,
 * `Temporary reformat`) and fall back to `questionText` when `concept` is a bare placeholder
 * such as `"Derived variable"` or `"Question 12"`.
 */
export function cleanedSubstantiveMeaning(v: CorpusVariable): string {
  const cleanField = (raw: string | undefined): string => {
    if (!raw) return '';
    return raw
      .replace(/\b(?:temporary\s+reformat)\b/gi, ' ')
      .replace(/[-–—:\s]*\(\s*[DGdg]\s*\)\s*$/g, ' ')
      .replace(/[-–—:\s]*\bderived\s+variable\b\s*$/gi, ' ')
      .replace(/^\s*\bderived\s+variable\b[-–—:\s]*/gi, ' ')
      .replace(/\bselect\s+all\s+that\s+apply\b/gi, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };

  const c = cleanField(v.concept);
  const q = cleanField(v.questionText);

  const isPlaceholderConcept =
    c === '' ||
    c === 'derived variable' ||
    c === 'grouped variable' ||
    /^question\s+\d+[a-z]?$/.test(c) ||
    /^q\s*\d+[a-z]?$/.test(c) ||
    c === 'yes no';

  if (isPlaceholderConcept && q !== '') {
    return q;
  }
  return c !== '' ? c : q;
}

export function substantiveTokens(v: CorpusVariable): Set<string> {
  const combined = `${cleanedSubstantiveMeaning(v)} ${normalizeKey(v.questionText)}`;
  const tokens = new Set<string>();
  for (const tok of combined.split(/\s+/)) {
    if (tok.length >= 3 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok)) {
      tokens.add(tok);
    }
  }
  return tokens;
}

export function computeConstructSimilarity(earlier: CorpusVariable, later: CorpusVariable): {
  similarity: number;
  sharedTokens: number;
  exactCleanedMeaning: boolean;
} {
  const m1 = cleanedSubstantiveMeaning(earlier);
  const m2 = cleanedSubstantiveMeaning(later);

  if (m1 !== '' && m1 === m2 && m1.length >= 5) {
    return { similarity: 1.0, sharedTokens: m1.split(/\s+/).length, exactCleanedMeaning: true };
  }

  // Also check if earlier's cleaned concept equals later's cleaned questionText or vice versa
  const c1 = normalizeKey(earlier.concept);
  const q1 = normalizeKey(earlier.questionText);
  const c2 = normalizeKey(later.concept);
  const q2 = normalizeKey(later.questionText);
  if (
    (m1 !== '' && m1.length >= 6 && (m1 === q2 || m1 === c2)) ||
    (m2 !== '' && m2.length >= 6 && (m2 === q1 || m2 === c1))
  ) {
    return { similarity: 0.95, sharedTokens: 3, exactCleanedMeaning: true };
  }

  const t1 = substantiveTokens(earlier);
  const t2 = substantiveTokens(later);
  if (t1.size === 0 || t2.size === 0) {
    return { similarity: 0, sharedTokens: 0, exactCleanedMeaning: false };
  }

  let intersection = 0;
  for (const tok of t1) {
    if (t2.has(tok)) intersection++;
  }
  const union = t1.size + t2.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = Math.min(t1.size, t2.size) > 0 ? intersection / Math.min(t1.size, t2.size) : 0;
  const score = jaccard * 0.6 + containment * 0.4;

  return {
    similarity: Number(score.toFixed(4)),
    sharedTokens: intersection,
    exactCleanedMeaning: false,
  };
}

function truncateQuote(s: string | undefined, maxLen = 120): string {
  const clean = (s ?? '—').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

/**
 * Evaluate whether two cross-cycle occurrences of a variable series constitute a valid,
 * high-confidence continuity link across distinct `conceptual_variable_id` groups.
 */
export function evaluateContinuityPair(
  earlier: CorpusVariable,
  later: CorpusVariable,
): ContinuityEdge | null {
  if (earlier.source.lang !== 'en' || later.source.lang !== 'en') return null;
  const family1 = canonicalSurveyFamily(earlier.source.surveyGroup, earlier.source.surveyAcronym);
  const family2 = canonicalSurveyFamily(later.source.surveyGroup, later.source.surveyAcronym);
  if (family1 !== family2) return null;
  const earlierYear = earlier.source.year;
  const laterYear = later.source.year;
  if (earlierYear === undefined || laterYear === undefined || earlierYear >= laterYear) {
    return null;
  }

  const earlierMeaning = meaningOf(earlier);
  const laterMeaning = meaningOf(later);
  if (earlierMeaning === '' || laterMeaning === '') return null;

  const earlierUniverseKey = normalizeKey(earlier.universe);
  const laterUniverseKey = normalizeKey(later.universe);

  const earlierCvId = conceptualVariableId(earlierMeaning, earlierUniverseKey);
  const laterCvId = conceptualVariableId(laterMeaning, laterUniverseKey);

  // Must belong to DIFFERENT DDI ConceptualVariable cascades (otherwise they are already on the same timeline)
  if (earlierCvId === laterCvId) return null;

  const series1 = canonicalSeriesName(earlier.name, family1);
  const series2 = canonicalSeriesName(later.name, family2);
  if (series1 !== series2) return null;
  if (!isEligibleSeriesName(series1)) return null;

  const { similarity, sharedTokens, exactCleanedMeaning } = computeConstructSimilarity(earlier, later);
  const isRenamed = earlier.name.toUpperCase() !== later.name.toUpperCase();

  // Require higher threshold when the variable mnemonic was renumbered (e.g., _010 -> _10)
  if (isRenamed) {
    if (!exactCleanedMeaning && (similarity < 0.78 || sharedTokens < 2)) return null;
  } else {
    if (!exactCleanedMeaning && (similarity < 0.72 || sharedTokens < 2)) return null;
  }

  let breakKind: ContinuityBreakKind;
  if (isRenamed) {
    breakKind = 'cycle_renumbering';
  } else if (earlierMeaning === laterMeaning && earlierUniverseKey !== laterUniverseKey) {
    breakKind = 'universe_shift';
  } else if (exactCleanedMeaning && earlierUniverseKey === laterUniverseKey) {
    breakKind = 'concept_relabel';
  } else {
    breakKind = 'wording_and_universe_evolution';
  }

  const acronym = earlier.source.surveyAcronym ?? family1;
  const earlierConcept = truncateQuote(earlier.concept);
  const laterConcept = truncateQuote(later.concept);
  const earlierQ = truncateQuote(earlier.questionText, 100);
  const laterQ = truncateQuote(later.questionText, 100);
  const earlierUniv = truncateQuote(earlier.universe, 100);
  const laterUniv = truncateQuote(later.universe, 100);

  let changeSummary: string;
  if (breakKind === 'universe_shift') {
    changeSummary = `Concept wording remained '${earlierConcept}', but the target universe shifted from '${earlierUniv}' (${earlierYear}) to '${laterUniv}' (${laterYear}).`;
  } else if (breakKind === 'concept_relabel') {
    changeSummary = `Variable ${earlier.name} measures the same construct across ${earlierYear} and ${laterYear}, but the dictionary concept label changed from '${earlierConcept}' to '${laterConcept}'.`;
  } else if (breakKind === 'cycle_renumbering') {
    changeSummary = `CCHS 3-digit variable ${earlier.name} (${earlierYear}) was renumbered to 2-digit ${later.name} (${laterYear}) while preserving the underlying measure ('${laterConcept}').`;
  } else {
    changeSummary = `Variable ${earlier.name} continues across ${earlierYear}→${laterYear} with minor concept/universe evolution ('${earlierConcept}' [${earlierUniv}] → '${laterConcept}' [${laterUniv}]).`;
  }

  const rationale =
    `Evidence from data dictionary: "${acronym} ${earlierYear} ${earlier.name} (Concept: '${earlierConcept}', Universe: '${earlierUniv}') -> ${acronym} ${laterYear} ${later.name} (Concept: '${laterConcept}', Universe: '${laterUniv}')"; ` +
    `AI interpretation and action: Linked cross-cycle conceptual variable timelines (${breakKind}, similarity=${similarity.toFixed(2)}). ${changeSummary} Separate DDI ConceptualVariable groups are preserved because population comparability is not automatic.`;

  const evidence =
    `Evidence from data dictionary: "${acronym} ${earlierYear} (${earlier.name}): Concept='${earlierConcept}', Question='${earlierQ}', Universe='${earlierUniv}' | ${acronym} ${laterYear} (${later.name}): Concept='${laterConcept}', Question='${laterQ}', Universe='${laterUniv}'"; ` +
    `AI interpretation and action: Deterministic Phase 27 longitudinal continuity resolver matched series '${series1}' across distinct DDI cascade groups (${breakKind}, similarity=${similarity.toFixed(2)}).`;

  return {
    surveyGroup: family1,
    canonicalSeries: series1,
    earlierRecordId: earlier.recordId,
    laterRecordId: later.recordId,
    earlierCvId,
    laterCvId,
    earlierName: earlier.name,
    laterName: later.name,
    earlierYear,
    laterYear,
    breakKind,
    similarity,
    suggestedBy: 'Phase 27 Longitudinal Continuity Resolver',
    rationale,
    evidence,
  };
}

/**
 * Discover cross-cycle concept continuity links across a set of corpus variables.
 * Connects consecutive distinct `conceptualVariableId` epochs along each `(surveyGroup, canonicalSeries)`
 * timeline so users can traverse longitudinal series breaks without transitive clique explosion.
 */
export function buildContinuityMesh(
  variables: Iterable<CorpusVariable>,
  options?: { targetSurveyGroups?: Set<string>; maxEdgesPerSurvey?: number },
): ContinuityEdge[] {
  // Group English substantive variables by `${surveyFamily}::${canonicalSeries}`
  const bySeries = new Map<string, CorpusVariable[]>();

  for (const v of variables) {
    if (v.source.lang !== 'en') continue;
    if (v.source.year === undefined) continue;
    const family = canonicalSurveyFamily(v.source.surveyGroup, v.source.surveyAcronym);
    if (options?.targetSurveyGroups && !options.targetSurveyGroups.has(family)) {
      continue;
    }
    if (meaningOf(v) === '') continue;
    if (!isEligibleSeriesName(v.name)) continue;

    const classification = classifyVariableRole(v);
    if (classification.role === 'process') continue;

    const series = canonicalSeriesName(v.name, family);
    const key = `${family}::${series}`;
    let list = bySeries.get(key);
    if (!list) {
      list = [];
      bySeries.set(key, list);
    }
    list.push(v);
  }

  const allEdges: ContinuityEdge[] = [];
  const seenCvPairs = new Set<string>();

  for (const [, occurrences] of bySeries) {
    if (occurrences.length < 2) continue;

    // Sort chronologically by year, then cycle, then recordId for determinism
    occurrences.sort((a, b) => {
      const ya = a.source.year ?? 0;
      const yb = b.source.year ?? 0;
      if (ya !== yb) return ya - yb;
      return a.recordId.localeCompare(b.recordId);
    });

    // Deduplicate to one representative occurrence per distinct (year, conceptualVariableId)
    const epochs: { v: CorpusVariable; cvId: string; year: number }[] = [];
    for (const v of occurrences) {
      const cvId = conceptualVariableId(meaningOf(v), normalizeKey(v.universe));
      const year = v.source.year!;
      const prev = epochs[epochs.length - 1];
      if (prev && prev.cvId === cvId) {
        // Keep the latest year occurrence of the current conceptualVariableId epoch so the bridge
        // connects the end of epoch i to the start of epoch i+1
        prev.v = v;
        prev.year = year;
        continue;
      }
      epochs.push({ v, cvId, year });
    }

    if (epochs.length < 2) continue;

    for (let i = 0; i < epochs.length - 1; i++) {
      const e1 = epochs[i]!;
      const e2 = epochs[i + 1]!;
      if (e1.year >= e2.year) continue;
      if (e1.cvId === e2.cvId) continue;

      const cvPairKey =
        e1.cvId < e2.cvId ? `${e1.cvId}::${e2.cvId}` : `${e2.cvId}::${e1.cvId}`;
      if (seenCvPairs.has(cvPairKey)) continue;

      const edge = evaluateContinuityPair(e1.v, e2.v);
      if (edge) {
        seenCvPairs.add(cvPairKey);
        allEdges.push(edge);
      }
    }
  }

  // Sort by similarity desc, then span/year so if maxEdgesPerSurvey is applied we keep the strongest
  allEdges.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.surveyGroup !== b.surveyGroup) return a.surveyGroup.localeCompare(b.surveyGroup);
    if (a.canonicalSeries !== b.canonicalSeries) {
      return a.canonicalSeries.localeCompare(b.canonicalSeries);
    }
    return a.earlierYear - b.earlierYear;
  });

  if (options?.maxEdgesPerSurvey) {
    const counts = new Map<string, number>();
    const capped: ContinuityEdge[] = [];
    for (const edge of allEdges) {
      const c = counts.get(edge.surveyGroup) ?? 0;
      if (c >= options.maxEdgesPerSurvey) continue;
      counts.set(edge.surveyGroup, c + 1);
      capped.push(edge);
    }
    return capped;
  }

  return allEdges;
}

function sqlEsc(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export function renderContinuitySql(edges: ContinuityEdge[]): string {
  const lines: string[] = [
    '-- Phase 27: Cross-Cycle Concept Continuity & Longitudinal Lineage Mesh',
    '-- Auto-generated by tools/metadata/statcan-corpus/src/graph/continuity.ts',
    '-- Safe to re-run (idempotent upsert on (earlier_record_id, later_record_id)).',
    '',
  ];

  const BATCH_SIZE = 200;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    const values = batch
      .map(
        (e) =>
          `  (${sqlEsc(e.earlierRecordId)}::uuid, ${sqlEsc(e.laterRecordId)}::uuid, 'likely_continuation', 'ai_suggested', ${sqlEsc(e.suggestedBy)}, ${sqlEsc(e.rationale)}, ${sqlEsc(e.evidence)})`,
      )
      .join(',\n');

    lines.push(
      `with raw_continuity (earlier_record_id, later_record_id, relation, review_status, suggested_by, rationale, evidence) as (`,
      `  values`,
      values,
      `)`,
      `insert into corpus_concept_continuity (earlier_record_id, later_record_id, relation, review_status, suggested_by, rationale, evidence)`,
      `select r.earlier_record_id, r.later_record_id, r.relation, r.review_status, r.suggested_by, r.rationale, r.evidence`,
      `from raw_continuity r`,
      `where exists (select 1 from corpus_variable cv1 where cv1.record_id = r.earlier_record_id)`,
      `  and exists (select 1 from corpus_variable cv2 where cv2.record_id = r.later_record_id)`,
      `on conflict (earlier_record_id, later_record_id) do update set`,
      `  suggested_by = excluded.suggested_by,`,
      `  rationale = excluded.rationale,`,
      `  evidence = excluded.evidence`,
      `where corpus_concept_continuity.review_status = 'ai_suggested';`,
      '',
    );
  }

  return lines.join('\n');
}

export async function runContinuityMeshCli(): Promise<void> {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(`corpus.jsonl not found at ${CORPUS_PATH}`);
  }

  const variables: CorpusVariable[] = [];
  const rl = createInterface({
    input: createReadStream(CORPUS_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    if (v.source.lang === 'en') {
      variables.push(v);
    }
  }

  const edges = buildContinuityMesh(variables, {
    maxEdgesPerSurvey: 120,
  });

  const bySurvey = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const e of edges) {
    bySurvey.set(e.surveyGroup, (bySurvey.get(e.surveyGroup) ?? 0) + 1);
    byKind.set(e.breakKind, (byKind.get(e.breakKind) ?? 0) + 1);
  }

  mkdirSync(dirname(SQL_OUT_PATH), { recursive: true });
  writeFileSync(SQL_OUT_PATH, renderContinuitySql(edges), 'utf8');

  // Also write chunks to out/continuity_chunks/ for fast CLI upload
  const chunkDir = resolve(OUT_DIR, 'continuity_chunks');
  mkdirSync(chunkDir, { recursive: true });
  const CHUNK_SIZE = 250;
  let chunkCount = 0;
  for (let i = 0; i < edges.length; i += CHUNK_SIZE) {
    chunkCount++;
    const slice = edges.slice(i, i + CHUNK_SIZE);
    writeFileSync(resolve(chunkDir, `chunk_${chunkCount}.sql`), renderContinuitySql(slice), 'utf8');
  }

  console.log(`=== Phase 27 Cross-Cycle Concept Continuity Summary ===`);
  console.log(`Loaded EN variables in priority multi-cycle programs: ${variables.length}`);
  console.log(`Total cross-cycle continuity bridges generated:       ${edges.length}`);
  console.log(`By break-in-series kind:`);
  for (const [k, c] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${k}: ${c}`);
  }
  console.log(`By survey program:`);
  for (const [s, c] of [...bySurvey.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${s}: ${c}`);
  }
  console.log(`Wrote SQL to ${SQL_OUT_PATH} and ${chunkCount} chunk(s) to ${chunkDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runContinuityMeshCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
