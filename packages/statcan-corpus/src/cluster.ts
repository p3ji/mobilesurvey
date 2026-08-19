/**
 * Grouping occurrences into DDI's variable cascade (docs/metadata-repo-plan.md, D3/M3).
 *
 * ### Why DDI's model rather than one "concept cluster"
 *
 * D3 planned a single `CorpusConcept` — a bag of occurrences judged to be "the same question
 * across time". DDI-Lifecycle already models this, and models it as **three** levels rather than
 * one:
 *
 * | | | |
 * |---|---|---|
 * | `c:Concept` | the unit of meaning | "marital status" |
 * | `l:ConceptualVariable` | a Concept applied to a Universe | "marital status, of all respondents 15+" |
 * | `l:RepresentedVariable` | a ConceptualVariable given a representation | "…coded 1–6, with these categories" |
 * | `l:Variable` | the variable as one dataset holds it | one {@link CorpusVariable} occurrence |
 *
 * Splitting it that way is not standards pedantry — it is what makes the interesting question
 * answerable. "Which cycles changed the wording?" is not a query you have to write: it is a
 * ConceptualVariable that carries **more than one RepresentedVariable**. Collapsed into a single
 * cluster, that distinction is gone and has to be reconstructed by comparing members pairwise.
 *
 * It also measures better. Against the plan's own fallback — group by survey plus variable name —
 * the cascade finds 13,466 cross-cycle groups where name matching finds 4,759, and 9,841 of those
 * span more than one survey, which name matching cannot do at all.
 *
 * ### These are inferences, and they are kept away from the facts
 *
 * Occurrences are what a document said; clusters are our judgement about what several documents
 * meant, and that judgement will sometimes be wrong. Nothing here writes to the occurrence
 * records: membership lives in its own table keyed by `recordId`, so re-clustering is a truncate
 * and a reload of one small table, and a clustering bug can never corrupt an extracted fact (D3).
 */
import { corpusUuid } from './ingest.js';
import type { CorpusVariable } from './types.js';

/**
 * Fold text to a matching key: case, punctuation and whitespace are noise here.
 *
 * Deliberately shallow — no stemming, no synonyms. A looser key merges genuinely different
 * measures and there is no way for a reader to see that it happened, while a stricter key leaves
 * two groups that are visibly the same thing side by side. Of those two failures only the second
 * is self-correcting.
 */
export function normalizeKey(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The meaning a record carries: its concept label, or its question wording when the layout
 * records no concept.
 *
 * The fallback matters because the layouts disagree about which field holds the meaning — the
 * labelled family prints a short `Concept`, the collection family gives prose and no concept at
 * all. Keying on `concept` alone would place none of the collection family.
 */
export function meaningOf(v: CorpusVariable): string {
  const concept = normalizeKey(v.concept);
  return concept === '' ? normalizeKey(v.questionText) : concept;
}

/**
 * A representation signature: the code list, by code and label.
 *
 * Frequencies are excluded on purpose. Two cycles of an identically-coded question differ in
 * their counts every time, and including them would make every cycle its own representation —
 * turning the "coding changed" signal into noise that fires on all 13,466 groups.
 */
export function representationOf(v: CorpusVariable): string {
  if (v.codes.length === 0) return 'none';
  return v.codes.map((c) => `${c.code}=${normalizeKey(c.label)}`).join('|');
}

/** Stable UUIDv5 ids, minted from the same corpus namespace as record ids (D9). */
export const conceptId = (meaning: string): string => corpusUuid(`concept:${meaning}`);
export const conceptualVariableId = (meaning: string, universe: string): string =>
  corpusUuid(`conceptual-variable:${meaning}:${universe}`);
export const representedVariableId = (
  meaning: string,
  universe: string,
  representation: string,
): string => corpusUuid(`represented-variable:${meaning}:${universe}:${representation}`);

/** Where one occurrence sits in the cascade. Written to its own table, never onto the occurrence. */
export interface ClusterMembership {
  recordId: string;
  conceptId: string;
  conceptualVariableId: string;
  representedVariableId: string;
}

/** `c:Concept` — a unit of meaning, with the span of documents that express it. */
export interface ConceptRow {
  concept_id: string;
  label: string;
  occurrences: number;
  surveys: number;
  year_min: number | null;
  year_max: number | null;
}

/** `l:ConceptualVariable` — a Concept applied to a Universe. The object a timeline is drawn for. */
export interface ConceptualVariableRow {
  conceptual_variable_id: string;
  concept_id: string;
  label: string;
  universe: string | null;
  occurrences: number;
  surveys: number;
  /** Distinct representations. More than one means the coding changed between cycles. */
  representations: number;
  years: number;
  year_min: number | null;
  year_max: number | null;
}

/** `l:RepresentedVariable` — a ConceptualVariable given one specific coding. */
export interface RepresentedVariableRow {
  represented_variable_id: string;
  conceptual_variable_id: string;
  code_count: number;
  occurrences: number;
  year_min: number | null;
  year_max: number | null;
}

export interface ClusterResult {
  concepts: ConceptRow[];
  conceptualVariables: ConceptualVariableRow[];
  representedVariables: RepresentedVariableRow[];
  members: ClusterMembership[];
  /** Occurrences carrying no meaning text at all, which the cascade cannot place. */
  unplaced: number;
}

interface Accum {
  labels: Map<string, number>;
  occurrences: number;
  surveys: Set<string>;
  years: Set<number>;
  representations: Set<string>;
  universe: string | undefined;
  conceptKey: string;
  /** Parent ConceptualVariable, recorded on RepresentedVariable accumulators. */
  parentKey: string;
  codeCount: number;
}

function accum(): Accum {
  return {
    labels: new Map(),
    occurrences: 0,
    surveys: new Set(),
    years: new Set(),
    representations: new Set(),
    universe: undefined,
    conceptKey: '',
    parentKey: '',
    codeCount: 0,
  };
}

/**
 * The label a group is shown under: the most frequent verbatim spelling among its members.
 *
 * Not the normalized key, which is lower-cased and stripped of punctuation and would render as
 * `marital status of the respondent` where the documents say `Marital status`. Ties break on the
 * alphabetically first spelling so the choice is stable across runs (D9) rather than depending on
 * iteration order.
 */
function pickLabel(labels: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [label, count] of labels) {
    if (count > bestCount || (count === bestCount && label < best)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

const span = (years: Set<number>): [number | null, number | null] =>
  years.size === 0 ? [null, null] : [Math.min(...years), Math.max(...years)];

/**
 * Build the cascade over a set of occurrences.
 *
 * Takes an iterable so a caller can stream a 285 MB JSONL through it; the accumulators hold one
 * entry per group, not per occurrence.
 */
export function buildClusters(records: Iterable<CorpusVariable>): ClusterResult {
  const concepts = new Map<string, Accum>();
  const conceptual = new Map<string, Accum>();
  const represented = new Map<string, Accum>();
  const members: ClusterMembership[] = [];
  let unplaced = 0;

  for (const v of records) {
    const meaning = meaningOf(v);
    if (meaning === '') {
      // No meaning text: the cascade has nothing to place it by, and inventing a group from the
      // variable name alone would put unrelated administrative fields together across surveys.
      unplaced += 1;
      continue;
    }
    const universe = normalizeKey(v.universe);
    const representation = representationOf(v);

    const cId = conceptId(meaning);
    const cvId = conceptualVariableId(meaning, universe);
    const rvId = representedVariableId(meaning, universe, representation);
    members.push({
      recordId: v.recordId,
      conceptId: cId,
      conceptualVariableId: cvId,
      representedVariableId: rvId,
    });

    const verbatim = (v.concept ?? v.questionText ?? '').trim();
    const year = v.source.year;

    for (const [map, key] of [
      [concepts, cId],
      [conceptual, cvId],
      [represented, rvId],
    ] as const) {
      let a = map.get(key);
      if (a === undefined) {
        a = accum();
        a.conceptKey = cId;
        a.parentKey = cvId;
        a.universe = v.universe;
        a.codeCount = v.codes.length;
        map.set(key, a);
      }
      a.occurrences += 1;
      a.surveys.add(v.source.surveyGroup);
      if (year !== undefined) a.years.add(year);
      a.representations.add(representation);
      if (verbatim !== '') a.labels.set(verbatim, (a.labels.get(verbatim) ?? 0) + 1);
    }
    // A ConceptualVariable's universe is whichever spelling its first member carried; the key is
    // already normalized, so members agree on it up to punctuation.
    const cv = conceptual.get(cvId)!;
    if (cv.universe === undefined && v.universe !== undefined) cv.universe = v.universe;
  }

  // Sorted output so a re-run is diffable and a load is deterministic (D9).
  const byId = <T extends Record<string, unknown>>(rows: T[], key: keyof T): T[] =>
    rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])));

  return {
    concepts: byId(
      [...concepts.entries()].map(([id, a]) => {
        const [year_min, year_max] = span(a.years);
        return {
          concept_id: id,
          label: pickLabel(a.labels),
          occurrences: a.occurrences,
          surveys: a.surveys.size,
          year_min,
          year_max,
        };
      }),
      'concept_id',
    ),
    conceptualVariables: byId(
      [...conceptual.entries()].map(([id, a]) => {
        const [year_min, year_max] = span(a.years);
        return {
          conceptual_variable_id: id,
          concept_id: a.conceptKey,
          label: pickLabel(a.labels),
          universe: a.universe ?? null,
          occurrences: a.occurrences,
          surveys: a.surveys.size,
          representations: a.representations.size,
          years: a.years.size,
          year_min,
          year_max,
        };
      }),
      'conceptual_variable_id',
    ),
    representedVariables: byId(
      [...represented.entries()].map(([id, a]) => {
        const [year_min, year_max] = span(a.years);
        return {
          represented_variable_id: id,
          conceptual_variable_id: a.parentKey,
          code_count: a.codeCount,
          occurrences: a.occurrences,
          year_min,
          year_max,
        };
      }),
      'represented_variable_id',
    ),
    members,
    unplaced,
  };
}
