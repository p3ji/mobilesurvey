/**
 * The source document behind a record, so a citation can be *opened* rather than only read
 * (docs/metadata-repo-plan.md, M4).
 *
 * ### Why this exists
 *
 * A record cites `CCHS · 2015 · cchs_2015_f1_T15.6_v1.pdf · p. 176`, which identifies a document
 * and resolves to nothing. The dictionary around a variable carries context the variable's own
 * block does not — derivation notes, universe definitions, the appendices that explain a code —
 * and sometimes that is the only place it exists.
 *
 * Linking out to Statistics Canada was measured and rejected: **26 of 581 documents (4.5%)** carry
 * an SDDS survey number in their filename, and even those resolve to a survey landing page rather
 * than to the dictionary. For the other 95.5% there is no derivable public URL, so reaching the
 * source means serving it.
 *
 * ### The DDI construct
 *
 * A data dictionary is not a `pi:PhysicalInstance` — we hold the documentation, not the microdata
 * it documents. It is **`r:OtherMaterial`**: material related to a study, carrying an
 * `r:Citation` and an `r:ExternalURLReference`. {@link CorpusDocumentRow} is that, flattened to a
 * table.
 *
 * ### Where the bytes live
 *
 * Postgres keeps identity and citation only — 581 small rows. The reconstructed text goes to
 * Supabase **Storage**, which is a separate quota (1 GB) from the database's 500 MB, and would
 * otherwise be ~184 MB of text competing with the records themselves.
 *
 * Nothing here touches `corpus_variable`. The join is on `(bundle, path)`, which every search
 * result and timeline entry already carries, so linking documents costs the occurrence table no
 * schema change at all (D3).
 */
import type { CorpusFile, ExtractedDoc, DocKind, Lang } from './types.js';

/**
 * Pages per stored object.
 *
 * A document averages 183 pages but the corpus holds one of 3,567, and fetching all of it to show
 * the page a citation points at would move six megabytes to read one screen. Chunking bounds that
 * to roughly 180 KB regardless of document size, and the chunk containing page N is arithmetic —
 * no index to fetch first, and no index to keep in step with the objects.
 */
export const PAGES_PER_CHUNK = 100;

/** First page of the chunk holding `page`. Pages are 1-based, as they are printed. */
export function chunkStart(page: number): number {
  const safe = Math.max(1, Math.trunc(page));
  return Math.floor((safe - 1) / PAGES_PER_CHUNK) * PAGES_PER_CHUNK + 1;
}

/** Storage object key for one chunk. Grouped under the document so a document can be removed whole. */
export function chunkKey(documentId: string, page: number): string {
  return `${documentId}/${chunkStart(page)}.json`;
}

/** One stored chunk: the pages themselves, and enough identity to be self-describing if downloaded. */
export interface DocumentChunk {
  documentId: string;
  /** First page in this chunk, matching the object key. */
  from: number;
  pages: Array<{ page: number; text: string }>;
}

/**
 * `r:OtherMaterial` + `r:Citation`, flattened. Field names are the Postgres column names, for the
 * same reason {@link module:./project} uses them: the loader stays a straight upsert.
 */
export interface CorpusDocumentRow {
  document_id: string;
  bundle: string;
  path: string;
  /** The filename, which is the only title these documents carry. */
  title: string;
  survey_group: string;
  survey_acronym: string | null;
  cycle: string | null;
  year: number | null;
  lang: Lang;
  tcode: string | null;
  doc_kind: DocKind;
  pages: number;
  characters: number;
  /** Records loaded from this document — what makes it worth having fetched. */
  records: number;
  /**
   * Whether the reconstructed text was uploaded. False for a document whose row exists but whose
   * text failed to extract, so the UI can say "no text available" rather than 404 at the reader.
   */
  has_text: boolean;
}

/** Split an extracted document into the chunks that will be stored. */
export function toChunks(documentId: string, doc: ExtractedDoc): DocumentChunk[] {
  const byStart = new Map<number, DocumentChunk>();
  for (const page of doc.pages) {
    const from = chunkStart(page.pageNumber);
    let chunk = byStart.get(from);
    if (chunk === undefined) {
      chunk = { documentId, from, pages: [] };
      byStart.set(from, chunk);
    }
    chunk.pages.push({ page: page.pageNumber, text: page.text });
  }
  // Sorted so a re-run writes the same objects in the same order (D9).
  return [...byStart.values()].sort((a, b) => a.from - b.from);
}

/**
 * Project a document onto its row.
 *
 * `title` is the bare filename. These documents carry no title page we can rely on, and inventing
 * one from the survey and year would read as authoritative while being ours — the filename is at
 * least verifiably what Statistics Canada shipped.
 */
export function toDocumentRow(
  documentId: string,
  file: CorpusFile,
  doc: ExtractedDoc | undefined,
  records: number,
): CorpusDocumentRow {
  return {
    document_id: documentId,
    bundle: file.bundle,
    path: file.path,
    title: file.path.split('/').pop() ?? file.path,
    survey_group: file.surveyGroup,
    survey_acronym: file.surveyAcronym ?? null,
    cycle: file.cycle ?? null,
    year: file.year ?? null,
    lang: file.lang,
    tcode: file.tcode ?? null,
    doc_kind: file.docKind,
    pages: doc?.pages.length ?? 0,
    characters: doc?.charCount ?? 0,
    records,
    has_text: doc !== undefined && doc.pages.length > 0,
  };
}
