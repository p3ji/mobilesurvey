/**
 * Tests for PDF text extraction with row reconstruction (`src/pdf.ts`).
 *
 * The suite is in two halves, and the split is deliberate.
 *
 * The first half is **pure**: it fabricates `PdfTextItemLike` objects — a `str`, a transform whose
 * translation components are the baseline coordinates, and an advance width — and never opens a
 * PDF. Every rule that decides whether a dictionary table survives extraction is a property of
 * that geometry alone, so it can be stated as an assertion about coordinates rather than as a
 * claim about a file. These run in milliseconds on a fresh clone.
 *
 * The second half is the **regression guard**, and it needs the real 2.4 GB delivery, so it skips
 * when the delivery is absent (same posture as `zip.test.ts` and `ddi-xml`'s external-import
 * suite). Its single most important assertion is that `99999995` and `Not applicable` come out on
 * the *same line*: that is the D2 correctness property — the entire reason pdfjs was chosen over a
 * reading-order extractor — reduced to one regex.
 *
 * ## Tolerance evidence
 *
 * `DEFAULT_Y_TOLERANCE` was re-measured for this suite rather than taken on faith, because the
 * figures the constant's docstring originally carried did not survive checking. Method: for 47
 * dictionary PDFs (1,950 pages, 286,619 text items) spanning seven T-code families, both
 * languages and four decades, every pair of adjacent baselines on a page was classified by whether
 * the two baselines' glyph runs **physically overlap in x**. Overlapping runs cannot be one visual
 * line — glyphs would collide — so merging them is definitely wrong, and the smallest such gap is
 * a hard ceiling on the tolerance. Running the real grouping at each candidate tolerance and
 * counting the rows that come out containing a collision gives the cliff directly:
 *
 * | yTolerance | rows | rows containing an x-collision | files affected |
 * |---|---|---|---|
 * | 0 | 77,231 | 0 | 0 |
 * | 0.4 – 3.0 | 73,579 → 73,003 | **4** | 4 |
 * | 4.0 – 6.5 | 72,868 → 72,712 | 12 | 5 |
 * | 7.0 – 7.5 | 72,680 | 14 | 6 |
 * | **8.0** | 72,176 | **270** | 13 |
 * | 10.0 | 71,595 | 956 | 29 |
 *
 * The 4 collisions present across the whole 0.4–3.0 plateau are `®` superscripts sitting directly
 * above the word they annotate (`FluMist ®`), and the 8 added at 4.0 are circumflex accents over a
 * formula — overlays, not merged rows, so the plateau is genuinely clean. The cliff is between 7.5
 * and 8.0, where the tightest real line pitch (7.97 pt, a two-line page footer) starts being
 * swallowed.
 *
 * The floor comes from the other direction: below 0.8 pt, rows *split*, because dictionaries do
 * not typeset a row on one exact baseline. Both cliffs are pinned to a named corpus file below, so
 * the band is checked rather than asserted:
 *
 * | | floor | default | ceiling |
 * |---|---|---|---|
 * | value | 0.8 pt | **2.0 pt** | 7.5 pt |
 * | evidence | `ccahs_2021_f1_T15-4_v1.pdf` splits a code row at ≤ 0.7 | — | 47-file collision sweep; `SDDS…LSIC…T15.2_eng.pdf` loses the guard row by 12.0 |
 *
 * 2.0 pt sits 2.5× above the floor and 3.75× below the ceiling, in the middle of the plateau on
 * which the collision count does not move at all. It is interior, not on an edge, so the value is
 * kept — only the reasoning behind it changed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reconstructRows,
  extractPdf,
  DEFAULT_Y_TOLERANCE,
  DEFAULT_CELL_SEPARATOR,
  DEFAULT_CELL_GAP,
  SCANNED_CHARS_PER_PAGE,
  type PdfTextItemLike,
} from '../pdf.js';
import { forEachCorpusFile } from '../zip.js';
import type { CorpusFile } from '../types.js';

// ---------------------------------------------------------------------------------------------
// Synthetic text items. `transform` is `[a, b, c, d, x, y]`; only the translation is read, and y
// runs *upward*, so a larger y is higher on the page.
// ---------------------------------------------------------------------------------------------

/** Roughly the advance of 7 pt monospaced type — enough that widths behave like real ones. */
const CHAR_W = 4;

function cell(str: string, x: number, y: number, width = str.length * CHAR_W): PdfTextItemLike {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

/** Split a reconstructed row the way the downstream variant parsers do. */
function cells(line: string): string[] {
  return line.split(/\s{2,}/);
}

describe('reconstructRows — grouping items into rows', () => {
  it('joins items that share a baseline into one row, ordered by ascending x', () => {
    // Fed in deliberately scrambled: reconstruction must depend on geometry, not input order.
    const rows = reconstructRows([
      cell('0', 300, 700, 4),
      cell('99999995', 100, 700),
      cell('0', 260, 700, 4),
      cell('Not applicable', 160, 700),
    ]);
    expect(rows).toEqual(['99999995   Not applicable   0   0']);
    expect(cells(rows[0]!)).toEqual(['99999995', 'Not applicable', '0', '0']);
  });

  it('emits differing baselines as separate rows, top-down', () => {
    const rows = reconstructRows([
      cell('7', 100, 660, 4),
      cell('1', 100, 700, 4),
      cell('5', 100, 680, 4),
    ]);
    expect(rows).toEqual(['1', '5', '7']);
  });

  it('reconstructs a code table as rows of cells, not a column of fragments', () => {
    const table: PdfTextItemLike[] = [];
    const codes = [
      ['1', 'Yes'],
      ['2', 'No'],
      ['5', 'Not applicable'],
    ];
    // Emitted column-major — the reading order that destroys row association.
    codes.forEach(([code], i) => table.push(cell(code!, 100, 700 - i * 12, 4)));
    codes.forEach(([, label], i) => table.push(cell(label!, 140, 700 - i * 12)));
    codes.forEach((_, i) => table.push(cell('0', 300, 700 - i * 12, 4)));

    expect(reconstructRows(table)).toEqual([
      '1   Yes   0',
      '2   No   0',
      '5   Not applicable   0',
    ]);
  });
});

describe('reconstructRows — cell boundaries', () => {
  it('separates cells with at least two spaces, which is what downstream splitting needs', () => {
    // The load-bearing property: parsers split on runs of 2+ spaces, so a one-space separator
    // would erase every boundary this module exists to preserve.
    expect(DEFAULT_CELL_SEPARATOR).toMatch(/^ {2,}$/);
    expect(DEFAULT_CELL_SEPARATOR.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a multi-word label in one cell, and column jumps in separate cells', () => {
    const [row] = reconstructRows([
      cell('99999995', 100, 700),
      cell('Not applicable', 160, 700),
      cell('10,137', 300, 700),
    ]);
    expect(cells(row!)).toEqual(['99999995', 'Not applicable', '10,137']);
  });

  it('would lose every boundary with a single-space separator (why the default is not one space)', () => {
    const items = [cell('99999995', 100, 700), cell('Not applicable', 160, 700), cell('0', 300, 700, 4)];
    const [good] = reconstructRows(items);
    const [bad] = reconstructRows(items, { cellSeparator: ' ' });
    expect(cells(good!)).toHaveLength(3);
    // Same geometry, same row, but the cell structure is gone: one undifferentiated string.
    expect(cells(bad!)).toEqual(['99999995 Not applicable 0']);
  });

  it('does not insert a separator when pdfjs splits continuous text mid-run', () => {
    // A mid-word font switch emits two items with no real gap. Treating that as a cell boundary
    // is the same class of silent error as merging rows.
    const [row] = reconstructRows([
      cell('Not ', 160, 700, 16),
      cell('applicable', 176, 700, 40), // butts directly against the previous run
    ]);
    expect(row).toBe('Not applicable');
    expect(cells(row!)).toEqual(['Not applicable']);
  });

  it('treats the cell gap as a lower bound: exactly cellGap separates, a hair less does not', () => {
    const at = reconstructRows([cell('a', 100, 700, 10), cell('b', 110 + DEFAULT_CELL_GAP, 700, 10)]);
    const under = reconstructRows([cell('a', 100, 700, 10), cell('b', 110 + DEFAULT_CELL_GAP - 0.01, 700, 10)]);
    expect(cells(at[0]!)).toEqual(['a', 'b']);
    expect(cells(under[0]!)).toEqual(['ab']);
  });

  it('honours an overridden cellGap', () => {
    const items = [cell('a', 100, 700, 10), cell('b', 112, 700, 10)]; // 2 pt gap, under the default
    expect(cells(reconstructRows(items)[0]!)).toEqual(['ab']);
    expect(cells(reconstructRows(items, { cellGap: 1 })[0]!)).toEqual(['a', 'b']);
  });
});

describe('reconstructRows — yTolerance', () => {
  /**
   * A dictionary row whose label and value sit 0.09 pt apart — the offset measured in
   * `CCHS_ESCC_RR_2012_f1_T15.6_v1.pdf`, where `Variable Name` / `Length` / `Position` are drawn
   * on a hair-different baseline from `VERDATE` / `8` / `18`.
   */
  const wobbly: PdfTextItemLike[] = [
    cell('Variable Name:', 100, 700.09),
    cell('LD3Q002', 180, 700),
    cell('Position:', 260, 700.09),
    cell('25', 320, 700, 8),
  ];

  it('groups a sub-point baseline wobble into one row at the default tolerance', () => {
    expect(reconstructRows(wobbly)).toEqual(['Variable Name:   LD3Q002   Position:   25']);
  });

  it('splits that same row when the tolerance is too fine', () => {
    // 0.05 pt cannot span a 0.09 pt wobble, so the row shatters into its two baselines and the
    // variable name is severed from its label.
    expect(reconstructRows(wobbly, { yTolerance: 0.05 })).toEqual([
      'Variable Name:   Position:',
      'LD3Q002   25',
    ]);
  });

  it('merges genuinely separate rows when the tolerance is too coarse', () => {
    // Two code rows of a frequency table, columns aligned as a real dictionary aligns them.
    const twoRows = [
      cell('1', 100, 700, 4),
      cell('Yes', 140, 700),
      cell('10,137', 300, 700),
      cell('2', 100, 688, 4),
      cell('No', 140, 688),
      cell('9,842', 300, 688),
    ];
    expect(reconstructRows(twoRows)).toEqual(['1   Yes   10,137', '2   No   9,842']);

    // A 12 pt line pitch is ordinary body-text leading; a tolerance that large swallows it. This
    // is the D2 failure mode in miniature — and note it does not produce visibly broken output,
    // it produces a plausible-looking row in which every column has fused with its neighbour
    // below. Downstream, code `12` acquires the label `YesNo` and the count `10,1379,842`.
    expect(reconstructRows(twoRows, { yTolerance: 12 })).toEqual(['12   YesNo   10,1379,842']);
  });

  it('treats the tolerance as inclusive — a gap exactly equal to it still joins', () => {
    const at = [cell('a', 100, 700), cell('b', 200, 700 - DEFAULT_Y_TOLERANCE)];
    const over = [cell('a', 100, 700), cell('b', 200, 700 - DEFAULT_Y_TOLERANCE - 0.01)];
    expect(reconstructRows(at)).toEqual(['a   b']);
    expect(reconstructRows(over)).toEqual(['a', 'b']);
  });

  it('anchors each row on its own first baseline, so near-tolerance rows cannot drift', () => {
    // Successive 1.5 pt steps under a 2.0 pt tolerance. A running-mean anchor would creep down the
    // page and swallow all four; anchoring on the row's topmost item stops after the second.
    const drifting = [
      cell('a', 100, 700),
      cell('b', 200, 698.5),
      cell('c', 300, 697),
      cell('d', 400, 695.5),
    ];
    expect(reconstructRows(drifting)).toEqual(['a   b', 'c   d']);
  });
});

describe('reconstructRows — edge cases', () => {
  it('returns no rows for an empty page', () => {
    expect(reconstructRows([])).toEqual([]);
  });

  it('returns one row for a single item', () => {
    expect(reconstructRows([cell('LD3Q002', 100, 700)])).toEqual(['LD3Q002']);
  });

  it('keeps items sharing an identical x, in their original order', () => {
    // Overprinted glyphs (accents, bold-by-double-strike). Neither may be dropped, and the order
    // must not depend on sort implementation.
    const rows = reconstructRows([cell('e', 100, 700, 4), cell('´', 100, 700, 0)]);
    expect(rows).toEqual(['e´']);
  });

  it('handles negative coordinates', () => {
    // Rotated pages are normalized through a viewport that can put the origin anywhere.
    expect(
      reconstructRows([
        cell('second', 100, -20),
        cell('first', 100, -8),
        cell('same-row', 200, -8),
      ]),
    ).toEqual(['first   same-row', 'second']);
  });

  it('drops empty strings but keeps whitespace-only items', () => {
    // A genuine inter-word space is text, not a boundary; dropping it would silently join words.
    expect(reconstructRows([cell('', 100, 700, 0), cell('a', 120, 700, 4), cell(' ', 124, 700, 4), cell('b', 128, 700, 4)])).toEqual(['a b']);
  });

  it('skips items whose geometry is unusable rather than placing them wrongly', () => {
    const rows = reconstructRows([
      cell('good', 100, 700),
      { str: 'nan', transform: [1, 0, 0, 1, Number.NaN, 700], width: 10 },
      { str: 'short', transform: [1, 0, 0, 1], width: 10 },
      { str: 'infinite', transform: [1, 0, 0, 1, 100, Number.POSITIVE_INFINITY], width: 10 },
    ]);
    expect(rows).toEqual(['good']);
  });

  it('treats a missing width as zero rather than as NaN', () => {
    // NaN in the gap arithmetic would make every comparison false and silently drop all separators.
    const [row] = reconstructRows([
      { str: 'a', transform: [1, 0, 0, 1, 100, 700] },
      { str: 'b', transform: [1, 0, 0, 1, 200, 700] },
    ]);
    expect(cells(row!)).toEqual(['a', 'b']);
  });

  it('emits no row for a line that is only whitespace', () => {
    expect(reconstructRows([cell('   ', 100, 700, 12), cell('x', 100, 680, 4)])).toEqual(['x']);
  });

  it('is deterministic across runs (D9)', () => {
    const items = [
      cell('b', 200, 700),
      cell('a', 100, 700),
      cell('d', 200, 688),
      cell('c', 100, 688),
    ];
    expect(reconstructRows(items)).toEqual(reconstructRows(items.slice()));
    // Same geometry presented in a different order still reconstructs identically.
    expect(reconstructRows(items)).toEqual(reconstructRows([...items].reverse()));
  });
});

// ---------------------------------------------------------------------------------------------
// The real delivery. Never committed (D1), so this block skips when it is absent.
// ---------------------------------------------------------------------------------------------

const CORPUS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'metadatarepo',
  'CRSB_ADHOC_CENTRAL_002_FromStatCan_DeStatCan20260818133553.zip',
);

/** The T15.2 dictionary whose `99999995 / Not applicable` row is the D2 regression guard. */
const GUARD_FILE = 'LSIC_ELIC/LSIC_ELIC_3/SDDS4422_LSIC_ELIC_C3_LD_T15.2_eng.pdf';
/** A T15.4 derived-variable spec that pins the *floor* of the safe tolerance band. */
const FLOOR_FILE = 'CCAHS_ECSAC_2021/ccahs_2021_f1_T15-4_v1.pdf';

function corpusFile(bundle: string, p: string, sizeBytes: number): CorpusFile {
  return {
    bundle,
    path: p,
    sizeBytes,
    ext: 'pdf',
    tcode: undefined,
    docKind: 'data-dictionary',
    surveyGroup: p.slice(0, p.indexOf('/')),
    surveyAcronym: undefined,
    cycle: undefined,
    year: undefined,
    lang: 'en',
  };
}

describe.skipIf(!existsSync(CORPUS))('real corpus delivery (on-demand, 2.4 GB, not committed)', () => {
  const wanted = new Map<string, { file: CorpusFile; buf: Buffer } | undefined>([
    [GUARD_FILE, undefined],
    [FLOOR_FILE, undefined],
  ]);

  // One traversal for the whole block: the outer archive is 2.4 GB and each nested bundle has to
  // be inflated to be read, so paying that twice would be the dominant cost of the suite.
  beforeAll(() => {
    forEachCorpusFile(CORPUS, (bundle, entry, read) => {
      if (!wanted.has(entry.path) || wanted.get(entry.path) !== undefined) return;
      wanted.set(entry.path, { file: corpusFile(bundle, entry.path, entry.sizeBytes), buf: read() });
    });
  }, 600_000);

  function load(p: string): { file: CorpusFile; buf: Buffer } {
    const hit = wanted.get(p);
    if (hit === undefined) throw new Error(`${p}: not found in the corpus delivery`);
    return hit;
  }

  it('reconstructs a T15.2 code row with its code and label on the SAME line', async () => {
    const { file, buf } = load(GUARD_FILE);
    const doc = await extractPdf(buf, file);
    const lines = doc.pages.flatMap((p) => p.text.split('\n'));

    // THE regression guard for the whole extraction design. A reading-order extractor emits
    // `99999995` and `Not applicable` on separate lines, and the frequency columns then pair with
    // the wrong codes — silently, because the output still looks like a code list.
    const guarded = lines.filter((l) => /99999995\s+Not applicable/.test(l));
    expect(guarded.length).toBeGreaterThan(0);

    // ...and the numeric columns stay in order behind the label, which is what makes the row
    // parseable rather than merely readable.
    expect(guarded[0]).toMatch(/^99999995\s{2,}Not applicable\s{2,}0\s{2,}0$/);

    // The neighbouring codes come through as their own rows, not folded into this one.
    expect(lines.some((l) => /^99999996\s{2,}Valid skip\b/.test(l))).toBe(true);
    expect(lines.some((l) => /^99999999\s{2,}Not stated\b/.test(l))).toBe(true);

    // The T15.2 field labels the parsers key off survive with their values attached.
    expect(lines.some((l) => /^Variable Name:\s{2,}LD3Q002\s{2,}Position:\s{2,}25\s{2,}Length:\s{2,}1$/.test(l))).toBe(true);
  }, 120_000);

  it('reports a sane page count and does not flag a text PDF as scanned', async () => {
    const { file, buf } = load(GUARD_FILE);
    const doc = await extractPdf(buf, file);

    expect(doc.pages).toHaveLength(10);
    expect(doc.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(doc.pages.every((p) => p.text.length > 0)).toBe(true);
    expect(doc.file).toBe(file);
    expect(doc.engine).toMatch(/^pdfjs-dist@\d+\.\d+\.\d+$/);

    expect(doc.charCount).toBe(doc.pages.reduce((n, p) => n + p.text.length, 0));
    expect(doc.charCount / doc.pages.length).toBeGreaterThan(SCANNED_CHARS_PER_PAGE);
    expect(doc.likelyScanned).toBe(false);
  }, 120_000);

  it('extracts byte-identically on a re-run (D9)', async () => {
    const { file, buf } = load(GUARD_FILE);
    const [a, b] = await Promise.all([extractPdf(buf, file), extractPdf(buf, file)]);
    expect(a.pages).toEqual(b.pages);
  }, 120_000);

  it('holds the guard row across the whole safe tolerance band, and loses it past the ceiling', async () => {
    const { file, buf } = load(GUARD_FILE);
    const rowsAt = async (yTolerance: number) =>
      (await extractPdf(buf, file, { yTolerance })).pages.flatMap((p) => p.text.split('\n'));
    const guardCount = (lines: string[]) => lines.filter((l) => /99999995\s+Not applicable/.test(l)).length;
    const codeRows = (lines: string[]) => lines.filter((l) => /^-?\d{1,9}\s{2,}\S/.test(l)).length;

    const floor = await rowsAt(0.8);
    const dflt = await rowsAt(DEFAULT_Y_TOLERANCE);
    const ceiling = await rowsAt(7.5);
    const past = await rowsAt(12);

    // Flat across [0.8, 7.5]: the default is on a plateau, not on an edge.
    expect(guardCount(floor)).toBe(2);
    expect(guardCount(dflt)).toBe(2);
    expect(guardCount(ceiling)).toBe(2);
    expect(dflt).toEqual(floor);
    expect(dflt).toEqual(ceiling);
    expect(codeRows(dflt)).toBe(168);

    // Past the ceiling the table collapses: adjacent code rows merge, and the guard row — code,
    // label and both counts — stops existing as a line.
    expect(guardCount(past)).toBe(0);
    expect(past.length).toBeLessThan(dflt.length * 0.7);
    expect(codeRows(past)).toBeLessThan(codeRows(dflt) * 0.6);
  }, 300_000);

  it('splits a real dictionary row below the tolerance floor', async () => {
    // The other cliff. `ccahs_2021_f1_T15-4_v1.pdf` typesets this row across two baselines 0.75 pt
    // apart, so any tolerance under that severs the BMI cutpoint from the class it defines — the
    // failure mode that a "just use zero, baselines are exact" tolerance would ship.
    const { file, buf } = load(FLOOR_FILE);
    const rowsAt = async (yTolerance: number) =>
      (await extractPdf(buf, file, { yTolerance })).pages.flatMap((p) => p.text.split('\n'));

    const tooFine = await rowsAt(0.5);
    expect(tooFine.some((l) => /^6\s+HWTDBMI >= 40\.00$/.test(l))).toBe(true);
    expect(tooFine.some((l) => /HWTDBMI >= 40\.00\s+Obese/.test(l))).toBe(false);

    // `\s+` rather than `\s{2,}`: this T15.4 spec sets its columns closer together than
    // DEFAULT_CELL_GAP, so the cells legitimately join with a single space. Row *association* is
    // what the floor governs, and that is what is asserted here.
    for (const yTolerance of [0.8, DEFAULT_Y_TOLERANCE]) {
      const rows = await rowsAt(yTolerance);
      expect(rows.some((l) => /^6\s+HWTDBMI >= 40\.00\s+Obese – Class III$/.test(l))).toBe(true);
      expect(rows.some((l) => /^6\s+HWTDBMI >= 40\.00$/.test(l))).toBe(false);
    }
  }, 300_000);
});
