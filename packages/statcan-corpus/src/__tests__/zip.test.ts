/**
 * Tests for the minimal zip reader (`src/zip.ts`).
 *
 * The archives are hand-assembled here rather than fixtured, for two reasons. The corpus is 2.4 GB
 * and never committed (D1), so the reader has to be provable without it — and hand-assembly is the
 * only way to exercise the paths that matter but that a well-behaved zip writer will not produce on
 * demand: ZIP64 sentinel sizes, CP437 names, an archive comment ahead of the EOCD, a bogus
 * compression method, a directory that disagrees with its EOCD.
 *
 * The corpus-dependent block skips when the delivery is absent, exactly as
 * `packages/ddi-xml/src/__tests__/external-import.test.ts` does, so a fresh clone stays green.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { forEachCorpusFile, listEntries, listNestedZips, readEntry, type ZipEntry } from '../zip.js';

// ---------------------------------------------------------------------------------------------
// A zip writer, just large enough to test a zip reader.
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface BuildFile {
  name: string;
  data: Buffer;
  /** Store uncompressed (method 0) instead of deflating. */
  store?: boolean;
  /** Force a compression method code, to test rejection of the ones we do not implement. */
  method?: number;
  /** Raw name bytes, for testing non-UTF-8 encodings. */
  rawName?: Buffer;
  /** General-purpose bit flags; defaults to bit 11 (UTF-8 names), as the corpus sets. */
  flags?: number;
}

function buildZip(files: BuildFile[], opts: { comment?: string } = {}): Buffer {
  const body: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = f.rawName ?? Buffer.from(f.name, 'utf8');
    const flags = f.flags ?? 0x800;
    const method = f.method ?? (f.store ? 0 : 8);
    const payload = method === 8 ? deflateRawSync(f.data) : f.data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(f.data), 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    body.push(local, name, payload);

    const cfh = Buffer.alloc(46);
    cfh.writeUInt32LE(0x02014b50, 0);
    cfh.writeUInt16LE(20, 4);
    cfh.writeUInt16LE(20, 6);
    cfh.writeUInt16LE(flags, 8);
    cfh.writeUInt16LE(method, 10);
    cfh.writeUInt32LE(crc32(f.data), 16);
    cfh.writeUInt32LE(payload.length, 20);
    cfh.writeUInt32LE(f.data.length, 24);
    cfh.writeUInt16LE(name.length, 28);
    cfh.writeUInt32LE(offset, 42);
    central.push(cfh, name);

    offset += 30 + name.length + payload.length;
  }
  const directory = Buffer.concat(central);
  const comment = Buffer.from(opts.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...body, directory, eocd, comment]);
}

/**
 * A single-entry archive that puts every size and offset behind a ZIP64 sentinel: the classic
 * fields all read 0xFFFFFFFF/0xFFFF, and the real values live in the 0x0001 extra field and the
 * ZIP64 EOCD record. This is the shape a >4 GB archive takes, produced here at 40 bytes.
 */
function buildZip64(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const payload = deflateRawSync(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(45, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const bodyLen = 30 + nameBuf.length + payload.length;

  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(data.length), 4);
  extra.writeBigUInt64LE(BigInt(payload.length), 12);
  extra.writeBigUInt64LE(0n, 20); // local header offset

  const cfh = Buffer.alloc(46);
  cfh.writeUInt32LE(0x02014b50, 0);
  cfh.writeUInt16LE(45, 4);
  cfh.writeUInt16LE(45, 6);
  cfh.writeUInt16LE(0x800, 8);
  cfh.writeUInt16LE(8, 10);
  cfh.writeUInt32LE(crc32(data), 16);
  cfh.writeUInt32LE(0xffffffff, 20);
  cfh.writeUInt32LE(0xffffffff, 24);
  cfh.writeUInt16LE(nameBuf.length, 28);
  cfh.writeUInt16LE(extra.length, 30);
  cfh.writeUInt32LE(0xffffffff, 42);
  const directory = Buffer.concat([cfh, nameBuf, extra]);

  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(0x06064b50, 0);
  rec.writeBigUInt64LE(BigInt(56 - 12), 4);
  rec.writeUInt16LE(45, 12);
  rec.writeUInt16LE(45, 14);
  rec.writeBigUInt64LE(1n, 24);
  rec.writeBigUInt64LE(1n, 32);
  rec.writeBigUInt64LE(BigInt(directory.length), 40);
  rec.writeBigUInt64LE(BigInt(bodyLen), 48);

  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeBigUInt64LE(BigInt(bodyLen + directory.length), 8);
  loc.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([local, nameBuf, payload, directory, rec, loc, eocd]);
}

const HELLO = Buffer.from('Variable Name:  HHLDID  Position:  1  Length:  14\n', 'utf8');
const BINARY = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff]);

function byPath(entries: ZipEntry[]): Record<string, ZipEntry> {
  return Object.fromEntries(entries.map((e) => [e.path, e]));
}

// ---------------------------------------------------------------------------------------------

describe('listEntries', () => {
  it('reads the central directory of a hand-built archive', () => {
    const zip = buildZip([
      { name: 'CCHS_ESCC/', data: Buffer.alloc(0), store: true },
      { name: 'CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf', data: HELLO },
      { name: 'CCHS_ESCC/layout.bin', data: BINARY, store: true },
    ]);
    const entries = listEntries(zip);
    expect(entries.map((e) => e.path)).toEqual([
      'CCHS_ESCC/',
      'CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf',
      'CCHS_ESCC/layout.bin',
    ]);
    const map = byPath(entries);
    expect(map['CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf']!.method).toBe(8);
    expect(map['CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf']!.sizeBytes).toBe(HELLO.length);
    expect(map['CCHS_ESCC/layout.bin']!.method).toBe(0);
    expect(map['CCHS_ESCC/layout.bin']!.compressedSize).toBe(BINARY.length);
    // Directory entries are kept and are identifiable by the trailing slash.
    expect(map['CCHS_ESCC/']!.sizeBytes).toBe(0);
  });

  it('locates the EOCD behind an archive comment', () => {
    const zip = buildZip([{ name: 'a.txt', data: HELLO }], { comment: 'x'.repeat(3000) });
    expect(listEntries(zip).map((e) => e.path)).toEqual(['a.txt']);
  });

  it('decodes UTF-8 names when the language-encoding flag is set', () => {
    // Both of these are real corpus filenames.
    const names = ['Vital Statistics Death Database/sec_décès_2014_t15.2_v1.pdf', 'SYC_EJC_2010/EJC2010_Enfant_Maître_LvCds.pdf'];
    const zip = buildZip(names.map((name) => ({ name, data: HELLO })));
    expect(listEntries(zip).map((e) => e.path)).toEqual(names);
  });

  it('falls back to CP437 for names without the UTF-8 flag', () => {
    // "décès.pdf" as an MS-DOS zip writer would store it: é = 0x82, è = 0x8a.
    const rawName = Buffer.from([0x64, 0x82, 0x63, 0x8a, 0x73, 0x2e, 0x70, 0x64, 0x66]);
    const zip = buildZip([{ name: 'ignored', rawName, flags: 0, data: HELLO }]);
    expect(listEntries(zip)[0]!.path).toBe('décès.pdf');
  });

  it('resolves ZIP64 sentinel sizes and offsets from the extra field and EOCD record', () => {
    const zip = buildZip64('big/T15_2.pdf', HELLO);
    const entries = listEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('big/T15_2.pdf');
    expect(entries[0]!.sizeBytes).toBe(HELLO.length);
    expect(entries[0]!.offset).toBe(0);
    expect(readEntry(zip, entries[0]!)).toEqual(HELLO);
  });

  it('fails loudly on a buffer that is not a zip', () => {
    expect(() => listEntries(Buffer.alloc(400, 0x41))).toThrow(/no End Of Central Directory record/);
  });

  it('fails loudly on ZIP64 sentinels with no ZIP64 EOCD record', () => {
    const zip = buildZip([{ name: 'a.txt', data: HELLO }]);
    zip.writeUInt32LE(0xffffffff, zip.length - 22 + 16); // central directory offset
    expect(() => listEntries(zip)).toThrow(/ZIP64 sentinels but no ZIP64 EOCD locator/);
  });

  it('fails loudly when the directory and the EOCD disagree on entry count', () => {
    const zip = buildZip([{ name: 'a.txt', data: HELLO }, { name: 'b.txt', data: HELLO }]);
    zip.writeUInt16LE(5, zip.length - 22 + 10);
    expect(() => listEntries(zip)).toThrow(/holds 2 entries but the EOCD declares 5/);
  });
});

describe('readEntry', () => {
  it('round-trips deflated and stored payloads', () => {
    const zip = buildZip([
      { name: 'deflated.txt', data: HELLO },
      { name: 'stored.bin', data: BINARY, store: true },
    ]);
    const entries = listEntries(zip);
    expect(readEntry(zip, entries[0]!)).toEqual(HELLO);
    expect(readEntry(zip, entries[1]!)).toEqual(BINARY);
  });

  it('returns a buffer that does not alias the archive', () => {
    const zip = buildZip([{ name: 'stored.bin', data: BINARY, store: true }]);
    const entry = listEntries(zip)[0]!;
    const out = readEntry(zip, entry);
    out.fill(0);
    expect(readEntry(zip, entry)).toEqual(BINARY);
  });

  it('honours the local header extra field when locating the payload', () => {
    // The corpus's outer entries carry a 20-byte ZIP64 extra locally and none centrally, so the
    // payload does not start where the central directory's extra length would suggest.
    const zip = buildZip([{ name: 'a.txt', data: HELLO }]);
    const extra = Buffer.alloc(6, 0);
    extra.writeUInt16LE(0x9999, 0);
    extra.writeUInt16LE(2, 2);
    const patched = Buffer.concat([
      zip.subarray(0, 30 + 5),
      extra,
      zip.subarray(30 + 5),
    ]);
    patched.writeUInt16LE(extra.length, 28); // local extra length
    // Everything after the local header shifted, so fix the central directory's offsets too.
    const cdOffset = patched.length - 22 - (zip.length - 22 - patched.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(cdOffset).toBeGreaterThan(0);
    patched.writeUInt32LE(patched.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), patched.length - 22 + 16);
    expect(readEntry(patched, listEntries(patched)[0]!)).toEqual(HELLO);
  });

  it('fails loudly on an unsupported compression method', () => {
    const zip = buildZip([{ name: 'bzipped.txt', data: HELLO, method: 12 }]);
    expect(() => readEntry(zip, listEntries(zip)[0]!)).toThrow(/unsupported compression method 12/);
  });

  it('fails loudly when the local header is missing', () => {
    const zip = buildZip([{ name: 'a.txt', data: HELLO }]);
    zip.writeUInt32LE(0, 0);
    expect(() => readEntry(zip, listEntries(zip)[0]!)).toThrow(/no local file header at offset 0/);
  });

  it('fails loudly when the payload does not inflate to the declared size', () => {
    const zip = buildZip([{ name: 'a.txt', data: HELLO }]);
    const entry = listEntries(zip)[0]!;
    zip.writeUInt8(zip[35]! ^ 0xff, 35); // corrupt the deflate stream
    expect(() => readEntry(zip, entry)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Nested traversal, against a synthetic zip-of-zips with the same shape as the corpus delivery.
// ---------------------------------------------------------------------------------------------

const tmp = mkdtempSync(path.join(tmpdir(), 'statcan-zip-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Inner bundle 1, with one entry whose local header is deliberately destroyed. */
function bundleOne(): { buf: Buffer; brokenPath: string } {
  const buf = buildZip([
    { name: 'CCHS_ESCC/', data: Buffer.alloc(0), store: true },
    { name: 'CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf', data: HELLO },
    { name: 'CCHS_ESCC/broken_T15_6_v1.pdf', data: BINARY },
  ]);
  const broken = listEntries(buf).find((e) => e.path.includes('broken'))!;
  buf.writeUInt32LE(0, broken.offset);
  return { buf, brokenPath: broken.path };
}

const inner1 = bundleOne();
const inner2 = buildZip([
  { name: 'APS_EAPA/', data: Buffer.alloc(0), store: true },
  { name: 'APS_EAPA/aps_2017_T1_1_v1.pdf', data: HELLO },
]);
const outerPath = path.join(tmp, 'corpus.zip');
writeFileSync(
  outerPath,
  buildZip([
    { name: 'RDC Nonconfidential Documentation (2).zip', data: inner2 },
    { name: 'RDC Nonconfidential Documentation (1).zip', data: inner1.buf },
    { name: 'MANIFEST.html', data: Buffer.from('<html></html>', 'utf8') },
  ]),
);

describe('listNestedZips', () => {
  it('returns the nested bundles, sorted, excluding non-zip entries', () => {
    expect(listNestedZips(outerPath)).toEqual([
      'RDC Nonconfidential Documentation (1).zip',
      'RDC Nonconfidential Documentation (2).zip',
    ]);
  });

  it('fails loudly on a path that is not an archive', () => {
    const junk = path.join(tmp, 'junk.zip');
    writeFileSync(junk, Buffer.alloc(500, 0x41));
    expect(() => listNestedZips(junk)).toThrow(/no End Of Central Directory record/);
  });
});

describe('forEachCorpusFile', () => {
  it('visits every file in every bundle and skips directory entries', () => {
    const seen: Array<[string, string]> = [];
    forEachCorpusFile(outerPath, (bundle, entry) => seen.push([bundle, entry.path]));
    expect(seen).toEqual([
      // Delivery-level files come first, reported under the archive's own name. Today's corpus
      // holds nothing but bundles at this level, but a stray README must reach the ingest report
      // rather than vanish (D7) — so the traversal surfaces it instead of filtering it out.
      ['corpus.zip', 'MANIFEST.html'],
      ['RDC Nonconfidential Documentation (1).zip', 'CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf'],
      ['RDC Nonconfidential Documentation (1).zip', 'CCHS_ESCC/broken_T15_6_v1.pdf'],
      ['RDC Nonconfidential Documentation (2).zip', 'APS_EAPA/aps_2017_T1_1_v1.pdf'],
    ]);
  });

  it('reads a delivery-level file’s payload like any other', () => {
    const seen = new Map<string, Buffer>();
    forEachCorpusFile(outerPath, (bundle, entry, read) => {
      if (entry.path === 'MANIFEST.html') seen.set(bundle, read());
    });
    expect(seen.get('corpus.zip')?.toString('utf8')).toBe('<html></html>');
  });

  it('reads payloads on demand', () => {
    const contents = new Map<string, Buffer>();
    forEachCorpusFile(outerPath, (_bundle, entry, read) => {
      if (entry.path.endsWith('T15_2_v1.pdf')) contents.set(entry.path, read());
    });
    expect(contents.get('CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf')).toEqual(HELLO);
  });

  it('is lazy: an unreadable entry only fails if its payload is actually requested', () => {
    // Bundle 1 contains an entry whose local header was destroyed. A pass over names and sizes must
    // not touch it — this is what lets the inventory pass skip 3.19 GB of PDF payload.
    expect(() => forEachCorpusFile(outerPath, () => {})).not.toThrow();
    expect(() =>
      forEachCorpusFile(outerPath, (_b, entry, read) => {
        if (entry.path === inner1.brokenPath) read();
      }),
    ).toThrow(/no local file header/);
  });

  it('reports sizes from the central directory', () => {
    const sizes = new Map<string, number>();
    forEachCorpusFile(outerPath, (_bundle, entry) => sizes.set(entry.path, entry.sizeBytes));
    expect(sizes.get('CCHS_ESCC/CCHS_2011_2012_T15_2_v1.pdf')).toBe(HELLO.length);
    expect(sizes.get('APS_EAPA/aps_2017_T1_1_v1.pdf')).toBe(HELLO.length);
  });
});

// ---------------------------------------------------------------------------------------------
// The real 2.4 GB delivery. Never committed (D1), so this block skips when it is absent.
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

describe.skipIf(!existsSync(CORPUS))('real corpus delivery (on-demand, 2.4 GB, not committed)', () => {
  it('lists the seven nested bundles from two small reads', () => {
    const bundles = listNestedZips(CORPUS);
    expect(bundles).toHaveLength(7);
    expect(bundles[0]).toBe('RDC Nonconfidential Documentation (1).zip');
    expect(bundles[6]).toBe('RDC Nonconfidential Documentation (7).zip');
  });

  it('traverses exactly 3,006 files across 318 survey groups', () => {
    const perBundle = new Map<string, number>();
    const byExt = new Map<string, number>();
    const groups = new Set<string>();
    let files = 0;
    let bytes = 0;
    let manifest: Buffer | undefined;

    const t0 = performance.now();
    forEachCorpusFile(CORPUS, (bundle, entry, read) => {
      files++;
      bytes += entry.sizeBytes;
      perBundle.set(bundle, (perBundle.get(bundle) ?? 0) + 1);
      const ext = entry.path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '(none)';
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
      if (entry.path.includes('/')) groups.add(entry.path.slice(0, entry.path.indexOf('/')));
      // One lazy read, to prove the payload path works end to end on the real delivery.
      if (!manifest && entry.path === 'MANIFEST_RDC Nonconfidential Documentation.html') manifest = read();
    });
    const ms = Math.round(performance.now() - t0);
    console.log(
      `corpus: ${files} files, ${(bytes / 1e9).toFixed(2)} GB uncompressed, ${groups.size} groups, ` +
        `traversed in ${ms} ms, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`,
    );
    console.log('corpus: per bundle', Object.fromEntries([...perBundle].map(([k, v]) => [k.replace(/^RDC Nonconfidential Documentation /, ''), v])));
    console.log('corpus: by extension', Object.fromEntries([...byExt].sort((a, b) => b[1] - a[1])));

    // The measured inventory from docs/metadata-repo-plan.md §1.
    expect(files).toBe(3006);
    expect(perBundle.size).toBe(7);
    expect(groups.size).toBe(318);
    expect(byExt.get('pdf')).toBe(2248);
    expect(byExt.get('docx')).toBe(265);
    expect(byExt.get('doc')).toBe(339);
    expect(byExt.get('xlsx')).toBe(91);
    expect(byExt.get('wpd')).toBe(6);
    expect(manifest?.subarray(0, 5).toString('utf8').toLowerCase()).toContain('<');
  }, 600_000);
});
