/**
 * Re-parse every EN document whose extracted page text is on disk (`out/documents/<docId>/`)
 * with the current parser, and patch `note` fields in `corpus.jsonl` where they changed.
 *
 * Why this exists: the 2026-10-03 note-cap fix (40 → 150 lines) means previously truncated RDC
 * notes now carry their full "Derived from …" prose. The 2.4 GB delivery zip is not on this
 * machine, but `out/documents` holds the exact page text the original parse consumed — so a
 * re-parse from disk reproduces every record deterministically (same parser, same uuidV5 minting)
 * and only the note fields may differ. Everything else in corpus.jsonl stays byte-identical.
 *
 * Usage: npx tsx scripts/reparse-notes-from-docs.ts [--apply]
 *   default is a dry run that reports how many notes would change; --apply rewrites corpus.jsonl
 *   (the previous file is kept as corpus.jsonl.pre-note-patch).
 */
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'out');
const DOCS_DIR = path.join(OUT, 'documents');
const RECORDS = path.join(OUT, 'corpus.jsonl');

// Import the real parser and ID minting — never reimplement identity (D9).
const { parseDictionary } = await import('../src/parse.js');
const { variableRecordId, documentRecordId } = await import('../src/ingest.js');

interface SourceRef {
  bundle: string;
  path: string;
  tcode?: string;
  docKind: string;
  surveyGroup: string;
  surveyAcronym?: string;
  cycle?: string;
  year?: number;
  lang: string;
}

/** Group the old records by source file so each document's CorpusFile fields come from its own rows. */
const filesByDoc = new Map<string, { ref: SourceRef; recordIds: Set<string> }>();
let totalRecords = 0;
{
  const rl = createInterface({ input: createReadStream(RECORDS), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    totalRecords++;
    const s = v.source as SourceRef & { page?: number };
    if (s.lang !== 'en') continue;
    const key = `${s.bundle}\u0000${s.path}`;
    let entry = filesByDoc.get(key);
    if (entry === undefined) {
      entry = { ref: s, recordIds: new Set() };
      filesByDoc.set(key, entry);
    }
    entry.recordIds.add(v.recordId);
  }
}
console.log(`old corpus: ${totalRecords} records · ${filesByDoc.size} EN source files`);

/** Load one document's page text from its chunked storage objects. */
function loadPages(docId: string): Array<{ pageNumber: number; text: string }> {
  const dir = path.join(DOCS_DIR, docId);
  if (!existsSync(dir)) return [];
  const chunks = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')));
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (const c of chunks) {
    const chunk = JSON.parse(readFileSync(path.join(dir, c), 'utf8'));
    for (const p of chunk.pages) pages.push({ pageNumber: p.page, text: p.text });
  }
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

// Re-parse every EN document and collect recordId → new note.
const newNotes = new Map<string, string | undefined>();
let docsParsed = 0;
let docsMissingText = 0;
let unexpectedRecords = 0;
for (const [key, entry] of filesByDoc) {
  const docId = documentRecordId({ bundle: entry.ref.bundle, path: entry.ref.path });
  const pages = loadPages(docId);
  if (pages.length === 0) {
    docsMissingText++;
    continue;
  }
  const file = { ...entry.ref };
  const doc = {
    file,
    pages,
    charCount: pages.reduce((n, p) => n + p.text.length, 0),
    engine: 'reparse-from-docs',
    likelyScanned: false,
  } as Parameters<typeof parseDictionary>[0];
  const { variables } = parseDictionary(doc, (v) => variableRecordId(file, v.name, v.position));
  docsParsed++;
  for (const v of variables) {
    if (!entry.recordIds.has(v.recordId)) unexpectedRecords++;
    newNotes.set(v.recordId, v.note);
  }
}
console.log(`re-parsed: ${docsParsed} docs · missing text on disk: ${docsMissingText} · records not in old corpus: ${unexpectedRecords}`);

// Patch the stream.
const tmp = RECORDS + '.note-patch';
mkdirSync(OUT, { recursive: true });
writeFileSync(tmp, ''); // truncate any stale scratch from a previous run
let changed = 0;
let unchanged = 0;
let droppedNote = 0;
{
  const rl = createInterface({ input: createReadStream(RECORDS), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    const fresh = newNotes.get(v.recordId);
    if (fresh !== undefined && fresh !== v.note) {
      if (v.note === undefined || v.note === '') droppedNote++; // note appeared where there was none
      changed++;
      v.note = fresh;
    } else {
      unchanged++;
    }
    appendFileSync(tmp, JSON.stringify(v) + '\n');
  }
}
console.log(`notes changed: ${changed} (of which newly present: ${droppedNote}) · unchanged: ${unchanged}`);

if (!process.argv.includes('--apply')) {
  console.log('dry run — nothing written. Re-run with --apply to rewrite corpus.jsonl.');
  writeFileSync(tmp, ''); // remove the scratch file
  process.exit(0);
}
renameSync(RECORDS, RECORDS + '.pre-note-patch');
renameSync(tmp, RECORDS);
console.log(`wrote ${RECORDS} (previous kept as corpus.jsonl.pre-note-patch)`);
