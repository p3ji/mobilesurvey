/**
 * Core model for the Statistics Canada RDC documentation corpus (docs/metadata-repo-plan.md).
 *
 * The corpus is 3,006 documentation files across 318 survey groups and four decades, delivered
 * as nested zips that never enter git (D1). Everything downstream — classification, PDF text
 * extraction, the per-variant dictionary parsers, EN/FR pairing, concept clustering — hangs off
 * the types in this file, so they are deliberately narrow and additive.
 *
 * Two shaping rules from the plan govern the whole model:
 *
 * - **D3, occurrences vs. concepts.** A `CorpusVariable` is an *occurrence*: what one document
 *   literally said about one variable, in one language, in one cycle. It is an immutable
 *   extracted fact. Concepts ("the same question across 20 years") are our *inference* and live
 *   in a separate entity added in M3, so that improving the clustering can never rewrite the
 *   facts it clusters.
 * - **D6, RegistryEntry compatibility.** These records are designed to project cleanly onto
 *   `@mobilesurvey/metadata-registry`'s existing `RegistryEntry` (`componentType`, `ddi`,
 *   `registry.provenance`, `searchText`) so the designer's Library panel can insert a StatCan
 *   question with no changes to the designer. That projection is written in M3; this package
 *   deliberately does *not* import the registry types, because the registry is browser-safe and
 *   this package is Node-only (D2) — the dependency must never run in that direction.
 */

/**
 * What a document *is*, derived from the StatCan `T##.#` document-type code in its filename.
 *
 * The T-code turned out to be the whole key to machine-processing this corpus: it separates the
 * ~1,200 files carrying structured variable definitions from the ~1,800 that do not, before a
 * single page of PDF is opened. Classifying on the semantic kind rather than the raw code means
 * the parsers dispatch on intent (`data-dictionary`) while the code (`T15.2` vs `T15.6`) selects
 * the layout variant — the two vary independently, and new variants keep appearing.
 *
 * `reference` is a real classification (methodology papers, reference material — out of scope for
 * v1 but knowingly so); `unknown` means the classifier could not decide, and such files are
 * itemized in the ingest report rather than dropped (D7).
 */
export type DocKind =
  | 'data-dictionary'
  | 'record-layout'
  | 'alphabetic-index'
  | 'topical-index'
  | 'user-guide'
  | 'reference'
  | 'unknown';

/**
 * Document language. The corpus is bilingual throughout, with EN and FR shipped as *separate*
 * documents rather than a language column inside one file (D4), so language is a property of the
 * file and of every record extracted from it. It is also load-bearing downstream: Postgres FTS
 * needs the right text-search configuration per record (french vs english stemming) to rank
 * sensibly, and guessing wrong is worse than admitting `'unknown'`.
 */
export type Lang = 'en' | 'fr' | 'unknown';

/**
 * One file in the corpus, after classification and before any text is read.
 *
 * This is the unit the inventory pass produces: enough to decide whether a file is worth opening,
 * to plan the extraction run, and to answer "is every one of the 3,006 files accounted for?"
 * (M1's acceptance bar). The identity of a file is `bundle` + `path` — neither alone is unique,
 * since the seven nested zips repeat folder structure.
 *
 * The derived fields are typed as explicitly-`undefined`-able *required* properties rather than
 * optional ones on purpose: the classifier must reach a verdict on every field for every file,
 * even when that verdict is "not determinable from the filename". An absent property would let a
 * classifier path silently forget to look.
 */
export interface CorpusFile {
  /** Which nested zip this came from, e.g. `RDC Nonconfidential Documentation 3.zip`. */
  bundle: string;
  /** Path within that nested zip, e.g. `CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T3_v1.pdf`. */
  path: string;
  sizeBytes: number;
  /** Lower-cased extension without the dot (`pdf`, `docx`, `xlsx`). Drives which extractor runs. */
  ext: string;
  /**
   * Normalized document-type code, e.g. `T15.2`. Source filenames spell the same code four ways
   * (`_T15.2_`, `_T15_2_`, `_t15-2_`, ` T24 `), so the raw spelling is normalized here once and
   * every consumer can compare it as a plain string. `undefined` when no code is present.
   */
  tcode: string | undefined;
  /** Semantic classification derived from `tcode`. Never absent — see {@link DocKind}. */
  docKind: DocKind;
  /** Top-level folder inside the bundle, e.g. `CCHS_ESCC`. The survey/dataset grouping. */
  surveyGroup: string;
  /**
   * English acronym parsed out of the group. 297 of 318 groups use StatCan's `EN_FR` pairing
   * (`CCHS_ESCC` → `CCHS`, `APS_EAPA` → `APS`), which is also the highest-confidence EN/FR
   * pairing signal (D4). `undefined` when the folder does not follow the convention — that is
   * information, not a failure, so it is preserved rather than defaulted to `surveyGroup`.
   */
  surveyAcronym: string | undefined;
  /**
   * Collection cycle as the corpus labels it — `C1.1`, `2011_2012`, `Wave3`. Left as the source
   * string rather than parsed into a range: cycle labels are how StatCan users refer to these
   * files, so normalizing them away would lose the identifier a citation needs.
   */
  cycle: string | undefined;
  /** Reference year, when a single one is determinable (span 1980–2026). Drives the timeline view. */
  year: number | undefined;
  lang: Lang;
}

/**
 * Text of one page, kept page-by-page rather than concatenated because every extracted record
 * must cite the page it came from (D8) — provenance that specific is what makes an extraction
 * error fixable instead of merely reportable.
 */
export interface ExtractedPage {
  /** 1-based, matching what a reader sees in a PDF viewer. */
  pageNumber: number;
  /**
   * Row-reconstructed text: pdfjs text items grouped into lines by y-coordinate and sorted by x,
   * so a dictionary table's code / label / frequency / weighted columns survive as one line. This
   * is the reason pdfjs was chosen over PyMuPDF (D2) — flat reading order silently mis-associates
   * code labels with frequency counts.
   */
  text: string;
}

/**
 * A whole document's extracted text plus the evidence needed to judge whether the extraction can
 * be trusted. The parsers consume `pages`; the fidelity harness consumes the rest.
 */
export interface ExtractedDoc {
  file: CorpusFile;
  pages: ExtractedPage[];
  /** Total characters across pages. The cheap, engine-agnostic signal for "did anything come out?". */
  charCount: number;
  /**
   * Which extractor produced this, including version (e.g. `pdfjs-dist@6.1.200`). Recorded per
   * document because the plan keeps a second engine as an independent cross-check: where two
   * engines disagree on a file, that file is flagged for review, which catches errors neither
   * engine reports on its own.
   */
  engine: string;
  /**
   * Set when the character yield is far too low for the page count — an image-only scan. ~1% of
   * the corpus (2 of 174 sampled PDFs, both `T7`). There is no OCR (§8 non-goals), so the correct
   * outcome is an itemized entry in the ingest report, never a silently empty parse.
   */
  likelyScanned: boolean;
}

/**
 * One row of a variable's code table: the response category as the document printed it.
 *
 * `frequency`/`weighted` are captured rather than discarded for two reasons. First, they are the
 * column-order trap that decides parser correctness — T15.6 puts the label *before* the code and
 * interleaves the counts, so a parser that ignores the numeric columns happily reads
 * `1 → "10,137"` and produces confidently wrong data; modelling them forces each variant parser
 * to state where they are. Second, these counts are rounded precisely so they can leave the RDC,
 * and they are genuinely useful — a designer can see which categories actually get used.
 */
export interface CodeEntry {
  code: string;
  label: string;
  /** Unweighted respondent count, when the dictionary prints one. */
  frequency?: number;
  /** Population-weighted estimate, when the dictionary prints one. */
  weighted?: number;
}

/**
 * Provenance for a single extracted record, denormalized onto the record itself.
 *
 * The duplication with {@link CorpusFile} is deliberate. Every record must be able to cite its
 * own source with no join (D8): a designer reusing wording needs the citation, the StatCan Open
 * Licence *requires* attribution naming the source document and reference date, and an
 * extraction error is only fixable if it points at a file and a page. Records also travel alone —
 * one JSONL line, one Postgres row, one search hit rendered in a provenance panel — so a
 * self-contained source block is the shape that survives every hop.
 */
export interface CorpusSource {
  bundle: string;
  path: string;
  /** 1-based page the variable block was found on. */
  page: number;
  tcode: string | undefined;
  docKind: DocKind;
  surveyGroup: string;
  surveyAcronym?: string;
  cycle?: string;
  year?: number;
  lang: Lang;
}

/**
 * ONE OCCURRENCE of a variable — what a single document said, in a single language, about a
 * single variable in a single cycle (D3). Roughly 177,000 of these across the corpus.
 *
 * This is an extracted *fact*, not an interpretation: fields are populated only when the document
 * states them, nothing is inferred across files, and nothing is deduplicated. Grouping
 * occurrences into concepts, and pairing an EN occurrence with its FR twin, are separate inferred
 * relations added in M3 — keeping them out of this interface is what lets clustering improve
 * without ever rewriting what the documents literally said.
 *
 * The field set is the union of the two dominant dictionary layouts (T15.2's `Position` /
 * `Length` / `Collection Name`, T15.6's `Question Name` / `Concept` / `Question` / `Universe` /
 * `Note`), so a variant parser fills what its layout provides and leaves the rest absent. Absence
 * therefore means "this document did not say", never "we failed to read it" — failures go to the
 * ingest report instead (D7).
 */
export interface CorpusVariable {
  /**
   * Stable UUIDv5 minted from a stable string (survey + file + variable name + position), the
   * same identity scheme adopted for DDI URNs in Phase 15 P5. Stability is what makes the ingest
   * re-runnable and reviewable as a diff (D9), and it lets a corpus record be addressed in the
   * DDI/JSON-LD graph later without re-minting identity.
   *
   * Minting reuses `uuidV5` from `@mobilesurvey/ddi-xml` — do not reimplement it. This package
   * only declares that the value *is* a UUIDv5; the integration step wires the minting.
   */
  recordId: string;
  /** Variable name as printed, e.g. `LD3Q005`. The primary handle users search and cite by. */
  name: string;
  /** Start position in the output record, as a string — dictionaries print it, we do not compute it. */
  position?: string;
  /** Field length in characters, as printed. */
  length?: string;
  /** T15.2's `Collection Name:` — the questionnaire-side name, distinct from the output variable. */
  collectionName?: string;
  /** T15.6's `Concept` — a short subject label. A grouping signal for M3, not yet a concept id. */
  concept?: string;
  /** The question wording itself. The single most valuable field in the corpus for reuse. */
  questionText?: string;
  /** Who was asked (T15.6 `Universe`, T15.2 `Coverage:`) — the wording is misleading without it. */
  universe?: string;
  /** Free-text notes: derivation rules, comparability caveats, cycle-specific changes. */
  note?: string;
  /** Response categories; empty when the document prints none (a real minority of variables). */
  codes: CodeEntry[];
  source: CorpusSource;
}

/**
 * How badly something went. `error` has no counterpart in the DDI codec's note severities
 * (`info | warning | approximation`) because this pipeline has a failure mode the codec does not:
 * a file it cannot read at all. That is a coverage fact worth surfacing loudly, and distinct from
 * a file that read fine but parsed imperfectly.
 */
export type FidelitySeverity = 'info' | 'warning' | 'error';

/**
 * One thing the pipeline could not do cleanly, attributed to the file that caused it.
 *
 * Same posture as the DDI importer's fidelity report, which earned its keep on the Colectica
 * files: nothing is ever silently dropped (D7). Because the report is committed while the corpus
 * is not, these notes are the only reviewable evidence of ingest quality in git — a parser change
 * then shows up as a measurable delta in a diff rather than as a claim.
 */
export interface FidelityNote {
  severity: FidelitySeverity;
  /** `bundle/path` of the offending file, so a reader can find it without consulting an index. */
  file: string;
  message: string;
}

/**
 * The committed summary of one ingest run: what went in, what was classified as what, and
 * everything that did not go cleanly.
 *
 * The counters are the M1 acceptance instrument — "every one of the 3,006 files is classified or
 * explicitly listed as unclassified" is checkable from `files`, `classified`, and `notes` alone.
 * The report carries no timestamps and no machine-specific paths by design: the same input zip
 * must produce a byte-identical report (D9), or its diffs stop meaning anything.
 */
export interface IngestReport {
  /** The source zip this run read, as a bare filename — deliberately not an absolute path. */
  generatedFrom: string;
  /** Files seen across all nested bundles. */
  files: number;
  /** Files that received a `docKind` other than `'unknown'`. The rest are itemized in `notes`. */
  classified: number;
  /** Counts keyed by {@link DocKind}. A plain record so a new kind cannot break the report shape. */
  byDocKind: Record<string, number>;
  /** Counts keyed by normalized T-code (`T15.2`, `T1.1`, …). Reveals variants we have not modelled. */
  byTcode: Record<string, number>;
  notes: FidelityNote[];
}
