/**
 * Path-only classification of corpus files (M1, docs/metadata-repo-plan.md §6).
 *
 * `classifyFile` decides everything a {@link CorpusFile} carries — document type, survey group,
 * cycle, year, language — from `bundle` + `path` alone. No file is opened, nothing is decompressed:
 * the whole 3,006-file inventory is classified from strings, so the expensive passes (PDF text
 * extraction, per-variant parsing) can be planned and budgeted before any of them run.
 *
 * The heuristics below are calibrated against the real corpus, and the calibration matters more
 * than the rules: every rule here exists because the actual filenames forced it. Where the corpus
 * is genuinely ambiguous the answer is `undefined` / `'unknown'`, never a plausible guess — a
 * wrong `year` silently corrupts the longitudinal view that is the entire point of the product,
 * and an unclassified file is itemized in the ingest report (D7) where someone can fix it.
 */
import type { CorpusFile, DocKind, Lang } from './types.js';

/* -------------------------------------------------------------------------------------------- *
 * T-codes
 * -------------------------------------------------------------------------------------------- */

/**
 * StatCan's document-type code as it actually appears in filenames.
 *
 * Four things in this pattern were each forced by a real family of files:
 *
 * - **`(?<![A-Za-z])`** — the code may be preceded by anything except a letter. It must reject
 *   `T1FF` (the T1 Family File, a *data source* that names 40+ files and whole folders) and
 *   `SDDS4422`; it must accept `…_f1T15_2_v2.pdf`, where 17 real files run the file-number token
 *   straight into the code with no separator at all.
 * - **`(\d{1,2})(?:[._,-](\d))?`** — the minor part is a *single* digit. `T4_2000-2015` is a T4
 *   code followed by a year range, not a `T4.2000`; capping the minor part at one digit makes the
 *   optional group fail and the engine backtrack to the bare `T4`. The `,` separator is there for
 *   exactly one file (`dcobs_2020_T1,1_v1.pdf`) whose comma is a typo for a dot.
 * - **`(?=v\d|[^A-Za-z0-9]|$)`** — a trailing letter means this is not a code (`T1FF` again), with
 *   one deliberate exception: a version suffix run straight onto the code (`…_T7v1.docx`).
 *
 * The lookahead is what does the false-positive work, so relaxing the *leading* boundary to allow
 * digits costs nothing in precision.
 */
const TCODE_RE = /(?<![A-Za-z])T(\d{1,2})(?:[._,-](\d))?(?=v\d|[^A-Za-z0-9]|$)/gi;

/**
 * The same code with the `T` dropped — `ECAE_2013_F1_15.2_v1.pdf`, `..._f1_15.2_v3.pdf`,
 * `CCHS_2011_2012_11.1_v1.pdf`. Six real files spell it this way, and they are dictionaries and
 * indexes that would otherwise be lost entirely.
 *
 * The pattern is deliberately far narrower than {@link TCODE_RE}, because a bare `15.2` has none
 * of the `T`'s protection against ordinary numbers: it must carry a minor part, sit on a separator
 * boundary, be **immediately followed by a version token**, and normalize to a code this module
 * already knows (see {@link TCODE_KIND}). A number that satisfies all four is a document code.
 */
const BARE_TCODE_RE = /(?<![A-Za-z0-9])(\d{1,2})[._-](\d)(?=[._-]v\d)/gi;

/**
 * What follows a T-code that really is *this document's* type code: a version (`_v1`), a file
 * number (`_f1`), a language tag (`_eng`), or nothing at all.
 *
 * The corpus writes the document code in a fixed trailing slot — `…_f3_T15-2_v2`, `…_T24_v1`,
 * `…_T9_eng` — while a T-code naming a *data source* sits mid-name in front of an ordinary word:
 * `LFE_T4_DataDictionary_January2020` (T4 tax records), `CodeSet_T1_2019Vintage_released` (T1
 * returns). Both of those are dictionaries whose own filename says so, and both were being filed
 * as `reference`/`user-guide` off a code that was never about them. See {@link classifyFile}.
 */
const DOC_SLOT_TAIL_RE = /^(?:$|[._\- ](?:v\d|f\d|eng|ang|fra|fre|en|fr|e|f)(?![A-Za-z0-9]))/i;

/** A T-code plus whether it sat in the document-type slot. */
interface TcodeHit {
  tcode: string;
  /** False when the code looks like a mention of a linked data source rather than a doc type. */
  documentSlot: boolean;
}

function normalizeTcode(major: string, minor: string | undefined): string {
  // Strip a leading zero so `T05.2` and `T5.2` normalize together; `T24.0` keeps its `.0`.
  const majorNum = String(Number(major));
  return minor === undefined ? `T${majorNum}` : `T${majorNum}.${minor}`;
}

/**
 * Normalized T-code found in `name`, with its position verdict, or `undefined`.
 *
 * When a filename carries several codes the **last** one wins. This is not arbitrary: in every
 * real multi-code file the earlier token names a linked *data source* and the later one is the
 * document type — `chs_2008-2017_t4_f3_T15-2_v2.pdf` is a data dictionary (T15.2) *about* T4 tax
 * records, and reading it as a T4 reference paper would drop a dictionary on the floor. All 14
 * multi-code files in the corpus are that exact shape (`t4` + `T15.x`), and the rule is right on
 * every one of them.
 */
function findTcode(name: string): TcodeHit | undefined {
  TCODE_RE.lastIndex = 0;
  let hit: TcodeHit | undefined;
  for (let m = TCODE_RE.exec(name); m !== null; m = TCODE_RE.exec(name)) {
    hit = {
      tcode: normalizeTcode(m[1]!, m[2]),
      documentSlot: DOC_SLOT_TAIL_RE.test(name.slice(m.index + m[0].length)),
    };
  }
  if (hit !== undefined) return hit;

  BARE_TCODE_RE.lastIndex = 0;
  for (let m = BARE_TCODE_RE.exec(name); m !== null; m = BARE_TCODE_RE.exec(name)) {
    const tcode = normalizeTcode(m[1]!, m[2]);
    // Only codes this module already recognizes: a bare number is too weak a signal for a guess.
    if (tcode in TCODE_KIND) hit = { tcode, documentSlot: true };
  }
  return hit;
}

/**
 * Normalized T-code found in `name`, or `undefined`. See {@link findTcode}.
 *
 * Call it with the filename *stem*: the extension is never part of a code, and stopping at the
 * stem is what lets a code that ends the name (`…_f1_T15.2.pdf`) be recognized as sitting in the
 * document-type slot.
 */
export function parseTcode(name: string): string | undefined {
  return findTcode(name)?.tcode;
}

/** Exact T-code → {@link DocKind}. Codes absent here fall through to the family rules. */
const TCODE_KIND: Readonly<Record<string, DocKind>> = {
  T15: 'data-dictionary',
  'T15.1': 'data-dictionary',
  'T15.2': 'data-dictionary',
  'T15.3': 'variable-list',
  'T15.4': 'derived-spec',
  'T15.6': 'data-dictionary',
  T3: 'record-layout',
  'T11.1': 'alphabetic-index',
  'T11.2': 'topical-index',
  T1: 'user-guide',
  'T1.1': 'user-guide',
  'T1.2': 'user-guide',
  T7: 'reference',
  T9: 'reference',
  'T9.1': 'reference',
  'T9.2': 'reference',
  T24: 'reference',
  'T24.0': 'reference',
  T10: 'reference',
  T12: 'reference',
  'T12.2': 'reference',
  'T5.2': 'reference',
};

/** Major number → kind, for minor variants that have not appeared yet (`T15.5`, `T4.3`, …). */
const TCODE_FAMILY_KIND: Readonly<Record<number, DocKind>> = {
  1: 'user-guide',
  4: 'reference',
  5: 'reference',
  7: 'reference',
  9: 'reference',
  10: 'reference',
  12: 'reference',
  15: 'data-dictionary',
  24: 'reference',
};

/**
 * Semantic kind for a normalized T-code, or `undefined` if the code is unmapped.
 *
 * Dispatching on the *kind* rather than the code is what lets M2's parsers select a layout variant
 * (`T15.2` vs `T15.6`) independently of intent — the two vary separately, and new variants keep
 * appearing. The family fallback means a `T15.5` that shows up next year is still routed to the
 * dictionary parsers (which will report if they cannot read it) rather than silently vanishing.
 * `T11` with no minor part stays unmapped on purpose: an index whose kind we cannot tell.
 */
export function docKindForTcode(tcode: string | undefined): DocKind | undefined {
  if (tcode === undefined) return undefined;
  const exact = TCODE_KIND[tcode];
  if (exact !== undefined) return exact;
  const major = Number(/^T(\d{1,2})/.exec(tcode)?.[1] ?? NaN);
  return TCODE_FAMILY_KIND[major];
}

/* -------------------------------------------------------------------------------------------- *
 * Keyword fallback for the untyped tail
 * -------------------------------------------------------------------------------------------- */

/**
 * Kind inferred from wording, for the 817 files that carry no T-code (mostly the pre-2010 and
 * the `.doc`/`.xlsx` tail). Bilingual, because roughly half of them are French.
 *
 * Every word here names a document *genre* — `protocol`, `presentation`, `report`, `summary`,
 * `codebook`, `record layout`. None is a subject word borrowed from a survey, because a rule that
 * fires on subject matter produces a confident wrong `docKind` rather than an honest `unknown`.
 * `reference` carries most of that vocabulary on purpose: it is the "real document, out of scope
 * for v1" bucket, so an over-eager match there costs a mislabelled methodology paper, while the
 * same mistake in `data-dictionary` would feed the M2 parsers something they cannot read.
 *
 * Rule order encodes which document a name is *primarily*, and these orderings were chosen against
 * real conflicts:
 *
 * - The **combined** check runs first because `GSS24_Main_Data_Dictionary_and_Alphabetical_Index`
 *   is one document that happens to append an index; the conjunction is the tell. Without it the
 *   index rule would win and the dictionary would never be parsed.
 * - Index checks run **before** dictionary (`English DD Alpha Index` is an index *into* a
 *   dictionary, not a dictionary), but `record` runs **after** it, because in this corpus `record`
 *   usually qualifies a dictionary's ordering (`rounded_dd_nel_record_c3_f`) rather than naming a
 *   standalone record layout.
 *
 * Questionnaires map to `'reference'`: {@link DocKind} has no questionnaire member, and they are
 * out of scope for v1 (§8 — no questionnaire reconstruction). That is a real classification, not a
 * failure to decide, so `'unknown'` would be the dishonest answer. If questionnaires are ever
 * ingested, they need their own `DocKind`, not a re-reading of this bucket.
 */
const KEYWORD_RULES: ReadonlyArray<readonly [RegExp, DocKind]> = [
  // "Data Dictionary and Alphabetical Index" / "Dictionnaire des données et index alphabétique".
  [
    /(?:data )?(?:dictionar|dictionnaire|codebook|code book|cdbk)[\s\S]{0,30}?\b(?:and|et|&)\b[\s\S]{0,20}?(?:index|alphab)/,
    'data-dictionary',
  ],
  [/\btopical\b|\btopic\b|th[eé]matique|\btable (?:des )?sujets?\b/, 'topical-index'],
  [/\balphab|\balpha\b/, 'alphabetic-index'],
  [
    /\bdata ?dictionar|\bdictionnaire|\bdictionar|\bcodebooks?\b|\bcode ?bks?\b|\bcd ?bks?\b|\bcdbook\b|\bcode ?books?\b|\bdd\b|\bcode ?sets?\b|\blv ?cds?\b|\blivres? de codes?\b|\bdata elements?\b|[eé]l[eé]ments? de donn[eé]es|\bvariables? lists?\b|\bliste des? variables\b/,
    'data-dictionary',
  ],
  // The "codebook with the counts suppressed" idiom, which names ~35 files that never say
  // "codebook": `CIS 2022 - no freqs_E`, `LISA nofreq_F`, `AdultEWOFreqs`, `CNICS_Master_zeroFreq_E`,
  // `ADULTES_EVMLO_sansfreq`. Frequencies are printed *in a variable's code table*, so a filename
  // that advertises their absence is describing a dictionary. The leading guard exempts names that
  // say `index`: `LSIC_W2_COLLECTION_index_NoCnts` is an index with its counts suppressed, and we
  // cannot tell from the name whether it is the alphabetic or the topical one — `unknown` is the
  // honest answer there, and a wrong `data-dictionary` would feed an index to the M2 parsers.
  [
    /^(?!.*\bindex\b).*(?:\b(?:no|without|wo|zero|z[eé]ro|sans)[ ]?fr[eé]q|\bfreqs?\b|\bpas des? chiffres\b|\bno ?cnts?\b|\bno ?counts?\b)/,
    'data-dictionary',
  ],
  [/\brecord\b|\blayout\b|mise en page|clich[eé] d.?articles?/, 'record-layout'],
  // `\bguides?\b` covers the English and the French form alike (`Guide_Ref_8B_FR`,
  // `bdrjp_guide_utili_juillet_2025`); `\buser ?guide\b` additionally catches the run-together
  // `Userguide`, which no case boundary splits. Bare `utilisateur` used to sit here and no longer
  // does: it also matches `Avis pour les utilisateurs`, a notice *to* users and not a guide at all.
  // The qualified French forms stay, so `Manuel de l'utilisateur des CDR` is still a user guide.
  [/\bguides?\b|\buser ?guides?\b|\buser ?doc\b|\buser ?manual\b|\b(?:manuel|guide) d(?:e l)?.?utilisat/, 'user-guide'],
  [
    /\bmethodolog|m[eé]thodolog|\bfaq\b|bibliograph|\bread ?me\b|lisez.?moi|\berrata\b|\breference\b|\bmanual\b|glossar|glossaire|questionnaire|\bdv ?doc|derived variables?|variables? d[eé]riv|\bappendi(?:x|ce)\b|\bannexe\b|\bdocumentation\b|\blong ?doc\b|\bprotocols?\b|\bpresentations?\b|\bwebinar|\bconference\b|\bconf[eé]rence\b|\breports?\b|\brapports?\b|\bnotes?\b|\btechnical\b|\btechnique\b|\bplans?\b|\bsummar|\bsommaire\b|\boverview\b|\baper[cç]u\b|\bcomparisons?\b|\bcomparaisons?\b|\bhow to\b|\bstud(?:y|ies)\b|\b[eé]tudes?\b|\bimputation|\bvariabilit|\bcontent\b|\bweights?\b|\branges?\b|\bdissem|\bintro(?:duction)?\b|\bpapers?\b|\bresearch\b|\brecherche\b|\bdescriptions?\b/,
    'reference',
  ],
];

/**
 * Lower-cased, separator-flattened form used by every keyword rule.
 *
 * CamelCase is split before flattening, because StatCan filenames run words together as often as
 * they separate them: `LFS_RV2021_RecordLayout_RDC_ENG`, `ICCS_RDCPilotManual_EN`,
 * `LFE_T4_DataDictionary_January2020`, `CSEW2013_ZeroFreqCdbk`, `CEEDD_VariableList_2020vintage`.
 * Every one of those carries an explicit document-type word that a `\b`-anchored rule cannot see
 * until the case boundary becomes a space. The second replacement handles an acronym running into
 * a word (`RDCPilot` → `RDC Pilot`), which the first cannot: it has no lower-case left neighbour.
 */
function normalizeForKeywords(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchKeywordRules(normalized: string): DocKind | undefined {
  for (const [re, kind] of KEYWORD_RULES) if (re.test(normalized)) return kind;
  return undefined;
}

/**
 * Kind inferred from wording, or `undefined` when nothing is confident.
 *
 * The filename is asked first and the enclosing folders only after it stays silent, deepest folder
 * first — the folder is the weaker, more general statement. It is still a real one: the corpus
 * sorts documents into `FAQ/`, `Lab Protocols/`, `Presentations/`, `Questionnaires/`,
 * `Methodological Documentation/` and `dissem_plan/`, which is the only thing that types the ~75
 * files inside them (`ALB_Albumin_E.pdf`, `Quest94e.doc`) whose own names say nothing at all.
 *
 * `folders[0]` is skipped: it is the survey group, and it names a *survey*, not a document type.
 */
export function inferDocKindFromName(stem: string, folders: readonly string[] = []): DocKind | undefined {
  const fromName = matchKeywordRules(normalizeForKeywords(stem));
  if (fromName !== undefined) return fromName;
  for (let i = folders.length - 1; i >= 1; i--) {
    const fromFolder = matchKeywordRules(normalizeForKeywords(folders[i]!));
    if (fromFolder !== undefined) return fromFolder;
  }
  return undefined;
}

/* -------------------------------------------------------------------------------------------- *
 * Survey group, acronym, cycle
 * -------------------------------------------------------------------------------------------- */

/**
 * Whether a folder-name token is a StatCan acronym rather than an ordinary word.
 *
 * The 60%-uppercase ratio (not "is it ALL CAPS") is what separates `CanCHEC`, `CanFED` and
 * `CSERCan` — real mixed-case StatCan acronyms — from `AllYears`, `Biobank`, `Business` and
 * `Alberta`, which are CamelCase words that a naive "has two capitals" test happily accepts. The
 * `AllYears` case is the one that matters: it appears as the third token of several group names,
 * and treating it as an acronym would corrupt both acronym extraction and pair detection.
 */
function looksLikeAcronym(token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(token)) return false;
  const letters = token.replace(/[^A-Za-z]/g, '');
  const upper = token.replace(/[^A-Z]/g, '').length;
  if (letters.length < 2 || upper < 2) return false;
  return upper / letters.length >= 0.6;
}

function groupTokens(group: string): string[] {
  return group.split(/[_\-\s]+/).filter((t) => t.length > 0);
}

/**
 * Leading English acronym of a survey group (`CCHS_ESCC` → `CCHS`, `APS_EAPA_2006` → `APS`), or
 * `undefined` when the folder does not follow StatCan's convention.
 *
 * 297 of 318 groups are `EN_FR` acronym pairs; the rest are prose (`Vital Statistics Birth
 * Database`, `0_Geo Summary`, `Business_Data`). Those must yield `undefined` rather than
 * `'Vital'`, because a junk acronym would silently create a junk facet that looks real.
 */
export function extractSurveyAcronym(group: string): string | undefined {
  const first = groupTokens(group)[0];
  if (first === undefined || !looksLikeAcronym(first)) return undefined;
  return first;
}

/**
 * The `EN_FR` acronym pair of a group, when it really is one.
 *
 * Suppressed for names that chain three or more acronyms (`DAD_NACRS_CCHS_T1FF`,
 * `CCHS_CCR_CENSUS11_16_T1FF`, `SSC_WC_ELS_BC`): those are *linkage* datasets listing several
 * English-named sources, and reading the second token as "the French name" would confidently
 * mislabel every file mentioning it as French. Losing the language signal on ~20 linkage groups
 * is much cheaper than tagging their files with the wrong language — Postgres FTS stems by
 * language, so a wrong tag degrades search for those records permanently.
 */
function acronymPair(group: string): { en: string; fr: string } | undefined {
  const tokens = groupTokens(group);
  const [en, fr, third] = tokens;
  if (en === undefined || fr === undefined) return undefined;
  if (!looksLikeAcronym(en) || !looksLikeAcronym(fr)) return undefined;
  if (en.toLowerCase() === fr.toLowerCase()) return undefined; // e.g. IPPI_IPPI — no signal
  if (third !== undefined && looksLikeAcronym(third)) return undefined; // linkage chain
  return { en, fr };
}

/**
 * Cycle designators, most explicit first: `Cycle_6_Wave_3`, `C1.1`, `C6_W1`, `Wave3`.
 * Applied to the leftover of a folder name after the survey acronyms are stripped, so `2001_C1.1`
 * yields `C1.1` — the label a StatCan user would cite — instead of the whole leftover.
 */
const CYCLE_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9])(cycle[_\- ]?\d{1,2}(?:[_\- ]?w(?:ave)?[_\- ]?\d{1,2})?)(?![A-Za-z0-9])/i,
  /(?<![A-Za-z0-9])(c\d{1,2}(?:[._]\d{1,2})?(?:[_\- ]?w(?:ave)?[_\- ]?\d{1,2})?)(?![A-Za-z0-9])/i,
  /(?<![A-Za-z0-9])(w(?:ave)?[_\- ]?\d{1,2})(?![A-Za-z0-9])/i,
];

/**
 * Strip up to two leading acronym tokens (the `EN_FR` pair) from a folder name.
 * Returns `undefined` when nothing was stripped — a name that never started with an acronym is
 * not a survey folder, and its remainder is not a cycle.
 */
function stripLeadingAcronyms(raw: string): string | undefined {
  let rest = raw;
  let stripped = 0;
  for (let i = 0; i < 2; i++) {
    const m = /^([A-Za-z][A-Za-z0-9]*)[_\-\s]+/.exec(rest);
    if (m === null || !looksLikeAcronym(m[1]!)) break;
    rest = rest.slice(m[0].length);
    stripped++;
  }
  if (stripped === 0) return undefined;
  // `CCHS_ESCC` and `LFS-EPA` end on the French half with no trailing separator: consume it too.
  if (looksLikeAcronym(rest)) rest = '';
  return rest;
}

/**
 * Collection cycle as the corpus labels it, kept verbatim rather than parsed into a date range —
 * `C1.1`, `2011_2012`, `Cycle_5`, `RR_2013` are the identifiers a citation needs.
 *
 * Read from the folder that owns the file: the cycle sub-folder when there is one
 * (`CCHS_ESCC/CCHS_ESCC_2011_2012/…`), otherwise the group folder itself
 * (`APS_EAPA_2006/…` → `2006`).
 */
function extractCycle(group: string, folders: readonly string[]): string | undefined {
  let rest: string | undefined;
  const child = folders[1];
  if (child !== undefined) {
    rest = child.toLowerCase().startsWith(group.toLowerCase())
      ? child.slice(group.length).replace(/^[_\-\s]+/, '')
      : stripLeadingAcronyms(child);
  } else if (group.length > 0) {
    rest = stripLeadingAcronyms(group);
  }
  if (rest === undefined) return undefined;
  const trimmed = rest.replace(/^[_\-\s]+|[_\-\s]+$/g, '');
  if (trimmed.length === 0) return undefined;
  for (const re of CYCLE_PATTERNS) {
    const m = re.exec(trimmed);
    if (m !== null) return m[1];
  }
  return trimmed;
}

/* -------------------------------------------------------------------------------------------- *
 * Year
 * -------------------------------------------------------------------------------------------- */

const MIN_YEAR = 1980;
const MAX_YEAR = 2026;

/**
 * A standalone four-digit run. The boundaries are the whole defence against the corpus's dense
 * population of look-alikes: `91F0015M` (a StatCan catalogue id), `x2011007` (a product number),
 * `SDDS4422` (a survey id) and `C2006` all contain four consecutive digits and none of them is a
 * usable year. A digit adjacent to a letter or another digit is therefore never a year here.
 */
const YEAR_RE = /(?<![A-Za-z0-9])(\d{4})(?![A-Za-z0-9])/g;

function firstYearIn(text: string): number | undefined {
  YEAR_RE.lastIndex = 0;
  for (let m = YEAR_RE.exec(text); m !== null; m = YEAR_RE.exec(text)) {
    const y = Number(m[1]);
    if (y >= MIN_YEAR && y <= MAX_YEAR) return y;
  }
  return undefined;
}

/**
 * Reference year for a file, or `undefined`.
 *
 * Folders are searched deepest-first and only then the filename, because the folder is where the
 * corpus states the cycle authoritatively: `ACS_EEA_2006/5108_ACS-EEA_C2006_T15.2_eng.doc` gets
 * 2006 from its folder while `C2006` in the filename is (correctly) rejected as letter-adjacent.
 * Where a name spans a range (`2011_2012`, `t4_2000-2015`) the **first** year wins — the start of
 * the reference period, which is what a cycle is dated by.
 */
function extractYear(folders: readonly string[], stem: string): number | undefined {
  for (let i = folders.length - 1; i >= 0; i--) {
    const y = firstYearIn(folders[i]!);
    if (y !== undefined) return y;
  }
  return firstYearIn(stem);
}

/* -------------------------------------------------------------------------------------------- *
 * Language
 * -------------------------------------------------------------------------------------------- */

/** Unambiguous words. Safe anywhere in a name — verified: every occurrence in the corpus is a
 *  language marker, none is topical (there is no `French_language_minorities.pdf` here). Matching
 *  them un-delimited is deliberate, and recovers `AdultFrenchWOFreqs.doc`. */
const LANG_WORD_EN = /english|anglais/i;
const LANG_WORD_FR = /french|fran[cç]ais/i;

/**
 * Short tags (`_eng`, `-fra`, `_E`, `_f`) delimited by `_ - .` only.
 *
 * Space is excluded on purpose: French filenames in this corpus are often prose
 * (`…utiliser la CSERCan en fusionnant les fichiers…`), and the French word *en* would otherwise
 * tag them English — precisely inverted. `_f1`/`_f3` are file-number tokens, not French, which the
 * closing delimiter rules out.
 */
const LANG_TAG_RE = /(?:^|[_.\-])(eng|ang|fra|fre|en|fr|e|f)(?=$|[_.\-])/gi;
/** The same tags as the final token, where a space delimiter is unambiguous (`… no freqs_E`). */
const LANG_TAG_TAIL_RE = /[\s_.\-](eng|ang|fra|fre|en|fr|e|f)$/i;

const TAG_LANG: Readonly<Record<string, Lang>> = {
  eng: 'en',
  ang: 'en',
  en: 'en',
  e: 'en',
  fra: 'fr',
  fre: 'fr',
  fr: 'fr',
  f: 'fr',
};

/** Vocabulary cues, used only after tags and acronyms have failed. */
const VOCAB_FR = /dictionnaire|donn[eé]es|fr[eé]quences|utilisateur|alphab[eé]tique|th[eé]matique|sansfreq|enqu[eê]te|annexe|fichier/i;
const VOCAB_EN = /data ?dictionary|record layout|user ?guide|codebook|alphabetical|topical|household|frequenc/i;

function tokenPresent(name: string, token: string): boolean {
  return new RegExp(`(?<![A-Za-z])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(name);
}

/**
 * Document language.
 *
 * Signals in confidence order:
 *
 * 1. **Explicit tags and language words** (`_eng`, `_fra`, `English`, `FRENCH`). Explicit wins even
 *    over the acronym, because `5108_ACS-EEA_C2006_T15.2_fra.doc` carries *both* halves of the
 *    `ACS_EEA` pair and only the tag distinguishes it.
 * 2. **The EN-vs-FR acronym** (D4's highest-confidence pairing signal): a file named `ESCC_*` in
 *    `CCHS_ESCC` is French, `CCHS_*` is English. Acronyms are matched on letter boundaries only,
 *    so `SHS2011` and `EDM2019` — the digits-run-on form used by hundreds of files — still count.
 *
 *    Two-letter acronyms are trusted too, and deliberately so. The guard here originally demanded
 *    3+ letters on the theory that `AG`/`BC`/`SA` would collide with ordinary words — but
 *    {@link tokenPresent} anchors on letter boundaries, so `AG` cannot match inside `agriculture`
 *    and the collision it feared is unreachable. The cost of the guard was total: **every file in
 *    `BC_CB_K12`, `ROE_RE`, `AG_SA_AllYears` and `HS_EH` came out `unknown`** — 91 files whose
 *    language is written plainly in their names. Lowering it to 2 resolves 64 of them with no
 *    observed error, corroborated by the prose in the same filenames
 *    (`RE_…_code_de_semaines` → fr, `ROE_…_week_codes` → en; `AG_`/`SA_` and `HS_`/`EH_` split
 *    cleanly). Linkage chains stay excluded regardless, because {@link acronymPair} already
 *    refuses any group with a third acronym token — which is what keeps `CHS_T4_T1FF_…` and
 *    `T1FF_pi_for_PSIS_…` out, and those are the genuinely dangerous two-character cases.
 * 3. **Vocabulary** (`Dictionnaire de données` vs `Data Dictionary`), which resolves the prose-y
 *    long tail that has neither a tag nor a usable acronym.
 *
 * Anything still undecided is `'unknown'`. Guessing is worse than admitting it: language selects
 * the Postgres text-search configuration, and stemming French text as English quietly degrades
 * recall for those records.
 */
function detectLang(stem: string, group: string): Lang {
  const enWord = LANG_WORD_EN.test(stem);
  const frWord = LANG_WORD_FR.test(stem);
  if (enWord !== frWord) return enWord ? 'en' : 'fr';

  const tagged = new Set<Lang>();
  LANG_TAG_RE.lastIndex = 0;
  for (let m = LANG_TAG_RE.exec(stem); m !== null; m = LANG_TAG_RE.exec(stem)) {
    const lang = TAG_LANG[m[1]!.toLowerCase()];
    if (lang !== undefined) tagged.add(lang);
  }
  const tail = LANG_TAG_TAIL_RE.exec(stem);
  if (tail !== null) {
    const lang = TAG_LANG[tail[1]!.toLowerCase()];
    if (lang !== undefined) tagged.add(lang);
  }
  if (tagged.size === 1) return [...tagged][0]!;

  const pair = acronymPair(group);
  if (pair !== undefined && pair.en.length >= 2 && pair.fr.length >= 2) {
    const hasEn = tokenPresent(stem, pair.en);
    const hasFr = tokenPresent(stem, pair.fr);
    if (hasEn !== hasFr) return hasEn ? 'en' : 'fr';
  }

  const vocabFr = VOCAB_FR.test(stem);
  const vocabEn = VOCAB_EN.test(normalizeForKeywords(stem));
  if (vocabFr !== vocabEn) return vocabFr ? 'fr' : 'en';

  return 'unknown';
}

/* -------------------------------------------------------------------------------------------- *
 * Entry point
 * -------------------------------------------------------------------------------------------- */

/**
 * Classify one corpus file from its location alone.
 *
 * Pure and deterministic — the same `(bundle, path)` always yields the same record (D9), which is
 * what lets the committed ingest report be reviewed as a diff.
 *
 * @param bundle Nested zip the file came from, e.g. `RDC Nonconfidential Documentation (3).zip`.
 * @param path   Path within that zip, e.g. `CCHS_ESCC/CCHS_ESCC_2011_2012/CCHS_2011_2012_T3_v1.pdf`.
 * @param sizeBytes Uncompressed size, carried through unchanged.
 */
export function classifyFile(bundle: string, path: string, sizeBytes: number): CorpusFile {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalizedPath.split('/').filter((s) => s.length > 0);
  const basename = segments[segments.length - 1] ?? '';
  const folders = segments.slice(0, -1);
  // The seven bundle-root MANIFEST files have no folder at all; '' is the honest group for them.
  const surveyGroup = folders[0] ?? '';

  const dot = basename.lastIndexOf('.');
  const ext = dot > 0 ? basename.slice(dot + 1).toLowerCase() : '';
  const stem = dot > 0 ? basename.slice(0, dot) : basename;

  const hit = findTcode(stem);
  const tcodeKind = docKindForTcode(hit?.tcode);
  const keywordKind = inferDocKindFromName(stem, folders);
  // The T-code is authoritative wherever it is really this document's type code. Where it is not —
  // a mid-name mention of a linked data source, `LFE_T4_DataDictionary` — a filename that names its
  // own document type outranks it. With neither signal in the document slot the code is still the
  // best evidence available, so it stays the fallback rather than being discarded.
  const preferKeyword = hit !== undefined && !hit.documentSlot && keywordKind !== undefined;
  const docKind = (preferKeyword ? keywordKind : (tcodeKind ?? keywordKind)) ?? 'unknown';

  return {
    bundle,
    path: normalizedPath,
    sizeBytes,
    ext,
    tcode: hit?.tcode,
    docKind,
    surveyGroup,
    surveyAcronym: extractSurveyAcronym(surveyGroup),
    cycle: extractCycle(surveyGroup, folders),
    year: extractYear(folders, stem),
    lang: detectLang(stem, surveyGroup),
  };
}
