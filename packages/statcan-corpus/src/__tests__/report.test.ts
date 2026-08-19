/**
 * Reporting tests. Pure — no corpus zip is required, and none of these skip.
 *
 * The determinism block is the one that earns its keep. D9 (byte-identical artifacts for identical
 * input) is only meaningful if *no* ordering leaks in from the input array, so the real assertion
 * is not "rendering twice matches" — it is "rendering a shuffled copy matches". A missing tiebreak
 * in any comparator, or a `Record` whose key order comes from insertion, fails that and passes the
 * naive version.
 */
import { describe, it, expect } from 'vitest';
import type { CorpusFile, FidelityNote, IngestReport } from '../types.js';
import { buildIngestReport, renderInventoryJsonl, renderReportMarkdown } from '../report.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BUNDLE_3 = 'RDC Nonconfidential Documentation 3.zip';
const BUNDLE_5 = 'RDC Nonconfidential Documentation 5.zip';

function file(overrides: Partial<CorpusFile> & Pick<CorpusFile, 'path'>): CorpusFile {
  return {
    bundle: BUNDLE_3,
    sizeBytes: 1_000,
    ext: 'pdf',
    tcode: 'T15.2',
    docKind: 'data-dictionary',
    surveyGroup: 'CCHS_ESCC',
    surveyAcronym: 'CCHS',
    cycle: '2011_2012',
    year: 2011,
    lang: 'en',
    ...overrides,
  };
}

/**
 * Deliberately lopsided: one dominant survey group, several kinds, a French half, files with no
 * year, an extension the PDF path cannot read, and two flavours of unclassified (no code at all,
 * and a code we recognize but have not mapped).
 */
const files: CorpusFile[] = [
  // CCHS_ESCC — the dominant group, both languages, two cycles.
  file({ path: 'CCHS_ESCC/2011_2012/CCHS_2011_2012_T15.2_v1.pdf', sizeBytes: 4_000_000 }),
  file({ path: 'CCHS_ESCC/2011_2012/ESCC_2011_2012_T15.2_v1.pdf', lang: 'fr', sizeBytes: 4_100_000 }),
  file({ path: 'CCHS_ESCC/2011_2012/CCHS_2011_2012_T3_v1.pdf', tcode: 'T3', docKind: 'record-layout', sizeBytes: 120_000 }),
  file({
    path: 'CCHS_ESCC/2013/CCHS_2013_T15.6_v1.pdf',
    tcode: 'T15.6',
    cycle: '2013',
    year: 2013,
    sizeBytes: 6_500_000,
  }),
  file({
    path: 'CCHS_ESCC/2013/ESCC_2013_T15.6_v1.pdf',
    tcode: 'T15.6',
    cycle: '2013',
    year: 2013,
    lang: 'fr',
    sizeBytes: 6_400_000,
  }),
  file({
    path: 'CCHS_ESCC/2013/CCHS_2013_T1.1_userguide.pdf',
    tcode: 'T1.1',
    docKind: 'user-guide',
    cycle: '2013',
    year: 2013,
    sizeBytes: 800_000,
  }),
  file({
    path: 'CCHS_ESCC/2024/CCHS_2024_T11.1_index.pdf',
    tcode: 'T11.1',
    docKind: 'alphabetic-index',
    cycle: '2024',
    year: 2024,
    sizeBytes: 200_000,
  }),

  // LSIC_ELIC — a second group, in another bundle, with an xlsx and a year-less file.
  file({
    bundle: BUNDLE_5,
    path: 'LSIC_ELIC/Wave3/LSIC_W3_T15.2_v2.pdf',
    surveyGroup: 'LSIC_ELIC',
    surveyAcronym: 'LSIC',
    cycle: 'Wave3',
    year: 2005,
    sizeBytes: 2_200_000,
  }),
  file({
    bundle: BUNDLE_5,
    path: 'LSIC_ELIC/Wave3/ELIC_W3_T15.2_v2.pdf',
    surveyGroup: 'LSIC_ELIC',
    surveyAcronym: 'LSIC',
    cycle: 'Wave3',
    year: 2005,
    lang: 'fr',
    sizeBytes: 2_250_000,
  }),
  file({
    bundle: BUNDLE_5,
    path: 'LSIC_ELIC/Wave3/LSIC_W3_T3_layout.xlsx',
    ext: 'xlsx',
    tcode: 'T3',
    docKind: 'record-layout',
    surveyGroup: 'LSIC_ELIC',
    surveyAcronym: 'LSIC',
    cycle: 'Wave3',
    year: 2005,
    sizeBytes: 60_000,
  }),
  file({
    bundle: BUNDLE_5,
    path: 'LSIC_ELIC/methodology/LSIC_T7_methodology.pdf',
    tcode: 'T7',
    docKind: 'reference',
    surveyGroup: 'LSIC_ELIC',
    surveyAcronym: 'LSIC',
    cycle: undefined,
    year: undefined,
    sizeBytes: 1_500_000,
  }),

  // UCR — one group, one file, no acronym pairing, unknown language.
  file({
    bundle: BUNDLE_5,
    path: 'UCR/1980/UCR_1980_T15_dictionary.pdf',
    tcode: 'T15',
    surveyGroup: 'UCR',
    surveyAcronym: undefined,
    cycle: '1980',
    year: 1980,
    lang: 'unknown',
    sizeBytes: 900_000,
  }),

  // Unclassified #1 — no T-code at all.
  file({
    bundle: BUNDLE_3,
    path: 'CCHS_ESCC/2013/Read_me.txt',
    ext: 'txt',
    tcode: undefined,
    docKind: 'unknown',
    cycle: '2013',
    year: 2013,
    sizeBytes: 2_400,
  }),
  // Unclassified #2 — a code we read but have not mapped. The interesting failure.
  file({
    bundle: BUNDLE_5,
    path: 'UCR/1980/UCR_1980_T99.9_mystery.pdf',
    tcode: 'T99.9',
    docKind: 'unknown',
    surveyGroup: 'UCR',
    surveyAcronym: undefined,
    cycle: '1980',
    year: 1980,
    lang: 'unknown',
    sizeBytes: 55_000,
  }),
];

const notes: FidelityNote[] = [
  {
    severity: 'error',
    file: `${BUNDLE_5}/LSIC_ELIC/methodology/LSIC_T7_methodology.pdf`,
    message: 'Image-only scan: 4 characters across 38 pages. No OCR (plan §8), so no text extracted.',
  },
  {
    severity: 'info',
    file: `${BUNDLE_3}/CCHS_ESCC/2024/CCHS_2024_T11.1_index.pdf`,
    message: 'Alphabetic index: parsed for concept grouping only, no variable records emitted.',
  },
  {
    // Already speaks for an unclassified file — the synthesizer must not duplicate it.
    severity: 'warning',
    file: `${BUNDLE_3}/CCHS_ESCC/2013/Read_me.txt`,
    message: 'Sharing statement, not survey documentation. Retained for provenance.',
  },
];

const SOURCE = 'C:\\Users\\somebody\\docs\\metadatarepo\\CRSB_ADHOC_CENTRAL_002.zip';

const report = buildIngestReport(files, notes, SOURCE);

/** Deterministic PRNG — a "random" shuffle would make the determinism test itself unreproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('buildIngestReport', () => {
  it('counts files, classification, and the docKind/tcode breakdowns', () => {
    expect(report.files).toBe(14);
    expect(report.classified).toBe(12);
    expect(report.byDocKind).toEqual({
      'data-dictionary': 7,
      'record-layout': 2,
      unknown: 2,
      'alphabetic-index': 1,
      reference: 1,
      'user-guide': 1,
    });
    // Files with no T-code contribute to no bucket, so the totals differ by exactly those files.
    const tcoded = Object.values(report.byTcode).reduce((sum, n) => sum + n, 0);
    expect(tcoded).toBe(report.files - 1);
    expect(report.byTcode['T15.2']).toBe(4);
    expect(report.byTcode['T99.9']).toBe(1);
  });

  it('orders the count records by count descending, then key', () => {
    expect(Object.keys(report.byDocKind)).toEqual([
      'data-dictionary',
      'record-layout',
      'unknown',
      'alphabetic-index',
      'reference',
      'user-guide',
    ]);
    const counts = Object.values(report.byTcode);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('rolls up bytes, bundles, extensions and languages', () => {
    const inv = report.inventory;
    expect(inv.totalBytes).toBe(files.reduce((sum, f) => sum + f.sizeBytes, 0));
    expect(inv.byBundle).toEqual({
      [BUNDLE_3]: 8,
      [BUNDLE_5]: 6,
    });
    expect(inv.byExt).toEqual({ pdf: 12, txt: 1, xlsx: 1 });
    expect(inv.byLang).toEqual({ en: 9, fr: 3, unknown: 2 });
  });

  it('rolls up survey groups with year ranges, biggest first', () => {
    const inv = report.inventory;
    expect(inv.surveyGroups.map((g) => g.surveyGroup)).toEqual(['CCHS_ESCC', 'LSIC_ELIC', 'UCR']);
    const cchs = inv.surveyGroups[0]!;
    expect(cchs.files).toBe(8);
    expect(cchs.minYear).toBe(2011);
    expect(cchs.maxYear).toBe(2024);
    // The methodology paper has no year — the group's range must ignore it, not break on it.
    const lsic = inv.surveyGroups[1]!;
    expect(lsic.files).toBe(4);
    expect(lsic.minYear).toBe(2005);
    expect(lsic.maxYear).toBe(2005);
    expect(inv.minYear).toBe(1980);
    expect(inv.maxYear).toBe(2024);
    expect(inv.filesWithoutYear).toBe(1);
  });

  it('reduces the source to a bare filename, keeping machine paths out of the committed report', () => {
    expect(report.generatedFrom).toBe('CRSB_ADHOC_CENTRAL_002.zip');
    expect(buildIngestReport([], [], '/home/x/y/corpus.zip').generatedFrom).toBe('corpus.zip');
    expect(buildIngestReport([], [], 'corpus.zip').generatedFrom).toBe('corpus.zip');
  });

  it('itemizes both flavours of unclassified file with a reason', () => {
    const items = report.inventory.unclassified;
    expect(items).toHaveLength(2);
    const mystery = items.find((i) => i.file.endsWith('UCR_1980_T99.9_mystery.pdf'))!;
    expect(mystery.tcode).toBe('T99.9');
    expect(mystery.reason).toContain('not mapped');
    const readme = items.find((i) => i.file.endsWith('Read_me.txt'))!;
    expect(readme.tcode).toBeUndefined();
    expect(readme.reason).toContain('No document-type code');
  });

  it('accounts for every unclassified file in the notes, without duplicating a caller note (D7)', () => {
    const noted = new Set(report.notes.map((n) => n.file));
    for (const item of report.inventory.unclassified) expect(noted.has(item.file)).toBe(true);
    // Read_me.txt already had a caller note, so exactly one note was synthesized (for the T99.9 file).
    expect(report.notes).toHaveLength(notes.length + 1);
    const forReadme = report.notes.filter((n) => n.file.endsWith('Read_me.txt'));
    expect(forReadme).toHaveLength(1);
    expect(forReadme[0]!.message).toBe(notes[2]!.message);
    const synthesized = report.notes.find((n) => n.file.endsWith('T99.9_mystery.pdf'))!;
    expect(synthesized.severity).toBe('warning');
    expect(synthesized.message).toContain('Unclassified.');
    // The M1 acceptance identity: every file is classified or explicitly listed.
    expect(report.classified + report.inventory.unclassified.length).toBe(report.files);
  });

  it('sorts notes by severity, most serious first', () => {
    expect(report.notes.map((n) => n.severity)).toEqual(['error', 'warning', 'warning', 'info']);
  });

  it('handles an empty run without dividing by zero', () => {
    const empty = buildIngestReport([], [], 'nothing.zip');
    expect(empty.files).toBe(0);
    expect(empty.inventory.totalBytes).toBe(0);
    expect(empty.inventory.minYear).toBeUndefined();
    expect(() => renderReportMarkdown(empty)).not.toThrow();
    expect(renderReportMarkdown(empty)).toContain('# StatCan corpus — ingest report');
  });
});

describe('renderReportMarkdown', () => {
  const md = renderReportMarkdown(report);

  it('renders every required section', () => {
    for (const heading of [
      '# StatCan corpus — ingest report',
      '## By document kind',
      '## By document-type code',
      '## By survey group',
      '## Language',
      '## File types',
      '## Coverage',
      '## Fidelity notes',
    ]) {
      expect(md).toContain(heading);
    }
  });

  it('headers the source archive and the totals', () => {
    expect(md).toContain('Source archive: `CRSB_ADHOC_CENTRAL_002.zip`');
    expect(md).toContain('| Files | 14 |');
    expect(md).toContain('| Total size | 27.7 MiB (29,087,400 bytes) |');
    expect(md).toContain('| Classified | 12 (85.7%) |');
    expect(md).toContain('| Unclassified | 2 (14.3%) |');
    expect(md).toContain('| Survey groups | 3 |');
    expect(md).toContain('| Year range | 1980–2024 |');
  });

  it('tabulates docKind and tcode counts in descending order', () => {
    expect(md).toContain('| `data-dictionary` | 7 | 50.0% |');
    expect(md).toContain('| `T15.2` | 4 | 28.6% |');
    const t152 = md.indexOf('| `T15.2` |');
    const t99 = md.indexOf('| `T99.9` |');
    expect(t152).toBeGreaterThan(-1);
    expect(t99).toBeGreaterThan(t152);
  });

  it('tabulates survey groups with year ranges, and languages', () => {
    expect(md).toContain('| `CCHS_ESCC` | 8 | 21.1 MiB | 2011–2024 |');
    expect(md).toContain('| `LSIC_ELIC` | 4 | 5.7 MiB | 2005 |');
    expect(md).toContain('| `UCR` | 2 | 932.6 KiB | 1980 |');
    expect(md).toContain('| English (`en`) | 9 | 64.3% |');
    expect(md).toContain('| French (`fr`) | 3 | 21.4% |');
    expect(md).toContain('| Undetermined (`unknown`) | 2 | 14.3% |');
  });

  it('states coverage and itemizes each unclassified file with its path and reason', () => {
    expect(md).toContain('**12 of 14 files classified (85.7%).**');
    expect(md).toContain(
      '| `RDC Nonconfidential Documentation 5.zip/UCR/1980/UCR_1980_T99.9_mystery.pdf` | pdf | `T99.9` | Document-type code T99.9 is not mapped to a document kind (unmodelled variant). |',
    );
    expect(md).toContain(
      '| `RDC Nonconfidential Documentation 3.zip/CCHS_ESCC/2013/Read_me.txt` | txt | — | No document-type code in the filename (.txt). |',
    );
    expect(md).not.toContain('Capped:');
  });

  it('discloses the cap when the unclassified list is truncated', () => {
    const capped = renderReportMarkdown(report, { maxUnclassifiedItems: 1 });
    expect(capped).toContain('_Capped: showing 1 of 2 unclassified files (sorted by path).');
    // The one shown is the first in sort order, not the first encountered.
    expect(capped).toContain('CCHS_ESCC/2013/Read_me.txt');
    expect(capped).not.toContain('UCR_1980_T99.9_mystery.pdf | pdf');
  });

  it('says so plainly when nothing is unclassified', () => {
    const clean = buildIngestReport(
      files.filter((f) => f.docKind !== 'unknown'),
      [],
      SOURCE,
    );
    const cleanMd = renderReportMarkdown(clean);
    expect(cleanMd).toContain('Every file received a document kind. Nothing to itemize.');
    expect(cleanMd).toContain('None. Every file was handled cleanly.');
  });

  it('groups fidelity notes by severity and itemizes the error', () => {
    expect(md).toContain('| Fidelity notes | 4 (1 error, 2 warnings, 1 info) |');
    expect(md).toContain('### Errors (1)');
    expect(md).toContain('### Warnings (2)');
    expect(md).toContain('### Info (1)');
    expect(md).toContain(
      '- `RDC Nonconfidential Documentation 5.zip/LSIC_ELIC/methodology/LSIC_T7_methodology.pdf` — Image-only scan: 4 characters across 38 pages. No OCR (plan §8), so no text extracted.',
    );
    expect(md.indexOf('### Errors')).toBeLessThan(md.indexOf('### Warnings'));
    expect(md.indexOf('### Warnings')).toBeLessThan(md.indexOf('### Info'));
  });

  it('discloses the cap on notes per severity', () => {
    const capped = renderReportMarkdown(report, { maxNotesPerSeverity: 1 });
    expect(capped).toContain('_Capped: showing 1 of 2 warning notes._');
  });

  it('caps the survey-group table and says how many are hidden', () => {
    const capped = renderReportMarkdown(report, { maxSurveyGroups: 2 });
    expect(capped).toContain('Top 2 of 3 groups by file count.');
    expect(capped).toContain('_1 further group is not shown here');
    expect(capped).not.toContain('| `UCR` |');
  });

  it('escapes pipes so a path can never break the table', () => {
    const odd = buildIngestReport(
      [file({ path: 'ODD/we|rd.pdf', tcode: undefined, docKind: 'unknown' })],
      [],
      SOURCE,
    );
    expect(renderReportMarkdown(odd)).toContain('ODD/we\\|rd.pdf');
  });

  it('degrades honestly when handed a bare IngestReport with no inventory block', () => {
    const bare: IngestReport = {
      generatedFrom: report.generatedFrom,
      files: report.files,
      classified: report.classified,
      byDocKind: report.byDocKind,
      byTcode: report.byTcode,
      notes: report.notes,
    };
    const bareMd = renderReportMarkdown(bare);
    expect(bareMd).toContain('## By survey group');
    expect(bareMd).toContain('_Not available: this report carries no inventory block._');
    expect(bareMd).toContain('**12 of 14 files classified (85.7%).**');
    // Still accounts for the unknowns, just without the table.
    expect(bareMd).toContain('2 files are unclassified');
    expect(bareMd).toContain('### Errors (1)');
  });

  it('embeds no timestamp and no machine path (D9)', () => {
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(md).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(md).not.toContain('C:\\Users');
    expect(md).not.toContain('somebody');
  });
});

describe('determinism (D9)', () => {
  it('renders byte-identically twice', () => {
    expect(renderReportMarkdown(report)).toBe(renderReportMarkdown(report));
  });

  it('renders byte-identically from shuffled input — the real test of total ordering', () => {
    const baseline = renderReportMarkdown(buildIngestReport(files, notes, SOURCE));
    for (const seed of [1, 7, 42, 1234, 98765]) {
      const shuffledReport = buildIngestReport(shuffled(files, seed), shuffled(notes, seed * 3), SOURCE);
      expect(renderReportMarkdown(shuffledReport)).toBe(baseline);
    }
  });

  it('produces the same report object, key order included, from shuffled input', () => {
    const a = buildIngestReport(files, notes, SOURCE);
    const b = buildIngestReport(shuffled(files, 99), shuffled(notes, 13), SOURCE);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('renders the inventory JSONL byte-identically from shuffled input', () => {
    const baseline = renderInventoryJsonl(files);
    for (const seed of [2, 8, 64, 4321]) {
      expect(renderInventoryJsonl(shuffled(files, seed))).toBe(baseline);
    }
  });
});

describe('renderInventoryJsonl', () => {
  const jsonl = renderInventoryJsonl(files);
  const lines = jsonl.split('\n').filter((line) => line.length > 0);

  it('emits one line per file, ending with a newline', () => {
    expect(lines).toHaveLength(files.length);
    expect(jsonl.endsWith('\n')).toBe(true);
    expect(renderInventoryJsonl([])).toBe('');
  });

  it('sorts by bundle then path', () => {
    const keys = lines.map((line) => {
      const record = JSON.parse(line) as CorpusFile;
      return `${record.bundle}/${record.path}`;
    });
    expect([...keys].sort()).toEqual(keys);
    expect(keys[0]!.startsWith(BUNDLE_3)).toBe(true);
    expect(keys[keys.length - 1]!.startsWith(BUNDLE_5)).toBe(true);
  });

  it('round-trips each record, omitting absent optionals rather than writing null', () => {
    const back = lines.map((line) => JSON.parse(line) as CorpusFile);
    const source = [...files].sort((a, b) =>
      `${a.bundle}/${a.path}` < `${b.bundle}/${b.path}` ? -1 : 1,
    );
    expect(back).toEqual(source);
    const methodology = back.find((r) => r.path.endsWith('LSIC_T7_methodology.pdf'))!;
    expect('year' in methodology).toBe(false);
    expect(methodology.year).toBeUndefined();
  });

  it('writes fields in a fixed order regardless of how the CorpusFile was built', () => {
    const forward = renderInventoryJsonl([file({ path: 'A/a.pdf' })]);
    // Same data, opposite property insertion order.
    const backward: CorpusFile = {
      lang: 'en',
      year: 2011,
      cycle: '2011_2012',
      surveyAcronym: 'CCHS',
      surveyGroup: 'CCHS_ESCC',
      docKind: 'data-dictionary',
      tcode: 'T15.2',
      ext: 'pdf',
      sizeBytes: 1_000,
      path: 'A/a.pdf',
      bundle: BUNDLE_3,
    };
    expect(renderInventoryJsonl([backward])).toBe(forward);
  });
});
