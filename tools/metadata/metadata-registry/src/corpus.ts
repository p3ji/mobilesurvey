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

/** Published lineage progress. A program counts once when it has a verified link. */
export interface CorpusAboutProgress {
  verifiedLinks: number;
  linkedPrograms: number;
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
  /** One of Statistics Canada's subjects. Matches surveys assigned to it. */
  subject?: string;
}

export interface CorpusSearchOptions extends CorpusFilters {
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'recent';
  signal?: AbortSignal;
}

export interface CorpusSearchResult {
  hits: SearchHit[];
  /** Matches before paging — what the UI means by "1,240 results". */
  total: number;
}

/** One published input link, distinct from a possible variable name mentioned in a note. */
export interface CorpusDirectInput {
  edgeId: string;
  targetRecordId: string;
  sourceRecordId: string;
  sourceVarName: string;
  dataAuthority: 'official_statcan' | 'ai_inferred' | 'human_verified';
  derivationType: string;
  expressionSummary: string | null;
  statcanNote: string;
  reviewStatus?: 'verified' | 'needs_review';
  confidence?: number;
}

/** One derived variable with published, verified input links. */
export interface CorpusLineageTarget {
  recordId: string;
  name: string;
  label: string;
  surveyAcronym: string | null;
  cycle: string | null;
  year: number | null;
  inputCount: number;
}

export interface CorpusLineageTargetsPage {
  targets: CorpusLineageTarget[];
  total: number;
  edges: number;
}

/** A verified edge in the bounded upstream graph, with source and target labels. */
export interface CorpusLineageEdge extends Omit<CorpusDirectInput, 'sourceRecordId'> {
  sourceRecordId: string | null;
  targetName: string;
  sourceLabel: string;
  depth: number;
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

/** One row of the subject facet, with the counts a reader needs to judge it. */
export interface CorpusSubjectFacet {
  subject: string;
  /** Variables, not surveys: it tells a reader how far this filter narrows things. */
  variables: number;
  surveys: number;
  /** Surveys whose assignment a person confirmed, as opposed to derived from the survey title. */
  confirmed: number;
}

/** How much of the corpus the subject facet cannot reach. */
export interface CorpusUnclassified {
  variables: number;
  surveys: number;
  totalVariables: number;
  totalSurveys: number;
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
      options.sort === 'recent' ? 'corpus_search_sorted' : 'corpus_search',
      {
        q: trimmed,
        lang_filter: options.lang ?? null,
        survey_filter: options.survey ?? null,
        year_min: options.yearMin ?? null,
        year_max: options.yearMax ?? null,
        require_codes: options.hasCodes ?? null,
        subject_filter: options.subject ?? null,
        ...(options.sort === 'recent' ? { sort_mode: 'recent' } : {}),
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

  /** Deduplicated, field-aware results for LLM-suggested phrases. */
  async searchAi(terms: string[], options: CorpusSearchOptions = {}): Promise<CorpusSearchResult> {
    if (terms.length === 0) return { hits: [], total: 0 };
    const rows = await this.rpc<CorpusSearchRow[]>('corpus_search_ai', {
      search_terms: terms.slice(0, 3),
      lang_filter: options.lang ?? null,
      survey_filter: options.survey ?? null,
      year_min: options.yearMin ?? null,
      year_max: options.yearMax ?? null,
      require_codes: options.hasCodes ?? null,
      subject_filter: options.subject ?? null,
      sort_mode: options.sort ?? 'relevance',
      max_rows: options.limit ?? 25,
      row_offset: options.offset ?? 0,
    }, options.signal);
    return {
      hits: rows.map((row) => ({
        entry: toRegistryEntry(row),
        score: row.rank,
        matched: [],
      })),
      total: rows[0]?.total_count ?? 0,
    };
  }

  /** Immediate verified inputs for the visible results page; empty pages make no request. */
  async directInputs(targetRecordIds: string[], signal?: AbortSignal): Promise<CorpusDirectInput[]> {
    if (targetRecordIds.length === 0) return [];
    const rows = await this.rpc<Array<{
      edge_id: string;
      target_record_id: string;
      source_record_id: string;
      source_var_name: string;
      data_authority: CorpusDirectInput['dataAuthority'];
      derivation_type: string;
      ai_expression_summary: string | null;
      statcan_verbatim_note: string;
      review_status?: CorpusDirectInput['reviewStatus'];
      confidence?: number;
    }>>('corpus_get_direct_inputs', { p_target_record_ids: targetRecordIds }, signal);
    return rows.map((row) => ({
      edgeId: row.edge_id,
      targetRecordId: row.target_record_id,
      sourceRecordId: row.source_record_id,
      sourceVarName: row.source_var_name,
      dataAuthority: row.data_authority,
      derivationType: row.derivation_type,
      expressionSummary: row.ai_expression_summary,
      statcanNote: row.statcan_verbatim_note,
      ...(row.review_status === undefined ? {} : { reviewStatus: row.review_status }),
      ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
    }));
  }

  /** Derived variables connected to each visible record, whether it is a target or an input. */
  async variableGraphTargets(recordIds: string[], signal?: AbortSignal): Promise<Map<string, CorpusLineageTarget[]>> {
    if (recordIds.length === 0) return new Map();
    const rows = await this.rpc<Array<{
      root_record_id: string;
      record_id: string;
      name: string;
      label: string;
      survey_acronym: string | null;
      cycle: string | null;
      year: number | null;
      input_count: number;
    }>>('corpus_get_variable_graph_targets', { p_record_ids: recordIds }, signal);
    const byRecord = new Map<string, CorpusLineageTarget[]>();
    for (const row of rows) {
      const targets = byRecord.get(row.root_record_id) ?? [];
      targets.push({
        recordId: row.record_id,
        name: row.name,
        label: row.label,
        surveyAcronym: row.survey_acronym,
        cycle: row.cycle,
        year: row.year,
        inputCount: row.input_count,
      });
      byRecord.set(row.root_record_id, targets);
    }
    return byRecord;
  }

  async lineageTargets(query = '', limit = 20, offset = 0, signal?: AbortSignal): Promise<CorpusLineageTargetsPage> {
    const rows = await this.rpc<Array<{
      record_id: string;
      name: string;
      label: string;
      survey_acronym: string | null;
      cycle: string | null;
      year: number | null;
      input_count: number;
      total_count: number;
      edge_count: number;
    }>>('corpus_list_lineage_targets', {
      p_query: query.trim() || null,
      p_limit: limit,
      p_offset: offset,
    }, signal);
    return {
      targets: rows.map((row) => ({
        recordId: row.record_id,
        name: row.name,
        label: row.label,
        surveyAcronym: row.survey_acronym,
        cycle: row.cycle,
        year: row.year,
        inputCount: row.input_count,
      })),
      total: rows[0]?.total_count ?? 0,
      edges: rows[0]?.edge_count ?? 0,
    };
  }

  async lineageGraph(rootRecordId: string, maxDepth = 4, signal?: AbortSignal): Promise<CorpusLineageEdge[]> {
    const rows = await this.rpc<Array<{
      edge_id: string;
      target_record_id: string;
      target_name: string;
      source_record_id: string | null;
      source_var_name: string;
      source_label: string;
      data_authority: CorpusDirectInput['dataAuthority'];
      derivation_type: string;
      ai_expression_summary: string | null;
      statcan_verbatim_note: string;
      review_status?: CorpusLineageEdge['reviewStatus'];
      confidence?: number;
      depth: number;
    }>>('corpus_get_lineage_graph', {
      p_root_record_id: rootRecordId,
      p_max_depth: maxDepth,
    }, signal);
    return rows.map((row) => ({
      edgeId: row.edge_id,
      targetRecordId: row.target_record_id,
      targetName: row.target_name,
      sourceRecordId: row.source_record_id,
      sourceVarName: row.source_var_name,
      sourceLabel: row.source_label,
      dataAuthority: row.data_authority,
      derivationType: row.derivation_type,
      expressionSummary: row.ai_expression_summary,
      statcanNote: row.statcan_verbatim_note,
      ...(row.review_status === undefined ? {} : { reviewStatus: row.review_status }),
      ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
      depth: row.depth,
    }));
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

  async aboutProgress(signal?: AbortSignal): Promise<CorpusAboutProgress> {
    try {
      const [row] = await this.rpc<Array<{ verified_links: number; linked_programs: number }>>(
        'corpus_about_progress', {}, signal,
      );
      return {
        verifiedLinks: row?.verified_links ?? 0,
        linkedPrograms: row?.linked_programs ?? 0,
      };
    } catch (error) {
      // Keep the public About page useful while an older deployment is waiting for the small
      // progress RPC to be applied. The table is already readable to anon and the fallback is
      // paged, so it does not depend on the REST API's 1,000-row cap.
      if (signal?.aborted) throw error;
      return this.aboutProgressFromEdges(signal);
    }
  }

  private async aboutProgressFromEdges(signal?: AbortSignal): Promise<CorpusAboutProgress> {
    const pageSize = 1000;
    const programs = new Set<string>();
    let offset = 0;
    let total: number | null = null;
    let verifiedLinks = 0;

    while (total === null || offset < total) {
      const response = await this.fetchImpl(
        `${this.url}/rest/v1/corpus_derivation_edge?select=survey_group&review_status=eq.verified&order=edge_id.asc&limit=${pageSize}&offset=${offset}`,
        {
          headers: {
            apikey: this.anonKey,
            Authorization: `Bearer ${this.anonKey}`,
            Prefer: 'count=exact',
          },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`corpus_derivation_edge progress failed: ${response.status}` +
          `${detail === '' ? '' : ` — ${detail.slice(0, 300)}`}`);
      }
      const rows = await response.json() as Array<{ survey_group?: string | null }>;
      verifiedLinks += rows.length;
      for (const row of rows) {
        const group = row.survey_group?.trim();
        if (group) programs.add(group.split('_', 1)[0]!);
      }
      const contentRange = response.headers.get('content-range');
      const parsedTotal = contentRange?.match(/\/(\d+)$/)?.[1];
      if (parsedTotal !== undefined) total = Number(parsedTotal);
      if (rows.length < pageSize || rows.length === 0) break;
      offset += pageSize;
    }
    return { verifiedLinks: total ?? verifiedLinks, linkedPrograms: programs.size };
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

  /** Resolve the concept memberships of one visible search page. Unclustered records are omitted. */
  async clustersOf(recordIds: string[], signal?: AbortSignal): Promise<Map<string, string>> {
    if (recordIds.length === 0) return new Map();
    const rows = await this.rpc<Array<{
      record_id: string;
      conceptual_variable_id: string;
    }>>('corpus_cluster_of', { record_ids: recordIds }, signal);
    return new Map(rows.map((row) => [row.record_id, row.conceptual_variable_id]));
  }

  /** Load one conceptual variable by its stable ID so navigation does not depend on search filters. */
  async conceptualVariable(id: string, signal?: AbortSignal): Promise<CorpusConceptualVariable | null> {
    const params = new URLSearchParams({
      select: 'conceptual_variable_id,concept_id,label,universe,occurrences,surveys,representations,years,year_min,year_max',
      conceptual_variable_id: `eq.${id}`,
      limit: '1',
    });
    const response = await this.fetchImpl(`${this.url}/rest/v1/corpus_conceptual_variable?${params}`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`Concept lookup failed: ${response.status} ${response.statusText}`);
    const [row] = await response.json() as Array<{
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
    }>;
    return row === undefined ? null : {
      conceptualVariableId: row.conceptual_variable_id,
      conceptId: row.concept_id,
      label: row.label,
      universe: row.universe,
      occurrences: row.occurrences,
      surveys: row.surveys,
      representations: row.representations,
      years: row.years,
      yearMin: row.year_min,
      yearMax: row.year_max,
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

  /** Explicit cross-cycle suggestions, kept separate from exact concept membership. */
  async conceptContinuity(
    conceptualVariableId: string,
    signal?: AbortSignal,
  ): Promise<CorpusConceptContinuity[]> {
    const rows = await this.rpc<Array<{
      earlier_record_id: string;
      later_record_id: string;
      earlier_conceptual_variable_id: string;
      later_conceptual_variable_id: string;
      earlier_name: string;
      later_name: string;
      earlier_concept: string | null;
      later_concept: string | null;
      earlier_question_text: string | null;
      later_question_text: string | null;
      earlier_universe: string | null;
      later_universe: string | null;
      earlier_year: number | null;
      later_year: number | null;
      earlier_survey_acronym: string | null;
      later_survey_acronym: string | null;
      earlier_path: string;
      later_path: string;
      earlier_page: number;
      later_page: number;
      review_status: 'ai_suggested' | 'human_reviewed';
      suggested_by: string;
      reviewed_by: string | null;
      rationale: string;
      evidence: string;
    }>>('corpus_concept_continuity_for', { cv_id: conceptualVariableId }, signal);
    return rows.map((row) => ({
      earlierRecordId: row.earlier_record_id,
      laterRecordId: row.later_record_id,
      earlierConceptualVariableId: row.earlier_conceptual_variable_id,
      laterConceptualVariableId: row.later_conceptual_variable_id,
      earlierName: row.earlier_name,
      laterName: row.later_name,
      earlierConcept: row.earlier_concept,
      laterConcept: row.later_concept,
      earlierQuestionText: row.earlier_question_text,
      laterQuestionText: row.later_question_text,
      earlierUniverse: row.earlier_universe,
      laterUniverse: row.later_universe,
      earlierYear: row.earlier_year,
      laterYear: row.later_year,
      earlierSurveyAcronym: row.earlier_survey_acronym,
      laterSurveyAcronym: row.later_survey_acronym,
      earlierPath: row.earlier_path,
      laterPath: row.later_path,
      earlierPage: row.earlier_page,
      laterPage: row.later_page,
      reviewStatus: row.review_status,
      suggestedBy: row.suggested_by,
      reviewedBy: row.reviewed_by,
      rationale: row.rationale,
      evidence: row.evidence,
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

  /**
   * The subject facet.
   *
   * Subject is a property of a *survey*, not of a variable: a survey is about something, a
   * variable inside it need not be. So this joins through a mapping table of a few hundred rows
   * rather than reading a column on 194,507.
   */
  async subjects(signal?: AbortSignal): Promise<CorpusSubjectFacet[]> {
    const rows = await this.rpc<
      Array<{ subject: string; variables: number; surveys: number; confirmed: number }>
    >('corpus_subjects', {}, signal);
    return rows.map((r) => ({
      subject: r.subject,
      variables: r.variables,
      surveys: r.surveys,
      confirmed: r.confirmed,
    }));
  }

  /**
   * What the facet cannot reach.
   *
   * Fetched so the sidebar can say it out loud. A facet list that silently omits a third of the
   * corpus reads as a complete index of it, which would be the most misleading thing on the page.
   */
  async unclassified(signal?: AbortSignal): Promise<CorpusUnclassified> {
    const [row] = await this.rpc<
      Array<{ variables: number; surveys: number; total_variables: number; total_surveys: number }>
    >('corpus_unclassified', {}, signal);
    return {
      variables: row?.variables ?? 0,
      surveys: row?.surveys ?? 0,
      totalVariables: row?.total_variables ?? 0,
      totalSurveys: row?.total_surveys ?? 0,
    };
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

  /**
   * The most recent variables for a given subject.
   * Finds the surveys assigned to this subject with the latest year_max,
   * then fetches the top variables from those cycles.
   */
  async recentBySubject(subject: string, limit = 5, signal?: AbortSignal): Promise<SearchHit[]> {
    if (!subject) return [];
    try {
      const subUrl = `${this.url}/rest/v1/corpus_survey_subject?subject=eq.${encodeURIComponent(subject)}&select=survey_group`;
      const subRes = await this.fetchImpl(subUrl, {
        headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` },
        ...(signal ? { signal } : {}),
      });
      if (!subRes.ok) return [];
      const subRows = (await subRes.json()) as Array<{ survey_group: string }>;
      const groups = subRows.map((r) => r.survey_group);
      if (groups.length === 0) return [];

      const countsUrl = `${this.url}/rest/v1/corpus_survey_counts?survey_group=in.(${groups.join(',')})&order=year_max.desc.nullslast&limit=8`;
      const countsRes = await this.fetchImpl(countsUrl, {
        headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` },
        ...(signal ? { signal } : {}),
      });
      if (!countsRes.ok) return [];
      const counts = (await countsRes.json()) as Array<{ survey_group: string; year_max: number | null }>;
      if (counts.length === 0) return [];

      const topGroups = counts.map((c) => c.survey_group).slice(0, 4);

      const varsUrl = `${this.url}/rest/v1/corpus_variable?survey_group=in.(${topGroups.join(',')})&order=year.desc.nullslast,position.asc&limit=${limit * 5}`;
      const varsRes = await this.fetchImpl(varsUrl, {
        headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` },
        ...(signal ? { signal } : {}),
      });
      if (!varsRes.ok) return [];
      const vars = (await varsRes.json()) as CorpusSearchRow[];

      const filtered = vars.filter((v) => {
        const nm = v.name.toUpperCase();
        if (nm.endsWith('ID') || nm === 'VERDATE' || nm === 'PUMFID' || nm === 'SEQID' || nm === 'RECID') return false;
        if (v.tcode === 'T15.2' && !v.concept && !v.question_text) return false;
        return true;
      }).slice(0, limit);

      return filtered.map((row) => ({
        entry: toRegistryEntry(row),
        score: 1.0,
        matched: [],
      }));
    } catch {
      return [];
    }
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

/** A suggested relationship between two distinct conceptual-variable timelines. */
export interface CorpusConceptContinuity {
  earlierRecordId: string;
  laterRecordId: string;
  earlierConceptualVariableId: string;
  laterConceptualVariableId: string;
  earlierName: string;
  laterName: string;
  earlierConcept: string | null;
  laterConcept: string | null;
  earlierQuestionText: string | null;
  laterQuestionText: string | null;
  earlierUniverse: string | null;
  laterUniverse: string | null;
  earlierYear: number | null;
  laterYear: number | null;
  earlierSurveyAcronym: string | null;
  laterSurveyAcronym: string | null;
  earlierPath: string;
  laterPath: string;
  earlierPage: number;
  laterPage: number;
  reviewStatus: 'ai_suggested' | 'human_reviewed';
  suggestedBy: string;
  reviewedBy: string | null;
  rationale: string;
  evidence: string;
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
