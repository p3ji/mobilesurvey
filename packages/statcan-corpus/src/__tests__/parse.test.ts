/**
 * Tests for the dictionary parsers (`src/parse.ts`).
 *
 * Every fixture below is a real row shape taken from the corpus, but no corpus is needed to run
 * them: the parsers read reconstructed text, so their whole contract is testable from a fresh
 * clone. The corpus-dependent block at the bottom skips when the 2.4 GB delivery is absent.
 *
 * What these tests defend is the pair of silent-corruption failures M2 actually hit:
 *
 * 1. **Code/label column order.** The families disagree about which comes first, and getting it
 *    wrong yields a code list that still *looks* like one (`1 → "10,137"`). Both orders are
 *    pinned, in both languages.
 * 2. **Locale-ambiguous counts.** French writes `2 400 461 000` for numbers English writes as
 *    `2,400 461,000`. The French form is genuinely unreadable once row reconstruction has
 *    flattened the columns, so the parser must return *no* frequency rather than a plausible
 *    wrong one — a frequency off by three orders of magnitude reads as authoritative.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectLayout, parseDictionary, readCodeRow } from '../parse.js';
import type { CorpusFile, ExtractedDoc } from '../types.js';

const CORPUS =
  new URL('../../../../docs/metadatarepo/CRSB_ADHOC_CENTRAL_002_FromStatCan_DeStatCan20260818133553.zip', import.meta.url)
    .pathname.replace(/^\//, '');

const FILE: CorpusFile = {
  bundle: 'RDC Nonconfidential Documentation (1).zip',
  path: 'CCHS_ESCC/CCHS_2020/cchs_2020_f1_T15-2_v1.pdf',
  sizeBytes: 1000,
  ext: 'pdf',
  tcode: 'T15.2',
  docKind: 'data-dictionary',
  surveyGroup: 'CCHS_ESCC',
  surveyAcronym: 'CCHS',
  cycle: '2020',
  year: 2020,
  lang: 'en',
};

/** Build a one-page document from rows, as the extractor would hand them over. */
function doc(rows: string[], file: Partial<CorpusFile> = {}): ExtractedDoc {
  const text = rows.join('\n');
  return {
    file: { ...FILE, ...file },
    pages: [{ pageNumber: 1, text }],
    charCount: text.length,
    engine: 'test',
    likelyScanned: false,
  };
}

const mint = (): string => 'test-id';

// ---------------------------------------------------------------------------------------------
// readCodeRow — the column-order contract
// ---------------------------------------------------------------------------------------------

describe('readCodeRow', () => {
  it('reads a code-first row (the T15.2 collection layout)', () => {
    expect(readCodeRow('99999995   Not applicable   0   0')).toEqual({
      code: '99999995',
      label: 'Not applicable',
      frequency: 0,
      weighted: 0,
    });
  });

  it('reads a label-first row without mistaking the frequency for the label', () => {
    // The defect this whole module exists to prevent: read as code-first, this row yields
    // code '1' with label '10,137' — a code list that looks entirely plausible and is wrong.
    expect(readCodeRow('COMPLETE   70   10,137   26,500')).toEqual({
      code: '70',
      label: 'COMPLETE',
      frequency: 10137,
      weighted: 26500,
    });
  });

  it('reads a single-spaced label-first row (the labelled layout types no cell gaps)', () => {
    expect(readCodeRow('Birth parent 041 1,150 4,021,500 44.9')).toEqual({
      code: '041',
      label: 'Birth parent',
      frequency: 1150,
      weighted: 4021500,
    });
  });

  it('keeps code and label but omits ambiguous French counts', () => {
    // `2 400 461 000` is equally readable as one number or as `2 400` + `461 000`; only the
    // original column geometry could say, and reconstruction has flattened it. So: no guess.
    const row = readCodeRow('TERRE-NEUVE-ET-LABRADOR 10 2 400 461 000 1,4');
    expect(row?.code).toBe('10');
    expect(row?.label).toBe('TERRE-NEUVE-ET-LABRADOR');
    expect(row?.frequency).toBeUndefined();
    expect(row?.weighted).toBeUndefined();
  });

  it('rejects table furniture and total rows in both languages', () => {
    expect(readCodeRow('Answer Categories   Code   Frequency   Weighted Frequency')).toBeUndefined();
    expect(readCodeRow('Catégories de réponse Code Fréquence Fréquence pondérée %')).toBeUndefined();
    expect(readCodeRow('Total 11,050 36,551,500 100.0')).toBeUndefined();
  });

  it('rejects prose that merely starts or ends with a number', () => {
    expect(readCodeRow('2 of the 3 respondents said they had moved in the last year')).toBeUndefined();
    expect(readCodeRow('Asked of all respondents aged 12 and over')).toBeUndefined();
    expect(readCodeRow('')).toBeUndefined();
  });

  it('accepts a code that is a range or a letter, as the corpus prints them', () => {
    expect(readCodeRow('Day (1 to 31)   01 - 31   11,050   36,551,500')?.code).toBe('01 - 31');
    expect(readCodeRow('Male   M   5,000   9,000')?.code).toBe('M');
  });
});

// ---------------------------------------------------------------------------------------------
// detectLayout — content decides, not the T-code
// ---------------------------------------------------------------------------------------------

describe('detectLayout', () => {
  it('detects the labelled layout from an English header', () => {
    expect(detectLayout(doc(['Variable Name: SSID Length: 22.0 Position: 1'])).layout).toBe('labelled');
  });

  it('detects the labelled layout from a French header', () => {
    expect(detectLayout(doc(['Nom de la variable : REFPER Longueur : 13.0 Position : 9'])).layout).toBe(
      'labelled',
    );
  });

  it('detects the collection layout, where position precedes length', () => {
    expect(detectLayout(doc(['Variable Name:    HHLDID    Position:    1    Length:    14'])).layout).toBe(
      'collection',
    );
  });

  it('detects the FIELD NAME layout', () => {
    expect(detectLayout(doc(['FIELD NAME: RESIDENCE_POSTALCODE'])).layout).toBe('field');
  });

  it('reports no layout rather than guessing on a document with none', () => {
    const d = doc(['Table of Contents', 'INTRODUCTION . . . . . 4', 'Some narrative text.']);
    expect(detectLayout(d).layout).toBeUndefined();
  });

  it('picks the repeating layout over a stray label in the front matter', () => {
    // Front matter can mention a label once; the real layout repeats once per variable.
    const rows = ['Variable Name:    X    Position:    1    Length:    2'];
    for (let i = 0; i < 12; i++) rows.push(`Variable Name: V${i} Length: 2.0 Position: ${i}`);
    expect(detectLayout(doc(rows)).layout).toBe('labelled');
  });

  it('does not depend on the T-code', () => {
    // A T15.2 file carrying the labelled layout — the case that broke the original design, where
    // the code was trusted to name the layout and 72 of 90 documents parsed to nothing.
    const d = doc(['Nom de la variable : GEO_PRV Longueur : 2.0 Position : 44'], { tcode: 'T15.2' });
    expect(detectLayout(d).layout).toBe('labelled');
  });
});

// ---------------------------------------------------------------------------------------------
// parseDictionary
// ---------------------------------------------------------------------------------------------

describe('parseDictionary — labelled layout', () => {
  const ENGLISH = [
    'CCAHS - Data Dictionary',
    'Variable Name: COLLPER Length: 1.0 Position: 23',
    'Question Name:',
    'Concept: Collection period of selected respondent',
    'Question Text: In what period were you contacted?',
    'Universe: All respondents',
    'Note:',
    'Answer Categories Code Frequency Weighted Frequency %',
    'First collection period 1 850 2,870,500 7.9',
    'Second collection period 2 5,150 17,190,000 47.0',
    'Total 11,050 36,551,500 100.0',
  ];

  it('reads every labelled field, and the code list with it', () => {
    const { variables } = parseDictionary(doc(ENGLISH), mint);
    expect(variables).toHaveLength(1);
    const v = variables[0]!;
    expect(v.name).toBe('COLLPER');
    expect(v.length).toBe('1.0');
    expect(v.position).toBe('23');
    expect(v.concept).toBe('Collection period of selected respondent');
    expect(v.questionText).toBe('In what period were you contacted?');
    expect(v.universe).toBe('All respondents');
    expect(v.codes.map((c) => [c.code, c.label])).toEqual([
      ['1', 'First collection period'],
      ['2', 'Second collection period'],
    ]);
  });

  it('reads the French labels, which half the corpus uses', () => {
    const { variables } = parseDictionary(
      doc(
        [
          'Nom de la variable : REFPER Longueur : 13.0 Position : 9',
          'Concept : Période de référence',
          'Univers : Tous les répondants',
          'Nota : Période au cours de laquelle les données ont été recueillies.',
        ],
        { lang: 'fr' },
      ),
      mint,
    );
    expect(variables).toHaveLength(1);
    const v = variables[0]!;
    expect(v.name).toBe('REFPER');
    expect(v.length).toBe('13.0');
    expect(v.concept).toBe('Période de référence');
    expect(v.universe).toBe('Tous les répondants');
    expect(v.note).toContain('recueillies');
  });

  it('leaves an empty field undefined instead of absorbing the next label', () => {
    const { variables } = parseDictionary(doc(ENGLISH), mint);
    // `Question Name:` is empty and `Concept:` follows it on the next row.
    expect(variables[0]!.note).toBeUndefined();
  });

  it('splits one block per variable and carries the source page', () => {
    const rows = [
      'Variable Name: AGE Length: 2.0 Position: 1',
      'Concept: Age of respondent',
      'Variable Name: SEX Length: 1.0 Position: 3',
      'Concept: Sex at birth',
    ];
    const { variables } = parseDictionary(doc(rows), mint);
    expect(variables.map((v) => [v.name, v.concept])).toEqual([
      ['AGE', 'Age of respondent'],
      ['SEX', 'Sex at birth'],
    ]);
    expect(variables[0]!.source.page).toBe(1);
    expect(variables[0]!.source.surveyAcronym).toBe('CCHS');
  });
});

describe('parseDictionary — collection layout', () => {
  const ROWS = [
    'Variable Name:    LD3Q001    Position:    17    Length:    8',
    'Collection Name:    LD_Q02V',
    'When did you start this course or program?',
    'FREQ    WTD',
    '99999995    Not applicable    0    0',
    '99999996    Valid skip    0    0',
    'Coverage:    Asked for all language courses followed in Wave 3.',
  ];

  it('reads the questionnaire-side name, the prose question, and the coverage', () => {
    const { variables } = parseDictionary(doc(ROWS), mint);
    expect(variables).toHaveLength(1);
    const v = variables[0]!;
    expect(v.name).toBe('LD3Q001');
    expect(v.position).toBe('17');
    expect(v.length).toBe('8');
    expect(v.collectionName).toBe('LD_Q02V');
    expect(v.questionText).toBe('When did you start this course or program?');
    expect(v.universe).toContain('Wave 3');
    expect(v.codes.map((c) => c.code)).toEqual(['99999995', '99999996']);
  });

  it('keeps table furniture out of the question text', () => {
    expect(parseDictionary(doc(ROWS), mint).variables[0]!.questionText).not.toMatch(/FREQ|WTD/);
  });
});

describe('parseDictionary — FIELD layout', () => {
  it('accumulates a value that wraps across rows', () => {
    const { variables } = parseDictionary(
      doc([
        'FIELD NAME: RESIDENCE_POSTALCODE',
        'POSITION: 122-127',
        'LENGTH: 6',
        'DESCRIPTION: Canadian postal code, for which the format is ANANAN, where A is a',
        'letter, and N is a number.',
        'COMMENTS: The postal code must correspond to the province.',
      ]),
      mint,
    );
    expect(variables).toHaveLength(1);
    const v = variables[0]!;
    expect(v.name).toBe('RESIDENCE_POSTALCODE');
    expect(v.position).toBe('122-127');
    // The wrapped second line has to be part of the description, not lost.
    expect(v.questionText).toBe(
      'Canadian postal code, for which the format is ANANAN, where A is a letter, and N is a number.',
    );
    expect(v.note).toContain('province');
  });
});

describe('parseDictionary — reporting', () => {
  it('reports a scan rather than returning an empty parse as success', () => {
    const scanned: ExtractedDoc = { ...doc(['']), likelyScanned: true };
    const { variables, notes } = parseDictionary(scanned, mint);
    expect(variables).toEqual([]);
    expect(notes[0]?.severity).toBe('warning');
    expect(notes[0]?.message).toMatch(/scan/i);
  });

  it('reports a document whose layout it does not recognize', () => {
    const { variables, notes } = parseDictionary(doc(['Some prose.', 'More prose.']), mint);
    expect(variables).toEqual([]);
    expect(notes.some((n) => /no known variable-entry layout/.test(n.message))).toBe(true);
  });

  it('attributes every note to the file that caused it', () => {
    const { notes } = parseDictionary(doc(['Some prose.']), mint);
    expect(notes[0]?.file).toBe(`${FILE.bundle}/${FILE.path}`);
  });

  it('mints an id for every variable through the injected minter', () => {
    let n = 0;
    const { variables } = parseDictionary(
      doc(['Variable Name: AGE Length: 2.0 Position: 1', 'Variable Name: SEX Length: 1.0 Position: 3']),
      () => `id-${n++}`,
    );
    expect(variables.map((v) => v.recordId)).toEqual(['id-0', 'id-1']);
  });
});

// ---------------------------------------------------------------------------------------------
// Real corpus
// ---------------------------------------------------------------------------------------------

describe.skipIf(!existsSync(CORPUS))('real corpus delivery (on-demand, 2.4 GB, not committed)', () => {
  it('parses a known T15.2 collection-layout dictionary with its code lists intact', async () => {
    const { forEachCorpusFile } = await import('../zip.js');
    const { classifyFile } = await import('../classify.js');
    const { extractPdf } = await import('../pdf.js');

    let buf: Buffer | undefined;
    let file: CorpusFile | undefined;
    forEachCorpusFile(CORPUS, (bundle, entry, read) => {
      if (!entry.path.endsWith('SDDS4422_LSIC_ELIC_C3_LD_T15.2_eng.pdf')) return;
      file = classifyFile(bundle, entry.path, entry.sizeBytes);
      buf = read();
    });
    expect(buf).toBeDefined();

    const extracted = await extractPdf(buf!, file!);
    expect(detectLayout(extracted).layout).toBe('collection');

    const { variables } = parseDictionary(extracted, mint);
    expect(variables.length).toBeGreaterThan(20);

    const coded = variables.find((v) => v.codes.length > 0);
    expect(coded).toBeDefined();
    // End-to-end guard: the code keeps its own label rather than picking up a frequency.
    const notApplicable = variables
      .flatMap((v) => v.codes)
      .find((c) => c.code === '99999995');
    expect(notApplicable?.label).toBe('Not applicable');
  }, 120_000);
});
