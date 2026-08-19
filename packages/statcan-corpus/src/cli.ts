/**
 * Command-line entry point for the corpus ETL (docs/metadata-repo-plan.md §6, M1).
 *
 * Run with tsx, the same way the ddigraph interop fixtures are driven:
 *
 * ```
 * pnpm --filter @mobilesurvey/statcan-corpus corpus:inventory
 * pnpm --filter @mobilesurvey/statcan-corpus corpus:extract -- --sample 200
 * pnpm exec tsx packages/statcan-corpus/src/cli.ts inventory --extract --max 5
 * ```
 *
 * ### Two kinds of output, on purpose
 *
 * - `docs/statcan-corpus-report.md` is **committed** and must be byte-identical for the same
 *   archive and options (D9), so it carries no timestamp, no wall-clock, and no machine path.
 *   It is the reviewable record of ingest quality: a classifier or extractor change shows up here
 *   as a diff in coverage rather than as a claim.
 * - `out/` is **gitignored** bulk: the inventory JSONL, per-document extraction results, and the
 *   run's timings — which live there precisely *because* they are non-deterministic and would
 *   otherwise poison the committed report's diff.
 *
 * ### Progress
 *
 * A full extraction pass is tens of minutes of pdfjs parsing. Everything human-facing goes to
 * stderr (so `stdout` stays free for piping), redraws in place on a TTY, and prints periodic full
 * lines when it is not one — a silent long run is indistinguishable from a hung one.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SAMPLE_SEED, documentRecordId, ingestCorpus, type IngestPlan } from './ingest.js';
import { renderInventoryJsonl, renderReportMarkdown } from './report.js';
import type { DocKind, ExtractedDoc } from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const CORPUS_DIR = path.join(REPO_ROOT, 'docs', 'metadatarepo');
const DEFAULT_OUT_DIR = path.join(PACKAGE_DIR, 'out');
const DEFAULT_REPORT = path.join(REPO_ROOT, 'docs', 'statcan-corpus-report.md');

const DOC_KINDS: readonly DocKind[] = [
  'data-dictionary',
  'record-layout',
  'alphabetic-index',
  'topical-index',
  'user-guide',
  'reference',
  'unknown',
];

const USAGE = `
@mobilesurvey/statcan-corpus — StatCan RDC documentation corpus ETL

Usage:
  tsx src/cli.ts inventory [options]

Classifies every file in the corpus delivery and, with --extract, pulls row-reconstructed text
out of the selected documents. Writes <out>/inventory.jsonl (gitignored) and the committed
Markdown report.

Options:
  --corpus PATH    Corpus delivery zip. Default: the single .zip in docs/metadatarepo/.
  --out DIR        Directory for gitignored bulk artifacts. Default: packages/statcan-corpus/out
  --report PATH    Committed Markdown report. Default: docs/statcan-corpus-report.md
  --no-report      Do not write the Markdown report.
  --extract        Extract text from the selected documents (off by default; an inventory pass
                   reads no payloads at all).
  --kinds LIST     Comma-separated document kinds to extract. Default: data-dictionary
                   One of: ${DOC_KINDS.join(', ')} — or 'all'.
  --tcodes LIST    Comma-separated T-code families to extract, matched as families so T15 selects
                   T15, T15.2, T15.6 … but never T1. Default: T15. Use 'all' for every code.
  --sample N       Extract a deterministic, representative sample of N documents (hash-selected,
                   spread across bundles/surveys/decades, identical on every re-run).
  --seed S         Salt for --sample. Changing it draws a different reproducible sample.
  --max N          Hard cap in traversal order. For smoke tests only — biased toward bundle 1.
  --text           Also write the extracted text to <out>/text/ (one file per document).
  --staging DIR    Keep staged payloads here instead of a temp directory that is deleted after.
  -h, --help       This message.
`.trim();

/* -------------------------------------------------------------------------------------------- *
 * Small deterministic formatters (the report must not depend on the host locale)
 * -------------------------------------------------------------------------------------------- */

function formatInt(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return negative ? `-${out}` : out;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value.toString() : value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

function formatPercent(part: number, total: number): string {
  return total === 0 ? '—' : `${((part / total) * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/* -------------------------------------------------------------------------------------------- *
 * Argument parsing
 * -------------------------------------------------------------------------------------------- */

interface CliArgs {
  corpus?: string;
  outDir: string;
  reportPath: string;
  writeReport: boolean;
  extract: boolean;
  kinds?: DocKind[];
  tcodes?: string[];
  sample?: number;
  seed?: string;
  max?: number;
  writeText: boolean;
  staging?: string;
}

function parseCount(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} needs a non-negative integer, got ${raw === undefined ? '(nothing)' : `"${raw}"`}`);
  }
  return value;
}

function parseKinds(raw: string | undefined): DocKind[] | undefined {
  if (raw === undefined) throw new Error('--kinds needs a comma-separated list');
  if (raw === 'all') return undefined;
  const kinds = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const kind of kinds) {
    if (!DOC_KINDS.includes(kind as DocKind)) {
      throw new Error(`--kinds: "${kind}" is not a document kind. One of: ${DOC_KINDS.join(', ')}`);
    }
  }
  return kinds as DocKind[];
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    outDir: DEFAULT_OUT_DIR,
    reportPath: DEFAULT_REPORT,
    writeReport: true,
    extract: false,
    kinds: ['data-dictionary'],
    tcodes: ['T15'],
    writeText: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--corpus':
        args.corpus = next;
        i += 1;
        break;
      case '--out':
        if (next === undefined) throw new Error('--out needs a directory');
        args.outDir = path.resolve(next);
        i += 1;
        break;
      case '--report':
        if (next === undefined) throw new Error('--report needs a path');
        args.reportPath = path.resolve(next);
        i += 1;
        break;
      case '--no-report':
        args.writeReport = false;
        break;
      case '--extract':
        args.extract = true;
        break;
      case '--kinds':
        args.kinds = parseKinds(next);
        i += 1;
        break;
      case '--tcodes':
        if (next === undefined) throw new Error('--tcodes needs a comma-separated list');
        args.tcodes = next === 'all' ? undefined : next.split(',').map((p) => p.trim()).filter(Boolean);
        i += 1;
        break;
      case '--sample':
        args.sample = parseCount('--sample', next);
        i += 1;
        break;
      case '--seed':
        if (next === undefined) throw new Error('--seed needs a value');
        args.seed = next;
        i += 1;
        break;
      case '--max':
        args.max = parseCount('--max', next);
        i += 1;
        break;
      case '--text':
        args.writeText = true;
        break;
      case '--staging':
        if (next === undefined) throw new Error('--staging needs a directory');
        args.staging = path.resolve(next);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option "${flag}". Run with --help.`);
    }
  }
  return args;
}

/**
 * Locate the corpus delivery. The filename carries an export timestamp, so it is discovered rather
 * than hardcoded — but discovery is deterministic (sorted, first match) and says what it picked.
 */
function resolveCorpus(explicit: string | undefined): string {
  if (explicit !== undefined) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) throw new Error(`Corpus archive not found: ${resolved}`);
    return resolved;
  }
  if (!existsSync(CORPUS_DIR)) {
    throw new Error(
      `No corpus directory at ${CORPUS_DIR}. The 2.4 GB delivery is never committed (D1) — ` +
        'put it there, or pass --corpus PATH.',
    );
  }
  const zips = readdirSync(CORPUS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .sort();
  const first = zips[0];
  if (first === undefined) throw new Error(`No .zip in ${CORPUS_DIR}. Pass --corpus PATH.`);
  if (zips.length > 1) {
    process.stderr.write(`note: ${zips.length} archives in docs/metadatarepo; using ${first}\n`);
  }
  return path.join(CORPUS_DIR, first);
}

/* -------------------------------------------------------------------------------------------- *
 * Progress on stderr
 * -------------------------------------------------------------------------------------------- */

const TTY = process.stderr.isTTY === true;

function status(line: string): void {
  if (TTY) process.stderr.write(`\r[2K${line}`);
  else process.stderr.write(`${line}\n`);
}

function endStatus(line: string): void {
  if (TTY) process.stderr.write(`\r[2K${line}\n`);
  else process.stderr.write(`${line}\n`);
}

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1e6);
}

/* -------------------------------------------------------------------------------------------- *
 * Extraction telemetry
 * -------------------------------------------------------------------------------------------- */

/**
 * A dictionary code-table row that survived row reconstruction: a numeric code, then a label, then
 * one or two count columns, all on **one line**. This is the exact property pdfjs was chosen for
 * (D2) — under a flat reading order each cell lands on its own line and the code silently pairs
 * with a frequency count instead of its label. Counting these across the real corpus turns that
 * design decision from a claim about two sample files into a measurement.
 */
const CODE_ROW_RE = /^\s*\d{1,12}(?: {2,}|\t)\S[^\t]*?(?: {2,}|\t)[\d,]+(?:(?: {2,}|\t)[\d,]+)?\s*$/;

/** T15.2's English field label — the marker M2's label-style parser keys off. */
const MARKER_EN = /Variable Name/;
/** Its French counterpart, both spellings the corpus uses. */
const MARKER_FR = /Nom de (?:la )?variable/i;

interface ExtractionStats {
  attempted: number;
  succeeded: number;
  failed: number;
  scanned: number;
  emptyDocs: number;
  pages: number;
  chars: number;
  engines: Map<string, number>;
  byTcode: Map<string, { docs: number; pages: number; chars: number }>;
  docsWithCodeRows: number;
  codeRows: number;
  docsWithMarkerEn: number;
  docsWithMarkerFr: number;
  bytesRead: number;
}

function newStats(): ExtractionStats {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    scanned: 0,
    emptyDocs: 0,
    pages: 0,
    chars: 0,
    engines: new Map(),
    byTcode: new Map(),
    docsWithCodeRows: 0,
    codeRows: 0,
    docsWithMarkerEn: 0,
    docsWithMarkerFr: 0,
    bytesRead: 0,
  };
}

function recordDoc(stats: ExtractionStats, doc: ExtractedDoc): void {
  stats.succeeded += 1;
  stats.pages += doc.pages.length;
  stats.chars += doc.charCount;
  stats.bytesRead += doc.file.sizeBytes;
  stats.engines.set(doc.engine, (stats.engines.get(doc.engine) ?? 0) + 1);
  if (doc.likelyScanned) stats.scanned += 1;
  if (doc.pages.length === 0) stats.emptyDocs += 1;

  const tcode = doc.file.tcode ?? '(none)';
  const bucket = stats.byTcode.get(tcode) ?? { docs: 0, pages: 0, chars: 0 };
  bucket.docs += 1;
  bucket.pages += doc.pages.length;
  bucket.chars += doc.charCount;
  stats.byTcode.set(tcode, bucket);

  let rows = 0;
  let markerEn = false;
  let markerFr = false;
  for (const page of doc.pages) {
    for (const line of page.text.split('\n')) {
      if (CODE_ROW_RE.test(line)) rows += 1;
    }
    if (!markerEn && MARKER_EN.test(page.text)) markerEn = true;
    if (!markerFr && MARKER_FR.test(page.text)) markerFr = true;
  }
  stats.codeRows += rows;
  if (rows > 0) stats.docsWithCodeRows += 1;
  if (markerEn) stats.docsWithMarkerEn += 1;
  if (markerFr) stats.docsWithMarkerFr += 1;
}

/* -------------------------------------------------------------------------------------------- *
 * Report assembly
 * -------------------------------------------------------------------------------------------- */

interface ExtractionScope {
  kinds: DocKind[] | undefined;
  tcodes: string[] | undefined;
  plan: IngestPlan;
  sampleSize: number | undefined;
  maxDocs: number | undefined;
  seed: string | undefined;
}

/**
 * The `## Text extraction` section appended to the committed report.
 *
 * Deliberately carries no wall-clock: it varies with the machine and would make every run a diff
 * (D9). Timings live in the gitignored `out/run-stats.json`, which is where a non-deterministic
 * number belongs.
 */
function renderExtractionSection(scope: ExtractionScope, stats: ExtractionStats): string[] {
  const { plan } = scope;
  const lines: string[] = [];
  lines.push('## Text extraction');
  lines.push('');

  const kinds = scope.kinds === undefined ? 'every document kind' : scope.kinds.map((k) => `\`${k}\``).join(', ');
  const tcodes =
    scope.tcodes === undefined ? 'every T-code' : `${scope.tcodes.map((t) => `\`${t}.*\``).join(', ')} families`;
  lines.push(`Selection: ${kinds}, ${tcodes}, PDF only.`);
  lines.push('');

  if (plan.sampled) {
    lines.push(
      `> **These numbers are a SAMPLE, not a complete pass.** ${formatInt(plan.selected)} of the`,
      `> ${formatInt(plan.extractable)} matching PDFs (${formatPercent(plan.selected, plan.extractable)}) were extracted.`,
    );
    if (scope.sampleSize !== undefined) {
      lines.push(
        '>',
        `> The draw hashes each file's \`bundle/path\` under the seed \`${scope.seed ?? DEFAULT_SAMPLE_SEED}\` and takes`,
        '> the lowest — a uniform selection, spread across all seven bundles, every survey group and',
        '> the full 1980–2026 span, that returns the *same* files on every re-run (D9). Rates and',
        '> per-document averages below therefore generalize to the family; **totals do not**.',
      );
    } else {
      lines.push(
        '>',
        `> Capped at ${formatInt(scope.maxDocs ?? plan.selected)} in traversal order, which is biased toward the first bundle.`,
        '> This is a smoke test, not a measurement — do not generalize any number below.',
      );
    }
  } else {
    lines.push(
      `**Complete pass** over all ${formatInt(plan.extractable)} matching PDFs. No sampling, no cap.`,
    );
  }
  lines.push('');

  const attempted = stats.attempted;
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Matching files (any format) | ${formatInt(plan.candidates)} |`);
  lines.push(`| Matching PDFs | ${formatInt(plan.extractable)} |`);
  lines.push(`| Extraction attempted | ${formatInt(attempted)} |`);
  lines.push(`| Succeeded | ${formatInt(stats.succeeded)} (${formatPercent(stats.succeeded, attempted)}) |`);
  lines.push(`| Failed | ${formatInt(stats.failed)} (${formatPercent(stats.failed, attempted)}) |`);
  lines.push(
    `| Likely image-only scans | ${formatInt(stats.scanned)} (${formatPercent(stats.scanned, stats.succeeded)} of successes) |`,
  );
  lines.push(`| Pages | ${formatInt(stats.pages)} |`);
  lines.push(`| Characters | ${formatInt(stats.chars)} |`);
  lines.push(
    `| Mean characters/page | ${stats.pages === 0 ? '—' : formatInt(Math.round(stats.chars / stats.pages))} |`,
  );
  lines.push(`| Source bytes read | ${formatBytes(stats.bytesRead)} |`);
  lines.push(
    `| Engine | ${[...stats.engines.keys()].sort().map((e) => `\`${e}\``).join(', ') || '—'} |`,
  );
  lines.push('');

  lines.push('### Row reconstruction actually worked');
  lines.push('');
  lines.push(
    'pdfjs was chosen over PyMuPDF on correctness, not convenience: these dictionaries are visual',
    'tables, and a flat reading order drops each cell onto its own line, silently pairing a code',
    'with a frequency count instead of its label (D2). The check below is that claim measured at',
    'corpus scale rather than on two sample files — a *code-table row* is a line carrying a numeric',
    'code, a text label, and one or two count columns **together**, which can only exist if the',
    'row survived extraction.',
  );
  lines.push('');
  lines.push('| Signal | Documents | Share of successes |');
  lines.push('|---|---:|---:|');
  lines.push(
    `| Contains ≥1 reconstructed code-table row | ${formatInt(stats.docsWithCodeRows)} | ${formatPercent(stats.docsWithCodeRows, stats.succeeded)} |`,
  );
  lines.push(
    `| Contains the \`Variable Name\` field label (EN layouts) | ${formatInt(stats.docsWithMarkerEn)} | ${formatPercent(stats.docsWithMarkerEn, stats.succeeded)} |`,
  );
  lines.push(
    `| Contains \`Nom de la variable\` (FR layouts) | ${formatInt(stats.docsWithMarkerFr)} | ${formatPercent(stats.docsWithMarkerFr, stats.succeeded)} |`,
  );
  lines.push('');
  lines.push(`Total reconstructed code-table rows: **${formatInt(stats.codeRows)}**.`);
  lines.push('');

  if (stats.byTcode.size > 0) {
    lines.push('### Extraction by document-type code');
    lines.push('');
    lines.push('| T-code | Documents | Pages | Characters |');
    lines.push('|---|---:|---:|---:|');
    const rows = [...stats.byTcode.entries()].sort((a, b) => b[1].docs - a[1].docs || (a[0] < b[0] ? -1 : 1));
    for (const [tcode, bucket] of rows) {
      lines.push(
        `| \`${tcode}\` | ${formatInt(bucket.docs)} | ${formatInt(bucket.pages)} | ${formatInt(bucket.chars)} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '_Wall-clock and machine-specific timings are deliberately excluded so this report stays',
    'byte-identical across runs (D9); they are written to the gitignored `out/run-stats.json`._',
  );
  lines.push('');
  return lines;
}

/**
 * Splice a section into the rendered report ahead of the fidelity notes, so the document reads
 * inventory → coverage → extraction → what went wrong. Falls back to appending if the heading ever
 * moves, because a missing section is a worse outcome than a misplaced one.
 */
function insertBeforeNotes(markdown: string, section: readonly string[]): string {
  const heading = '## Fidelity notes';
  const at = markdown.indexOf(heading);
  const block = `${section.join('\n')}\n`;
  if (at < 0) return `${markdown}${markdown.endsWith('\n') ? '' : '\n'}${block}`;
  return `${markdown.slice(0, at)}${block}${markdown.slice(at)}`;
}

/* -------------------------------------------------------------------------------------------- *
 * inventory
 * -------------------------------------------------------------------------------------------- */

async function inventory(args: CliArgs): Promise<void> {
  const corpus = resolveCorpus(args.corpus);
  mkdirSync(args.outDir, { recursive: true });
  const inventoryPath = path.join(args.outDir, 'inventory.jsonl');
  const extractionPath = path.join(args.outDir, 'extraction.jsonl');
  const statsPath = path.join(args.outDir, 'run-stats.json');
  const textDir = path.join(args.outDir, 'text');

  process.stderr.write(`corpus:  ${path.relative(REPO_ROOT, corpus).replace(/\\/g, '/')}\n`);
  process.stderr.write(`out:     ${path.relative(REPO_ROOT, args.outDir).replace(/\\/g, '/')}\n`);
  process.stderr.write(`mode:    ${args.extract ? 'classify + extract text' : 'classify only'}\n\n`);

  const stats = newStats();
  const started = Date.now();
  let scanStarted = started;
  let scanEnded = 0;
  let stageEnded = 0;
  let plan: IngestPlan | undefined;
  let lastTick = 0;

  if (args.extract) {
    rmSync(extractionPath, { force: true });
    if (args.writeText) {
      rmSync(textDir, { recursive: true, force: true });
      mkdirSync(textDir, { recursive: true });
    }
  }

  const result = await ingestCorpus(corpus, {
    extractText: args.extract,
    ...(args.kinds ? { limitDocKinds: args.kinds } : {}),
    ...(args.tcodes ? { limitTcodes: args.tcodes } : {}),
    ...(args.sample !== undefined ? { sampleSize: args.sample } : {}),
    ...(args.seed !== undefined ? { sampleSeed: args.seed } : {}),
    ...(args.max !== undefined ? { maxDocs: args.max } : {}),
    ...(args.staging !== undefined ? { stagingDir: args.staging } : {}),
    // Extracted text is streamed to disk below; holding 1,200 documents of page text in memory
    // just to hand it back at the end is the one thing the brief forbids.
    retainDocs: false,
    onScan: (files) => {
      if (files % 250 !== 0) return;
      status(`scan:    ${formatInt(files)} files classified · rss ${rssMb()} MB`);
    },
    onPlan: (p) => {
      plan = p;
      scanEnded = Date.now();
      endStatus(
        `scan:    ${formatInt(p.files)} files classified in ${formatDuration(scanEnded - scanStarted)} · rss ${rssMb()} MB`,
      );
      process.stderr.write(
        `select:  ${formatInt(p.candidates)} matching files · ${formatInt(p.extractable)} PDFs · ` +
          `extracting ${formatInt(p.selected)}${p.sampled ? ' (SAMPLE)' : ' (complete)'} · ` +
          `staging ${formatBytes(p.selectedBytes)}\n`,
      );
    },
    onStage: (staged, total) => {
      if (staged % 25 !== 0 && staged !== total) return;
      status(`stage:   ${formatInt(staged)}/${formatInt(total)} payloads · rss ${rssMb()} MB`);
    },
    onDoc: (doc) => {
      recordDoc(stats, doc);
      const id = documentRecordId(doc.file);
      appendFileSync(
        extractionPath,
        `${JSON.stringify({
          recordId: id,
          bundle: doc.file.bundle,
          path: doc.file.path,
          tcode: doc.file.tcode,
          docKind: doc.file.docKind,
          surveyGroup: doc.file.surveyGroup,
          year: doc.file.year,
          lang: doc.file.lang,
          pages: doc.pages.length,
          charCount: doc.charCount,
          engine: doc.engine,
          likelyScanned: doc.likelyScanned,
          pageChars: doc.pages.map((page) => page.text.length),
        })}\n`,
      );
      if (args.writeText) {
        writeFileSync(
          path.join(textDir, `${id}.txt`),
          doc.pages.map((page) => `\f[page ${page.pageNumber}]\n${page.text}`).join('\n'),
        );
      }
    },
    onProgress: (done, total) => {
      if (stageEnded === 0) stageEnded = Date.now();
      stats.attempted = done;
      const now = Date.now();
      if (now - lastTick < 400 && done !== total) return;
      lastTick = now;
      const elapsed = (now - stageEnded) / 1000;
      const rate = elapsed > 0 ? done / elapsed : 0;
      const eta = rate > 0 ? (total - done) / rate : 0;
      status(
        `extract: ${formatInt(done)}/${formatInt(total)} (${formatPercent(done, total)}) · ` +
          `${rate.toFixed(1)} docs/s · eta ${formatDuration(eta * 1000)} · ` +
          `${formatInt(stats.pages)} pages · rss ${rssMb()} MB`,
      );
    },
  });

  const finished = Date.now();
  stats.failed = stats.attempted - stats.succeeded;
  if (args.extract) {
    endStatus(
      `extract: ${formatInt(stats.attempted)} documents in ${formatDuration(finished - (stageEnded || started))} · ` +
        `${formatInt(stats.pages)} pages · ${formatInt(stats.chars)} chars · ${formatInt(stats.failed)} failed`,
    );
  }

  writeFileSync(inventoryPath, renderInventoryJsonl(result.files));

  let markdown = renderReportMarkdown(result.report);
  if (args.extract && plan !== undefined) {
    markdown = insertBeforeNotes(
      markdown,
      renderExtractionSection(
        {
          kinds: args.kinds,
          tcodes: args.tcodes,
          plan,
          sampleSize: args.sample,
          maxDocs: args.max,
          seed: args.seed,
        },
        stats,
      ),
    );
  }
  if (args.writeReport) {
    mkdirSync(path.dirname(args.reportPath), { recursive: true });
    writeFileSync(args.reportPath, markdown);
  }

  // Non-deterministic by nature, which is exactly why it does not go in the committed report.
  writeFileSync(
    statsPath,
    `${JSON.stringify(
      {
        corpus: path.basename(corpus),
        files: result.files.length,
        classified: result.report.classified,
        notes: result.report.notes.length,
        extract: args.extract,
        plan: plan ?? null,
        extraction: args.extract
          ? {
              attempted: stats.attempted,
              succeeded: stats.succeeded,
              failed: stats.failed,
              likelyScanned: stats.scanned,
              pages: stats.pages,
              chars: stats.chars,
              codeRows: stats.codeRows,
              docsWithCodeRows: stats.docsWithCodeRows,
              engines: Object.fromEntries(stats.engines),
            }
          : null,
        timingsMs: {
          total: finished - started,
          scan: (scanEnded || finished) - started,
          stage: scanEnded > 0 ? (stageEnded || finished) - scanEnded : 0,
          extract: stageEnded > 0 ? finished - stageEnded : 0,
        },
        peakRssMb: rssMb(),
        node: process.version,
      },
      null,
      2,
    )}\n`,
  );

  const rel = (p: string): string => path.relative(REPO_ROOT, p).replace(/\\/g, '/');
  process.stderr.write('\n');
  process.stderr.write(
    `done:    ${formatInt(result.files.length)} files · ${formatInt(result.report.classified)} classified ` +
      `(${formatPercent(result.report.classified, result.files.length)}) · ` +
      `${formatInt(result.report.notes.length)} fidelity notes · ${formatDuration(finished - started)}\n`,
  );
  process.stderr.write(`wrote:   ${rel(inventoryPath)}\n`);
  if (args.extract) process.stderr.write(`wrote:   ${rel(extractionPath)}\n`);
  if (args.extract && args.writeText) process.stderr.write(`wrote:   ${rel(textDir)}/\n`);
  if (args.writeReport) process.stderr.write(`wrote:   ${rel(args.reportPath)}\n`);
  process.stderr.write(`wrote:   ${rel(statsPath)}\n`);
}

/* -------------------------------------------------------------------------------------------- *
 * main
 * -------------------------------------------------------------------------------------------- */

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    process.stderr.write(`${USAGE}\n`);
    return command === undefined ? 1 : 0;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }
  if (command !== 'inventory') {
    process.stderr.write(`Unknown command "${command}". Run with --help.\n`);
    return 1;
  }
  await inventory(parseArgs(rest));
  return 0;
}

/**
 * Run only when this file *is* the process entry point.
 *
 * Without the guard a test could not import the pure renderers below without launching a full
 * corpus ingest as a side effect. The guard is itself covered: the subprocess test asserts that
 * `tsx src/cli.ts --help` prints usage, which fails loudly if this comparison ever stops matching.
 */
const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(`${err.stack.split('\n').slice(1, 4).join('\n')}\n`);
      }
      process.exitCode = 1;
    },
  );
}

export { main, parseArgs, insertBeforeNotes, renderExtractionSection, newStats, recordDoc, formatInt, formatBytes };
export type { CliArgs, ExtractionStats, ExtractionScope };
