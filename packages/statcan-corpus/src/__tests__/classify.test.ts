/**
 * Tests for the path-only classifier (`src/classify.ts`).
 *
 * The tables below are all real corpus paths, but the corpus itself is never needed to run them:
 * the classifier reads strings, so its whole contract is testable from a fresh clone. The
 * corpus-dependent block at the bottom skips when the 2.4 GB delivery is absent, exactly as
 * `zip.test.ts` and `packages/ddi-xml/src/__tests__/external-import.test.ts` do.
 *
 * What these tests are actually defending is *abstention*. A wrong `year` silently corrupts the
 * longitudinal concept timeline that is the point of the product, and a wrong `docKind` either
 * feeds an index to the dictionary parsers or drops a dictionary on the floor. So the negative
 * cases here — `91f0015M` is not a year, `T1FF` is not a T-code, an index with no alphabetic or
 * topical qualifier has no `docKind` — carry as much weight as the positive ones, and each is
 * pinned to the family of real filenames that forced it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyFile,
  docKindForTcode,
  extractSurveyAcronym,
  inferDocKindFromName,
  parseTcode,
} from '../classify.js';
import type { CorpusFile, DocKind, Lang } from '../types.js';
import { forEachCorpusFile } from '../zip.js';

const BUNDLE = 'RDC Nonconfidential Documentation (1).zip';

/** Classify a path with a fixed bundle and size — the two fields the classifier only passes through. */
function classify(p: string): CorpusFile {
  return classifyFile(BUNDLE, p, 1234);
}

// ---------------------------------------------------------------------------------------------
// parseTcode
// ---------------------------------------------------------------------------------------------

describe('parseTcode', () => {
  const cases: ReadonlyArray<readonly [string, string | undefined, string]> = [
    // The four spellings of the same code that the corpus actually uses.
    ['CCHS_2011_2012_T3_v1', 'T3', 'dot-free code, underscore separators'],
    ['CCHS_C1_1_T15.4_f1_v1', 'T15.4', 'dotted minor part'],
    ['cchs_escc_2015_cfg_f1_T15-2_v4', 'T15.2', 'hyphen as the minor separator'],
    ['MC_CM/cvsb_cvss_1993_2017_f3_T15_2_v1', 'T15.2', 'underscore as the minor separator'],
    ['eeph_2020_f1_t15-2_v1', 'T15.2', 'lower-case code'],
    ['dcobs_2020_T1,1_v1', 'T1.1', 'comma typo for the dot — one real file'],
    ['bc_k_12_2021_f1T15_2_v2', 'T15.2', 'file number run straight into the code'],
    ['gss_esg_T7v1', 'T7', 'version suffix run straight onto the code'],
    ['T05_2_v1', 'T5.2', 'leading zero normalizes away'],
    ['fore_abr_2022_fr_f1_T24_0_v1', 'T24.0', 'an explicit .0 minor part is kept'],

    // Look-alikes that must not be read as codes.
    ['T1FF_pi_for_PSIS_RAIS_AllYears', undefined, 'T1FF is a data source, not a T1 document'],
    ['t1ff_1992-2019_elmlp_f3_T15-2_v2', 'T15.2', 'a T1FF file is still classified by its real code'],
    ['SDDS4422_LSIC_ELIC_C3_LD_T15.2_eng', 'T15.2', 'the SDDS survey id contributes nothing'],
    ['CEN_91f0015M_201612_Demographic_Documents_T9.2_v1', 'T9.2', 'catalogue id contributes nothing'],
    ['ETVC_2010_T24_v1', 'T24', 'the T inside ETVC is letter-preceded and rejected'],
    ['CanCHEC_2016_SDLE-Census2016-ERLF1_T12_v1', 'T12', 'trailing-letter tokens are rejected'],

    // Multiple codes: the last one is the document type, the earlier ones name linked sources.
    ['lisa_t4_2000-2015_f1_T15.2_v1', 'T15.2', 'a T15.2 dictionary about T4 tax records'],
    ['chs_2008-2017_t4_f3_T15-2_v2', 'T15.2', 'same shape, hyphenated'],
    ['lisa_t4_2000-2015', 'T4', 'a year range does not become a minor part'],

    // The `T`-less spelling, recovered only under the tight guard.
    ['ECAE_2013_F1_15.2_v1', 'T15.2', 'bare code before a version token'],
    ['gss_29_tu_analm_f1_15.2_v3', 'T15.2', 'bare code, lower-case neighbours'],
    ['CCHS_2011_2012_11.1_v1', 'T11.1', 'bare code next to two four-digit years'],
    ['CCHS_2011_2012_v1', undefined, 'adjacent years never form a bare code'],
    ['foo_1.5_v1', undefined, 'a bare code must be one this module already knows'],
    ['foo_15.2_final', undefined, 'a bare code must be followed by a version token'],

    ['GIFI_All', undefined, 'no code at all'],
    ['', undefined, 'empty name'],
  ];

  it.each(cases)('%s → %s (%s)', (name, expected) => {
    expect(parseTcode(name)).toBe(expected);
  });

  it('is not order-dependent across calls (the shared global regex is reset)', () => {
    expect(parseTcode('lisa_t4_2000-2015_f1_T15.2_v1')).toBe('T15.2');
    expect(parseTcode('CCHS_2011_2012_T3_v1')).toBe('T3');
    expect(parseTcode('lisa_t4_2000-2015_f1_T15.2_v1')).toBe('T15.2');
    expect(parseTcode('ECAE_2013_F1_15.2_v1')).toBe('T15.2');
    expect(parseTcode('ECAE_2013_F1_15.2_v1')).toBe('T15.2');
  });
});

// ---------------------------------------------------------------------------------------------
// docKindForTcode
// ---------------------------------------------------------------------------------------------

describe('docKindForTcode', () => {
  const cases: ReadonlyArray<readonly [string | undefined, DocKind | undefined]> = [
    ['T15.2', 'data-dictionary'],
    ['T15.6', 'data-dictionary'],
    ['T15', 'data-dictionary'],
    ['T3', 'record-layout'],
    ['T11.1', 'alphabetic-index'],
    ['T11.2', 'topical-index'],
    ['T1.1', 'user-guide'],
    ['T24', 'reference'],
    ['T24.0', 'reference'],
    // Unmodelled minor variants fall back to the family, so a new T15.x still reaches the parsers.
    ['T15.9', 'data-dictionary'],
    ['T1.7', 'user-guide'],
    ['T4.3', 'reference'],
    // `T11` with no minor part is an index whose kind the filename does not state.
    ['T11', undefined],
    ['T99', undefined],
    [undefined, undefined],
  ];

  it.each(cases)('%s → %s', (tcode, expected) => {
    expect(docKindForTcode(tcode)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// extractSurveyAcronym
// ---------------------------------------------------------------------------------------------

describe('extractSurveyAcronym', () => {
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['CCHS_ESCC', 'CCHS'],
    ['APS_EAPA_2006', 'APS'],
    ['LFS-EPA', 'LFS'],
    ['SSPD_EEPH_2020', 'SSPD'],
    ['T1FF_pi_for_PSIS_RAIS_AllYears', 'T1FF'],
    // Real mixed-case StatCan acronyms must survive the 60%-uppercase test.
    ['CanCHEC_CSERCan', 'CanCHEC'],
    ['CanBCC_CCanNR_2016', 'CanBCC'],
    // Prose folders are not acronyms: a junk facet that looks real is worse than none.
    ['Vital Statistics Birth Database', undefined],
    ['Vital Statistics Death Database', undefined],
    ['Business_Data', undefined],
    ['Alberta_Shelter_Linkage', undefined],
    ['Mother Centric', undefined],
    ['Record Layout', undefined],
    ['0_Geo Summary', undefined],
    ['', undefined],
  ];

  it.each(cases)('%s → %s', (group, expected) => {
    expect(extractSurveyAcronym(group)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// inferDocKindFromName
// ---------------------------------------------------------------------------------------------

describe('inferDocKindFromName', () => {
  const cases: ReadonlyArray<readonly [string, DocKind | undefined, string]> = [
    // Rule order: a dictionary that appends an index is a dictionary; an index into a dictionary
    // is an index; `record` qualifies a dictionary's ordering more often than it names a layout.
    [
      'GSS24_Main_Data_Dictionary_and_Alphabetical_Index',
      'data-dictionary',
      'the conjunction makes it one dictionary',
    ],
    ['English DD Alpha Index', 'alphabetic-index', 'an index into a dictionary is an index'],
    ['rounded_dd_nel_record_c3_f', 'data-dictionary', '`record` here qualifies the ordering'],
    ['ESCC_2013_2014_Table_Sujet', 'topical-index', 'French topical index'],

    // CamelCase has to be split before any \b-anchored rule can see these words.
    ['LFS_RV2021_RecordLayout_RDC_ENG', 'record-layout', 'RecordLayout is one token in the source'],
    ['CESP1998_2020_RecordLayout_EN', 'record-layout', 'same'],
    ['PCEE1998_2020_Cliché d_article_FR', 'record-layout', "cliché d'article is the French term"],
    ['ICCS_RDCPilotManual_EN', 'reference', 'acronym running into a word: RDC|Pilot|Manual'],
    ['LFE_T4_DataDictionary_January2020', 'data-dictionary', 'DataDictionary is one token'],
    ['CEEDD_VariableList_2020vintage', 'data-dictionary', 'VariableList is one token'],
    ['CSEW2013_ZeroFreqCdbk', 'data-dictionary', 'ZeroFreq|Cdbk'],
    ['English Userguide', 'user-guide', 'Userguide has no case boundary to split on'],

    // The "codebook with counts suppressed" idiom.
    ['CIS 2022 - no freqs_E', 'data-dictionary', 'no freqs'],
    ['LISA nofreq_F', 'data-dictionary', 'run-together nofreq'],
    ['AdultEWOFreqs', 'data-dictionary', 'without-freqs, camel-cased'],
    ['ADULTES_EVMLO_sansfreq_Fev2009', 'data-dictionary', 'French sans fréquences'],
    ['CNICS_Master_27062017_zeroFreq_E', 'data-dictionary', 'zero frequencies'],
    ['ECVNE2011_pasdeschiffes_LvCd_F', 'data-dictionary', 'livre de codes'],
    ['dad-data-elements-2023-2024-en', 'data-dictionary', 'data elements is a dictionary'],
    // …but not when the document calls itself an index: which index is unknowable from the name.
    ['LSIC_W2_COLLECTION_index_NoCnts', undefined, 'an index with counts suppressed, kind unknown'],
    ['ELIC_V3_Diffusion_Index_SansFreq', undefined, 'same, French'],
    ['LSIC_W1_CdBk_NoCnts_Index', 'data-dictionary', 'unless it also says codebook'],

    // User guide vs. a notice addressed to users.
    [
      'Manuel de l_utilisateur des centres de données de recherche_octobre 2013',
      'user-guide',
      'the qualified French form',
    ],
    ['LFS_RV2021 Avis pour les utilisateurs CDR_FRA', undefined, 'a notice to users is not a guide'],

    ['ESCC_2013_2014_Variables_dérivées', 'reference', 'derived variables, French'],
    ['HMHDB_Technical_Note_2020_2021', 'reference', 'a technical note is reference material'],
    ['Cycles 1-9 NPHS Household Longdoc F', 'reference', 'longdoc is the methodology document'],

    ['whatever', undefined, 'nothing to go on'],
    ['CEN_2006_EN Public', undefined, 'nothing to go on'],
    ['99-014-x2011007-eng', undefined, 'a catalogue number says nothing about document type'],
    ['', undefined, 'empty stem'],
  ];

  it.each(cases)('%s → %s', (stem, expected) => {
    expect(inferDocKindFromName(stem)).toBe(expected);
  });

  it('falls back to the enclosing folders, deepest first', () => {
    expect(inferDocKindFromName('Can I combine CanCHECs', ['CanCHEC_CSERCan', 'FAQ'])).toBe('reference');
    expect(
      inferDocKindFromName('ALB_Albumin_E', ['CHMS_ECMS', 'CHMS_ECMS_Cycle_1', 'Lab Protocols']),
    ).toBe('reference');
    expect(inferDocKindFromName('Quest94e', ['NPHS_5003', 'Questionnaires', 'Cycle 1 (1994-1995)'])).toBe(
      'reference',
    );
  });

  it('prefers the filename over the folder', () => {
    // The file names itself a codebook; the folder only says these are questionnaires.
    expect(inferDocKindFromName('APS_Master_Codebook_E', ['APS_EAPA', 'Questionnaires'])).toBe(
      'data-dictionary',
    );
  });

  it('never reads the survey-group folder as a document type', () => {
    // `folders[0]` names a survey, not a document. Otherwise every file under a group whose name
    // happens to contain a genre word would inherit that word.
    expect(inferDocKindFromName('x', ['Record Layout'])).toBeUndefined();
    expect(inferDocKindFromName('x', ['CJRD RDC Manual external access'])).toBeUndefined();
    // …but a deeper folder with the same name is a real signal.
    expect(inferDocKindFromName('x', ['CJRD_BDRJP', 'Record Layout'])).toBe('record-layout');
  });
});

// ---------------------------------------------------------------------------------------------
// classifyFile — the whole record
// ---------------------------------------------------------------------------------------------

interface Expectation {
  tcode?: string | undefined;
  docKind?: DocKind;
  surveyGroup?: string;
  surveyAcronym?: string | undefined;
  cycle?: string | undefined;
  year?: number | undefined;
  lang?: Lang;
  ext?: string;
}

const FILE_CASES: ReadonlyArray<readonly [string, Expectation]> = [
  // ---- the EN/FR twin pair: identical but for the acronym, which is the only language signal ----
  [
    'CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T3_v1.pdf',
    {
      tcode: 'T3',
      docKind: 'record-layout',
      surveyGroup: 'CCHS_ESCC',
      surveyAcronym: 'CCHS',
      cycle: '2011_2012',
      year: 2011,
      lang: 'en',
      ext: 'pdf',
    },
  ],
  [
    'CCHS_ESCC/CCHS_ESCC_2011_2012/ESCC_2011_2012_T3_v1.pdf',
    { tcode: 'T3', docKind: 'record-layout', surveyAcronym: 'CCHS', cycle: '2011_2012', year: 2011, lang: 'fr' },
  ],

  // ---- explicit language tag, survey id that is not a year ----
  [
    'LSIC_ELIC/LSIC_ELIC_3/SDDS4422_LSIC_ELIC_C3_LD_T15.2_eng.pdf',
    {
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'LSIC_ELIC',
      surveyAcronym: 'LSIC',
      cycle: '3',
      year: undefined, // `SDDS4422` is letter-adjacent and rejected
      lang: 'en',
    },
  ],

  // ---- lower-case code with a hyphen separator; year and cycle from the group folder ----
  [
    'SSPD_EEPH_2020/eeph_2020_f1_t15-2_v1.pdf',
    {
      tcode: 'T15.2',
      docKind: 'data-dictionary',
      surveyGroup: 'SSPD_EEPH_2020',
      surveyAcronym: 'SSPD',
      cycle: '2020',
      year: 2020,
      lang: 'fr', // EEPH is the French half of the SSPD_EEPH pair
    },
  ],

  // ---- group folder that is only an acronym pair: no cycle to report ----
  [
    'STCL_ETVC/ETVC_2010_T24_v1.pdf',
    {
      tcode: 'T24',
      docKind: 'reference',
      surveyGroup: 'STCL_ETVC',
      surveyAcronym: 'STCL',
      cycle: undefined,
      year: 2010,
      lang: 'fr',
    },
  ],

  // ---- StatCan cycle designator, read from the folder rather than the filename ----
  [
    'CCHS_ESCC/CCHS_ESCC_2001_C1.1/CCHS_C1_1_T15.4_f1_v1.pdf',
    {
      tcode: 'T15.4',
      docKind: 'data-dictionary',
      surveyAcronym: 'CCHS',
      cycle: 'C1.1',
      year: 2001,
      lang: 'en',
    },
  ],

  // ---- prose folder: no acronym, and no invented one ----
  [
    '0_Geo Summary/whatever.pdf',
    {
      surveyGroup: '0_Geo Summary',
      surveyAcronym: undefined,
      cycle: undefined,
      year: undefined,
      tcode: undefined,
      docKind: 'unknown',
      lang: 'unknown',
    },
  ],

  // ---- T1FF is the T1 Family File, not document type T1 ----
  ['T1FF_pi_for_PSIS_RAIS_AllYears/x.pdf', { tcode: undefined, surveyAcronym: 'T1FF', year: undefined }],
  [
    'T1FF_pi_for_PSIS_RAIS_AllYears/t1ff_1992-2019_elmlp_f3_T15-2_v2.pdf',
    { tcode: 'T15.2', docKind: 'data-dictionary' },
  ],

  // ---- a catalogue id and a YYYYMM stamp are not years, and 1911 is outside the corpus span ----
  [
    'CEN_REC/CEN_REC_1911/CEN_91f0015M_201612_Demographic_Documents_T9.2_v1.pdf',
    {
      tcode: 'T9.2',
      docKind: 'reference',
      surveyGroup: 'CEN_REC',
      surveyAcronym: 'CEN',
      cycle: '1911', // the cycle label is kept verbatim even where the year is rejected
      year: undefined,
    },
  ],

  // ---- a T-code naming a linked data source loses to a filename that states its own type ----
  [
    'SIBS_LFE/LFE_T4_DataDictionary_January2020.doc',
    {
      tcode: 'T4',
      docKind: 'data-dictionary', // not `reference`, which the T4 family rule would give
      ext: 'doc',
    },
  ],
  ['CEEDD_BDCDEE/CodeSet_T1_2019Vintage_released.pdf', { tcode: 'T1', docKind: 'data-dictionary' }],
  // …but a code in the document slot still outranks the filename wording.
  [
    'IMDB_BDIM/2015/imdb_2015_appendix_f3_t15.3_v1.pdf',
    { tcode: 'T15.3', docKind: 'data-dictionary', year: 2015 },
  ],
  ['CEN_REC/CEN_REC_2011/CEN_NHS_2011_T4_v1.docx', { tcode: 'T4', docKind: 'reference', year: 2011 }],

  // ---- the `T`-less code spelling ----
  ['EICS_ECAE_2013/ECAE_2013_F1_15.2_v1.pdf', { tcode: 'T15.2', docKind: 'data-dictionary', year: 2013 }],
  [
    'CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_11.1_v1.pdf',
    { tcode: 'T11.1', docKind: 'alphabetic-index', lang: 'en' },
  ],
  [
    'CCHS_ESCC/CCHS_ESCC_2011_2012/ESCC_2011_2012_11.2_v1.pdf',
    { tcode: 'T11.2', docKind: 'topical-index', lang: 'fr' },
  ],

  // ---- typed only by the folder they sit in ----
  ['CanCHEC_CSERCan/FAQ/Can I combine CanCHECs.docx', { docKind: 'reference', tcode: undefined }],
  [
    'CHMS_ECMS/CHMS_ECMS_Cycle_1/Lab Protocols/ALB_Albumin_E.pdf',
    { docKind: 'reference', cycle: 'Cycle_1', lang: 'en' },
  ],
  ['CHMS_ECMS/CHMS_ECMS_Cycle_4/dissem_plan/Cycle4_CHMS_Dissem_Plan_2016_11_07_E.pdf', { docKind: 'reference' }],

  // ---- a bundle-root file: no folder, so no group, and that is the honest answer ----
  [
    'MANIFEST_RDC Nonconfidential Documentation.html',
    { surveyGroup: '', surveyAcronym: undefined, cycle: undefined, ext: 'html', docKind: 'reference' },
  ],

  // ---- deliberate abstentions ----
  [
    'LSIC_ELIC/LSIC_ELIC_2/LSIC_W2_COLLECTION_index_NoCnts.pdf',
    { docKind: 'unknown', tcode: undefined, cycle: '2' },
  ],
  ['NHS/99-014-x2011007-eng.pdf', { docKind: 'unknown', year: undefined, lang: 'en' }],
  ['Business_Data/BIGS_2020_DatasetNotes_EnterpriseLevel.docx', { surveyAcronym: undefined, lang: 'unknown' }],
];

describe('classifyFile', () => {
  it.each(FILE_CASES)('%s', (p, expected) => {
    const actual = classify(p);
    for (const [key, value] of Object.entries(expected)) {
      expect(actual[key as keyof CorpusFile], `${key} of ${p}`).toStrictEqual(value);
    }
  });

  it('passes bundle, path and size through unchanged', () => {
    const f = classifyFile('RDC Nonconfidential Documentation (7).zip', 'APS_EAPA/aps_2017_T1_1_v1.pdf', 98765);
    expect(f.bundle).toBe('RDC Nonconfidential Documentation (7).zip');
    expect(f.path).toBe('APS_EAPA/aps_2017_T1_1_v1.pdf');
    expect(f.sizeBytes).toBe(98765);
  });

  it('normalizes separators and a leading slash', () => {
    const a = classify('CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T3_v1.pdf');
    const b = classify('/CCHS_ESCC\\CCHS_ESCC_2011_2012\\CCHS_2011_2012_T3_v1.pdf');
    expect(b).toStrictEqual(a);
  });

  it('is pure and deterministic — the same input always yields the same record (D9)', () => {
    const paths = FILE_CASES.map(([p]) => p);
    const once = paths.map((p) => classify(p));
    const twice = paths.map((p) => classify(p));
    expect(twice).toStrictEqual(once);
    // …and in reverse order, to catch a stateful global regex leaking between files.
    const reversed = [...paths].reverse().map((p) => classify(p));
    expect(reversed).toStrictEqual([...once].reverse());
  });

  it('reaches a verdict on every field even for a degenerate path', () => {
    const f = classify('');
    expect(f).toStrictEqual({
      bundle: BUNDLE,
      path: '',
      sizeBytes: 1234,
      ext: '',
      tcode: undefined,
      docKind: 'unknown',
      surveyGroup: '',
      surveyAcronym: undefined,
      cycle: undefined,
      year: undefined,
      lang: 'unknown',
    });
  });

  it('never reports a year outside the corpus span, however plausible the digits look', () => {
    for (const p of [
      'CEN_REC/CEN_REC_1911/CEN_1911_T3_v1.pdf', // real, but before the span
      'NHS/99-010-x2011006-eng.pdf', // catalogue number
      'LSIC_ELIC/LSIC_ELIC_3/SDDS4422_LSIC_ELIC_C3_LD_T15.2_eng.pdf', // survey id
      'ACS_EEA/5108_ACS-EEA_C2006_T15.2_eng.doc', // `C2006` is letter-adjacent
      'CEN_REC/CEN_REC_2016/CEN_91f0015M_201612_x_T9.2_v1.pdf', // YYYYMM stamp… but see below
    ]) {
      const y = classify(p).year;
      expect(y === undefined || (y >= 1980 && y <= 2026), `${p} → ${y}`).toBe(true);
    }
    // The folder is searched before the filename, because that is where the corpus states the
    // cycle authoritatively — `C2006` in the filename is rejected, `_2016` in the folder is not.
    expect(classify('ACS_EEA_2006/5108_ACS-EEA_C2006_T15.2_eng.doc').year).toBe(2006);
    expect(classify('CEN_REC/CEN_REC_2016/CEN_91f0015M_201612_x_T9.2_v1.pdf').year).toBe(2016);
  });

  it('takes the first year of a range — the start of the reference period', () => {
    expect(classify('CHS_ECL/chs_2008-2017_t4_f3_T15-2_v2.pdf').year).toBe(2008);
    expect(classify('CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T3_v1.pdf').year).toBe(2011);
  });

  it('reads the language tag ahead of the acronym, since a file can carry both', () => {
    // Both halves of the ACS_EEA pair appear in this name; only the tag separates the two files.
    expect(classify('ACS_EEA_2006/5108_ACS-EEA_C2006_T15.2_eng.doc').lang).toBe('en');
    expect(classify('ACS_EEA_2006/5108_ACS-EEA_C2006_T15.2_fra.doc').lang).toBe('fr');
  });

  it('does not read a file-number token as a French tag', () => {
    // `_f1`/`_f3` are file numbers. Nothing else in this name is a language signal.
    expect(classify('BC_CB_K12/CB_K_12_2021_analytical_f1_T15-2.pdf').lang).toBe('unknown');
    expect(classify('BC_CB_K12/CB_K_12_2021_analytical_f3_T15-2.pdf').lang).toBe('unknown');
  });

  it('does not read the French word `en` as an English tag', () => {
    // Space is excluded from the tag delimiters precisely so that French prose filenames — which
    // are common here — are not tagged English by the preposition.
    expect(classify('CanCHEC_CSERCan/FAQ/Comment peut-on commencer en fusionnant les fichiers.docx').lang).toBe(
      'fr',
    );
  });

  it('suppresses the acronym-pair signal for linkage groups that chain three acronyms', () => {
    // `DAD_NACRS_CCHS_T1FF` lists several English-named sources; reading `NACRS` as "the French
    // name" would tag every file mentioning it French.
    expect(classify('DAD_NACRS_CCHS_T1FF/nacrs_2019_f1_T15-2_v1.pdf').lang).toBe('unknown');
    // Two acronyms is the pair convention, and there the signal stands.
    expect(classify('CCHS_ESCC/ESCC_2019_f1_T15-2_v1.pdf').lang).toBe('fr');
  });

  it('leaves the language unknown rather than guessing', () => {
    for (const p of [
      'BC_CB_K12/BC_CB_K-12_AllYears/CB_K_12_2021_completion_rate_f1_T15-2_v1.pdf',
      'CEEDD_BDCDEE/CodeSet_T1_2019Vintage_released.pdf',
      'Business_Data/BIGS_2020_DatasetNotes_EnterpriseLevel.docx',
      '0_Geo Summary/whatever.pdf',
    ]) {
      expect(classify(p).lang, p).toBe('unknown');
    }
  });

  it('KNOWN LIMITATION: a two-dataset group folder is read as an EN/FR acronym pair', () => {
    // `SIBS_LFE` chains two English-named datasets, but with only two tokens it is indistinguishable
    // from the `EN_FR` convention that 297 of the 318 groups follow, so `LFE` is taken as the French
    // half. Across the whole corpus this is the *only* file where the acronym signal and the
    // vocabulary signal disagree and the vocabulary is the one that is right — reordering the two
    // would fix this file and break `ECL_household_T15.2_v1.pdf` in exchange. Pinned so the trade is
    // a deliberate one, not a surprise.
    expect(classify('SIBS_LFE/LFE_T4_DataDictionary_January2020.doc').lang).toBe('fr');
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

const MIN_YEAR = 1980;
const MAX_YEAR = 2026;

function sortedTally(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

describe.skipIf(!existsSync(CORPUS))('real corpus delivery (on-demand, 2.4 GB, not committed)', () => {
  const files: CorpusFile[] = [];
  forEachCorpusFile(CORPUS, (bundle, entry) => {
    files.push(classifyFile(bundle, entry.path, entry.sizeBytes));
  });

  const byDocKind = new Map<string, number>();
  const byLang = new Map<string, number>();
  const byTcode = new Map<string, number>();
  for (const f of files) {
    byDocKind.set(f.docKind, (byDocKind.get(f.docKind) ?? 0) + 1);
    byLang.set(f.lang, (byLang.get(f.lang) ?? 0) + 1);
    const t = f.tcode ?? '(none)';
    byTcode.set(t, (byTcode.get(t) ?? 0) + 1);
  }

  it('classifies all 3,006 files', () => {
    expect(files).toHaveLength(3006);
    console.log('classify: by docKind', sortedTally(byDocKind));
    console.log('classify: by lang', sortedTally(byLang));
    console.log('classify: by tcode', sortedTally(byTcode));
    const groups = new Set(files.map((f) => f.surveyGroup));
    const years = files.map((f) => f.year).filter((y): y is number => y !== undefined);
    console.log(
      `classify: ${groups.size} survey groups, ${new Set(files.map((f) => f.surveyAcronym)).size - 1} acronyms, ` +
        `${years.length} files dated ${Math.min(...years)}–${Math.max(...years)}`,
    );
  });

  it('assigns a docKind other than `unknown` to at least 95% of files', () => {
    const known = files.filter((f) => f.docKind !== 'unknown').length;
    const pct = (known / files.length) * 100;
    console.log(`classify: ${known}/${files.length} typed (${pct.toFixed(1)}%)`);
    expect(pct).toBeGreaterThanOrEqual(95);
  });

  it('never reports a year outside 1980–2026', () => {
    const bad = files.filter((f) => f.year !== undefined && (f.year < MIN_YEAR || f.year > MAX_YEAR));
    expect(bad.map((f) => `${f.path} → ${f.year}`)).toStrictEqual([]);
  });

  it('produces only well-formed T-codes', () => {
    const malformed = [...byTcode.keys()].filter((t) => t !== '(none)' && !/^T\d{1,2}(\.\d)?$/.test(t));
    expect(malformed).toStrictEqual([]);
  });

  it('is deterministic across a second pass over the same delivery', () => {
    const again: CorpusFile[] = [];
    forEachCorpusFile(CORPUS, (bundle, entry) => {
      again.push(classifyFile(bundle, entry.path, entry.sizeBytes));
    });
    expect(again).toStrictEqual(files);
  });
}, 600_000);
