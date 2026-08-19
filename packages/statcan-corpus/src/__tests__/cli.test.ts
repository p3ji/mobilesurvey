/**
 * Tests for the CLI (`src/cli.ts`).
 *
 * Three layers, because they fail for different reasons:
 *
 * 1. **Argument parsing and report rendering, in process.** These are pure, so they are tested
 *    directly — including the one thing a human reader of the committed report most needs to be
 *    true: that a sampled run says, unmissably, that it is a sample.
 * 2. **A whole `inventory` run against the synthetic delivery**, driving `main` in process. This
 *    proves the artifacts are actually written and that the extraction telemetry matches what the
 *    ingest produced, without paying subprocess cost per assertion.
 * 3. **One subprocess run**, which is the only way to cover the entry-point guard: `cli.ts` only
 *    calls `main` when it *is* the process entry, and nothing in process can prove that still
 *    fires.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatBytes,
  formatInt,
  insertBeforeNotes,
  main,
  newStats,
  parseArgs,
  recordDoc,
  renderExtractionSection,
  type ExtractionScope,
} from '../cli.js';
import { GOOD_A, writeSyntheticCorpus } from './support/synthetic-corpus.js';
import type { ExtractedDoc } from '../types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'cli.ts');
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

let workDir: string;
let corpusZip: string;

beforeAll(() => {
  const written = writeSyntheticCorpus();
  workDir = written.dir;
  corpusZip = written.zipPath;
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------------------------------
 * Formatters — locale-independent by hand, because the report must not vary with the host (D9)
 * ------------------------------------------------------------------------------------------- */

describe('formatters', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1,000'],
    [3006, '3,006'],
    [1234567, '1,234,567'],
    [-4200, '-4,200'],
  ])('formatInt(%i) === %s', (input, expected) => {
    expect(formatInt(input)).toBe(expected);
  });

  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.00 KB'],
    [2_500_000_000, '2.33 GB'],
  ])('formatBytes(%i) === %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Argument parsing
 * ------------------------------------------------------------------------------------------- */

describe('parseArgs', () => {
  it('defaults to the dictionary families, no extraction, report on', () => {
    const args = parseArgs([]);
    expect(args.extract).toBe(false);
    expect(args.kinds).toEqual(['data-dictionary']);
    expect(args.tcodes).toEqual(['T15']);
    expect(args.writeReport).toBe(true);
    expect(args.writeText).toBe(false);
  });

  it('reads the flags a real run uses', () => {
    const args = parseArgs(['--extract', '--sample', '150', '--seed', 'x', '--max', '9', '--text', '--no-report']);
    expect(args.extract).toBe(true);
    expect(args.sample).toBe(150);
    expect(args.seed).toBe('x');
    expect(args.max).toBe(9);
    expect(args.writeText).toBe(true);
    expect(args.writeReport).toBe(false);
  });

  it("treats 'all' as no filter rather than as a literal value", () => {
    expect(parseArgs(['--kinds', 'all']).kinds).toBeUndefined();
    expect(parseArgs(['--tcodes', 'all']).tcodes).toBeUndefined();
  });

  it('splits and trims comma lists', () => {
    expect(parseArgs(['--tcodes', 'T15, T11.1 ,T3']).tcodes).toEqual(['T15', 'T11.1', 'T3']);
    expect(parseArgs(['--kinds', 'data-dictionary,record-layout']).kinds).toEqual([
      'data-dictionary',
      'record-layout',
    ]);
  });

  it('rejects a document kind that does not exist, and says what the options are', () => {
    expect(() => parseArgs(['--kinds', 'dictionary'])).toThrow(/not a document kind/);
    expect(() => parseArgs(['--kinds', 'dictionary'])).toThrow(/data-dictionary/);
  });

  it('rejects a non-numeric or negative count rather than silently ignoring it', () => {
    expect(() => parseArgs(['--sample', 'many'])).toThrow(/--sample/);
    expect(() => parseArgs(['--max', '-1'])).toThrow(/--max/);
    expect(() => parseArgs(['--sample'])).toThrow(/--sample/);
  });

  it('rejects an unknown option instead of running with a silently dropped flag', () => {
    expect(() => parseArgs(['--extractt'])).toThrow(/Unknown option/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Extraction telemetry — the corpus-scale measurement of the D2 correctness claim
 * ------------------------------------------------------------------------------------------- */

function docWith(text: string, over: Partial<ExtractedDoc['file']> = {}): ExtractedDoc {
  return {
    file: {
      bundle: 'b.zip',
      path: 'S_T/S_2001_f1_T15.2_v1.pdf',
      sizeBytes: 1024,
      ext: 'pdf',
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'S_T',
      surveyAcronym: 'S',
      cycle: undefined,
      year: 2001,
      lang: 'en',
      ...over,
    },
    pages: [{ pageNumber: 1, text }],
    charCount: text.length,
    engine: 'pdfjs-dist@6.1.200',
    likelyScanned: false,
  };
}

describe('code-table row detection', () => {
  it('counts a row whose code, label and both counts survived on one line', () => {
    const stats = newStats();
    recordDoc(stats, docWith('99999995   Not applicable   0   0\n99999996   Valid skip   12   1,204'));
    expect(stats.codeRows).toBe(2);
    expect(stats.docsWithCodeRows).toBe(1);
  });

  it('counts nothing from a flattened rendering — the failure mode pdfjs was chosen to avoid', () => {
    // This is PyMuPDF's default reading order: one cell per line. A parser reading it pairs the
    // code with the frequency count (D2's `1 -> "10,137"`), and no row-shaped line exists at all.
    const stats = newStats();
    recordDoc(stats, docWith(['99999995', 'Not applicable', '0', '0'].join('\n')));
    expect(stats.codeRows).toBe(0);
    expect(stats.docsWithCodeRows).toBe(0);
  });

  it('does not count prose, headers, or a bare code with no counts', () => {
    const stats = newStats();
    recordDoc(
      stats,
      docWith(
        [
          'Variable Name:   AGE   Position:   35',
          'Code   Label   Frequency   Weighted',
          '1   Yes',
          'In 2001 the survey asked 40,000 people',
        ].join('\n'),
      ),
    );
    expect(stats.codeRows).toBe(0);
  });

  it('finds the field label each layout family keys off, in both languages', () => {
    const stats = newStats();
    recordDoc(stats, docWith('Variable Name:   AGE'));
    recordDoc(stats, docWith('Nom de la variable :   AGE', { lang: 'fr' }));
    expect(stats.docsWithMarkerEn).toBe(1);
    expect(stats.docsWithMarkerFr).toBe(1);
  });

  it('rolls documents up by T-code and tracks scans separately from successes', () => {
    const stats = newStats();
    recordDoc(stats, docWith('99999995   Not applicable   0   0'));
    recordDoc(stats, { ...docWith('x'), likelyScanned: true, file: docWith('x', { tcode: 'T15.6' }).file });
    expect(stats.succeeded).toBe(2);
    expect(stats.scanned).toBe(1);
    expect(stats.byTcode.get('T15.2')?.docs).toBe(1);
    expect(stats.byTcode.get('T15.6')?.docs).toBe(1);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Report assembly
 * ------------------------------------------------------------------------------------------- */

function scope(over: Partial<ExtractionScope> = {}): ExtractionScope {
  return {
    kinds: ['data-dictionary'],
    tcodes: ['T15'],
    sampleSize: undefined,
    maxDocs: undefined,
    seed: undefined,
    plan: {
      files: 3006,
      candidates: 1631,
      extractable: 1342,
      selected: 1342,
      selectedBytes: 2_410_000_000,
      sampled: false,
      ...over.plan,
    },
    ...over,
  };
}

describe('renderExtractionSection', () => {
  it('says plainly when a pass was complete', () => {
    const markdown = renderExtractionSection(scope(), newStats()).join('\n');
    expect(markdown).toContain('**Complete pass**');
    expect(markdown).not.toContain('SAMPLE');
  });

  it('shouts when the numbers are a sample, and never presents them as complete', () => {
    const markdown = renderExtractionSection(
      scope({ sampleSize: 150, seed: 'my-seed', plan: { ...scope().plan, selected: 150, sampled: true } }),
      newStats(),
    ).join('\n');
    expect(markdown).toContain('SAMPLE, not a complete pass');
    expect(markdown).toContain('150');
    expect(markdown).toContain('my-seed');
    expect(markdown).toContain('totals do not');
    expect(markdown).not.toContain('**Complete pass**');
  });

  it('labels a --max run as a smoke test, not a sample — it is biased and says so', () => {
    const markdown = renderExtractionSection(
      scope({ maxDocs: 5, plan: { ...scope().plan, selected: 5, sampled: true } }),
      newStats(),
    ).join('\n');
    expect(markdown).toContain('smoke test, not a measurement');
    expect(markdown).toContain('biased toward the first bundle');
  });

  it('carries no wall-clock, so the committed report stays byte-identical across runs (D9)', () => {
    const stats = newStats();
    recordDoc(stats, docWith('99999995   Not applicable   0   0'));
    stats.attempted = 1;
    const a = renderExtractionSection(scope(), stats).join('\n');
    const b = renderExtractionSection(scope(), stats).join('\n');
    expect(b).toBe(a);
    expect(a).not.toMatch(/\d+ (ms|s|seconds|docs\/s)/);
    expect(a).toMatch(/out\/run-stats\.json/);
  });

  it('reports the row-reconstruction evidence as a share of successes', () => {
    const stats = newStats();
    recordDoc(stats, docWith('99999995   Not applicable   0   0'));
    recordDoc(stats, docWith('nothing table-shaped here'));
    stats.attempted = 2;
    const markdown = renderExtractionSection(scope(), stats).join('\n');
    expect(markdown).toContain('Row reconstruction actually worked');
    expect(markdown).toMatch(/code-table row \| 1 \| 50\.0%/);
  });
});

describe('insertBeforeNotes', () => {
  const report = '# Title\n\n## Coverage\n\nbody\n\n## Fidelity notes\n\nnotes\n';

  it('places the section ahead of the fidelity notes', () => {
    const out = insertBeforeNotes(report, ['## Text extraction', '', 'body']);
    expect(out.indexOf('## Text extraction')).toBeLessThan(out.indexOf('## Fidelity notes'));
    expect(out.indexOf('## Coverage')).toBeLessThan(out.indexOf('## Text extraction'));
  });

  it('appends rather than losing the section when the heading is not there', () => {
    const out = insertBeforeNotes('# Title\n', ['## Text extraction']);
    expect(out).toContain('## Text extraction');
    expect(out.endsWith('\n')).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------
 * A whole run
 * ------------------------------------------------------------------------------------------- */

describe('inventory, end to end on the synthetic delivery', () => {
  let outDir: string;
  let reportPath: string;
  let report: string;

  beforeAll(async () => {
    outDir = path.join(workDir, 'out');
    reportPath = path.join(workDir, 'report.md');
    // The CLI writes progress to stderr by design; keep the test output readable.
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const code = await main([
        'inventory',
        '--corpus',
        corpusZip,
        '--out',
        outDir,
        '--report',
        reportPath,
        '--extract',
        '--text',
      ]);
      expect(code).toBe(0);
    } finally {
      stderr.mockRestore();
    }
    report = readFileSync(reportPath, 'utf8');
  }, 120_000);

  it('writes the gitignored inventory, one JSON object per file', () => {
    const lines = readFileSync(path.join(outDir, 'inventory.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(8);
    const parsed = lines.map((line) => JSON.parse(line) as { path: string; docKind: string });
    expect(parsed.map((row) => row.path)).toContain(GOOD_A);
  });

  it('writes one extraction record per document, keyed by its stable record id', () => {
    const lines = readFileSync(path.join(outDir, 'extraction.jsonl'), 'utf8').trim().split('\n');
    const rows = lines.map((line) => JSON.parse(line) as { recordId: string; pages: number; path: string });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.recordId)).size).toBe(2);
    for (const row of rows) expect(row.pages).toBeGreaterThan(0);
  });

  it('writes the extracted text next to it when asked', () => {
    const rows = readFileSync(path.join(outDir, 'extraction.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { recordId: string });
    for (const row of rows) {
      const text = readFileSync(path.join(outDir, 'text', `${row.recordId}.txt`), 'utf8');
      expect(text).toContain('[page 1]');
    }
    const dictionary = rows
      .map((row) => readFileSync(path.join(outDir, 'text', `${row.recordId}.txt`), 'utf8'))
      .join('\n');
    // Row association survives the trip through the CLI to disk. The exact cell separator is
    // pdf.ts's contract, guarded strictly against a REAL corpus file in pdf.test.ts — this
    // fixture's gaps come from pdfjs bridging hand-placed runs, not from real table geometry.
    expect(dictionary).toMatch(/^99999995\s+Not applicable\s+0\s+0$/m);
  });

  it('writes the committed report with the extraction section spliced in', () => {
    expect(report).toContain('# StatCan corpus — ingest report');
    expect(report).toContain('## Text extraction');
    expect(report.indexOf('## Text extraction')).toBeLessThan(report.indexOf('## Fidelity notes'));
    expect(report).toContain('Row reconstruction actually worked');
  });

  it('carries the failures into the committed report rather than into a silent exit code', () => {
    expect(report).toMatch(/PDF text extraction failed/);
    expect(report).toMatch(/Could not read the file out of the archive/);
    expect(report).toMatch(/deferred to M4/);
  });

  it('keeps timings out of the committed report and in the gitignored stats file', () => {
    expect(report).not.toMatch(/\bdocs\/s\b/);
    const stats = JSON.parse(readFileSync(path.join(outDir, 'run-stats.json'), 'utf8')) as {
      timingsMs: { total: number };
      extraction: { attempted: number; succeeded: number; failed: number };
    };
    expect(stats.timingsMs.total).toBeGreaterThanOrEqual(0);
    expect(stats.extraction.attempted).toBe(3);
    expect(stats.extraction.succeeded).toBe(2);
    expect(stats.extraction.failed).toBe(1);
  });

  it('produces a byte-identical report on a re-run (D9)', async () => {
    const second = path.join(workDir, 'report-2.md');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await main([
        'inventory',
        '--corpus',
        corpusZip,
        '--out',
        path.join(workDir, 'out-2'),
        '--report',
        second,
        '--extract',
      ]);
    } finally {
      stderr.mockRestore();
    }
    expect(readFileSync(second, 'utf8')).toBe(report);
  }, 120_000);

  it('does not write a report when told not to', async () => {
    const skipped = path.join(workDir, 'no-report.md');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await main(['inventory', '--corpus', corpusZip, '--out', path.join(workDir, 'out-3'), '--report', skipped, '--no-report']);
    } finally {
      stderr.mockRestore();
    }
    expect(existsSync(skipped)).toBe(false);
  }, 120_000);
});

describe('main — commands', () => {
  it('prints usage and fails when given no command', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(await main([])).toBe(1);
      expect(await main(['--help'])).toBe(0);
      expect(await main(['ingest'])).toBe(1);
      expect(await main(['inventory', '--help'])).toBe(0);
    } finally {
      stderr.mockRestore();
    }
  });

  it('reports a missing archive by name instead of a stack trace', async () => {
    await expect(
      main(['inventory', '--corpus', path.join(workDir, 'nope.zip'), '--no-report']),
    ).rejects.toThrow(/not found/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The entry-point guard, which only a real process can prove
 * ------------------------------------------------------------------------------------------- */

describe.skipIf(!existsSync(TSX))('as a real process', () => {
  it('runs under tsx and prints usage', () => {
    const out = execFileSync(process.execPath, [TSX, CLI, '--help'], { encoding: 'utf8', stdio: 'pipe' });
    // Usage goes to stderr, so stdout must stay clean for piping.
    expect(out).toBe('');
  });

  it('classifies the synthetic delivery from the command line and writes its artifacts', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'statcan-cli-'));
    try {
      execFileSync(
        process.execPath,
        [TSX, CLI, 'inventory', '--corpus', corpusZip, '--out', outDir, '--no-report'],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      const lines = readFileSync(path.join(outDir, 'inventory.jsonl'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(8);
      const stats = JSON.parse(readFileSync(path.join(outDir, 'run-stats.json'), 'utf8')) as {
        files: number;
        extract: boolean;
      };
      expect(stats.files).toBe(8);
      expect(stats.extract).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
