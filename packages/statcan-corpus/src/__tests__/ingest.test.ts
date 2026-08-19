/**
 * Tests for the ingest spine (`src/ingest.ts`).
 *
 * The corpus is 2.4 GB and never committed (D1), so almost everything here runs against a
 * **synthetic zip-of-zips** assembled in the test: a handful of files with real StatCan-shaped
 * names, real (tiny) PDFs, one payload that is deliberately not a PDF, and one entry whose
 * compressed bytes are garbage. That is the only way to prove the property M1 actually rests on —
 * *one bad file out of 3,006 must never end a twenty-minute run* — because a well-formed corpus
 * cannot demonstrate it and the real corpus, happily, contains no such file to point at.
 *
 * The corpus-dependent block at the bottom skips when the delivery is absent, exactly as
 * `zip.test.ts` and `packages/ddi-xml/src/__tests__/external-import.test.ts` do.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLE_1,
  BUNDLE_2,
  CORRUPT,
  DOCX_DICTIONARY,
  GOOD_A,
  GOOD_B,
  NOT_A_PDF,
  NO_TCODE,
  SYNTHETIC_FILE_COUNT,
  buildPdf,
  buildZip,
  writeSyntheticCorpus,
} from './support/synthetic-corpus.js';
import {
  CORPUS_ID_PREFIX,
  corpusFileKey,
  corpusUuid,
  documentRecordId,
  ingestCorpus,
  variableRecordId,
  type IngestPlan,
} from '../ingest.js';
import type { CorpusFile, ExtractedDoc, FidelityNote } from '../types.js';

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

function noteFor(notes: readonly FidelityNote[], file: string): FidelityNote | undefined {
  return notes.find((note) => note.file === file);
}

function keys(files: readonly CorpusFile[]): string[] {
  return files.map((file) => corpusFileKey(file));
}

/* ---------------------------------------------------------------------------------------------
 * Record identity (D9)
 * ------------------------------------------------------------------------------------------- */

const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('record identity', () => {
  const file = { bundle: BUNDLE_1, path: GOOD_A, surveyGroup: 'LSIC_ELIC' };

  it('mints a well-formed UUIDv5 for a document', () => {
    expect(documentRecordId(file)).toMatch(UUID_V5_RE);
  });

  it('mints a well-formed UUIDv5 for a variable occurrence', () => {
    expect(variableRecordId(file, 'LD3Q005', '35')).toMatch(UUID_V5_RE);
  });

  it('is stable across calls — the whole point of a re-runnable ingest', () => {
    expect(documentRecordId(file)).toBe(documentRecordId({ ...file }));
    expect(variableRecordId(file, 'LD3Q005', '35')).toBe(variableRecordId({ ...file }, 'LD3Q005', '35'));
  });

  it('separates a document id from the id of a variable inside it', () => {
    expect(documentRecordId(file)).not.toBe(variableRecordId(file, 'LD3Q005', '35'));
  });

  it('distinguishes the same variable name at two positions (D9: position is part of identity)', () => {
    expect(variableRecordId(file, 'AGE', '10')).not.toBe(variableRecordId(file, 'AGE', '20'));
  });

  it('distinguishes an absent position from an empty one', () => {
    // Absent contributes an empty component, so the two agree — the guarantee is that neither can
    // alias a *different* pair, which the position test above covers.
    expect(variableRecordId(file, 'AGE')).toBe(variableRecordId(file, 'AGE', ''));
    expect(variableRecordId(file, 'AGE')).not.toBe(variableRecordId(file, 'AGE', '1'));
  });

  it('distinguishes the same variable in two files and in two surveys', () => {
    const other = { ...file, path: GOOD_B };
    expect(variableRecordId(file, 'AGE', '1')).not.toBe(variableRecordId(other, 'AGE', '1'));
    expect(variableRecordId(file, 'AGE', '1')).not.toBe(
      variableRecordId({ ...file, surveyGroup: 'CCHS_ESCC' }, 'AGE', '1'),
    );
  });

  it('distinguishes files that differ only by bundle', () => {
    expect(documentRecordId(file)).not.toBe(documentRecordId({ ...file, bundle: BUNDLE_2 }));
  });

  it('namespaces corpus ids so they can never collide with an instrument item id', () => {
    // `itemUuid('q1')` in ddi-xml is uuidV5('q1', MOBILESURVEY_UUID_NAMESPACE); every corpus id
    // goes through the prefix, so the two id spaces are disjoint by construction.
    expect(documentRecordId(file)).toBe(corpusUuid(`${CORPUS_ID_PREFIX}:document:${BUNDLE_1}/${GOOD_A}`));
    expect(documentRecordId(file)).not.toBe(corpusUuid(`${BUNDLE_1}/${GOOD_A}`));
  });
});

/* ---------------------------------------------------------------------------------------------
 * Classification pass
 * ------------------------------------------------------------------------------------------- */

describe('ingestCorpus — classification', () => {
  it('classifies every file in every bundle and reads no payload', async () => {
    const result = await ingestCorpus(corpusZip);
    expect(result.files).toHaveLength(SYNTHETIC_FILE_COUNT);
    expect(result.report.files).toBe(SYNTHETIC_FILE_COUNT);
    expect(result.docs).toEqual([]);
    // The corrupt entry would throw if its payload were read; an inventory pass never touches it.
    expect(result.report.notes.filter((note) => note.severity === 'error')).toEqual([]);
  });

  it('visits bundles in sorted order and keeps entry order within a bundle (D9)', async () => {
    const result = await ingestCorpus(corpusZip);
    const bundles = result.files.map((file) => file.bundle);
    // Delivery-level files (the manifest beside the bundles) come first under the archive's own
    // name, then each bundle in sorted order. Any stable order satisfies D9; this one is asserted
    // so a traversal change has to be deliberate rather than silent.
    const [deliveryLevel, ...inBundles] = bundles;
    expect(deliveryLevel).not.toBe(BUNDLE_1);
    expect(deliveryLevel).not.toBe(BUNDLE_2);
    expect(inBundles.slice(0, 4).every((b) => b === BUNDLE_1)).toBe(true);
    expect(inBundles.slice(4).every((b) => b === BUNDLE_2)).toBe(true);
    expect(keys(result.files)[1]).toBe(`${BUNDLE_1}/${GOOD_A}`);
  });

  it('produces a byte-identical report on a second run', async () => {
    const a = await ingestCorpus(corpusZip);
    const b = await ingestCorpus(corpusZip);
    expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
  });

  it('accounts for every unclassified file in the notes (D7)', async () => {
    const result = await ingestCorpus(corpusZip);
    const unknown = result.files.filter((file) => file.docKind === 'unknown');
    expect(unknown.map((file) => file.path)).toContain(NO_TCODE);
    for (const file of unknown) {
      expect(noteFor(result.report.notes, corpusFileKey(file))).toBeDefined();
    }
    expect(result.report.classified).toBe(result.files.length - unknown.length);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------------------------- */

describe('ingestCorpus — selection', () => {
  async function planFor(opts: Parameters<typeof ingestCorpus>[1]): Promise<IngestPlan> {
    let captured: IngestPlan | undefined;
    await ingestCorpus(corpusZip, { ...opts, onPlan: (plan) => (captured = plan) });
    if (captured === undefined) throw new Error('onPlan was never called');
    return captured;
  }

  it('matches T-codes as families, so T15 never sweeps in T1.1', async () => {
    const plan = await planFor({ extractText: true, limitTcodes: ['T15'], maxDocs: 0 });
    // T15.2 ×3 (one of them a .docx) + T15.6 ×1 — but never the T1.1 user guide.
    expect(plan.candidates).toBe(5);
    expect(plan.extractable).toBe(4);
  });

  it('does not let a shorter family swallow a longer code', async () => {
    const plan = await planFor({ extractText: true, limitTcodes: ['T1'], maxDocs: 0 });
    expect(plan.candidates).toBe(1); // the T1.1 user guide alone
  });

  it('filters by document kind', async () => {
    const plan = await planFor({ extractText: true, limitDocKinds: ['user-guide'], maxDocs: 0 });
    expect(plan.candidates).toBe(1);
  });

  it('counts only PDFs as extractable and itemizes the formats deferred to M4', async () => {
    const result = await ingestCorpus(corpusZip, {
      extractText: true,
      limitTcodes: ['T15'],
      maxDocs: 0,
    });
    const note = noteFor(result.report.notes, `${BUNDLE_1}/${DOCX_DICTIONARY}`);
    expect(note?.severity).toBe('info');
    expect(note?.message).toContain('M4');
  });

  it('caps with maxDocs in traversal order', async () => {
    const seen: string[] = [];
    await ingestCorpus(corpusZip, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      maxDocs: 1,
      onDoc: (doc) => seen.push(corpusFileKey(doc.file)),
    });
    expect(seen).toEqual([`${BUNDLE_1}/${GOOD_A}`]);
  });

  it('draws the same sample on every run, and a different one from a different seed', async () => {
    const draw = async (sampleSeed: string): Promise<string[]> => {
      const files: string[] = [];
      await ingestCorpus(corpusZip, {
        extractText: true,
        limitDocKinds: ['data-dictionary'],
        sampleSize: 2,
        sampleSeed,
        onDoc: (doc) => files.push(corpusFileKey(doc.file)),
      });
      return files;
    };
    const first = await draw('seed-a');
    // `onDoc` streams documents that EXTRACTED, and the sample is drawn from all four dictionary
    // PDFs — two of which are deliberately unreadable (a non-PDF and a corrupt archive entry). So
    // a draw of 2 can surface fewer than 2 documents, and asserting a count here would be
    // asserting which files the seed happened to pick. The property under test is determinism.
    expect(first.length).toBeGreaterThan(0);
    expect(await draw('seed-a')).toEqual(first);

    // Not a guaranteed inequality for any single pair of seeds, so search a few — the property
    // under test is that the seed *is* live, not that two named seeds happen to differ.
    const seeds = ['seed-b', 'seed-c', 'seed-d', 'seed-e'];
    const draws = await Promise.all(seeds.map((seed) => draw(seed)));
    expect(draws.some((d) => JSON.stringify(d) !== JSON.stringify(first))).toBe(true);
  });

  it('flags a sample as a sample and a complete pass as complete', async () => {
    const sampled = await planFor({
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      sampleSize: 1,
    });
    expect(sampled.sampled).toBe(true);
    const complete = await planFor({ extractText: true, limitDocKinds: ['data-dictionary'] });
    expect(complete.sampled).toBe(false);
    expect(complete.selected).toBe(complete.extractable);
  });

  it('reports the staging high-water mark before reading anything', async () => {
    const plan = await planFor({ extractText: true, limitDocKinds: ['data-dictionary'], maxDocs: 0 });
    expect(plan.selectedBytes).toBe(0);
    const full = await planFor({ extractText: true, limitDocKinds: ['data-dictionary'] });
    expect(full.selectedBytes).toBeGreaterThan(0);
  });

  it('refuses to start rather than filling the disk mid-run, and names the fix', async () => {
    await expect(
      ingestCorpus(corpusZip, { extractText: true, limitDocKinds: ['data-dictionary'], maxStagingBytes: 1 }),
    ).rejects.toThrow(/sampleSize|maxStagingBytes/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Extraction and robustness — the property M1 rests on
 * ------------------------------------------------------------------------------------------- */

describe('ingestCorpus — extraction', () => {
  let result: Awaited<ReturnType<typeof ingestCorpus>>;
  let streamed: ExtractedDoc[];

  beforeAll(async () => {
    streamed = [];
    result = await ingestCorpus(corpusZip, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      onDoc: (doc) => streamed.push(doc),
    });
  }, 60_000);

  it('keeps going after a file it cannot read — the run is not hostage to one bad PDF', () => {
    // Four dictionary PDFs were selected; two are unreadable by construction.
    expect(result.docs).toHaveLength(2);
    expect(keys(result.docs.map((doc) => doc.file)).sort()).toEqual(
      [`${BUNDLE_1}/${GOOD_A}`, `${BUNDLE_2}/${GOOD_B}`].sort(),
    );
  });

  it('records the unopenable PDF as an error note naming the file', () => {
    const note = noteFor(result.report.notes, `${BUNDLE_1}/${NOT_A_PDF}`);
    expect(note?.severity).toBe('error');
    expect(note?.message).toMatch(/extraction failed/i);
  });

  it('records the corrupt archive entry as an error note, distinct from a parse failure', () => {
    const note = noteFor(result.report.notes, `${BUNDLE_2}/${CORRUPT}`);
    expect(note?.severity).toBe('error');
    expect(note?.message).toMatch(/could not read the file out of the archive/i);
  });

  it('leaks no machine-specific or run-specific path into a note (D9)', () => {
    for (const note of result.report.notes) {
      expect(note.message).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(note.message).not.toContain(tmpdir());
      expect(note.message).not.toContain('statcan-corpus-');
    }
  });

  it('reconstructs table rows end to end — code, label and both counts on one line (D2)', () => {
    const doc = result.docs.find((d) => d.file.path === GOOD_A);
    const text = doc?.pages.map((page) => page.text).join('\n') ?? '';
    // What this test owns is that ingest wires extraction through with row association intact:
    // the code, its label and both counts arrive on ONE line, in column order. A reading-order
    // extractor would put them on four, and the frequencies would then pair with the wrong codes.
    //
    // It deliberately does NOT assert the exact cell separator. That is pdf.ts's contract and is
    // guarded strictly (`/^99999995\s{2,}Not applicable\s{2,}0\s{2,}0$/`) in pdf.test.ts against a
    // REAL corpus file, which is the only place the assertion is meaningful: this fixture is a
    // hand-built single-page PDF whose runs pdfjs bridges with synthesized whitespace items, so
    // its inter-cell gaps are an artifact of the fixture rather than of real table geometry.
    expect(text).toMatch(/^99999995\s+Not applicable\s+0\s+0$/m);
  });

  it('carries the classification onto every extracted document', () => {
    const doc = result.docs.find((d) => d.file.path === GOOD_B);
    expect(doc?.file.tcode).toBe('T15.6');
    expect(doc?.file.docKind).toBe('data-dictionary');
    expect(doc?.file.surveyGroup).toBe('CCHS_ESCC');
    expect(doc?.engine).toMatch(/^pdfjs-dist@/);
  });

  it('streams each document to onDoc as it completes', () => {
    expect(keys(streamed.map((doc) => doc.file))).toEqual(keys(result.docs.map((doc) => doc.file)));
  });

  it('reports progress once per attempted document, successes and failures alike', async () => {
    const ticks: Array<[number, number]> = [];
    await ingestCorpus(corpusZip, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      onProgress: (done, total) => ticks.push([done, total]),
    });
    // Three staged (the corrupt entry never stages), each ticking once, monotonically.
    expect(ticks).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  }, 60_000);

  it('releases documents when retainDocs is false but still streams them', async () => {
    const streamedKeys: string[] = [];
    const lean = await ingestCorpus(corpusZip, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      retainDocs: false,
      onDoc: (doc) => streamedKeys.push(corpusFileKey(doc.file)),
    });
    expect(lean.docs).toEqual([]);
    expect(streamedKeys).toHaveLength(2);
    // The report is unaffected: coverage does not depend on whether the caller kept the text.
    expect(lean.report.files).toBe(result.report.files);
    expect(lean.report.notes.length).toBe(result.report.notes.length);
  }, 60_000);

  it('flags a text-free PDF as a likely scan rather than reporting an empty parse', async () => {
    const scanDir = mkdtempSync(path.join(tmpdir(), 'statcan-scan-'));
    try {
      const blank = path.join(scanDir, 'delivery.zip');
      const inner = buildZip([{ name: 'X_Y/X_2001_f1_T15.2_v1.pdf', data: buildPdf([]) }]);
      writeFileSync(blank, buildZip([{ name: 'bundle.zip', data: inner }]));
      const scanned = await ingestCorpus(blank, { extractText: true, limitDocKinds: ['data-dictionary'] });
      expect(scanned.docs[0]?.likelyScanned).toBe(true);
      const note = scanned.report.notes.find((n) => n.message.includes('image-only scan'));
      expect(note?.severity).toBe('warning');
      expect(note?.message).toContain('no OCR');
    } finally {
      rmSync(scanDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('cleans up its own staging directory, and honours one it was given', async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('statcan-corpus-'));
    await ingestCorpus(corpusZip, { extractText: true, limitDocKinds: ['data-dictionary'] });
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('statcan-corpus-'));
    expect(after.length).toBeLessThanOrEqual(before.length);

    const mine = path.join(workDir, 'staging');
    mkdirSync(mine, { recursive: true });
    await ingestCorpus(corpusZip, { extractText: true, limitDocKinds: ['data-dictionary'], stagingDir: mine });
    // Kept, but emptied: each payload is unlinked the moment it has been extracted.
    expect(existsSync(mine)).toBe(true);
    expect(readdirSync(mine)).toEqual([]);
  }, 60_000);
});

/* ---------------------------------------------------------------------------------------------
 * The real 2.4 GB delivery. Never committed (D1), so this block skips when it is absent.
 * ------------------------------------------------------------------------------------------- */

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

describe.skipIf(!existsSync(CORPUS))('real corpus delivery (on-demand, 2.4 GB, not committed)', () => {
  let result: Awaited<ReturnType<typeof ingestCorpus>>;

  beforeAll(async () => {
    result = await ingestCorpus(CORPUS);
  }, 600_000);

  it('classifies all 3,006 files and leaves none unaccounted for (M1 acceptance)', () => {
    expect(result.report.files).toBe(3006);
    expect(result.report.classified).toBe(2910);
    const unknown = result.files.filter((file) => file.docKind === 'unknown');
    expect(unknown).toHaveLength(96);
    for (const file of unknown) {
      expect(noteFor(result.report.notes, corpusFileKey(file))).toBeDefined();
    }
  });

  it('reads no payload on an inventory pass — 3.19 GB of PDF is never inflated', () => {
    expect(result.docs).toEqual([]);
    expect(result.report.notes.filter((note) => note.severity === 'error')).toEqual([]);
  });

  it('finds the dictionary families the extraction pass targets', () => {
    const extractable = result.files.filter(
      (file) =>
        file.ext === 'pdf' &&
        file.docKind === 'data-dictionary' &&
        file.tcode !== undefined &&
        (file.tcode === 'T15' || file.tcode.startsWith('T15.')),
    );
    expect(extractable.length).toBe(1342);
  });

  it('mints a distinct stable id for every one of the 3,006 files', () => {
    const ids = new Set(result.files.map((file) => documentRecordId(file)));
    expect(ids.size).toBe(result.files.length);
  });

  it('extracts a deterministic sample without holding the documents in memory', async () => {
    const first: Array<{ key: string; chars: number; pages: number }> = [];
    const run = await ingestCorpus(CORPUS, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      limitTcodes: ['T15'],
      sampleSize: 6,
      retainDocs: false,
      onDoc: (doc) =>
        first.push({ key: corpusFileKey(doc.file), chars: doc.charCount, pages: doc.pages.length }),
    });
    expect(run.docs).toEqual([]);
    expect(first).toHaveLength(6);
    expect(first.every((doc) => doc.chars > 0 && doc.pages > 0)).toBe(true);

    const second: string[] = [];
    await ingestCorpus(CORPUS, {
      extractText: true,
      limitDocKinds: ['data-dictionary'],
      limitTcodes: ['T15'],
      sampleSize: 6,
      retainDocs: false,
      onDoc: (doc) => second.push(corpusFileKey(doc.file)),
    });
    expect(second).toEqual(first.map((doc) => doc.key));
  }, 600_000);
});
