/**
 * PDF text extraction with **row reconstruction** (docs/metadata-repo-plan.md D2).
 *
 * StatCan data dictionaries are visual *tables*. A PDF stores no table structure — only glyph
 * runs at coordinates — so an extractor that emits text in content-stream order flattens each
 * cell onto its own line and destroys row association. Measured consequence on this corpus: code
 * lists silently mis-pair, `1 → "10,137"` (a frequency count read as a category label). That is a
 * data-integrity failure that survives every downstream check, because the output still *looks*
 * like a code list.
 *
 * `pdfjs-dist` exposes per-item geometry, so the original rows can be rebuilt: bucket text items
 * by baseline y, sort each bucket by x, emit buckets top-down. The dictionary row
 *
 *     99999995   Not applicable   0   0
 *
 * then survives intact as one line, with code / label / frequency / weighted still in column
 * order. That property is the entire reason pdfjs was chosen over PyMuPDF, and
 * `src/__tests__/pdf.test.ts` guards it against a real corpus file.
 *
 * Two tuning parameters govern correctness, and both are measured rather than guessed — see
 * {@link DEFAULT_Y_TOLERANCE} and {@link DEFAULT_CELL_GAP} for the evidence.
 */
import type { CorpusFile, ExtractedDoc, ExtractedPage } from './types.js';

/**
 * Baseline-y bucket width, in PDF points. Two text items are on the same row when their baselines
 * are within this distance of the row's anchor.
 *
 * **This is the correctness-determining parameter**, and it is a genuine trade-off: too coarse
 * merges adjacent rows (a code's label picks up the next code's frequency), too fine splits one
 * row in two (the label and the counts become separate records). The safe window is bounded below
 * by the largest baseline wobble *within* a real row and above by the smallest line pitch
 * *between* real rows.
 *
 * Measured over 47 dictionary PDFs sampled across seven T-code families, four filename spellings,
 * both languages and four decades (T15.2 / T15.3 / T15.4 / T15.6 / T15 / T3 / T1.1; 1,950 pages,
 * 286,619 text items). Row counts alone cannot settle this — a tolerance change moves them in both
 * directions and the count does not say which move was right — so each pair of adjacent baselines
 * is classified by whether its glyph runs **physically overlap in x**. Overlapping runs cannot be
 * one visual line (they would collide on the page), so a row containing one is a merge that is
 * definitely wrong, and counting such rows measures the ceiling directly:
 *
 * | yTolerance | rows | rows containing an x-collision |
 * |---|---|---|
 * | 0.4 – 3.0 | 73,579 → 73,003 | **4** |
 * | 4.0 – 6.5 | 72,868 → 72,712 | 12 |
 * | 7.0 – 7.5 | 72,680 | 14 |
 * | **8.0** | 72,176 | **270** |
 * | 10.0 | 71,595 | 956 |
 *
 * The 4 collisions on the whole 0.4–3.0 plateau are `®` superscripts set directly above the word
 * they annotate, and the 8 added at 4.0 are circumflexes over a formula — overlays, not merged
 * rows, so the plateau is clean. The cliff falls between 7.5 and 8.0, where the tightest genuine
 * line pitch in the sample (7.97 pt, a two-line page footer) starts being swallowed.
 *
 * The floor is set by the opposite failure. Dictionaries do *not* typeset a row on one exact
 * baseline: `CCHS_ESCC_RR_2012` offsets its `Variable Name` / `Length` / `Position` labels 0.09 pt
 * from their values, `ccahs_2021_f1_T15-4` splits a BMI cutpoint from the class it defines across
 * 0.75 pt, and `brm_2017_f1_T15.3` puts its data-type column ~2.4 pt off its row. Below 0.8 pt
 * real rows therefore shatter — which is why the tolerance exists at all.
 *
 * So the safe band is **[0.8, 7.5]** and **2.0 pt is the default**: 2.5× above the floor, 3.75×
 * below the ceiling, in the middle of the plateau where the collision count does not move. Both
 * cliffs are pinned to named corpus files in `src/__tests__/pdf.test.ts`, so the band is re-checked
 * rather than remembered.
 *
 * The value stayed a parameter rather than a constant because the corpus spans 1980–2026 and new
 * layout generators keep appearing; a file with 6 pt type would want it lowered.
 */
export const DEFAULT_Y_TOLERANCE = 2.0;

/**
 * Text inserted where a cell boundary is detected. **Three spaces, deliberately not one**:
 * downstream variant parsers split a reconstructed row into cells on runs of 2+ spaces, so a
 * single space would erase the very boundaries this module exists to preserve — a label
 * containing a space would be indistinguishable from two columns.
 */
export const DEFAULT_CELL_SEPARATOR = '   ';

/**
 * Horizontal gap, in PDF points, above which two adjacent items are treated as separate cells
 * rather than continuous text.
 *
 * Without this, joining *every* item in a row with {@link DEFAULT_CELL_SEPARATOR} would corrupt
 * any label that pdfjs happens to emit as more than one item — a mid-word font switch turns
 * `Not applicable` into two cells, which is the same class of silent error D2 is about.
 *
 * Measured over the same 47-file sample, grouping rows with the real {@link DEFAULT_Y_TOLERANCE}
 * so the pairs counted are the ones this code actually compares (213,419 adjacent pairs):
 *
 * | Adjacent-pair gap | Pairs |
 * |---|---|
 * | `< 1.0 pt` (continuous text — pdfjs split mid-run) | 184,879 (86.6%) |
 * | `1.0 – 2.5 pt` (the trough) | 149 (0.07%) |
 * | `≥ 2.5 pt` (real column jump) | 28,391 (13.3%) |
 *
 * The distribution is sharply bimodal and the trough is all but empty, so 2.5 pt separates the two
 * modes cleanly. Note how large the continuous-text bucket is: 87% of adjacent pairs are *not*
 * cell boundaries, so the naive "join everything with the separator" reading of the design would
 * have shredded the overwhelming majority of labels.
 *
 * The placement inside that trough is deliberately asymmetric, and only one side has slack.
 * Lowering the value to 1.0 would invent boundaries for just 149 pairs; raising it to 3.0 would
 * erase 832 real ones, because the column-jump mode *starts* at 2.5. So 2.5 is the last safe value
 * going up — treat it as a ceiling, not a midpoint, if a future layout forces a change.
 *
 * Whitespace-only items are kept rather than dropped, so a genuine inter-word space inside a cell
 * survives as itself and needs no separator.
 */
export const DEFAULT_CELL_GAP = 2.5;

/**
 * Characters-per-page floor below which a PDF is called an image-only scan. ~1% of the corpus is
 * scanned (2 of 174 sampled PDFs, both `T7`); there is no OCR (plan §8), so the right outcome is
 * a flagged document that the ingest report itemizes — never a silently empty parse.
 */
export const SCANNED_CHARS_PER_PAGE = 100;

export interface ExtractOptions {
  /** Baseline-y bucket width in PDF points. Default {@link DEFAULT_Y_TOLERANCE}. */
  yTolerance?: number;
  /** Text inserted at a detected cell boundary. Default {@link DEFAULT_CELL_SEPARATOR}. */
  cellSeparator?: string;
  /**
   * Horizontal gap in points that marks a cell boundary. Default {@link DEFAULT_CELL_GAP}.
   * Additive to the two parameters the design named; see {@link DEFAULT_CELL_GAP} for why row
   * reconstruction cannot be correct without it.
   */
  cellGap?: number;
}

/**
 * The shape {@link reconstructRows} needs from a text item — a structural subset of pdfjs's
 * `TextItem`, so real pdfjs output satisfies it and tests can fabricate items without a PDF.
 *
 * Coordinates are read as `transform[4]` = x (rightward) and `transform[5]` = y (**upward**, as in
 * PDF user space). {@link extractPdf} normalizes rotated pages into that frame before calling.
 */
export interface PdfTextItemLike {
  str: string;
  /** `[a, b, c, d, x, y]` — only the translation components are read. */
  transform: readonly number[];
  /** Advance width of the run, in the same units as x. Missing is treated as 0. */
  width?: number;
}

interface Glyph {
  /** Original index — the final sort tiebreak, so output is deterministic (D9). */
  i: number;
  str: string;
  x: number;
  y: number;
  w: number;
}

/**
 * Rebuild the visual rows of one page from its text items.
 *
 * Pure and PDF-free: bucket by baseline y, sort each bucket left-to-right, join with a cell
 * separator wherever a real horizontal gap appears, and emit buckets top-down.
 *
 * A row is anchored at the baseline of its topmost item and an item joins it when
 * `|y - anchor| <= yTolerance`. Anchoring on the first item rather than on a running mean matters:
 * a running mean drifts down a page of near-tolerance baselines and can swallow a row that never
 * came within tolerance of where the row started. The anchor also makes the grouping a pure
 * function of the sorted input, which is what makes a re-run byte-identical (D9).
 *
 * Blank rows are not emitted — a row with no glyphs has nothing to reconstruct. Vertical spacing
 * between rows is therefore *not* preserved; parsers key off the field labels the dictionaries
 * print (`Variable Name:`, `Position:`), not off blank-line block separation.
 */
export function reconstructRows(
  items: readonly PdfTextItemLike[],
  opts: ExtractOptions = {},
): string[] {
  const yTolerance = opts.yTolerance ?? DEFAULT_Y_TOLERANCE;
  const cellSeparator = opts.cellSeparator ?? DEFAULT_CELL_SEPARATOR;
  const cellGap = opts.cellGap ?? DEFAULT_CELL_GAP;

  const glyphs: Glyph[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (typeof item.str !== 'string' || item.str === '') continue;
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = item.width;
    glyphs.push({ i, str: item.str, x: x as number, y: y as number, w: Number.isFinite(w) ? (w as number) : 0 });
  }

  // Top-down, then left-to-right, then original order. Every comparison is total, so no two runs
  // can order equal items differently.
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x || a.i - b.i);

  const rows: Glyph[][] = [];
  let anchor = Number.NaN;
  let current: Glyph[] | undefined;
  for (const g of glyphs) {
    if (current === undefined || Math.abs(g.y - anchor) > yTolerance) {
      current = [g];
      anchor = g.y;
      rows.push(current);
    } else {
      current.push(g);
    }
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x || a.i - b.i);
    let text = '';
    let prev: Glyph | undefined;
    for (const g of row) {
      if (prev !== undefined && g.x - (prev.x + prev.w) >= cellGap) text += cellSeparator;
      text += g.str;
      prev = g;
    }
    const line = text.trim();
    if (line !== '') lines.push(line);
  }
  return lines;
}

/** pdfjs's public surface, narrowed to what this module uses. Avoids a hard type dependency. */
interface PdfjsModule {
  version: string;
  getDocument(src: Record<string, unknown>): PdfjsLoadingTask;
  Util: { transform(a: readonly number[], b: readonly number[]): number[] };
}
interface PdfjsLoadingTask {
  promise: Promise<PdfjsDocument>;
  /** Releases the fake worker and transport. `PDFDocumentProxy` itself has no `destroy` in v6. */
  destroy(): Promise<void>;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}
interface PdfjsPage {
  rotate: number;
  getViewport(params: { scale: number }): { transform: number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

let pdfjsPromise: Promise<PdfjsModule> | undefined;

/**
 * Load the pdfjs **legacy** build, once per process.
 *
 * Legacy rather than the modern build because the modern one assumes browser globals that Node
 * does not provide. The import is dynamic and cached so that consumers doing classification only
 * never pay pdfjs's load cost, and so a corpus-absent test run never touches it.
 */
async function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfjsModule>;
  return pdfjsPromise;
}

/**
 * Extract one PDF into page-by-page, row-reconstructed text.
 *
 * Text is kept per page rather than concatenated because every record extracted downstream must
 * cite the page it came from (D8) — provenance that specific is what makes an extraction error
 * fixable instead of merely reportable.
 *
 * Rotated pages are normalized through the page viewport, so a `/Rotate 90` landscape table is
 * read in the orientation a human sees rather than in raw user space. Text drawn at an arbitrary
 * angle is not handled — such items still fall into rows by their normalized baseline, which is
 * the best available reading and is preferable to dropping them silently.
 *
 * Throws only on a PDF pdfjs cannot open at all. That is a coverage fact for the ingest report to
 * record against the file (D7), so the caller owns the decision, not this function.
 */
export async function extractPdf(
  buf: Buffer,
  file: CorpusFile,
  opts: ExtractOptions = {},
): Promise<ExtractedDoc> {
  const pdfjs = await loadPdfjs();
  // `data` must be a fresh Uint8Array: pdfjs transfers ownership of the buffer it is handed.
  // Keep the loading task: in v6 `destroy()` lives on the task (it tears down the worker and
  // transport), NOT on the PDFDocumentProxy it resolves to.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
    // 0 = ERRORS. Thousands of files would otherwise bury a real failure under font warnings.
    verbosity: 0,
  });
  const doc = await task.promise;

  const pages: ExtractedPage[] = [];
  let charCount = 0;
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const rotated = ((page.rotate % 360) + 360) % 360 !== 0;
        const viewport = rotated ? page.getViewport({ scale: 1 }) : undefined;
        const items: PdfTextItemLike[] = [];
        for (const raw of content.items) {
          const item = raw as Partial<PdfTextItemLike>;
          if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue;
          if (viewport === undefined) {
            items.push(item as PdfTextItemLike);
            continue;
          }
          // Device space runs y-downward; negate so the shared reading frame stays y-upward.
          const t = pdfjs.Util.transform(viewport.transform, item.transform);
          items.push({ str: item.str, transform: [1, 0, 0, 1, t[4]!, -t[5]!], width: item.width ?? 0 });
        }
        const text = reconstructRows(items, opts).join('\n');
        charCount += text.length;
        pages.push({ pageNumber, text });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    // Thousands of documents per run — pdfjs holds page caches until the task is destroyed.
    await task.destroy();
  }

  return {
    file,
    pages,
    charCount,
    engine: `pdfjs-dist@${pdfjs.version}`,
    likelyScanned: pages.length > 0 && charCount / pages.length < SCANNED_CHARS_PER_PAGE,
  };
}
