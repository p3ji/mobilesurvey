/**
 * Model smoke test. There is no logic in types.ts, so what is worth guarding is the *shape* the
 * rest of the pipeline builds against: a fully-populated occurrence must type-check and survive a
 * JSONL round-trip, since that is exactly how records leave this package (D1 — the canonical
 * artifact is a JSONL file, never a repo artifact). It also keeps `pnpm test` green for this
 * package until the zip/classify/extract suites land.
 */
import { describe, it, expect } from 'vitest';
import type { CorpusFile, CorpusVariable, IngestReport } from '../types.js';

const file: CorpusFile = {
  bundle: 'RDC Nonconfidential Documentation 3.zip',
  path: 'CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T15.2_v1.pdf',
  sizeBytes: 1_234_567,
  ext: 'pdf',
  tcode: 'T15.2',
  docKind: 'data-dictionary',
  surveyGroup: 'CCHS_ESCC',
  surveyAcronym: 'CCHS',
  cycle: '2011_2012',
  year: 2011,
  lang: 'en',
};

const variable: CorpusVariable = {
  recordId: '3f2504e0-4f89-51d3-9a0c-0305e82c3301',
  name: 'SMK_005',
  position: '35',
  length: '1',
  collectionName: 'SMK_Q05',
  concept: 'Smoking',
  questionText: 'At the present time, do you smoke cigarettes daily, occasionally or not at all?',
  universe: 'Respondents aged 12 and over.',
  codes: [
    { code: '1', label: 'Daily', frequency: 10_137, weighted: 4_912_300 },
    { code: '9', label: 'Not stated' },
  ],
  source: {
    bundle: file.bundle,
    path: file.path,
    page: 42,
    tcode: file.tcode,
    docKind: file.docKind,
    surveyGroup: file.surveyGroup,
    surveyAcronym: file.surveyAcronym,
    cycle: file.cycle,
    year: file.year,
    lang: file.lang,
  },
};

describe('corpus model', () => {
  it('survives a JSONL round-trip with provenance intact', () => {
    const back = JSON.parse(JSON.stringify(variable)) as CorpusVariable;
    expect(back).toEqual(variable);
    // Provenance is denormalized onto the record (D8) — one line cites its own source, no join.
    expect(back.source.page).toBe(42);
    expect(back.source.surveyAcronym).toBe('CCHS');
  });

  it('keeps codes and their counts distinct, the T15.6 column-order trap', () => {
    // The failure this guards against is `1 -> "10,137"`: the frequency read as the label.
    expect(variable.codes[0]!.label).toBe('Daily');
    expect(variable.codes[0]!.frequency).toBe(10_137);
    // Counts are optional — plenty of dictionaries print codes with no frequencies at all.
    expect(variable.codes[1]!.frequency).toBeUndefined();
  });

  it('accounts for unclassified files rather than dropping them (D7)', () => {
    const report: IngestReport = {
      generatedFrom: 'CRSB_ADHOC_CENTRAL_002.zip',
      files: 2,
      classified: 1,
      byDocKind: { 'data-dictionary': 1, unknown: 1 },
      byTcode: { 'T15.2': 1 },
      notes: [
        {
          severity: 'warning',
          file: `${file.bundle}/SOMETHING/odd_file.pdf`,
          message: 'No T-code in filename; docKind left as unknown.',
        },
      ],
    };
    const unaccounted = report.files - report.classified - report.notes.length;
    expect(unaccounted).toBe(0);
  });
});
