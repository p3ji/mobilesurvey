/**
 * Document-layer tests. The chunk boundary is the part worth pinning: it is arithmetic the client
 * repeats independently, so a change here silently breaks every "open at page N" link rather than
 * failing anywhere visible.
 */
import { describe, expect, it } from 'vitest';
import {
  chunkKey,
  chunkStart,
  PAGES_PER_CHUNK,
  toChunks,
  toDocumentRow,
} from '../documents.js';
import type { CorpusFile, ExtractedDoc } from '../types.js';

const file: CorpusFile = {
  bundle: 'RDC Nonconfidential Documentation (1).zip',
  path: 'CCHS_ESCC_2015/cchs_2015_f1_T15.6_v1.pdf',
  sizeBytes: 1234,
  ext: '.pdf',
  tcode: 'T15.6',
  docKind: 'data-dictionary',
  surveyGroup: 'CCHS_ESCC_2015',
  surveyAcronym: 'CCHS',
  cycle: undefined,
  year: 2015,
  lang: 'en',
};

const doc = (pageNumbers: number[]): ExtractedDoc => ({
  file,
  pages: pageNumbers.map((n) => ({ pageNumber: n, text: `page ${n} text` })),
  charCount: pageNumbers.length * 12,
  engine: 'test',
  likelyScanned: false,
});

describe('chunkStart', () => {
  it('puts the first hundred pages in one chunk', () => {
    expect(chunkStart(1)).toBe(1);
    expect(chunkStart(100)).toBe(1);
    expect(chunkStart(101)).toBe(101);
  });

  it('is 1-based, because page numbers are printed 1-based', () => {
    // Off by one here and every citation opens the page before the one it names.
    expect(chunkStart(176)).toBe(101);
    expect(chunkStart(200)).toBe(101);
    expect(chunkStart(201)).toBe(201);
  });

  it('survives a nonsense page rather than computing a negative key', () => {
    expect(chunkStart(0)).toBe(1);
    expect(chunkStart(-5)).toBe(1);
  });

  it('agrees with the declared chunk size', () => {
    expect(chunkStart(PAGES_PER_CHUNK)).toBe(1);
    expect(chunkStart(PAGES_PER_CHUNK + 1)).toBe(PAGES_PER_CHUNK + 1);
  });
});

describe('chunkKey', () => {
  it('groups chunks under the document so it can be removed whole', () => {
    expect(chunkKey('doc-uuid', 176)).toBe('doc-uuid/101.json');
    expect(chunkKey('doc-uuid', 1)).toBe('doc-uuid/1.json');
  });
});

describe('toChunks', () => {
  it('splits at the boundary and keeps pages with their chunk', () => {
    const chunks = toChunks('d', doc([1, 99, 100, 101, 250]));
    expect(chunks.map((c) => c.from)).toEqual([1, 101, 201]);
    expect(chunks[0]!.pages.map((p) => p.page)).toEqual([1, 99, 100]);
    expect(chunks[1]!.pages.map((p) => p.page)).toEqual([101]);
    expect(chunks[2]!.pages.map((p) => p.page)).toEqual([250]);
  });

  it('orders chunks so a re-run writes the same objects in the same order (D9)', () => {
    const chunks = toChunks('d', doc([300, 1, 150]));
    expect(chunks.map((c) => c.from)).toEqual([1, 101, 201]);
  });

  it('produces nothing for a document with no pages', () => {
    expect(toChunks('d', doc([]))).toEqual([]);
  });
});

describe('toDocumentRow', () => {
  it('carries the citation fields and the filename as title', () => {
    // These documents have no title page we can trust; the filename is at least verifiably what
    // Statistics Canada shipped, where a title assembled from survey and year would read as
    // authoritative while being ours.
    const row = toDocumentRow('d', file, doc([1, 2, 3]), 421);
    expect(row).toMatchObject({
      document_id: 'd',
      title: 'cchs_2015_f1_T15.6_v1.pdf',
      survey_group: 'CCHS_ESCC_2015',
      survey_acronym: 'CCHS',
      year: 2015,
      lang: 'en',
      pages: 3,
      records: 421,
      has_text: true,
    });
  });

  it('records a document whose text could not be extracted, rather than omitting it', () => {
    // A row that is absent looks identical to a document we never saw. `has_text: false` lets the
    // reader be told "no text available" instead of meeting a 404.
    const row = toDocumentRow('d', file, undefined, 0);
    expect(row).toMatchObject({ has_text: false, pages: 0, characters: 0 });
  });

  it('maps absent optionals to null for Postgres', () => {
    const row = toDocumentRow('d', { ...file, year: undefined, surveyAcronym: undefined }, undefined, 0);
    expect(row.year).toBeNull();
    expect(row.survey_acronym).toBeNull();
  });
});
