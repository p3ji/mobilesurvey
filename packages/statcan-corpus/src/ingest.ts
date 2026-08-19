/**
 * The M1 ingest spine: walk the corpus delivery, classify every file, and extract text from the
 * selected document families, producing the committed report and the gitignored inventory
 * (docs/metadata-repo-plan.md §6, M1).
 *
 * ### Why this runs in two passes over the archive
 *
 * `forEachCorpusFile` is synchronous — it inflates one nested bundle at a time and hands the
 * callback a lazy `read()` — while `extractPdf` is asynchronous, because pdfjs is. A synchronous
 * callback cannot `await`, so extraction cannot happen *inside* the traversal. The three ways out
 * of that are: hold every selected payload in memory until the traversal ends (~1.8 GB of PDF for
 * the dictionary families — the exact thing the brief forbids); re-traverse the 2.4 GB archive for
 * every file (a full traversal costs tens of seconds, so ~1,200 of them is not a pipeline); or
 * **stage the selected payloads to disk during one traversal and extract from disk afterwards.**
 *
 * The third is what this module does, and it is not merely the least-bad option:
 *
 * - **Peak memory stays flat.** One inflated bundle plus one file's bytes, exactly as the zip
 *   reader was designed for. Extracted text is streamed to `onDoc` and can be released
 *   immediately (`retainDocs: false`), so a 1,200-document run never holds 1,200 documents.
 * - **Peak disk is the staged subset**, and each staged file is unlinked the moment it has been
 *   extracted, so the high-water mark falls monotonically through the extraction phase. The
 *   `maxStagingBytes` guard turns "filled the disk 40 minutes in" into an error before any work
 *   starts, naming the sampling flag that fixes it.
 * - Extraction is decoupled from the archive, which is what lets a run be interrupted and its
 *   cost be understood: the expensive phase is 3,000 pdfjs parses, not the zip.
 *
 * Pass 1 (classify) reads no payloads at all — `read()` is lazy, so the 3.19 GB of PDF is never
 * inflated by an inventory-only run. Pass 2 stages only the selection and aborts the traversal as
 * soon as the last selected file has been staged, so a `maxDocs: 5` smoke test finishes in seconds
 * rather than streaming six bundles it does not need.
 *
 * ### Robustness posture (D7)
 *
 * One unreadable file out of 3,006 must never abort a twenty-minute job. Every payload read and
 * every extraction is individually guarded; a failure becomes an `error` {@link FidelityNote}
 * naming the file, and the run continues. The report is therefore always complete: every file is
 * classified, and every file that could not be *read* says so in the same document.
 *
 * ### Determinism (D9)
 *
 * Traversal order is fixed by the zip reader, selection is a pure function of the classified file
 * list, sampling is hash-based rather than PRNG-based, and failure messages are scrubbed of the
 * staging path before they reach a note — so the same archive and the same options produce a
 * byte-identical report and inventory on any machine.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MOBILESURVEY_UUID_NAMESPACE, uuidV5 } from '@mobilesurvey/ddi-xml';
import { classifyFile } from './classify.js';
import { extractPdf, type ExtractOptions } from './pdf.js';
import { buildIngestReport, type DetailedIngestReport } from './report.js';
import type { CorpusFile, DocKind, ExtractedDoc, FidelityNote } from './types.js';
import { forEachCorpusFile } from './zip.js';

/* -------------------------------------------------------------------------------------------- *
 * Stable record identity (D9)
 * -------------------------------------------------------------------------------------------- */

/**
 * Namespace prefix for every internal id this package mints. Corpus ids share the project-wide
 * UUIDv5 namespace adopted for DDI URNs in Phase 15 P5 rather than inventing a second one, so a
 * corpus record can be addressed in the DDI/JSON-LD graph later without re-minting identity; the
 * prefix is what keeps corpus ids from ever colliding with an instrument's item ids.
 */
export const CORPUS_ID_PREFIX = 'statcan-corpus';

/**
 * Mint a UUIDv5 for a corpus internal id. This is exactly `itemUuid`'s scheme from
 * `@mobilesurvey/ddi-xml` (UUIDv5 of the internal id under {@link MOBILESURVEY_UUID_NAMESPACE}),
 * reused rather than reimplemented.
 */
export function corpusUuid(internalId: string): string {
  return uuidV5(internalId, MOBILESURVEY_UUID_NAMESPACE);
}

/**
 * `bundle/path` — the identity of a file in the corpus. Neither half is unique on its own, since
 * the seven nested bundles repeat folder structure.
 */
export function corpusFileKey(file: Pick<CorpusFile, 'bundle' | 'path'>): string {
  return `${file.bundle}/${file.path}`;
}

/** Stable id for one *source document*. Used to key extraction results to their file. */
export function documentRecordId(file: Pick<CorpusFile, 'bundle' | 'path'>): string {
  return corpusUuid(`${CORPUS_ID_PREFIX}:document:${corpusFileKey(file)}`);
}

/**
 * Stable id for one variable *occurrence* — `CorpusVariable.recordId`.
 *
 * The stable string is survey + file + variable name + position, exactly as D9 specifies. Position
 * is part of it because a dictionary can print the same variable name twice (a repeated block
 * across sections, or a name reused at two record positions), and an id that collapsed those would
 * silently drop one of two genuinely different facts. An absent position contributes an empty
 * component rather than being omitted, so `(A, no position)` and `(A, position "")` cannot alias
 * a different pair.
 *
 * M2 mints these for the records its parsers produce; M1 exports the function and proves it runs
 * over the real corpus at document granularity.
 */
export function variableRecordId(
  file: Pick<CorpusFile, 'bundle' | 'path' | 'surveyGroup'>,
  name: string,
  position?: string,
): string {
  return corpusUuid(
    `${CORPUS_ID_PREFIX}:variable:${file.surveyGroup}:${corpusFileKey(file)}:${name}:${position ?? ''}`,
  );
}

/* -------------------------------------------------------------------------------------------- *
 * Options
 * -------------------------------------------------------------------------------------------- */

/** What a run is about to do, reported once after classification and before any payload is read. */
export interface IngestPlan {
  /** Files seen in the archive. */
  files: number;
  /** Files matching the document-kind / T-code filters, whatever their format. */
  candidates: number;
  /** Candidates that are PDFs — the only format M1 can extract (`.doc`/`.docx`/`.xlsx` are M4). */
  extractable: number;
  /** Extractable candidates left after `sampleSize` / `maxDocs`. This is what will be staged. */
  selected: number;
  /** Uncompressed bytes of the selected files: the disk high-water mark of the staging phase. */
  selectedBytes: number;
  /** True when `selected` is a proper subset of `extractable` — the run must be labelled a sample. */
  sampled: boolean;
}

export interface IngestOptions {
  /**
   * Extract text from the selected documents. Off by default: an inventory pass reads no payloads
   * at all, which is what makes classifying 3,006 files cheap.
   */
  extractText?: boolean;
  /** Restrict extraction to these document kinds. Absent means every kind is a candidate. */
  limitDocKinds?: readonly DocKind[];
  /**
   * Restrict extraction to these normalized T-codes, matched as families: `'T15'` selects `T15`,
   * `T15.2`, `T15.6`, … but never `T1` or `T150`. Absent means every code, including files with
   * none.
   */
  limitTcodes?: readonly string[];
  /**
   * Hard cap on documents to extract, applied last, in traversal order. For smoke tests — the
   * resulting set is biased toward the first bundle, so never present it as a sample of the
   * corpus. Use {@link sampleSize} for that.
   */
  maxDocs?: number;
  /**
   * Take a representative subset of this many extractable candidates, spread across bundles,
   * surveys and decades. Selection is by hash of the file key, not by a PRNG, so it is uniform,
   * reproducible on any machine, and stable under re-runs (D9) — the same 150 files come back
   * every time.
   */
  sampleSize?: number;
  /** Salt for {@link sampleSize}. Changing it draws a different, equally reproducible sample. */
  sampleSeed?: string;
  /** Called after each document is extracted (or fails), with the count of selected documents. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Called during classification with the running file count. `onProgress` cannot serve this
   * phase: the total is unknown until the archive has been walked, and reporting a moving
   * denominator is worse than reporting none.
   */
  onScan?: (files: number) => void;
  /** Called once between classification and staging, with what the run is about to do. */
  onPlan?: (plan: IngestPlan) => void;
  /** Called during staging with the count of payloads written and the total to write. */
  onStage?: (staged: number, total: number) => void;
  /**
   * Called with each extracted document as it completes. Combined with `retainDocs: false` this is
   * how a full-corpus run streams gigabytes of text to disk without ever holding it in memory.
   */
  onDoc?: (doc: ExtractedDoc) => void;
  /**
   * Keep extracted documents in the returned `docs` array. Default true. Set false for large runs
   * and consume {@link onDoc} instead — 1,200 dictionaries of page text is hundreds of megabytes.
   */
  retainDocs?: boolean;
  /** Row-reconstruction parameters passed through to {@link extractPdf}. */
  extract?: ExtractOptions;
  /**
   * Directory for staged payloads. Defaults to a fresh temp directory that is removed when the run
   * ends. Supplying one keeps the staged bytes after the run, which is useful when iterating on
   * extraction without re-reading the 2.4 GB archive.
   */
  stagingDir?: string;
  /**
   * Refuse to start staging when the selection exceeds this many bytes. Guards against filling the
   * disk twenty minutes into a run; the error names the option that fixes it. Default 4 GiB.
   */
  maxStagingBytes?: number;
}

export interface IngestResult {
  /** Every file in the archive, classified, in traversal order. */
  files: CorpusFile[];
  /** The committed report: counts, coverage, and every fidelity note the run produced. */
  report: DetailedIngestReport;
  /** Extracted documents, in selection order. Empty when `retainDocs` is false. */
  docs: ExtractedDoc[];
}

/** Default ceiling on staged bytes: generous enough for the dictionary families, low enough to fail loudly. */
export const DEFAULT_MAX_STAGING_BYTES = 4 * 1024 * 1024 * 1024;

/** Default salt for hash sampling. Named rather than empty so a changed sample is a visible diff. */
export const DEFAULT_SAMPLE_SEED = 'statcan-corpus/m1';

/* -------------------------------------------------------------------------------------------- *
 * Selection
 * -------------------------------------------------------------------------------------------- */

/**
 * T-code family match: `'T15'` selects the whole `T15.*` family plus a bare `T15`, and nothing
 * else. Plain `startsWith` would let `'T1'` swallow `T15.2`, quietly turning a request for user
 * guides into a request for 1,400 dictionaries.
 */
function matchesTcodeFamily(tcode: string | undefined, families: readonly string[]): boolean {
  if (tcode === undefined) return false;
  return families.some((family) => tcode === family || tcode.startsWith(`${family}.`));
}

function isCandidate(file: CorpusFile, opts: IngestOptions): boolean {
  if (opts.limitDocKinds && !opts.limitDocKinds.includes(file.docKind)) return false;
  if (opts.limitTcodes && !matchesTcodeFamily(file.tcode, opts.limitTcodes)) return false;
  return true;
}

/**
 * FNV-1a, 32-bit. A hash, not a PRNG: sampling by `hash(seed + key)` is reproducible without
 * carrying state, is independent of traversal order, and spreads a survey's files across the
 * ordering instead of clustering them the way a "take the first N" cap does.
 */
function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Choose which extractable candidates to actually read.
 *
 * Sampling takes the `sampleSize` candidates with the lowest hash — a uniform draw over the
 * candidate set — and then restores traversal order, so the staging phase still runs the archive
 * front to back. `maxDocs` is applied afterwards, in traversal order, because it exists to make a
 * smoke test finish, not to be representative.
 */
function selectForExtraction(candidates: CorpusFile[], opts: IngestOptions): CorpusFile[] {
  let chosen = candidates;
  const { sampleSize } = opts;
  if (sampleSize !== undefined && sampleSize >= 0 && sampleSize < candidates.length) {
    const seed = opts.sampleSeed ?? DEFAULT_SAMPLE_SEED;
    const order = candidates.map((file, index) => ({
      file,
      index,
      hash: fnv1a32(`${seed} ${corpusFileKey(file)}`),
    }));
    // Tiebreak on the file key so two files that hash identically still sort deterministically.
    order.sort((a, b) => a.hash - b.hash || (corpusFileKey(a.file) < corpusFileKey(b.file) ? -1 : 1));
    chosen = order
      .slice(0, sampleSize)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.file);
  }
  if (opts.maxDocs !== undefined && opts.maxDocs >= 0 && opts.maxDocs < chosen.length) {
    chosen = chosen.slice(0, opts.maxDocs);
  }
  return chosen;
}

/* -------------------------------------------------------------------------------------------- *
 * Failure reporting
 * -------------------------------------------------------------------------------------------- */

const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\/)[^\s"'<>|]{4,}/g;

/**
 * Reduce a thrown value to one report-safe line.
 *
 * Two properties matter. The message must not carry a machine-specific or run-specific path — the
 * staging directory is a fresh temp dir on every run, so leaking it into a note would make the
 * committed report churn on every execution and destroy the diff (D9). And it must be bounded:
 * pdfjs can throw messages carrying a chunk of the offending file.
 */
function describeFailure(err: unknown, stagingDir: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split('\n')[0] ?? '';
  const staged = firstLine.split(stagingDir).join('<staged>').split(stagingDir.replace(/\\/g, '/')).join('<staged>');
  const scrubbed = staged.replace(ABSOLUTE_PATH_RE, '<path>').trim();
  const message = scrubbed.length > 0 ? scrubbed : 'threw a value with no message';
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

/* -------------------------------------------------------------------------------------------- *
 * Ingest
 * -------------------------------------------------------------------------------------------- */

/** Thrown to stop `forEachCorpusFile` early once the last selected payload has been staged. */
class StagingComplete extends Error {}

interface StagedFile {
  file: CorpusFile;
  stagedPath: string;
}

/**
 * Run one ingest over the corpus delivery.
 *
 * Classification always covers **every** file in the archive; extraction covers the subset the
 * options select. The returned report accounts for both — a file that was never selected for
 * extraction is still classified and counted, and a file that was selected but could not be read
 * carries an `error` note naming it.
 *
 * @param outerZipPath path to the corpus delivery (the outer zip-of-zips).
 */
export async function ingestCorpus(outerZipPath: string, opts: IngestOptions = {}): Promise<IngestResult> {
  const files: CorpusFile[] = [];
  const notes: FidelityNote[] = [];
  const docs: ExtractedDoc[] = [];
  const retainDocs = opts.retainDocs ?? true;

  // -- Pass 1: classify everything. No payload is read, so the 3.19 GB of PDF is never inflated.
  forEachCorpusFile(outerZipPath, (bundle, entry) => {
    files.push(classifyFile(bundle, entry.path, entry.sizeBytes));
    opts.onScan?.(files.length);
  });

  if (!opts.extractText) {
    return { files, report: buildIngestReport(files, notes, outerZipPath), docs };
  }

  // -- Plan: what is a candidate, what of that is reachable by the PDF path, what will be read.
  const candidates = files.filter((file) => isCandidate(file, opts));
  const extractable = candidates.filter((file) => file.ext === 'pdf');
  const selected = selectForExtraction(extractable, opts);
  const selectedBytes = selected.reduce((sum, file) => sum + file.sizeBytes, 0);

  // A candidate we cannot open is a coverage fact, not a non-event (D7): the dictionary families
  // include hundreds of `.doc`/`.docx` files whose content is real and simply out of M1's reach.
  for (const file of candidates) {
    if (file.ext === 'pdf') continue;
    notes.push({
      severity: 'info',
      file: corpusFileKey(file),
      message: `Selected as a ${file.docKind} but the .${file.ext || 'unknown'} format is deferred to M4; M1 extracts PDF only.`,
    });
  }

  opts.onPlan?.({
    files: files.length,
    candidates: candidates.length,
    extractable: extractable.length,
    selected: selected.length,
    selectedBytes,
    sampled: selected.length < extractable.length,
  });

  if (selected.length === 0) {
    return { files, report: buildIngestReport(files, notes, outerZipPath), docs };
  }

  const budget = opts.maxStagingBytes ?? DEFAULT_MAX_STAGING_BYTES;
  if (selectedBytes > budget) {
    throw new Error(
      `Ingest would stage ${selectedBytes} bytes, over the ${budget}-byte limit. Narrow the selection ` +
        `(limitDocKinds / limitTcodes), take a sample (sampleSize), or raise maxStagingBytes.`,
    );
  }

  const ownStaging = opts.stagingDir === undefined;
  const stagingDir = ownStaging
    ? mkdtempSync(path.join(tmpdir(), 'statcan-corpus-'))
    : (mkdirSync(opts.stagingDir as string, { recursive: true }), opts.stagingDir as string);

  try {
    // -- Pass 2: stage the selected payloads. One bundle inflated at a time, one file buffer live
    //    at a time, and the traversal aborts as soon as the last selection has been written.
    const wanted = new Map(selected.map((file) => [corpusFileKey(file), file]));
    const staged: StagedFile[] = [];
    try {
      forEachCorpusFile(outerZipPath, (bundle, entry, read) => {
        const key = `${bundle}/${entry.path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
        const file = wanted.get(key);
        if (file === undefined) return;
        wanted.delete(key);
        // Index-named, not path-named: corpus paths carry `/`, spaces and accents, and a staging
        // name derived from them would be a portability problem for no benefit.
        const stagedPath = path.join(stagingDir, `${staged.length.toString().padStart(5, '0')}.bin`);
        try {
          writeFileSync(stagedPath, read());
          staged.push({ file, stagedPath });
        } catch (err) {
          notes.push({
            severity: 'error',
            file: key,
            message: `Could not read the file out of the archive: ${describeFailure(err, stagingDir)}`,
          });
        }
        opts.onStage?.(staged.length, selected.length);
        if (wanted.size === 0) throw new StagingComplete();
      });
    } catch (err) {
      if (!(err instanceof StagingComplete)) throw err;
    }

    // Anything still wanted was never visited — the archive and the classification disagree, which
    // would otherwise vanish as a silently short extraction run.
    for (const key of wanted.keys()) {
      notes.push({
        severity: 'error',
        file: key,
        message: 'Selected for extraction but the file was not found on the staging pass of the archive.',
      });
    }

    // -- Extraction. Each staged payload is read, parsed, and unlinked before the next is opened,
    //    so the staging high-water mark falls monotonically from here.
    let done = 0;
    for (const entry of staged) {
      const key = corpusFileKey(entry.file);
      try {
        const buf = readFileSync(entry.stagedPath);
        const doc = await extractPdf(buf, entry.file, opts.extract ?? {});
        if (doc.pages.length === 0) {
          notes.push({
            severity: 'warning',
            file: key,
            message: 'Opened cleanly but contains no pages — nothing to extract.',
          });
        } else if (doc.likelyScanned) {
          notes.push({
            severity: 'warning',
            file: key,
            message:
              `Likely an image-only scan: ${doc.charCount} characters across ${doc.pages.length} ` +
              `page${doc.pages.length === 1 ? '' : 's'}. There is no OCR (plan §8), so this document contributes no records.`,
          });
        }
        opts.onDoc?.(doc);
        if (retainDocs) docs.push(doc);
      } catch (err) {
        // The whole point of the guard: one unreadable PDF out of 3,006 must not end the run.
        notes.push({
          severity: 'error',
          file: key,
          message: `PDF text extraction failed: ${describeFailure(err, stagingDir)}`,
        });
      } finally {
        rmSync(entry.stagedPath, { force: true });
        done += 1;
        opts.onProgress?.(done, staged.length);
      }
    }
  } finally {
    if (ownStaging) rmSync(stagingDir, { recursive: true, force: true });
  }

  return { files, report: buildIngestReport(files, notes, outerZipPath), docs };
}
