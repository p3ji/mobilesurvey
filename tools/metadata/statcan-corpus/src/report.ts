/**
 * Inventory, coverage and fidelity reporting for the corpus ingest (docs/metadata-repo-plan.md).
 *
 * Three artifacts come out of an ingest run, and they have deliberately different fates:
 *
 * - the **report** ({@link buildIngestReport}) — a small aggregate, held in memory and serialized
 *   as JSON if wanted;
 * - the **Markdown rendering** ({@link renderReportMarkdown}) — **committed to git** (D1), because
 *   the corpus itself never is. It is the only reviewable evidence of ingest quality in the repo,
 *   which is what turns a parser change into a measurable coverage delta in a diff instead of a
 *   claim in a commit message;
 * - the **inventory JSONL** ({@link renderInventoryJsonl}) — the bulk, gitignored companion, one
 *   line per file for downstream passes and ad-hoc querying.
 *
 * Two of the plan's decisions do most of the shaping here:
 *
 * - **D7 — nothing is silently dropped.** Every file gets an outcome. {@link buildIngestReport}
 *   enforces that by construction: a file left `docKind: 'unknown'` that no caller wrote a note
 *   for gets one synthesized, so `files === classified + accounted-for unknowns` always holds and
 *   M1's acceptance bar ("every one of the 3,006 files is classified or explicitly listed as
 *   unclassified") is checkable from the report alone.
 * - **D9 — deterministic and re-runnable.** The same input must render byte-identically, or the
 *   diffs stop meaning anything. That rules out three things this module avoids on purpose:
 *   timestamps, machine-specific paths (`generatedFrom` is reduced to a bare filename), and any
 *   locale-sensitive formatting — `localeCompare` and `toLocaleString` both vary with the host's
 *   ICU locale, so ordering uses raw code-unit comparison and numbers are grouped by hand.
 *   Every comparator is *total* (ties broken down to a unique key) so no ordering depends on the
 *   input array's order.
 */
import type { CorpusFile, FidelityNote, FidelitySeverity, IngestReport, Lang } from './types.js';

/** Per-survey-group rollup: the "which surveys does this corpus actually cover, and when" view. */
export interface SurveyGroupStat {
  /** Top-level folder inside a bundle, e.g. `CCHS_ESCC`. */
  surveyGroup: string;
  files: number;
  bytes: number;
  /** Earliest/latest determinable reference year across the group's files; both absent when none carry one. */
  minYear: number | undefined;
  maxYear: number | undefined;
}

/**
 * One file the classifier could not place, with the reason stated rather than implied. The reason
 * distinguishes the two failure modes that need different fixes: a filename carrying no T-code at
 * all (a naming convention we have not met) versus a T-code we recognize but have not mapped
 * (a new document variant — the more interesting of the two, and the one that grows the taxonomy).
 */
export interface UnclassifiedFile {
  /** `bundle/path`, so it is findable without consulting a second table. */
  file: string;
  ext: string;
  tcode: string | undefined;
  reason: string;
}

/**
 * The inventory rollups {@link IngestReport} does not carry.
 *
 * `IngestReport` is the narrow, stable contract in `types.ts`; these are the extra aggregates the
 * committed Markdown needs (bytes, languages, per-survey coverage, the itemized unknowns). They
 * live in an additive block rather than in `types.ts` so the shared model stays the union of what
 * every consumer needs, not the union of what any one renderer wants.
 */
export interface IngestInventory {
  totalBytes: number;
  /** Files per nested zip. A skewed distribution here usually means a bundle failed to stream. */
  byBundle: Record<string, number>;
  /** Files per lower-cased extension. Decides how much of the corpus the PDF path can even reach. */
  byExt: Record<string, number>;
  byLang: Record<string, number>;
  /** Sorted by file count descending, then name — the renderer truncates, this does not. */
  surveyGroups: SurveyGroupStat[];
  minYear: number | undefined;
  maxYear: number | undefined;
  filesWithoutYear: number;
  unclassified: UnclassifiedFile[];
}

/** {@link IngestReport} plus the inventory rollups. What {@link buildIngestReport} actually returns. */
export interface DetailedIngestReport extends IngestReport {
  inventory: IngestInventory;
}

/** Caps for the itemized sections. Defaults are tuned for a report a human will actually read. */
export interface RenderReportOptions {
  /** Survey-group rows to print. Default 30. */
  maxSurveyGroups?: number;
  /** Unclassified files to itemize. Default 100. */
  maxUnclassifiedItems?: number;
  /** Fidelity notes to itemize *per severity*. Default 100. */
  maxNotesPerSeverity?: number;
}

export const DEFAULT_MAX_SURVEY_GROUPS = 30;
export const DEFAULT_MAX_UNCLASSIFIED_ITEMS = 100;
export const DEFAULT_MAX_NOTES_PER_SEVERITY = 100;

/** Most-serious-first: an ingest reader wants the errors before the commentary. */
const SEVERITY_ORDER: readonly FidelitySeverity[] = ['error', 'warning', 'info'];

const SEVERITY_HEADING: Record<FidelitySeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
};

const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  fr: 'French',
  unknown: 'Undetermined',
};

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------

/**
 * Code-unit string comparison. Deliberately not `localeCompare`, which depends on the host's ICU
 * data and collation locale — the same input would then sort differently on two machines and the
 * committed report would churn (D9).
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Count descending, then key ascending. Total, because keys are unique. */
function compareCountEntries(a: readonly [string, number], b: readonly [string, number]): number {
  return b[1] - a[1] || compareStrings(a[0], b[0]);
}

/**
 * Freeze a count map into a plain record with a deterministic key order. JSON serialization
 * preserves insertion order for string keys, so the order is set here once and the JSON form of
 * the report is stable too — not only its Markdown rendering.
 */
function sortedCountRecord(counts: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of [...counts.entries()].sort(compareCountEntries)) out[key] = count;
  return out;
}

function increment(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/** `bundle/path` — the identity of a file, since neither part is unique across the seven bundles. */
function fileKey(file: CorpusFile): string {
  return `${file.bundle}/${file.path}`;
}

/**
 * Reduce a source path to a bare filename. `generatedFrom` is committed, so an absolute path would
 * leak a machine layout into git and make the report differ between contributors for no reason.
 */
function baseName(source: string): string {
  const cut = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  return cut >= 0 ? source.slice(cut + 1) : source;
}

/** Hand-rolled thousands grouping: `toLocaleString` is locale-dependent and therefore unstable. */
function formatInt(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return negative ? `-${out}` : out;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatInt(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

function formatPercent(part: number, total: number): string {
  if (total <= 0) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Years render as a range, a single year, or an explicit dash — never as an empty cell. */
function formatYearRange(min: number | undefined, max: number | undefined): string {
  if (min === undefined || max === undefined) return '—';
  return min === max ? String(min) : `${min}–${max}`;
}

/** Keep a value inside one Markdown table cell: pipes escaped, newlines flattened. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// buildIngestReport
// ---------------------------------------------------------------------------

/**
 * Why a file ended up unclassified, in the terms that decide what to do about it.
 *
 * An unmapped-but-present T-code is the actionable case: it names a document variant the taxonomy
 * has not learned yet, and those keep appearing. A missing code is usually just a file outside the
 * dictionary families.
 */
function unclassifiedReason(file: CorpusFile): string {
  if (file.tcode) {
    return `Document-type code ${file.tcode} is not mapped to a document kind (unmodelled variant).`;
  }
  return `No document-type code in the filename (.${file.ext || 'no extension'}).`;
}

/**
 * Aggregate an inventory pass into the committed report.
 *
 * `notes` are the caller's own findings (unreadable bundle entries, suspected scans, and later the
 * parsers' fidelity notes). This function adds one synthesized note for every unclassified file no
 * caller already spoke for, which is what makes "every file has an outcome" (D7) a property of the
 * report rather than a discipline every caller has to remember.
 *
 * @param source path or filename of the source archive; reduced to its basename for the report.
 */
export function buildIngestReport(
  files: CorpusFile[],
  notes: FidelityNote[],
  source: string,
): DetailedIngestReport {
  const byDocKind = new Map<string, number>();
  const byTcode = new Map<string, number>();
  const byExt = new Map<string, number>();
  const byLang = new Map<string, number>();
  const byBundle = new Map<string, number>();
  const groups = new Map<string, { files: number; bytes: number; minYear?: number; maxYear?: number }>();

  let classified = 0;
  let totalBytes = 0;
  let filesWithoutYear = 0;
  let minYear: number | undefined;
  let maxYear: number | undefined;
  const unclassified: UnclassifiedFile[] = [];

  for (const file of files) {
    totalBytes += file.sizeBytes;
    increment(byDocKind, file.docKind);
    increment(byExt, file.ext);
    increment(byLang, file.lang);
    increment(byBundle, file.bundle);
    if (file.tcode) increment(byTcode, file.tcode);

    if (file.docKind === 'unknown') {
      unclassified.push({
        file: fileKey(file),
        ext: file.ext,
        tcode: file.tcode,
        reason: unclassifiedReason(file),
      });
    } else {
      classified += 1;
    }

    const group = groups.get(file.surveyGroup) ?? { files: 0, bytes: 0 };
    group.files += 1;
    group.bytes += file.sizeBytes;
    if (file.year !== undefined) {
      group.minYear = group.minYear === undefined ? file.year : Math.min(group.minYear, file.year);
      group.maxYear = group.maxYear === undefined ? file.year : Math.max(group.maxYear, file.year);
      minYear = minYear === undefined ? file.year : Math.min(minYear, file.year);
      maxYear = maxYear === undefined ? file.year : Math.max(maxYear, file.year);
    } else {
      filesWithoutYear += 1;
    }
    groups.set(file.surveyGroup, group);
  }

  // Nothing silently dropped (D7): an unclassified file with no note of its own gets one.
  const spokenFor = new Set(notes.map((note) => note.file));
  const synthesized: FidelityNote[] = unclassified
    .filter((entry) => !spokenFor.has(entry.file))
    .map((entry) => ({
      severity: 'warning' as const,
      file: entry.file,
      message: `Unclassified. ${entry.reason}`,
    }));

  const surveyGroups: SurveyGroupStat[] = [...groups.entries()]
    .map(([surveyGroup, stat]) => ({
      surveyGroup,
      files: stat.files,
      bytes: stat.bytes,
      minYear: stat.minYear,
      maxYear: stat.maxYear,
    }))
    .sort((a, b) => b.files - a.files || b.bytes - a.bytes || compareStrings(a.surveyGroup, b.surveyGroup));

  return {
    generatedFrom: baseName(source),
    files: files.length,
    classified,
    byDocKind: sortedCountRecord(byDocKind),
    byTcode: sortedCountRecord(byTcode),
    notes: sortNotes([...notes, ...synthesized]),
    inventory: {
      totalBytes,
      byBundle: sortedCountRecord(byBundle),
      byExt: sortedCountRecord(byExt),
      byLang: sortedCountRecord(byLang),
      surveyGroups,
      minYear,
      maxYear,
      filesWithoutYear,
      unclassified: unclassified.sort((a, b) => compareStrings(a.file, b.file)),
    },
  };
}

/** Severity (most serious first), then file, then message. Total up to genuinely identical notes. */
function sortNotes(notes: FidelityNote[]): FidelityNote[] {
  return [...notes].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      compareStrings(a.file, b.file) ||
      compareStrings(a.message, b.message),
  );
}

function hasInventory(report: IngestReport): report is DetailedIngestReport {
  return 'inventory' in report && (report as DetailedIngestReport).inventory !== undefined;
}

// ---------------------------------------------------------------------------
// renderReportMarkdown
// ---------------------------------------------------------------------------

/**
 * Render the committed Markdown report.
 *
 * The parameter is the *narrow* {@link IngestReport} on purpose, so anything holding a
 * deserialized report can render it; the inventory rollups produced by {@link buildIngestReport}
 * are used when present and their sections say so plainly when they are not. The output carries no
 * timestamp and no absolute path, and every list is explicitly sorted — re-rendering the same
 * report, or a shuffled copy of the same files, must produce a byte-identical document (D9).
 */
export function renderReportMarkdown(report: IngestReport, options: RenderReportOptions = {}): string {
  const maxSurveyGroups = options.maxSurveyGroups ?? DEFAULT_MAX_SURVEY_GROUPS;
  const maxUnclassified = options.maxUnclassifiedItems ?? DEFAULT_MAX_UNCLASSIFIED_ITEMS;
  const maxNotes = options.maxNotesPerSeverity ?? DEFAULT_MAX_NOTES_PER_SEVERITY;

  const inventory = hasInventory(report) ? report.inventory : undefined;
  const notes = sortNotes(report.notes);
  const unknown = report.files - report.classified;
  const lines: string[] = [];

  // -- Header ---------------------------------------------------------------
  lines.push('# StatCan corpus — ingest report');
  lines.push('');
  lines.push(`Source archive: \`${report.generatedFrom}\``);
  lines.push('');
  lines.push(
    'Generated by `@mobilesurvey/statcan-corpus` (see `docs/metadata-repo-plan.md`). The corpus',
    'itself is never committed, so this report is the reviewable record of ingest quality: every',
    'file gets an outcome and nothing is silently dropped (D7). It contains no timestamp and no',
    'machine-specific path — re-running against the same archive must produce a byte-identical',
    'file, so any diff here is a real change in coverage (D9).',
  );
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Files | ${formatInt(report.files)} |`);
  if (inventory) {
    lines.push(`| Total size | ${formatBytes(inventory.totalBytes)} (${formatInt(inventory.totalBytes)} bytes) |`);
  }
  lines.push(`| Classified | ${formatInt(report.classified)} (${formatPercent(report.classified, report.files)}) |`);
  lines.push(`| Unclassified | ${formatInt(unknown)} (${formatPercent(unknown, report.files)}) |`);
  if (inventory) {
    lines.push(`| Survey groups | ${formatInt(inventory.surveyGroups.length)} |`);
    lines.push(`| Bundles | ${formatInt(Object.keys(inventory.byBundle).length)} |`);
    lines.push(`| Year range | ${formatYearRange(inventory.minYear, inventory.maxYear)} |`);
  }
  lines.push(`| Fidelity notes | ${formatInt(notes.length)}${summarizeSeverities(notes)} |`);
  lines.push('');

  // -- By document kind -----------------------------------------------------
  lines.push('## By document kind');
  lines.push('');
  lines.push(...countTable('Kind', report.byDocKind, report.files));
  lines.push('');

  // -- By T-code ------------------------------------------------------------
  lines.push('## By document-type code');
  lines.push('');
  lines.push(
    'The `T##.#` code in the filename is what separates the dictionary families from everything',
    'else before a single page is opened. Codes with no mapped kind show up in Coverage below.',
  );
  lines.push('');
  lines.push(...countTable('T-code', report.byTcode, report.files, 'No T-code was found in any filename.'));
  lines.push('');

  // -- By survey group ------------------------------------------------------
  lines.push('## By survey group');
  lines.push('');
  if (!inventory) {
    lines.push('_Not available: this report carries no inventory block._');
  } else if (inventory.surveyGroups.length === 0) {
    lines.push('_No files._');
  } else {
    const shown = inventory.surveyGroups.slice(0, Math.max(0, maxSurveyGroups));
    lines.push(
      shown.length < inventory.surveyGroups.length
        ? `Top ${formatInt(shown.length)} of ${formatInt(inventory.surveyGroups.length)} groups by file count.`
        : `All ${formatInt(inventory.surveyGroups.length)} ${plural(inventory.surveyGroups.length, 'group', 'groups')}.`,
    );
    lines.push('');
    lines.push('| Survey group | Files | Size | Years |');
    lines.push('|---|---:|---:|---|');
    for (const group of shown) {
      lines.push(
        `| \`${escapeCell(group.surveyGroup)}\` | ${formatInt(group.files)} | ${formatBytes(group.bytes)} | ${formatYearRange(group.minYear, group.maxYear)} |`,
      );
    }
    if (shown.length < inventory.surveyGroups.length) {
      const hidden = inventory.surveyGroups.length - shown.length;
      lines.push('');
      lines.push(
        `_${formatInt(hidden)} further ${plural(hidden, 'group is', 'groups are')} not shown here; every group appears in the inventory JSONL._`,
      );
    }
  }
  lines.push('');

  // -- Languages and file types --------------------------------------------
  lines.push('## Language');
  lines.push('');
  if (!inventory) {
    lines.push('_Not available: this report carries no inventory block._');
  } else {
    lines.push('| Language | Files | Share |');
    lines.push('|---|---:|---:|');
    for (const [lang, count] of Object.entries(inventory.byLang).sort(compareCountEntries)) {
      const label = LANG_LABEL[lang as Lang] ?? lang;
      lines.push(`| ${escapeCell(label)} (\`${escapeCell(lang)}\`) | ${formatInt(count)} | ${formatPercent(count, report.files)} |`);
    }
  }
  lines.push('');

  lines.push('## File types');
  lines.push('');
  if (!inventory) {
    lines.push('_Not available: this report carries no inventory block._');
  } else {
    lines.push(...countTable('Extension', inventory.byExt, report.files));
  }
  lines.push('');

  // -- Coverage -------------------------------------------------------------
  lines.push('## Coverage');
  lines.push('');
  lines.push(
    `**${formatInt(report.classified)} of ${formatInt(report.files)} files classified (${formatPercent(report.classified, report.files)}).**`,
  );
  lines.push('');
  if (unknown === 0) {
    lines.push('Every file received a document kind. Nothing to itemize.');
  } else if (!inventory) {
    lines.push(
      `${formatInt(unknown)} ${plural(unknown, 'file is', 'files are')} unclassified. This report carries no`,
      'inventory block, so they cannot be itemized here — see the fidelity notes below, which',
      'account for every one of them.',
    );
  } else {
    const items = inventory.unclassified;
    const shown = items.slice(0, Math.max(0, maxUnclassified));
    lines.push(
      `${formatInt(unknown)} ${plural(unknown, 'file is', 'files are')} unclassified and itemized below. An unclassified file is a`,
      'coverage fact to act on, not a non-event: an unmapped `T##.#` code usually means a document',
      'variant the taxonomy has not learned yet.',
    );
    lines.push('');
    lines.push('| File | Ext | T-code | Why |');
    lines.push('|---|---|---|---|');
    for (const item of shown) {
      lines.push(
        `| \`${escapeCell(item.file)}\` | ${escapeCell(item.ext)} | ${item.tcode ? `\`${escapeCell(item.tcode)}\`` : '—'} | ${escapeCell(item.reason)} |`,
      );
    }
    if (shown.length < items.length) {
      lines.push('');
      lines.push(
        `_Capped: showing ${formatInt(shown.length)} of ${formatInt(items.length)} unclassified files (sorted by path). The full list is in the inventory JSONL._`,
      );
    }
  }
  lines.push('');

  // -- Fidelity notes -------------------------------------------------------
  lines.push('## Fidelity notes');
  lines.push('');
  if (notes.length === 0) {
    lines.push('None. Every file was handled cleanly.');
  } else {
    lines.push(
      `${formatInt(notes.length)} ${plural(notes.length, 'note', 'notes')}, grouped by severity, most serious first.`,
    );
    for (const severity of SEVERITY_ORDER) {
      const forSeverity = notes.filter((note) => note.severity === severity);
      if (forSeverity.length === 0) continue;
      lines.push('');
      lines.push(`### ${SEVERITY_HEADING[severity]} (${formatInt(forSeverity.length)})`);
      lines.push('');
      for (const note of forSeverity.slice(0, Math.max(0, maxNotes))) {
        lines.push(`- \`${escapeCell(note.file)}\` — ${escapeCell(note.message)}`);
      }
      if (forSeverity.length > maxNotes) {
        lines.push('');
        lines.push(
          `_Capped: showing ${formatInt(Math.max(0, maxNotes))} of ${formatInt(forSeverity.length)} ${severity} notes._`,
        );
      }
    }
  }
  lines.push('');

  return `${lines.join('\n')}`;
}

/** ` (3 errors, 20 warnings)` — omitted entirely when there are no notes. */
function summarizeSeverities(notes: FidelityNote[]): string {
  const parts: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = notes.filter((note) => note.severity === severity).length;
    if (count > 0) parts.push(`${formatInt(count)} ${severity}${count === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * A `| key | count | share |` table from a count record, ordered by count descending. The record's
 * own key order is not trusted — a deserialized report may have lost it — so it is re-sorted here.
 */
function countTable(header: string, counts: Record<string, number>, total: number, empty = 'None.'): string[] {
  const entries = Object.entries(counts).sort(compareCountEntries);
  if (entries.length === 0) return [`_${empty}_`];
  const lines = [`| ${header} | Files | Share |`, '|---|---:|---:|'];
  for (const [key, count] of entries) {
    lines.push(`| \`${escapeCell(key)}\` | ${formatInt(count)} | ${formatPercent(count, total)} |`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// renderInventoryJsonl
// ---------------------------------------------------------------------------

/**
 * The gitignored bulk artifact: one JSON object per file, sorted by bundle then path.
 *
 * Fields are written in a fixed order rather than by serializing the `CorpusFile` directly.
 * `JSON.stringify` preserves *insertion* order, so two classifier code paths that build the same
 * file record with different property order would otherwise produce different bytes for identical
 * data — a determinism hole that would only surface as inexplicable diff churn (D9). Absent
 * optional values are omitted rather than written as `null`, which is what `JSON.parse` round-trips
 * back to the same object.
 *
 * Ends with a trailing newline when non-empty, so the file is a well-formed line-oriented artifact
 * and appending is safe; an empty inventory renders as the empty string.
 */
export function renderInventoryJsonl(files: CorpusFile[]): string {
  const sorted = [...files].sort(
    (a, b) => compareStrings(a.bundle, b.bundle) || compareStrings(a.path, b.path),
  );
  const lines = sorted.map((file) =>
    JSON.stringify({
      bundle: file.bundle,
      path: file.path,
      sizeBytes: file.sizeBytes,
      ext: file.ext,
      tcode: file.tcode,
      docKind: file.docKind,
      surveyGroup: file.surveyGroup,
      surveyAcronym: file.surveyAcronym,
      cycle: file.cycle,
      year: file.year,
      lang: file.lang,
    }),
  );
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
