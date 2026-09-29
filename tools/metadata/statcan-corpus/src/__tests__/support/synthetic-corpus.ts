/**
 * A corpus delivery small enough to commit, for tests that must not depend on the real 2.4 GB
 * archive (D1).
 *
 * Everything here is written by hand rather than fixtured, because what the ingest tests need to
 * prove cannot be demonstrated with well-formed input: a PDF that pdfjs refuses to open, an
 * archive entry whose compressed bytes are garbage, and a file whose name carries no document-type
 * code. The real corpus, happily, has no such file to point at.
 *
 * Not a test file itself — vitest only collects `*.test.ts`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* ---------------------------------------------------------------------------------------------
 * A zip writer, just large enough to build a corpus delivery.
 *
 * Stored (method 0) entries only, no ZIP64, no data descriptors — the reader supports far more
 * than this, and `zip.test.ts` already exercises those paths against hand-built archives. What is
 * needed here is a *valid* archive so the ingest can be tested, plus one deliberately corrupt
 * entry.
 * ------------------------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  data: Buffer;
  /** Claim deflate but store raw bytes, so inflating the entry throws. */
  corrupt?: boolean;
}

export function buildZip(entries: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.corrupt ? 8 : 0;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + entry.data.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

/* ---------------------------------------------------------------------------------------------
 * A PDF writer, just large enough to test a PDF reader.
 * ------------------------------------------------------------------------------------------- */

/** One text run placed at an absolute point in PDF user space (y measured upward). */
export interface PdfRun {
  x: number;
  y: number;
  text: string;
}

/**
 * A single-page PDF drawing the given runs with Helvetica.
 *
 * Real byte offsets and a real xref table, because pdfjs's recovery path for a broken xref would
 * make a test pass for the wrong reason. One page, so a whole test file's worth of extraction
 * costs a fraction of a second.
 */
export function buildPdf(runs: readonly PdfRun[]): Buffer {
  const escape = (s: string): string => s.replace(/([\\()])/g, '\\$1');
  const content = [
    'BT',
    '/F1 10 Tf',
    ...runs.map((run) => `1 0 0 1 ${run.x} ${run.y} Tm (${escape(run.text)}) Tj`),
    'ET',
  ].join('\n');

  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${at.toString().padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * A dictionary page: a `Variable Name:` field label and one code-table row whose code, label and
 * two count columns sit on a single baseline — the row association that only survives because
 * extraction reconstructs rows from geometry (D2).
 */
export function codeRowPdf(): Buffer {
  return buildPdf([
    { x: 40, y: 160, text: 'Variable Name:' },
    { x: 140, y: 160, text: 'LD3Q005' },
    { x: 40, y: 120, text: '99999995' },
    { x: 140, y: 120, text: 'Not applicable' },
    { x: 320, y: 120, text: '0' },
    { x: 420, y: 120, text: '0' },
  ]);
}

/* ---------------------------------------------------------------------------------------------
 * The synthetic delivery
 * ------------------------------------------------------------------------------------------- */

export const BUNDLE_1 = 'RDC Nonconfidential Documentation (1).zip';
export const BUNDLE_2 = 'RDC Nonconfidential Documentation (2).zip';

/** Two dictionary PDFs that read cleanly. */
export const GOOD_A = 'LSIC_ELIC/LSIC_W3/LSIC_2005_f1_T15-2_v1.pdf';
export const GOOD_B = 'CCHS_ESCC/CCHS_ESCC_2013/CCHS_2013_T15.6_v1.pdf';
/** A `.pdf` whose bytes are not a PDF: pdfjs throws, the run must continue. */
export const NOT_A_PDF = 'GSS_ESG/GSS_2010/gss_2010_f1_T15.2_v2.pdf';
/** A dictionary whose archive entry cannot even be inflated. */
export const CORRUPT = 'APS_EAPA/APS_2012/aps_2012_f1_T15.2_v1.pdf';
/** A dictionary in a format M1 cannot open — deferred to M4, and said so in the report. */
export const DOCX_DICTIONARY = 'SLID_EDTR/SLID_1999/slid_1999_T15.2_DataDictionary.docx';
/** A different T-code family, to prove family matching does not over-select. */
export const USER_GUIDE = 'LFS_EPA/LFS_2020/LFS_2020_T1.1_UserGuide_eng.pdf';
/** A filename carrying no document-type code at all. */
export const NO_TCODE = 'CEN_REC/CEN_2006/CEN_2006_EN Public.pdf';

/**
 * Write a synthetic corpus delivery into a fresh temp directory and return its path. The caller
 * owns the directory and should remove it.
 */
export function writeSyntheticCorpus(): { dir: string; zipPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'statcan-corpus-test-'));
  const bundleOne = buildZip([
    { name: 'LSIC_ELIC/', data: Buffer.alloc(0) },
    { name: GOOD_A, data: codeRowPdf() },
    { name: NOT_A_PDF, data: Buffer.from('this is emphatically not a PDF', 'utf8') },
    { name: USER_GUIDE, data: buildPdf([{ x: 40, y: 160, text: 'Labour Force Survey guide' }]) },
    { name: DOCX_DICTIONARY, data: Buffer.from('PK pretend docx', 'latin1') },
  ]);
  const bundleTwo = buildZip([
    { name: GOOD_B, data: codeRowPdf() },
    { name: CORRUPT, data: Buffer.from('not deflate data at all', 'utf8'), corrupt: true },
    { name: NO_TCODE, data: buildPdf([{ x: 40, y: 160, text: 'census' }]) },
  ]);
  const zipPath = path.join(dir, 'delivery.zip');
  writeFileSync(
    zipPath,
    buildZip([
      { name: 'MANIFEST_RDC Nonconfidential Documentation.html', data: Buffer.from('<html></html>') },
      { name: BUNDLE_1, data: bundleOne },
      { name: BUNDLE_2, data: bundleTwo },
    ]),
  );
  return { dir, zipPath };
}

/** Files in the synthetic delivery, across both bundles plus the manifest. */
export const SYNTHETIC_FILE_COUNT = 8;
