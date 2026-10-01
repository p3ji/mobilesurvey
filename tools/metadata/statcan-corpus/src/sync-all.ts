/**
 * Sync all staged documentation into Supabase corpus_variable (in-place upsert).
 *
 * Re-parses all 581 staged documents with the updated parser to:
 * 1. Capture multi-line wrapped question text and option labels (e.g. mark-all batteries).
 * 2. Recover 2-column response categories (labels + codes) for dictionaries without frequencies.
 * 3. Smart-join hyphenated line wraps without injecting extraneous spaces.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLayout, parseDictionary } from './parse.js';
import { toCorpusRow, type CorpusRow } from './project.js';
import {
  credentialsFromEnv,
  envWithFile,
  factKey,
  upsertRows,
  type LoadCredentials,
} from './load.js';
import { variableRecordId } from './ingest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..');
const DOCS_DIR = path.join(PACKAGE_DIR, 'out', 'documents');
const PROGRESS_FILE = path.join(PACKAGE_DIR, 'out', 'sync-progress.json');

interface DocMeta {
  document_id: string;
  bundle: string;
  path: string;
  doc_kind: string;
  survey_group: string;
  survey_acronym: string | null;
  cycle: string | null;
  year: number | null;
  lang: string;
}

const BATCH_SIZE = 250;
const CONCURRENCY = 2;

async function upsertWithRetry(
  creds: LoadCredentials,
  table: string,
  conflictColumn: string,
  rows: readonly object[],
  maxRetries = 4,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await upsertRows(creds, table, conflictColumn, rows);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const waitMs = attempt * 2500;
      console.warn(
        `Upsert batch failed (${(err as Error).message.slice(0, 120)}). Retrying in ${waitMs}ms (attempt ${attempt}/${maxRetries})...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function refreshFacets(creds: LoadCredentials): Promise<void> {
  const res = await fetch(`${creds.url}/rest/v1/rpc/corpus_refresh_facets`, {
    method: 'POST',
    headers: {
      apikey: creds.serviceRoleKey,
      Authorization: `Bearer ${creds.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    console.warn(`Warning: corpus_refresh_facets RPC returned ${res.status} ${res.statusText}`);
  } else {
    console.log('Successfully refreshed corpus facets snapshot.');
  }
}

async function run(): Promise<void> {
  const env = envWithFile(path.join(PACKAGE_DIR, '.env.local'));
  const creds = credentialsFromEnv(env);

  console.log(`Connecting to ${creds.url}...`);
  const docsRes = await fetch(
    `${creds.url}/rest/v1/corpus_document?select=document_id,bundle,path,doc_kind,survey_group,survey_acronym,cycle,year,lang`,
    {
      headers: {
        apikey: creds.serviceRoleKey,
        Authorization: `Bearer ${creds.serviceRoleKey}`,
      },
    },
  );
  if (!docsRes.ok) {
    throw new Error(`Failed to fetch documents: ${docsRes.status} ${docsRes.statusText}`);
  }
  const docs: DocMeta[] = await docsRes.json();
  console.log(`Loaded ${docs.length} document definitions from Supabase.`);

  let completedDocIds = new Set<string>();
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      if (Array.isArray(data.completed)) {
        completedDocIds = new Set(data.completed);
        console.log(`Resuming sync: ${completedDocIds.size} documents already marked complete.`);
      }
    } catch {}
  }

  const seenFactKeys = new Set<string>();
  let totalParsed = 0;
  let totalWithCodes = 0;
  let totalSelectAll = 0;

  let currentBatch: CorpusRow[] = [];
  const pendingPromises: Promise<void>[] = [];

  const SELECT_ALL_REGEX = /\b(select\s+all|mark\s+all|cochez\s+toutes|sélectionnez\s+toutes)\b/i;

  async function flushBatch(batch: CorpusRow[]): Promise<void> {
    if (batch.length === 0) return;
    while (pendingPromises.length >= CONCURRENCY) {
      await Promise.race(pendingPromises);
    }
    const p = upsertWithRetry(creds, 'corpus_variable', 'record_id', batch).then(() => {
      const idx = pendingPromises.indexOf(p);
      if (idx >= 0) pendingPromises.splice(idx, 1);
    });
    pendingPromises.push(p);
  }

  const t0 = Date.now();
  let docIndex = 0;
  let upsertedRows = 0;

  for (const doc of docs) {
    docIndex++;
    if (completedDocIds.has(doc.document_id)) {
      continue;
    }

    const docDirPath = path.join(DOCS_DIR, doc.document_id);
    if (!fs.existsSync(docDirPath)) {
      console.warn(`Missing staged dir for ${doc.path} (${doc.document_id})`);
      completedDocIds.add(doc.document_id);
      continue;
    }

    const chunkFiles = fs
      .readdirSync(docDirPath)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => parseInt(a) - parseInt(b));

    const pages: Array<{ pageNumber: number; text: string }> = [];
    for (const chunk of chunkFiles) {
      const chunkData = JSON.parse(fs.readFileSync(path.join(docDirPath, chunk), 'utf8'));
      for (const p of chunkData.pages) {
        pages.push({ pageNumber: p.page ?? p.pageNumber, text: p.text });
      }
    }

    const fileMeta = {
      bundle: doc.bundle,
      path: doc.path,
      sizeBytes: 1000,
      ext: 'pdf' as const,
      docKind: doc.doc_kind as any,
      surveyGroup: doc.survey_group,
      surveyAcronym: doc.survey_acronym ?? undefined,
      cycle: doc.cycle ?? undefined,
      year: doc.year ?? undefined,
      lang: (doc.lang as any) ?? 'en',
    };

    const layout = detectLayout({ file: fileMeta, pages } as any);
    const parsed = parseDictionary({ file: fileMeta, layout, pages } as any, (v) =>
      variableRecordId(fileMeta as any, v.name, v.position),
    );

    for (const v of parsed.variables) {
      totalParsed++;
      if (v.codes && v.codes.length > 0) totalWithCodes++;
      const text = `${v.note ?? ''} ${v.questionText ?? ''} ${v.concept ?? ''}`;
      if (SELECT_ALL_REGEX.test(text)) totalSelectAll++;

      const row = toCorpusRow(v);
      const fk = factKey(row);
      if (seenFactKeys.has(fk)) continue;
      seenFactKeys.add(fk);

      currentBatch.push(row);
      if (currentBatch.length >= BATCH_SIZE) {
        upsertedRows += currentBatch.length;
        await flushBatch(currentBatch);
        currentBatch = [];
      }
    }

    // Flush any pending per document and record progress
    if (currentBatch.length > 0) {
      upsertedRows += currentBatch.length;
      await flushBatch(currentBatch);
      currentBatch = [];
    }

    completedDocIds.add(doc.document_id);
    if (docIndex % 10 === 0 || docIndex === docs.length) {
      await Promise.all(pendingPromises);
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: Array.from(completedDocIds) }));
      const rate = Math.round(upsertedRows / (Math.max(1, Date.now() - t0) / 1000));
      console.log(
        `[${docIndex}/${docs.length} docs] Upserted ${upsertedRows.toLocaleString()} rows (${rate} rows/s)...`,
      );
    }
  }

  await Promise.all(pendingPromises);
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nSync complete in ${durationSec}s:`);
  console.log(`- Documents processed: ${docIndex}`);
  console.log(`- Total variables parsed: ${totalParsed.toLocaleString()}`);
  console.log(`- Unique deduped variables upserted: ${upsertedRows.toLocaleString()}`);
  console.log(`- Variables with response categories: ${totalWithCodes.toLocaleString()}`);
  console.log(`- Select-all multi-select items: ${totalSelectAll.toLocaleString()}`);

  console.log('\nRefreshing facets...');
  await refreshFacets(creds);
}

run().catch((err) => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
