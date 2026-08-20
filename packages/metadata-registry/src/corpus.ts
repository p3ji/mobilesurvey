/**
 * The StatCan corpus as a registry source (docs/metadata-repo-plan.md, D5/D6/D8).
 *
 * ### Why this lives in `metadata-registry` and not in `statcan-corpus`
 *
 * `statcan-corpus` is Node-only by design — it streams gigabytes and must never be reachable from
 * an app bundle (D2). But the *browser* is what searches the corpus, so the read path has to live
 * somewhere a browser can import. This module is that half: no filesystem, no zip, no pdfjs, no
 * dependency beyond `fetch`.
 *
 * ### Why the results are `RegistryEntry`
 *
 * Because the designer's Library panel already consumes `RegistryEntry`, and a StatCan question
 * that arrives in that shape can be inserted into an instrument with no change to the designer,
 * then exported as valid DDI-XML and JSON-LD by machinery that already exists (D6). Inventing a
 * parallel result type would have meant rebuilding all of that for a second model.
 *
 * ### Attribution is not decoration
 *
 * Every entry carries its licence, its attribution string, and the notice that it is an
 * *adaptation* rather than the official publication. Those are obligations of the Statistics
 * Canada Open Licence (D8), so they are attached at projection time — where they cannot be
 * forgotten by a caller — rather than being left to whichever UI happens to render the row.
 */
import type { RegistryEntry, SearchHit } from './types.js';

/** Licence the corpus is published under. Fixed string: it is a legal identifier, not a label. */
export const CORPUS_LICENSE = 'Statistics Canada Open Licence';

/**
 * The notice that must accompany anything derived from these records.
 *
 * Three obligations in one sentence: name the source, disclaim endorsement, and identify the
 * material as an adaptation. Kept as one constant so a UI cannot satisfy two of the three.
 */
export const CORPUS_ATTRIBUTION =
  'Adapted from Statistics Canada documentation, published under the Statistics Canada Open ' +
  'Licence. This is an adaptation; Statistics Canada does not endorse this product.';

/** One response category as stored in the `codes` JSON column. Keys are short — this is bulk. */
export interface CorpusCode {
  c: string;
  l: string;
  f?: number;
  w?: number;
}

/** A row as `corpus_search` returns it. Field names are the SQL column names, unchanged. */
export interface CorpusSearchRow {
  record_id: string;
  name: string;
  position: string | null;
  length: string | null;
  concept: string | null;
  question_text: string | null;
  universe: string | null;
  note: string | null;
  codes: CorpusCode[] | null;
  code_count: number;
  bundle: string;
  path: string;
  page: number;
  tcode: string | null;
  survey_group: string;
  survey_acronym: string | null;
  cycle: string | null;
  year: number | null;
  lang: string;
  rank: number;
  total_count: number;
}

/** Corpus-specific metadata, carried in `RegistryEntry.corpus` (an additive block, like `eq`). */
export interface CorpusMeta {
  surveyGroup: string;
  /** The delivery bundle the document sits in — half of the key that resolves it. */
  bundle: string;
  surveyAcronym?: string;
  cycle?: string;
  year?: number;
  lang: string;
  tcode?: string;
  /** Source document within the delivery, and the page the variable was printed on. */
  file: string;
  page: number;
  variableName: string;
  position?: string;
  length?: string;
  universe?: string;
  note?: string;
  codes: CorpusCode[];
  /** Ready-to-render source citation, assembled once so every surface cites identically. */
  citation: string;
}

/**
 * Human-readable citation for one occurrence.
 *
 * Ordered the way a reader scans it — survey, then when, then which document, then where in it —
 * because the first two are what identifies the source and the last two are what makes an
 * extraction error traceable and therefore fixable (D8).
 */
export function corpusCitation(row: CorpusSearchRow): string {
  const survey = row.survey_acronym ?? row.survey_group;
  const when = row.year === null ? row.cycle : String(row.year);
  const file = row.path.split('/').pop() ?? row.path;
  return [
    survey,
    when === null || when === undefined ? undefined : when,
    file,
    `p. ${row.page}`,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
}

function intl(lang: string, value: string): Record<string, string> {
  return { [lang === 'fr' ? 'fr' : 'en']: value };
}

/**
 * Project a search row onto a registry entry.
 *
 * `componentType` is `question` when the document recorded question wording and `variable`
 * otherwise. That is not cosmetic: it is what makes the existing type filter mean something over
 * corpus results, and it is honest — a derived variable with no wording was never asked, and
 * offering it as a reusable *question* would be a small lie that a designer would discover only
 * after inserting it.
 */
export function toRegistryEntry(row: CorpusSearchRow): RegistryEntry {
  const codes = row.codes ?? [];
  const label = row.concept ?? row.question_text ?? row.name;
  const citation = corpusCitation(row);

  return {
    entryId: row.record_id,
    componentType: row.question_text === null ? 'variable' : 'question',
    payload: row,
    searchText: [row.name, row.concept, row.question_text, row.universe]
      .filter((part): part is string => part !== null && part !== undefined && part !== '')
      .join(' '),
    ddi: {
      label: intl(row.lang, label),
      ...(row.question_text === null ? {} : { description: intl(row.lang, row.question_text) }),
      ...(row.universe === null ? {} : { universeRef: row.universe }),
      ddiElementType: row.question_text === null ? 'Variable' : 'QuestionItem',
      keywords: [row.survey_acronym, row.cycle, row.tcode].filter(
        (k): k is string => k !== null && k !== undefined && k !== '',
      ),
    },
    registry: {
      tags: [row.survey_acronym ?? row.survey_group, row.year === null ? undefined : String(row.year)]
        .filter((t): t is string => t !== undefined),
      provenance: row.survey_group,
      // Occurrences are facts from one document, not shared components — nothing "uses" them.
      usageCount: 0,
      license: CORPUS_LICENSE,
      usageRights: CORPUS_ATTRIBUTION,
      // The corpus is documentation of what was published, not a living record; a synthetic
      // "last updated" would imply a freshness this data does not have. The reference year is in
      // `corpus.year`, which is the date that actually means something here.
      lastUpdated: '',
    },
    corpus: {
      surveyGroup: row.survey_group,
      bundle: row.bundle,
      ...(row.survey_acronym === null ? {} : { surveyAcronym: row.survey_acronym }),
      ...(row.cycle === null ? {} : { cycle: row.cycle }),
      ...(row.year === null ? {} : { year: row.year }),
      lang: row.lang,
      ...(row.tcode === null ? {} : { tcode: row.tcode }),
      file: row.path,
      page: row.page,
      variableName: row.name,
      ...(row.position === null ? {} : { position: row.position }),
      ...(row.length === null ? {} : { length: row.length }),
      ...(row.universe === null ? {} : { universe: row.universe }),
      ...(row.note === null ? {} : { note: row.note }),
      codes,
      citation,
    },
  };
}

/* -------------------------------------------------------------------------------------------- *
 * The remote source
 * -------------------------------------------------------------------------------------------- */

export interface CorpusFilters {
  lang?: 'en' | 'fr';
  /** Survey acronym or survey group — the RPC accepts either. */
  survey?: string;
  yearMin?: number;
  yearMax?: number;
  /** `true` restricts to variables carrying a response-category list, `false` excludes them. */
  hasCodes?: boolean;
}

export interface CorpusSearchOptions extends CorpusFilters {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface CorpusSearchResult {
  hits: SearchHit[];
  /** Matches before paging — what the UI means by "1,240 results". */
  total: number;
}

export interface CorpusStats {
  variables: number;
  surveys: number;
  documents: number;
  yearMin: number | null;
  yearMax: number | null;
  withCodes: number;
  withQuestion: number;
}

export interface CorpusSurvey {
  surveyGroup: string;
  surveyAcronym: string | null;
  variables: number;
  documents: number;
  yearMin: number | null;
  yearMax: number | null;
}

/** A candidate correction for a query the corpus does not contain. */
export interface CorpusSuggestion {
  term: string;
  /** Records the word appears in. Shown so a reader can judge the suggestion, not just take it. */
  records: number;
  similarity: number;
  score: number;
}

export interface CorpusSourceConfig {
  /** Supabase project URL, e.g. `https://abcdefgh.supabase.co`. */
  url: string;
  /** The **publishable/anon** key. This source only ever reads. */
  anonKey: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Search the corpus over PostgREST RPC.
 *
 * Deliberately not a `SupabaseClient`: `metadata-registry` has no external dependencies today and
 * is imported by every app, so adding one to reach three read-only endpoints would be a poor
 * trade. The three calls are each one POST.
 */

/* -------------------------------------------------------------------------------------------- *
 * Source documents
 *
 * A citation identifies a document; this is what makes it openable. The dictionary around a
 * variable carries context the variable's own block does not — derivation notes, universe
 * definitions, the appendices that explain a code — and for 95.5% of these documents there is no
 * public URL to link out to, so the text is served from the corpus's own Storage bucket.
 * -------------------------------------------------------------------------------------------- */

/** `r:OtherMaterial` + `r:Citation`: the document a record was lifted from. */
export interface CorpusDocument {
  documentId: string;
  title: string;
  surveyGroup: string;
  surveyAcronym: string | null;
  cycle: string | null;
  year: number | null;
  lang: string;
  tcode: string | null;
  docKind: string;
  pages: number;
  characters: number;
  /** Records loaded from this document. */
  records: number;
  /** False when the row exists but no text was uploaded — say so rather than 404 at the reader. */
  hasText: boolean;
}

/** One page of reconstructed text. */
export interface CorpusDocumentPage {
  page: number;
  text: string;
}

/**
 * Pages per stored object. Must match the ETL's `PAGES_PER_CHUNK`.
 *
 * Duplicated rather than imported because `statcan-corpus` is Node-only and must never enter a
 * browser bundle (D2). The cost of the duplication is this comment and the test that pins the
 * value; the cost of importing it would be pdfjs and a zip reader in the client.
 */
export const CORPUS_PAGES_PER_CHUNK = 100;

/** First page of the chunk holding `page`. The client repeats the ETL's arithmetic exactly. */
export function corpusChunkStart(page: number): number {
  const safe = Math.max(1, Math.trunc(page));
  return Math.floor((safe - 1) / CORPUS_PAGES_PER_CHUNK) * CORPUS_PAGES_PER_CHUNK + 1;
}

export class SupabaseCorpusSource {
  readonly id = 'statcan-corpus';
  readonly license = CORPUS_LICENSE;
  readonly attribution = CORPUS_ATTRIBUTION;

  private readonly url: string;
  private readonly anonKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CorpusSourceConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.anonKey = config.anonKey;
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  private async rpc<T>(fn: string, args: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${fn} failed: ${response.status} ${response.statusText}` +
          `${detail === '' ? '' : ` — ${detail.slice(0, 300)}`}`,
      );
    }
    return (await response.json()) as T;
  }

  async search(query: string, options: CorpusSearchOptions = {}): Promise<CorpusSearchResult> {
    const trimmed = query.trim();
    if (trimmed === '') return { hits: [], total: 0 };

    const rows = await this.rpc<CorpusSearchRow[]>(
      'corpus_search',
      {
        q: trimmed,
        lang_filter: options.lang ?? null,
        survey_filter: options.survey ?? null,
        year_min: options.yearMin ?? null,
        year_max: options.yearMax ?? null,
        require_codes: options.hasCodes ?? null,
        max_rows: options.limit ?? 50,
        row_offset: options.offset ?? 0,
      },
      options.signal,
    );

    return {
      hits: rows.map((row) => ({
        entry: toRegistryEntry(row),
        score: row.rank,
        // The server ranked these; it does not report which terms matched, and inventing a list
        // client-side would be a guess presented as an explanation.
        matched: [],
      })),
      total: rows[0]?.total_count ?? 0,
    };
  }

  async stats(signal?: AbortSignal): Promise<CorpusStats> {
    const [row] = await this.rpc<
      Array<{
        variables: number;
        surveys: number;
        documents: number;
        year_min: number | null;
        year_max: number | null;
        with_codes: number;
        with_question: number;
      }>
    >('corpus_stats', {}, signal);
    return {
      variables: row?.variables ?? 0,
      surveys: row?.surveys ?? 0,
      documents: row?.documents ?? 0,
      yearMin: row?.year_min ?? null,
      yearMax: row?.year_max ?? null,
      withCodes: row?.with_codes ?? 0,
      withQuestion: row?.with_question ?? 0,
    };
  }

  /**
   * Browse or search the cascade rather than the occurrences.
   *
   * `minYears` defaults to 2 because a "concept" observed in a single year is not a history, and
   * listing 85,363 of them ahead of the 13,466 that actually span cycles would bury the thing the
   * cascade exists to surface.
   */
  async concepts(query: CorpusConceptQuery = {}): Promise<CorpusConceptResult> {
    const rows = await this.rpc<
      Array<{
        conceptual_variable_id: string;
        concept_id: string;
        label: string;
        universe: string | null;
        occurrences: number;
        surveys: number;
        representations: number;
        years: number;
        year_min: number | null;
        year_max: number | null;
        total_count: number;
      }>
    >(
      'corpus_concepts',
      {
        q: query.q === undefined || query.q.trim() === '' ? null : query.q,
        min_years: query.minYears ?? 2,
        changed_only: query.changedOnly ?? false,
        max_rows: query.limit ?? 50,
        row_offset: query.offset ?? 0,
      },
      query.signal,
    );
    return {
      concepts: rows.map((r) => ({
        conceptualVariableId: r.conceptual_variable_id,
        conceptId: r.concept_id,
        label: r.label,
        universe: r.universe,
        occurrences: r.occurrences,
        surveys: r.surveys,
        representations: r.representations,
        years: r.years,
        yearMin: r.year_min,
        yearMax: r.year_max,
      })),
      total: rows[0]?.total_count ?? 0,
    };
  }

  /** Every occurrence of one conceptual variable, in chronological order. */
  async timeline(
    conceptualVariableId: string,
    signal?: AbortSignal,
  ): Promise<CorpusTimelineEntry[]> {
    const rows = await this.rpc<CorpusSearchRow[]>(
      'corpus_timeline',
      { cv_id: conceptualVariableId },
      signal,
    );
    return rows.map((r) => ({
      recordId: r.record_id,
      representedVariableId: (r as unknown as { represented_variable_id: string })
        .represented_variable_id,
      name: r.name,
      questionText: r.question_text,
      universe: r.universe,
      codes: r.codes ?? [],
      codeCount: r.code_count,
      surveyGroup: r.survey_group,
      surveyAcronym: r.survey_acronym,
      cycle: r.cycle,
      year: r.year,
      path: r.path,
      page: r.page,
      lang: r.lang,
      // Assembled with the same function search hits use, so one record cites identically
      // wherever it is shown.
      citation: corpusCitation(r),
    }));
  }

  /**
   * The document a record came from, looked up by the path the record already carries.
   *
   * Returns null when the document has not been published rather than throwing: a record whose
   * source was never uploaded is a normal state, not an error, and the panel should say so.
   */
  async document(
    bundle: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<CorpusDocument | null> {
    const rows = await this.rpc<
      Array<{
        document_id: string;
        title: string;
        survey_group: string;
        survey_acronym: string | null;
        cycle: string | null;
        year: number | null;
        lang: string;
        tcode: string | null;
        doc_kind: string;
        pages: number;
        characters: number;
        records: number;
        has_text: boolean;
      }>
    >('corpus_document_at', { p_bundle: bundle, p_path: path }, signal);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      documentId: row.document_id,
      title: row.title,
      surveyGroup: row.survey_group,
      surveyAcronym: row.survey_acronym,
      cycle: row.cycle,
      year: row.year,
      lang: row.lang,
      tcode: row.tcode,
      docKind: row.doc_kind,
      pages: row.pages,
      characters: row.characters,
      records: row.records,
      hasText: row.has_text,
    };
  }

  /**
   * The chunk of reconstructed text containing `page`.
   *
   * Fetched straight from Storage rather than through PostgREST — the text is not in the
   * database. Bounded to ~100 pages regardless of document size, which matters because the
   * corpus holds a 3,567-page document and a citation should not move six megabytes to show one
   * screen.
   */
  async documentPages(
    documentId: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<CorpusDocumentPage[]> {
    const from = corpusChunkStart(page);
    const response = await this.fetchImpl(
      `${this.url}/storage/v1/object/public/corpus-documents/${documentId}/${from}.json`,
      signal === undefined ? {} : { signal },
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`Document text unavailable: ${response.status} ${response.statusText}`);
    }
    const chunk = (await response.json()) as { pages?: CorpusDocumentPage[] };
    return chunk.pages ?? [];
  }
  /**
   * Corrections for a query the corpus does not contain.
   *
   * Ranked server-side by trigram similarity blended with how many records the word appears in,
   * because similarity alone corrects `maritial` to `martial` (6 records) over `marital` (459).
   *
   * Returns an empty list rather than a weak guess when nothing is close. `narcotic` is not a
   * misspelling of anything here — StatCan writes `opioid`, `codeine`, `fentanyl` — and offering
   * a bad correction would imply we found something.
   */
  async suggest(
    query: string,
    { limit = 5, minSimilarity = 0.3, signal }: { limit?: number; minSimilarity?: number; signal?: AbortSignal } = {},
  ): Promise<CorpusSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed === '') return [];
    const rows = await this.rpc<
      Array<{ term: string; records: number; similarity: number; score: number }>
    >('corpus_suggest', { q: trimmed, min_similarity: minSimilarity, max_rows: limit }, signal);
    return rows.map((r) => ({
      term: r.term,
      records: r.records,
      similarity: r.similarity,
      score: r.score,
    }));
  }

  async surveys(signal?: AbortSignal): Promise<CorpusSurvey[]> {
    const rows = await this.rpc<
      Array<{
        survey_group: string;
        survey_acronym: string | null;
        variables: number;
        documents: number;
        year_min: number | null;
        year_max: number | null;
      }>
    >('corpus_surveys', {}, signal);
    return rows.map((row) => ({
      surveyGroup: row.survey_group,
      surveyAcronym: row.survey_acronym,
      variables: row.variables,
      documents: row.documents,
      yearMin: row.year_min,
      yearMax: row.year_max,
    }));
  }
}

/* -------------------------------------------------------------------------------------------- *
 * The DDI variable cascade
 *
 * `c:Concept` → `l:ConceptualVariable` → `l:RepresentedVariable` → the occurrences themselves.
 * The level worth putting in front of a reader is the ConceptualVariable: it is one measure,
 * traced across every cycle that asked it, and the count of its representations is exactly the
 * "did the coding change?" answer without anyone having to compare members by eye.
 * -------------------------------------------------------------------------------------------- */

/** `l:ConceptualVariable` — a Concept applied to a Universe, with the span of its occurrences. */
export interface CorpusConceptualVariable {
  conceptualVariableId: string;
  conceptId: string;
  label: string;
  universe: string | null;
  occurrences: number;
  surveys: number;
  /** Distinct codings. Greater than one means the coding changed between cycles. */
  representations: number;
  years: number;
  yearMin: number | null;
  yearMax: number | null;
}

/** One occurrence on a conceptual variable's timeline. */
export interface CorpusTimelineEntry {
  recordId: string;
  representedVariableId: string;
  name: string;
  questionText: string | null;
  universe: string | null;
  codes: CorpusCode[];
  codeCount: number;
  surveyGroup: string;
  surveyAcronym: string | null;
  cycle: string | null;
  year: number | null;
  path: string;
  page: number;
  lang: string;
  /** Ready-to-render citation, assembled the same way as a search hit's. */
  citation: string;
}

export interface CorpusConceptQuery {
  q?: string;
  /** Minimum distinct years. Defaults to 2 — a "concept" seen once is not a history. */
  minYears?: number;
  /** Restrict to conceptual variables whose coding changed. */
  changedOnly?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface CorpusConceptResult {
  concepts: CorpusConceptualVariable[];
  total: number;
}
