/**
 * `@mobilesurvey/statcan-corpus` — Node-only ETL for the Statistics Canada RDC documentation
 * corpus (docs/metadata-repo-plan.md). Never import this package from `apps/*`: it streams
 * gigabytes off the filesystem and must stay out of every browser bundle (D2).
 *
 * The public surface, in pipeline order:
 *
 * - `types` — the shared model (`CorpusFile`, `ExtractedDoc`, `CorpusVariable`, `IngestReport`, …).
 * - `zip` — the nested-zip reader that walks the 2.4 GB delivery one bundle at a time.
 * - `classify` — filename/path → document kind, T-code, survey, cycle, year, language.
 * - `pdf` — pdfjs text extraction with y-bucket/x-sort row reconstruction (D2).
 * - `report` — inventory rollups, the committed Markdown report, the inventory JSONL.
 * - `ingest` — the spine that runs all of the above over the archive, plus stable record identity.
 *
 * The CLI (`src/cli.ts`) is deliberately *not* re-exported: it runs a command on import.
 */
export * from './types.js';
export * from './zip.js';
export * from './classify.js';
export * from './pdf.js';
export * from './report.js';
export * from './ingest.js';
