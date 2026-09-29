/**
 * Projecting {@link CorpusVariable} occurrences onto the rows the search backend stores
 * (docs/metadata-repo-plan.md D5, D6, D8).
 *
 * This module is the seam between the ETL's model and the database's. It exists as its own file
 * because the two shapes have genuinely different jobs: `CorpusVariable` is a faithful record of
 * *what one document said about one variable*, while {@link CorpusRow} is a flat, indexable,
 * facet-filterable row. Collapsing them would force one of the two to compromise.
 *
 * ### Why the field names are snake_case
 *
 * They are Postgres column names, not TypeScript properties. Keeping them identical to the DDL
 * means the loader is a straight `insert(rows)` with no mapping layer to drift out of sync with
 * `schema.sql`, and a column rename fails at the type level rather than at 3 a.m. in a REST call.
 *
 * ### What `search_text` is for
 *
 * Postgres builds the `tsvector` from this one column, so what goes in it *is* what is findable.
 * The external audience (§7 open question 2) does not know StatCan's variable mnemonics, so the
 * concept, question wording, universe, and — importantly — the **response-category labels** are
 * all folded in: "never married" is often the only place a searchable concept appears in plain
 * language. Frequencies and codes are deliberately excluded; they are numbers, and indexing them
 * makes every variable match every numeric query.
 */
import type { CorpusVariable, DocKind, Lang } from './types.js';

/**
 * One row of `corpus_variable`, named exactly as the columns are.
 *
 * `codes` is JSON rather than a child table on purpose: a code list is only ever read whole, with
 * its variable, and a join table of ~2 M rows would cost far more than it returns. If the D5 size
 * trigger fires (~300 MB loaded), this is the column that moves to Storage — which is why it is
 * kept separate from `search_text` rather than being reachable only through it.
 */
export interface CorpusRow {
  record_id: string;
  name: string;
  position: string | null;
  length: string | null;
  collection_name: string | null;
  concept: string | null;
  question_text: string | null;
  universe: string | null;
  note: string | null;
  codes: CorpusRowCode[];
  code_count: number;
  /** Provenance (D8) — every one of these is required to cite a record under the Open Licence. */
  bundle: string;
  path: string;
  page: number;
  tcode: string | null;
  doc_kind: DocKind;
  survey_group: string;
  survey_acronym: string | null;
  cycle: string | null;
  year: number | null;
  lang: Lang;
  /** The only column the full-text index reads. See the module note. */
  search_text: string;
}

/** A code list entry as stored in the `codes` JSON column. Keys are short: this is ~24% of bytes. */
export interface CorpusRowCode {
  c: string;
  l: string;
  f?: number;
  w?: number;
}

/** Empty string and whitespace are absences, and Postgres should see them as NULL, not as ''. */
function orNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Build the indexed text for one occurrence.
 *
 * Order matters less than presence — `ts_rank` does not care about position — but the parts are
 * emitted in a stable order anyway so that a row's `search_text` is a pure function of the record
 * and a re-ingest diffs cleanly (D9).
 */
export function buildSearchText(variable: CorpusVariable): string {
  const parts: Array<string | undefined> = [
    variable.name,
    variable.concept,
    variable.questionText,
    variable.universe,
    variable.note,
    variable.collectionName,
    // Category labels carry the plain-language vocabulary the mnemonics lack.
    ...variable.codes.map((code) => code.label),
  ];
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Project one occurrence onto its storage row. Pure, total, and lossless for every stored field. */
export function toCorpusRow(variable: CorpusVariable): CorpusRow {
  const { source } = variable;
  return {
    record_id: variable.recordId,
    name: variable.name,
    position: orNull(variable.position),
    length: orNull(variable.length),
    collection_name: orNull(variable.collectionName),
    concept: orNull(variable.concept),
    question_text: orNull(variable.questionText),
    universe: orNull(variable.universe),
    note: orNull(variable.note),
    codes: variable.codes.map((code) => ({
      c: code.code,
      l: code.label,
      ...(code.frequency === undefined ? {} : { f: code.frequency }),
      ...(code.weighted === undefined ? {} : { w: code.weighted }),
    })),
    code_count: variable.codes.length,
    bundle: source.bundle,
    path: source.path,
    page: source.page,
    tcode: source.tcode ?? null,
    doc_kind: source.docKind,
    survey_group: source.surveyGroup,
    survey_acronym: source.surveyAcronym ?? null,
    cycle: source.cycle ?? null,
    year: source.year ?? null,
    lang: source.lang,
    search_text: buildSearchText(variable),
  };
}
