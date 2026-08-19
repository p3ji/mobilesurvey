/**
 * Minimal zip reader for the zip-of-zips the corpus ships as (docs/metadata-repo-plan.md §1).
 *
 * Node has no built-in zip reader and this repo keeps its dependency surface deliberately small
 * (pdfjs-dist is the one new dependency M1 is permitted), so the reader is built on `node:fs` and
 * `node:zlib` alone. That is affordable because a zip *reader* is small: locate the End Of Central
 * Directory record, walk the central directory, and for each wanted entry seek to its local header
 * and `inflateRawSync` the payload. Writing zips, encryption, spanned archives, and the exotic
 * compression methods are all out of scope and rejected loudly rather than half-supported.
 *
 * ### What the real corpus turned out to require (measured 2026-08-18, not assumed)
 *
 * - **The outer archive is not ZIP64, but its local file headers use ZIP64 sentinels anyway.**
 *   Every outer entry sets general-purpose bit 3 (data descriptor) and writes `0xFFFFFFFF` for both
 *   sizes in the local header — the producer streamed the archive without knowing sizes in advance.
 *   A reader that trusts the local header therefore reads a 4 GB payload out of a 2.4 GB file. The
 *   sizes here come from the **central directory**, which is authoritative in every zip and is the
 *   only place these values are correct.
 * - **The seven nested bundles do carry ZIP64 EOCD records** (locator signature present ahead of
 *   the classic EOCD), even though their entry counts and offsets all fit in 32 bits. So ZIP64 is
 *   not hypothetical for this corpus and is implemented properly: the ZIP64 EOCD record wins when
 *   present, and per-entry `0x0001` extra fields resolve sentinel sizes/offsets.
 * - **Nested bundles are deflated, not stored** (573 MB → 577 MB, etc.), so each one must be
 *   inflated into memory to be read. That is the memory constraint {@link forEachCorpusFile} is
 *   built around.
 * - **Entry names are UTF-8** (bit 11 set throughout) and genuinely need it — the corpus contains
 *   `sec_décès_2014_t15.2_v1.pdf` and `EJC2010_Enfant_Maître_LvCds.pdf`. The CP437 path below is
 *   the spec-mandated fallback for archives that do not set bit 11; this corpus never takes it.
 *
 * Integrity checking is intentionally shallow: the inflated length must equal the size the central
 * directory declared, which catches truncation and mis-seeking, but CRC-32 is not recomputed over
 * 3.5 GB of payload for a pipeline that immediately re-parses every byte it reads anyway.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * One entry in a zip's central directory.
 *
 * `offset` points at the entry's *local file header*, not at its payload: the gap between the two
 * is the local name and extra fields, whose lengths differ from the central directory's copies and
 * so can only be learned by reading the local header. {@link readEntry} does that seek.
 */
export interface ZipEntry {
  /** Path within the archive, as recorded. Directory entries keep their trailing `/`. */
  path: string;
  /** Uncompressed size in bytes. */
  sizeBytes: number;
  /** Size of the stored (possibly deflated) payload in bytes. */
  compressedSize: number;
  /** Compression method: 0 = stored, 8 = deflate. Anything else is rejected by {@link readEntry}. */
  method: number;
  /** Absolute offset of the local file header within the archive. */
  offset: number;
}

const SIG_LOCAL_HEADER = 0x04034b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const U32_SENTINEL = 0xffffffff;
const U16_SENTINEL = 0xffff;

const EOCD_SIZE = 22;
const EOCD64_SIZE = 56;
const EOCD64_LOCATOR_SIZE = 20;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const MAX_COMMENT = 0xffff;

/** Upper half of code page 437, the zip spec's default encoding when bit 11 is clear. */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/**
 * Random access over "some bytes", so the central-directory walk can run identically against a
 * 600 MB nested bundle held in a Buffer and against a 2.4 GB file we must never fully load.
 */
interface ByteSource {
  /** Used only in error messages, so a failure names the archive it came from. */
  readonly name: string;
  readonly size: number;
  /** True when `read` returns freshly allocated memory rather than a view onto a larger buffer. */
  readonly detached: boolean;
  read(offset: number, length: number): Buffer;
}

function bufferSource(buf: Buffer, name: string): ByteSource {
  return {
    name,
    size: buf.length,
    detached: false,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > buf.length) {
        throw new Error(
          `${name}: read of ${length} bytes at ${offset} runs past the end of the archive (${buf.length} bytes)`,
        );
      }
      return buf.subarray(offset, offset + length);
    },
  };
}

function fileSource(fd: number, name: string): ByteSource {
  const size = fstatSync(fd).size;
  return {
    name,
    size,
    detached: true,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) {
        throw new Error(
          `${name}: read of ${length} bytes at ${offset} runs past the end of the archive (${size} bytes)`,
        );
      }
      const out = Buffer.allocUnsafe(length);
      let got = 0;
      while (got < length) {
        const n = readSync(fd, out, got, length - got, offset + got);
        if (n === 0) throw new Error(`${name}: unexpected end of file ${length - got} bytes into a read at ${offset}`);
        got += n;
      }
      return out;
    },
  };
}

/**
 * ZIP64 stores sizes and offsets as unsigned 64-bit. JavaScript numbers hold those exactly up to
 * 2^53, which is nine petabytes — but a corrupt field reads as a plausible number, so the bound is
 * checked rather than assumed, and a violation is an error instead of a silently truncated seek.
 */
function u64(buf: Buffer, off: number, what: string, source: string): number {
  const v = buf.readBigUInt64LE(off);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${source}: ZIP64 ${what} is ${v}, beyond the exactly-representable range`);
  }
  return Number(v);
}

function decodeName(raw: Buffer, flags: number): string {
  if ((flags & 0x800) !== 0) return raw.toString('utf8');
  let high = false;
  for (const b of raw) {
    if (b >= 0x80) {
      high = true;
      break;
    }
  }
  if (!high) return raw.toString('latin1');
  let out = '';
  for (const b of raw) out += b < 0x80 ? String.fromCharCode(b) : (CP437_HIGH[b - 0x80] ?? '�');
  return out;
}

interface CentralDirectoryLocation {
  offset: number;
  size: number;
  entryCount: number;
  /** Whether a ZIP64 EOCD record supplied the values above. */
  zip64: boolean;
}

/**
 * Find the central directory by scanning backwards from the end of the archive for the EOCD
 * signature, then upgrading to the ZIP64 EOCD record when the locator that precedes it says so.
 *
 * The scan is bounded by the maximum archive-comment length (64 KB), which is why a zip's
 * directory can be found at all without reading the whole file — the property this reader leans on
 * to open a 2.4 GB archive with two small reads.
 */
function locateCentralDirectory(src: ByteSource): CentralDirectoryLocation {
  if (src.size < EOCD_SIZE) throw new Error(`${src.name}: too small to be a zip (${src.size} bytes)`);
  const tailLen = Math.min(src.size, EOCD_SIZE + MAX_COMMENT);
  const tailStart = src.size - tailLen;
  const tail = src.read(tailStart, tailLen);

  // Prefer an EOCD whose comment length accounts for exactly the remaining bytes; fall back to any
  // structurally plausible one, so an archive with trailing padding still opens.
  let at = -1;
  let loose = -1;
  for (let i = tailLen - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    if (commentLen === tailLen - i - EOCD_SIZE) {
      at = i;
      break;
    }
    if (loose < 0 && i + EOCD_SIZE + commentLen <= tailLen) loose = i;
  }
  if (at < 0) at = loose;
  if (at < 0) {
    throw new Error(`${src.name}: no End Of Central Directory record in the last ${tailLen} bytes — not a zip, or truncated`);
  }

  const eocd = tail.subarray(at, at + EOCD_SIZE);
  let entryCount = eocd.readUInt16LE(10);
  let size = eocd.readUInt32LE(12);
  let offset = eocd.readUInt32LE(16);
  const diskNumber = eocd.readUInt16LE(4);
  const cdStartDisk = eocd.readUInt16LE(6);

  const eocdAbs = tailStart + at;
  let locator: Buffer | null = null;
  if (at >= EOCD64_LOCATOR_SIZE) locator = tail.subarray(at - EOCD64_LOCATOR_SIZE, at);
  else if (eocdAbs >= EOCD64_LOCATOR_SIZE) locator = src.read(eocdAbs - EOCD64_LOCATOR_SIZE, EOCD64_LOCATOR_SIZE);

  let zip64 = false;
  if (locator && locator.readUInt32LE(0) === SIG_EOCD64_LOCATOR) {
    const totalDisks = locator.readUInt32LE(16);
    if (totalDisks > 1) {
      throw new Error(`${src.name}: spanned archives are not supported (ZIP64 locator reports ${totalDisks} disks)`);
    }
    const recOffset = u64(locator, 8, 'EOCD record offset', src.name);
    if (recOffset + EOCD64_SIZE > src.size) {
      throw new Error(`${src.name}: ZIP64 locator points at ${recOffset}, past the end of the archive`);
    }
    const rec = src.read(recOffset, EOCD64_SIZE);
    if (rec.readUInt32LE(0) !== SIG_EOCD64) {
      throw new Error(`${src.name}: ZIP64 locator points at ${recOffset}, which is not a ZIP64 EOCD record`);
    }
    if (rec.readUInt32LE(16) !== 0 || rec.readUInt32LE(20) !== 0) {
      throw new Error(`${src.name}: spanned archives are not supported (ZIP64 EOCD names a non-zero disk)`);
    }
    entryCount = u64(rec, 32, 'total entry count', src.name);
    size = u64(rec, 40, 'central directory size', src.name);
    offset = u64(rec, 48, 'central directory offset', src.name);
    zip64 = true;
  } else {
    if (diskNumber !== 0 || cdStartDisk !== 0) {
      throw new Error(`${src.name}: spanned archives are not supported (EOCD names disk ${diskNumber}/${cdStartDisk})`);
    }
    // Sentinels here mean the archive *is* ZIP64 but its locator is missing or unreadable. There is
    // no recovery — the real offset lives only in the record we failed to find — so say so plainly
    // rather than seeking to 0xFFFFFFFF and reporting a bogus parse failure downstream.
    if (size === U32_SENTINEL || offset === U32_SENTINEL) {
      throw new Error(
        `${src.name}: central directory size/offset are ZIP64 sentinels but no ZIP64 EOCD locator precedes the EOCD`,
      );
    }
  }

  if (offset + size > src.size) {
    throw new Error(
      `${src.name}: central directory (${size} bytes at ${offset}) runs past the end of the archive (${src.size} bytes)`,
    );
  }
  return { offset, size, entryCount, zip64 };
}

/**
 * Resolve the ZIP64 extended-information extra field (header id `0x0001`).
 *
 * The field is positional, not tagged: it contains uncompressed size, compressed size, local header
 * offset, and disk number *in that order*, each present only if the corresponding 32-bit field held
 * a sentinel. Reading it without tracking which sentinels were set silently shifts every value.
 */
function applyZip64Extra(
  extra: Buffer,
  fields: { sizeBytes: number; compressedSize: number; offset: number; diskStart: number },
  path: string,
  source: string,
): { sizeBytes: number; compressedSize: number; offset: number } {
  let { sizeBytes, compressedSize, offset } = fields;
  const wantSize = sizeBytes === U32_SENTINEL;
  const wantCompressed = compressedSize === U32_SENTINEL;
  const wantOffset = offset === U32_SENTINEL;
  const wantDisk = fields.diskStart === U16_SENTINEL;
  if (!wantSize && !wantCompressed && !wantOffset && !wantDisk) return { sizeBytes, compressedSize, offset };

  for (let q = 0; q + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(q);
    const len = extra.readUInt16LE(q + 2);
    if (q + 4 + len > extra.length) break;
    if (id === 0x0001) {
      const body = extra.subarray(q + 4, q + 4 + len);
      let p = 0;
      const take = (what: string): number => {
        if (p + 8 > body.length) {
          throw new Error(`${source}: ${path}: ZIP64 extra field is truncated before ${what}`);
        }
        const v = u64(body, p, what, source);
        p += 8;
        return v;
      };
      if (wantSize) sizeBytes = take('uncompressed size');
      if (wantCompressed) compressedSize = take('compressed size');
      if (wantOffset) offset = take('local header offset');
      return { sizeBytes, compressedSize, offset };
    }
    q += 4 + len;
  }
  throw new Error(
    `${source}: ${path}: central directory uses ZIP64 sentinel values but carries no 0x0001 extra field`,
  );
}

function listFrom(src: ByteSource): ZipEntry[] {
  const cd = locateCentralDirectory(src);
  const buf = src.read(cd.offset, cd.size);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + CENTRAL_HEADER_SIZE <= buf.length) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL_HEADER) {
      throw new Error(
        `${src.name}: expected a central directory header at directory offset ${p} (entry ${entries.length}), found 0x${buf
          .readUInt32LE(p)
          .toString(16)}`,
      );
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const end = p + CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen;
    if (end > buf.length) {
      throw new Error(`${src.name}: central directory entry ${entries.length} is truncated`);
    }
    const path = decodeName(buf.subarray(p + CENTRAL_HEADER_SIZE, p + CENTRAL_HEADER_SIZE + nameLen), flags);
    const resolved = applyZip64Extra(
      buf.subarray(p + CENTRAL_HEADER_SIZE + nameLen, p + CENTRAL_HEADER_SIZE + nameLen + extraLen),
      {
        sizeBytes: buf.readUInt32LE(p + 24),
        compressedSize: buf.readUInt32LE(p + 20),
        offset: buf.readUInt32LE(p + 42),
        diskStart: buf.readUInt16LE(p + 34),
      },
      path,
      src.name,
    );
    entries.push({ path, method, ...resolved });
    p = end;
  }

  // A count mismatch means the directory and the EOCD disagree — the archive is damaged, or the
  // walk desynchronized. Either way the entry list cannot be trusted, so it is not returned.
  // The one benign case is a non-ZIP64 archive with the 0xFFFF "count unknown" sentinel.
  if (entries.length !== cd.entryCount && !(!cd.zip64 && cd.entryCount === U16_SENTINEL)) {
    throw new Error(
      `${src.name}: central directory holds ${entries.length} entries but the EOCD declares ${cd.entryCount}`,
    );
  }
  return entries;
}

function readFrom(src: ByteSource, entry: ZipEntry): Buffer {
  const header = src.read(entry.offset, LOCAL_HEADER_SIZE);
  if (header.readUInt32LE(0) !== SIG_LOCAL_HEADER) {
    throw new Error(`${src.name}: ${entry.path}: no local file header at offset ${entry.offset}`);
  }
  // Local name/extra lengths are read here and not taken from the central directory: they differ in
  // practice (this corpus's outer entries carry a 20-byte ZIP64 extra locally and none centrally),
  // and getting them wrong lands the read a few bytes into the payload.
  const dataOffset = entry.offset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = src.read(dataOffset, entry.compressedSize);

  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.sizeBytes) {
      throw new Error(
        `${src.name}: ${entry.path}: stored entry declares ${entry.compressedSize} compressed vs ${entry.sizeBytes} uncompressed bytes`,
      );
    }
    // Detach from the archive buffer: a view would pin the whole (up to 600 MB) bundle alive for as
    // long as the caller keeps one small file.
    return src.detached ? raw : Buffer.from(raw);
  }
  if (entry.method !== METHOD_DEFLATE) {
    throw new Error(
      `${src.name}: ${entry.path}: unsupported compression method ${entry.method} (only 0=stored and 8=deflate are supported)`,
    );
  }
  const out =
    entry.sizeBytes > 0 ? inflateRawSync(raw, { maxOutputLength: entry.sizeBytes }) : inflateRawSync(raw);
  if (entry.sizeBytes > 0 && out.length !== entry.sizeBytes) {
    throw new Error(
      `${src.name}: ${entry.path}: inflated to ${out.length} bytes but the directory declares ${entry.sizeBytes}`,
    );
  }
  return out;
}

/** True for central-directory entries that record a folder rather than a file. */
function isDirectory(entry: ZipEntry): boolean {
  return entry.path.endsWith('/');
}

function isZipEntry(entry: ZipEntry): boolean {
  return !isDirectory(entry) && entry.path.toLowerCase().endsWith('.zip');
}

/** Byte-order comparison — deterministic across locales, unlike `localeCompare` (D9). */
function byPath(a: ZipEntry, b: ZipEntry): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * List every central-directory entry of an in-memory archive, in the order the directory records
 * them. Directory entries are included and identifiable by their trailing `/`.
 *
 * @param sourceName label used in error messages; defaults to a generic one.
 */
export function listEntries(zipBuffer: Buffer, sourceName = '<zip buffer>'): ZipEntry[] {
  return listFrom(bufferSource(zipBuffer, sourceName));
}

/**
 * Extract one entry from an in-memory archive. The returned Buffer never aliases `zipBuffer`.
 */
export function readEntry(zipBuffer: Buffer, entry: ZipEntry, sourceName = '<zip buffer>'): Buffer {
  return readFrom(bufferSource(zipBuffer, sourceName), entry);
}

/**
 * Names of the nested `.zip` bundles inside the outer corpus archive, sorted by path.
 *
 * Reads only the outer archive's directory — a couple of small seeks — so this is cheap even on the
 * 2.4 GB delivery. Sorted rather than left in directory order (which ships bundle 7 before 6)
 * because every downstream artifact must be byte-identical across runs (D9).
 */
export function listNestedZips(outerPath: string): string[] {
  const fd = openSync(outerPath, 'r');
  try {
    return listFrom(fileSource(fd, basename(outerPath)))
      .filter(isZipEntry)
      .sort(byPath)
      .map((e) => e.path);
  } finally {
    closeSync(fd);
  }
}

/**
 * Visit every file inside every nested bundle of the corpus archive: 3,006 files across 7 bundles.
 *
 * Two properties matter more than the traversal itself.
 *
 * **Memory.** The bundles are deflated, so each must be inflated whole (up to 606 MB) to be read.
 * Exactly one is held at a time — it goes out of scope at the end of its loop iteration, before the
 * next is inflated — which keeps the peak at roughly one compressed plus one inflated bundle rather
 * than the 3.5 GB the corpus would occupy in full. The outer archive is never loaded; only the
 * bytes of the current bundle are read from it.
 *
 * **Laziness.** `read()` decompresses on call, so a pass that only needs paths and sizes (the
 * inventory pass, which is most of M1) never spends a cycle on the ~3.19 GB of PDF payload. The
 * returned Buffer is independent of the bundle, but `read` itself is only valid during the callback
 * — after it returns, the bundle it would read from is released.
 *
 * Directory entries are skipped; the callback sees files only. Bundles are visited in sorted order
 * and entries in central-directory order, so the traversal is deterministic (D9).
 *
 * **Delivery-level files are visited too**, reported under the outer archive's own name as their
 * bundle. Today's delivery holds nothing but the seven bundles, so this yields nothing on the real
 * corpus — but a `README` or a top-level manifest dropped beside them in a future delivery must
 * surface in the ingest report rather than disappear, which is D7's whole point: the pipeline is
 * allowed to not understand a file, and is not allowed to pretend it was never there.
 */
export function forEachCorpusFile(
  outerPath: string,
  cb: (bundle: string, entry: ZipEntry, read: () => Buffer) => void,
): void {
  const fd = openSync(outerPath, 'r');
  try {
    const outer = fileSource(fd, basename(outerPath));
    const outerEntries = listFrom(outer);
    const bundles = outerEntries.filter(isZipEntry).sort(byPath);
    if (bundles.length === 0) {
      throw new Error(`${outerPath}: contains no nested .zip bundles — is this the corpus delivery?`);
    }
    const deliveryName = basename(outerPath);
    for (const entry of outerEntries) {
      if (isDirectory(entry) || isZipEntry(entry)) continue;
      cb(deliveryName, entry, () => readFrom(outer, entry));
    }
    for (const bundleEntry of bundles) {
      // Block-scoped so the inflated bundle is unreachable once the iteration ends.
      const bundle = bufferSource(readFrom(outer, bundleEntry), bundleEntry.path);
      for (const entry of listFrom(bundle)) {
        if (isDirectory(entry)) continue;
        cb(bundleEntry.path, entry, () => readFrom(bundle, entry));
      }
    }
  } finally {
    closeSync(fd);
  }
}
