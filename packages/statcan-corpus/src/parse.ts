/**
 * Parsing dictionary text into {@link CorpusVariable} occurrences (M2, docs/metadata-repo-plan.md).
 *
 * **The T-code does not determine the layout.** M2 began on the assumption that it did — that
 * `T15.2` meant one shape, `T15.6` another — and a survey of 90 real dictionaries killed that
 * assumption: the `Variable Name:  X  Position:  n` form the design was built around appears in
 * *one* of them, while the dominant shapes were a labelled form (in **both languages**) and a
 * `FIELD NAME:` form the design had never seen. So layout is detected from the **content**, and
 * the T-code is left to do what it is good at — telling dictionaries apart from user guides.
 *
 * Three layouts are parsed:
 *
 * | | header row | other fields |
 * |---|---|---|
 * | `labelled` | `Variable Name: X Length: n Position: n` / `Nom de la variable : X Longueur : n` | `Concept`, `Question Text`, `Universe`, `Note` (and their French counterparts) |
 * | `collection` | `Variable Name:  X  Position:  n  Length:  n` | `Collection Name:`, `Coverage:`, free prose |
 * | `field` | `FIELD NAME: X` | `POSITION:`, `LENGTH:`, `DESCRIPTION:`, `VALID VALUES:`, `COMMENTS:` |
 *
 * **French is first-class, not an afterthought.** Roughly half the corpus is French, and those
 * documents label their fields `Nom de la variable`, `Longueur`, `Univers`, `Nota` — with the
 * space-before-colon French typography. A parser that only reads English silently drops half the
 * corpus while reporting success on the other half.
 *
 * **Code-table column order is detected per row, not assumed.** The families disagree about
 * whether the code or the label comes first, and guessing wrong does not fail loudly: it pairs a
 * label with a frequency count and yields a code list that still *looks* like one (`1 → "10,137"`).
 * {@link readCodeRow} decides from the shape of the cells, so neither order can be mistaken for
 * the other, and a document that mixes them still parses.
 *
 * Input is row-reconstructed text from {@link module:./pdf}: cells within a row are separated by
 * runs of 2+ spaces. Everything a parser cannot read becomes a {@link FidelityNote} (D7).
 */
import type {
  CodeEntry,
  CorpusFile,
  CorpusVariable,
  ExtractedDoc,
  FidelityNote,
} from './types.js';

/** Cell separator produced by row reconstruction. */
const CELL = /\s{2,}/;

/**
 * A variable name as the dictionaries print it.
 *
 * Deliberately strict: accepting any token after the label reads page furniture and French prose
 * as variable names, and a junk record is worse than a missing one — it pollutes search for the
 * external audience this is built for.
 */
const VAR_NAME = /^[A-Za-z][A-Za-z0-9_]{1,31}$/;

/** Table furniture and total rows, in both languages. */
const NOT_A_CATEGORY =
  /^(?:answer categories?|cat[ée]gories?(?: de r[ée]ponse)?|content|contenu|code|freq(?:uency)?|fr[ée]q(?:uence)?|wtd|weighted(?: frequency)?|pond[ée]r[ée]e?|sample|[ée]chantillon|population|total|%|n)$/i;

export interface ParseResult {
  variables: CorpusVariable[];
  notes: FidelityNote[];
}

/** Layouts this module can read, detected from content by {@link detectLayout}. */
export type Layout = 'labelled' | 'collection' | 'field';

/* -------------------------------------------------------------------------------------------- *
 * Bilingual label vocabulary
 * -------------------------------------------------------------------------------------------- */

/**
 * Field labels in both languages. French writes `Nom de la variable :` — note the space before
 * the colon, which is correct French typography and which an English-only pattern misses.
 *
 * Alternatives are ordered longest-first where one is a prefix of another (`Question Text` before
 * `Question`), because the first match wins and the shorter one would otherwise swallow the field.
 */
const LABELS = {
  variableName: /(?:Variable\s*Name|Nom\s+de\s+(?:la\s+)?variable)/i,
  length: /(?:Length|Longueur)/i,
  position: /(?:Position)/i,
  concept: /(?:Concept)/i,
  questionText: /(?:Question\s*Text|Texte\s+de\s+la\s+question)/i,
  questionName: /(?:Question\s*Name|Nom\s+de\s+la\s+question)/i,
  universe: /(?:Universe|Univers)/i,
  note: /(?:Note|Nota|Remarques?)/i,
  source: /(?:Source)/i,
  collectionName: /(?:Collection\s*Name|Nom\s+de\s+collecte)/i,
  coverage: /(?:Coverage|Port[ée]e|Couverture)/i,
} as const;

/** `Label :  value` — the separator is `:` with optional French space, then the cell gap. */
function labelled(label: RegExp, valuePattern = '(.+?)'): RegExp {
  return new RegExp(`(?:^|\\s{2,})${label.source}\\s*:\\s*${valuePattern}\\s*(?=\\s{2,}|$)`, 'i');
}

/** Every label, so a value can be recognized as "actually the next empty field". */
const ANY_LABEL = new RegExp(
  `^(?:${Object.values(LABELS).map((r) => r.source).join('|')})\\s*:`,
  'i',
);

/**
 * Every label with its colon, used to find field boundaries *inside* a row.
 *
 * This exists because the labelled family does not use the cell gap to separate its fields —
 * it writes `Nom de la variable : REFPER Longueur : 13.0 Position : 9`, all single-spaced. A
 * value therefore runs until the next *label*, not until the next wide gap, and reading it any
 * other way silently returns nothing (the first version of this parser scored zero on 72 of 90
 * documents for exactly that reason).
 */
const LABEL_SCAN = new RegExp(
  `(?:^|\\s)(${Object.values(LABELS).map((r) => r.source).join('|')})\\s*:`,
  'gi',
);

/**
 * Split one row into `label → value`, where each value runs to the next label on the row.
 *
 * Keys are normalized to lower-case with collapsed whitespace so `Nom de la variable` and
 * `Variable  Name` land in the same map alongside their English or French counterpart.
 */
function splitLabelledRow(row: string): Array<{ label: string; value: string }> {
  LABEL_SCAN.lastIndex = 0;
  const hits: Array<{ label: string; start: number; end: number }> = [];
  for (let m = LABEL_SCAN.exec(row); m !== null; m = LABEL_SCAN.exec(row)) {
    hits.push({ label: m[1]!.toLowerCase().replace(/\s+/g, ' '), start: m.index, end: m.index + m[0].length });
  }
  return hits.map((hit, i) => ({
    label: hit.label,
    value: row.slice(hit.end, i + 1 < hits.length ? hits[i + 1]!.start : undefined).trim(),
  }));
}

/** Does this label regex match the normalized key produced by {@link splitLabelledRow}? */
function labelMatches(label: RegExp, key: string): boolean {
  return new RegExp(`^(?:${label.source})$`, 'i').test(key);
}

/** First non-empty value for `label` across a block's rows, read by label boundaries. */
function fieldByLabel(rows: readonly string[], label: RegExp): string | undefined {
  for (const row of rows) {
    for (const { label: key, value } of splitLabelledRow(row)) {
      if (labelMatches(label, key) && value !== '') return value;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------------------------- *
 * Shared helpers
 * -------------------------------------------------------------------------------------------- */

function cells(row: string): string[] {
  return row.trim().split(CELL).map((c) => c.trim()).filter((c) => c !== '');
}

/** `1,234` / `1 234` / `12.5` → number; anything else → undefined. */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[\s, ]/g, '');
  if (!/^-?\d+(?:[.,]\d+)?$/.test(cleaned)) return undefined;
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** A category code: `1`, `07`, `99999995`, `01 - 31`, `A`, `1E`. */
function isCodeToken(raw: string): boolean {
  return /^(?:\d{1,9}(?:\s*[-–]\s*\d{1,9})?|[A-Z]\d?)$/.test(raw.trim());
}

function pushNote(
  notes: FidelityNote[],
  file: CorpusFile,
  severity: FidelityNote['severity'],
  message: string,
): void {
  notes.push({ severity, file: `${file.bundle}/${file.path}`, message });
}

/**
 * A code row whose columns are separated by **single spaces**, so the cell gap cannot find them.
 *
 * The labelled family typesets its answer tables this way —
 * `First collection period 1 850 2,870,500 7.9` — which the cell-gap reader sees as one cell and
 * skips. That is why the first version of this parser produced 26,809 variables and *zero* code
 * lists: the records looked fine, and the single most valuable field in the corpus was missing
 * from every one of them.
 *
 * Parsed from the right, because only the tail is unambiguous: trailing count columns, then the
 * code, and whatever remains on the left is the label. The label is required to contain a letter
 * so a row of pure numbers (a frequency table with no categories) cannot masquerade as one, and
 * `Total`-style summary rows fall out naturally — their thousands separators stop them matching
 * the code position at all.
 */
function cellFreeCodeRow(row: string): CodeEntry | undefined {
  const m = /^\s*(.{2,120}?)\s+(\d{1,9}(?:\s*[-–]\s*\d{1,9})?|[A-Z]\d?)\s+([\d.,\s%]+)$/.exec(row);
  if (m === null) return undefined;
  const label = m[1]!.trim();
  if (!/[A-Za-zÀ-ÿ]/.test(label) || NOT_A_CATEGORY.test(label)) return undefined;
  const tail = m[3]!;
  // The trailing run must at least look like count columns; prose ending in a digit is not a
  // category row.
  if (!/\d/.test(tail)) return undefined;
  const counts = parseCounts(tail);
  return { code: m[2]!.trim(), label, frequency: counts[0], weighted: counts[1] };
}

/**
 * Read the count columns that trail a category row, in either language's number format.
 *
 * The two formats are genuinely ambiguous token-by-token: English writes `2,400 461,000 1.4`
 * while French writes `2 400 461 000 1,4` — the same three numbers, but French uses the space as
 * a thousands separator, so a naive split on whitespace reads six numbers instead of three and
 * every frequency in the French half of the corpus comes out wrong by orders of magnitude.
 *
 * In English the comma disambiguates and the columns can be read. **In French they cannot**, and
 * this function deliberately gives up rather than guessing: `2 400 461 000` is equally readable as
 * one number, or as `2 400` and `461 000`, and only the original column geometry — which the row
 * reconstruction has already flattened away — could say which. The counts are therefore omitted
 * for French rows.
 *
 * That is the right trade because of what each field is worth: the code and the label are what a
 * questionnaire designer reuses and cites, and they parse correctly in both languages. A missing
 * frequency is a small, visible gap; a frequency wrong by three orders of magnitude is a corrupt
 * record that reads as authoritative. If the counts are ever needed for French, they have to come
 * from column positions during extraction, not from the reconstructed row.
 */
function parseCounts(tail: string): number[] {
  // A comma means opposite things in the two locales, so the *length* of the group after it is
  // the discriminator: `1,150` is English thousands, `1,4` is a French decimal. Testing for a
  // bare comma-digit instead (the first attempt) read every English thousands separator as
  // French and dropped the counts from the half of the corpus that could be parsed.
  const frenchDecimal = /\d,\d{1,2}(?!\d)/.test(tail);
  const frenchThousands = /\d[  ]\d{3}(?!\d)/.test(tail);
  if (frenchDecimal || frenchThousands) return [];
  const cleaned = tail.replace(/\s*%\s*$/, '').trim();
  const tokens = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return tokens
    .map((t) => Number(t.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

/**
 * One code-table row, whichever column order it uses.
 *
 * The order is read from the cells rather than assumed: exactly one of the first two cells should
 * look like a code and the other like a label, and at least one numeric column must follow. That
 * last requirement is what stops a wrapped line of prose beginning with a digit from becoming a
 * category — the failure that turns a code list into plausible nonsense.
 */
export function readCodeRow(row: string): CodeEntry | undefined {
  const parts = cells(row);
  if (parts.length < 3) return cellFreeCodeRow(row);
  const [a, b, c, d] = parts as [string, string, string, string | undefined];

  const aIsCode = isCodeToken(a);
  const bIsCode = isCodeToken(b);
  let code: string;
  let label: string;
  let counts: Array<string | undefined>;
  if (aIsCode && !bIsCode) {
    [code, label, counts] = [a, b, [c, d]];
  } else if (bIsCode && !aIsCode) {
    [code, label, counts] = [b, a, [c, d]];
  } else {
    return undefined;
  }

  if (NOT_A_CATEGORY.test(label) || label.length > 120) return undefined;
  const frequency = num(counts[0]);
  if (frequency === undefined) return undefined;
  return { code: code.trim(), label, frequency, weighted: num(counts[1]) };
}

/**
 * Split rows into one block per variable, delimited by the *next* header — these documents have
 * no terminator, so a variable's content simply runs until the next one starts, across pages.
 */
function blocks(
  doc: ExtractedDoc,
  isHeader: (row: string) => boolean,
): Array<{ rows: string[]; page: number }> {
  const out: Array<{ rows: string[]; page: number }> = [];
  let current: { rows: string[]; page: number } | undefined;
  for (const page of doc.pages) {
    for (const row of page.text.split('\n')) {
      if (isHeader(row)) {
        if (current !== undefined) out.push(current);
        current = { rows: [row], page: page.pageNumber };
      } else if (current !== undefined) {
        current.rows.push(row);
      }
    }
  }
  if (current !== undefined) out.push(current);
  return out;
}

/** Value of `Label: …` within a block, or undefined when absent or empty. */
function field(rows: readonly string[], label: RegExp): string | undefined {
  const re = labelled(label);
  for (const row of rows) {
    const m = re.exec(row);
    if (m === null) continue;
    const value = (m[1] ?? '').trim();
    // An empty field followed by the next label reads as `Question Text:   Universe: …`.
    if (value !== '' && !ANY_LABEL.test(value)) return value;
  }
  return undefined;
}

function makeVariable(
  file: CorpusFile,
  page: number,
  fields: Omit<CorpusVariable, 'recordId' | 'source'>,
): Omit<CorpusVariable, 'recordId'> {
  return {
    ...fields,
    source: {
      bundle: file.bundle,
      path: file.path,
      page,
      tcode: file.tcode,
      docKind: file.docKind,
      surveyGroup: file.surveyGroup,
      surveyAcronym: file.surveyAcronym,
      cycle: file.cycle,
      year: file.year,
      lang: file.lang,
    },
  };
}

/* -------------------------------------------------------------------------------------------- *
 * Layout detection
 * -------------------------------------------------------------------------------------------- */

/** `Variable Name:  X  Position:  n  Length:  n` — position precedes length, `Collection Name` follows. */
const COLLECTION_HEADER = new RegExp(
  `^\\s*${LABELS.variableName.source}\\s*:\\s{2,}\\S+\\s{2,}${LABELS.position.source}\\s*:`,
  'i',
);
/** `Variable Name: X Length: n Position: n` / `Nom de la variable : X Longueur : n Position : n`. */
const LABELLED_HEADER = new RegExp(
  `^\\s*${LABELS.variableName.source}\\s*:\\s*\\S+.*${LABELS.length.source}\\s*:`,
  'i',
);
/** Vital Statistics style. */
const FIELD_HEADER = /^\s*FIELD\s+NAME\s*:/i;

interface Detection {
  layout: Layout | undefined;
  headers: number;
}

/**
 * Pick the layout by counting header rows and taking the clear winner.
 *
 * Counting rather than first-match matters because these documents open with a table of contents
 * and pages of narrative that can contain a stray label; the real layout is the one that repeats
 * once per variable, hundreds of times.
 */
export function detectLayout(doc: ExtractedDoc): Detection {
  const rows = doc.pages.flatMap((p) => p.text.split('\n'));
  const counts: Array<[Layout, number]> = [
    ['collection', rows.filter((r) => COLLECTION_HEADER.test(r)).length],
    ['labelled', rows.filter((r) => LABELLED_HEADER.test(r)).length],
    ['field', rows.filter((r) => FIELD_HEADER.test(r)).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const [winner, n] = counts[0]!;
  return n === 0 ? { layout: undefined, headers: 0 } : { layout: winner, headers: n };
}

/* -------------------------------------------------------------------------------------------- *
 * Parsers
 * -------------------------------------------------------------------------------------------- */

function parseLabelled(doc: ExtractedDoc): Array<Omit<CorpusVariable, 'recordId'>> {
  return blocks(doc, (r) => LABELLED_HEADER.test(r))
    .map((block) => {
      // The name is the first token of the header's `Variable Name:` value: the value runs to the
      // next label, so it reads as `REFPER` even though `Longueur : 13.0` follows on the same row.
      const name = fieldByLabel([block.rows[0]!], LABELS.variableName)?.split(/\s+/)[0];
      if (name === undefined || !VAR_NAME.test(name)) return undefined;
      const codes = block.rows.map(readCodeRow).filter((c): c is CodeEntry => c !== undefined);
      return makeVariable(doc.file, block.page, {
        name,
        position: fieldByLabel(block.rows, LABELS.position),
        length: fieldByLabel(block.rows, LABELS.length),
        concept: fieldByLabel(block.rows, LABELS.concept),
        questionText: fieldByLabel(block.rows, LABELS.questionText),
        universe: fieldByLabel(block.rows, LABELS.universe),
        note: fieldByLabel(block.rows, LABELS.note),
        codes,
      });
    })
    .filter((v): v is Omit<CorpusVariable, 'recordId'> => v !== undefined);
}

function parseCollection(doc: ExtractedDoc): Array<Omit<CorpusVariable, 'recordId'>> {
  const nameRe = labelled(LABELS.variableName, '(\\S+)');
  return blocks(doc, (r) => COLLECTION_HEADER.test(r))
    .map((block) => {
      const head = block.rows[0]!;
      const name = nameRe.exec(head)?.[1];
      if (name === undefined || !VAR_NAME.test(name)) return undefined;

      const codes: CodeEntry[] = [];
      const prose: string[] = [];
      for (const row of block.rows.slice(1)) {
        const code = readCodeRow(row);
        if (code !== undefined) {
          codes.push(code);
          continue;
        }
        const text = row.trim();
        // Question wording is the prose that is neither a labelled field nor a table row.
        if (text === '' || CELL.test(text) || ANY_LABEL.test(text)) continue;
        if (/^(?:FREQ|WTD|Response|R[ée]ponse)\b/i.test(text) || /^Page\s+\d+/i.test(text)) continue;
        prose.push(text);
      }
      return makeVariable(doc.file, block.page, {
        name,
        position: field([head], LABELS.position),
        length: field([head], LABELS.length),
        collectionName: field(block.rows, LABELS.collectionName),
        questionText: prose.length > 0 ? prose.join(' ') : undefined,
        universe: field(block.rows, LABELS.coverage),
        note: field(block.rows, LABELS.note),
        codes,
      });
    })
    .filter((v): v is Omit<CorpusVariable, 'recordId'> => v !== undefined);
}

const FIELD_LABELS = {
  name: /FIELD\s+NAME/i,
  position: /POSITION/i,
  length: /LENGTH/i,
  description: /DESCRIPTION/i,
  validValues: /VALID\s+VALUES/i,
  comments: /COMMENTS?/i,
} as const;

/**
 * Vital-Statistics style, where a field's value frequently wraps onto following rows —
 * `DESCRIPTION:` runs for three lines. Values are therefore accumulated until the next label,
 * rather than read from a single row as the labelled layouts allow.
 */
function parseField(doc: ExtractedDoc): Array<Omit<CorpusVariable, 'recordId'>> {
  const anyFieldLabel = new RegExp(
    `^\\s*(?:${Object.values(FIELD_LABELS).map((r) => r.source).join('|')})\\s*:`,
    'i',
  );
  return blocks(doc, (r) => FIELD_HEADER.test(r))
    .map((block) => {
      const collected = new Map<string, string[]>();
      let currentKey: string | undefined;
      for (const row of block.rows) {
        const text = row.trim();
        if (text === '') continue;
        if (anyFieldLabel.test(text)) {
          const [rawLabel, ...rest] = text.split(':');
          currentKey = rawLabel!.trim().toUpperCase().replace(/\s+/g, ' ');
          collected.set(currentKey, [rest.join(':').trim()]);
        } else if (currentKey !== undefined) {
          collected.get(currentKey)!.push(text);
        }
      }
      const get = (key: string): string | undefined => {
        const parts = collected.get(key)?.filter((p) => p !== '');
        return parts !== undefined && parts.length > 0 ? parts.join(' ') : undefined;
      };
      const name = get('FIELD NAME');
      if (name === undefined || !VAR_NAME.test(name)) return undefined;
      const codes = block.rows.map(readCodeRow).filter((c): c is CodeEntry => c !== undefined);
      return makeVariable(doc.file, block.page, {
        name,
        position: get('POSITION'),
        length: get('LENGTH'),
        questionText: get('DESCRIPTION'),
        universe: get('VALID VALUES'),
        note: get('COMMENTS') ?? get('COMMENT'),
        codes,
      });
    })
    .filter((v): v is Omit<CorpusVariable, 'recordId'> => v !== undefined);
}

const PARSERS: Record<Layout, (doc: ExtractedDoc) => Array<Omit<CorpusVariable, 'recordId'>>> = {
  labelled: parseLabelled,
  collection: parseCollection,
  field: parseField,
};

/* -------------------------------------------------------------------------------------------- *
 * Entry point
 * -------------------------------------------------------------------------------------------- */

/**
 * Parse one extracted dictionary into occurrence records.
 *
 * `mintId` is injected rather than imported so this module stays free of the identity scheme: the
 * caller supplies `uuidV5`-backed minting (D9) and tests can pass a counter.
 *
 * A document that yields nothing is reported rather than returning quietly — a dictionary that
 * parses to zero variables is precisely the failure that must not hide (D7).
 */
export function parseDictionary(
  doc: ExtractedDoc,
  mintId: (v: Omit<CorpusVariable, 'recordId'>) => string,
): ParseResult {
  const notes: FidelityNote[] = [];

  if (doc.likelyScanned) {
    pushNote(notes, doc.file, 'warning', 'likely an image-only scan; there is no text to parse');
    return { variables: [], notes };
  }

  const { layout, headers } = detectLayout(doc);
  if (layout === undefined) {
    pushNote(
      notes,
      doc.file,
      'warning',
      `no known variable-entry layout in ${doc.pages.length} pages; text extracted but not parsed`,
    );
    return { variables: [], notes };
  }

  const parsed = PARSERS[layout](doc);
  const variables = parsed.map((v) => ({ ...v, recordId: mintId(v) }));

  if (variables.length === 0) {
    pushNote(
      notes,
      doc.file,
      'warning',
      `${layout} layout detected (${headers} headers) but no variable parsed from them`,
    );
    return { variables, notes };
  }

  // Header rows that produced no record are silent losses, so they are counted rather than
  // trusted away: a name that failed VAR_NAME, or a block whose header repeated in a footer.
  if (variables.length < headers * 0.9) {
    pushNote(
      notes,
      doc.file,
      'info',
      `${layout} layout: ${variables.length} variables from ${headers} header rows`,
    );
  }
  const coded = variables.filter((v) => v.codes.length > 0).length;
  // A dictionary where almost nothing carries a code list usually means the code-row reader is
  // mismatched — the likeliest M2 defect, and invisible in the record count alone.
  if (variables.length >= 20 && coded / variables.length < 0.15) {
    pushNote(
      notes,
      doc.file,
      'info',
      `${coded}/${variables.length} variables carry a code list — check the ${layout} code table`,
    );
  }
  return { variables, notes };
}
