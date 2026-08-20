/**
 * The corpus vocabulary, for typo tolerance and "did you mean" (docs/metadata-repo-plan.md, M5).
 *
 * ### The problem this solves
 *
 * Postgres full-text search matches lexemes exactly. `opioid` returns 96 records; **`opiod`
 * returns nothing** — and a metadata repository that answers a one-letter typo with an empty page
 * reads as "we don't have this", which is the opposite of true.
 *
 * ### Why a lexicon rather than a trigram index on the text
 *
 * A `gin_trgm_ops` index over `search_text` would work and would cost tens of megabytes against a
 * tier that is already the binding constraint. The vocabulary is **27,365 distinct words, about
 * 0.5 MB** — three orders of magnitude smaller, because a corpus of 194,507 records says the same
 * words over and over. Correcting a query is a lookup in the vocabulary, not a scan of the corpus.
 *
 * ### Why the ranking blends similarity with frequency
 *
 * Similarity alone picks the wrong word, and it does so on exactly the queries people type:
 *
 * | typo | similarity says | frequency says | right answer |
 * |---|---|---|---|
 * | `maritial` | `marital` and `martial` tie at 0.55 | marital 616 records, martial 6 | `marital` |
 * | `diabetis` | `diabetic` 0.64 beats `diabetes` 0.50 | diabetes 442, diabetic 72 | `diabetes` |
 *
 * So a suggestion is scored `similarity × (1 + ln(records))`. That reverses both cases without a
 * special case for either, because a rare word being lexically closer is normally a coincidence
 * and a common word being nearly as close is normally the intent.
 */
import type { CorpusVariable } from './types.js';

/**
 * Words appearing in fewer than this many records are dropped.
 *
 * The tail is extraction noise — glyphs fused across a column boundary, a hyphen swallowed, an
 * accent lost. Suggesting `ddiabete` to someone who typed `diabetis` is worse than suggesting
 * nothing, because it looks like the corpus contains a variable spelled that way.
 */
export const MIN_RECORDS = 2;

/** A word must be at least this long to be worth suggesting. */
const MIN_LENGTH = 3;

/**
 * Words, as a *reader* types them — not as Postgres stems them.
 *
 * Deliberately not the FTS lexemes. Someone typing `opiod` is trying to spell `opioid`, and
 * `opioid` is what should be offered back; `opioid` stems to `opioid` here but plenty of words do
 * not, and offering a stem (`smok`) as a correction is unreadable.
 */
export function wordsOf(text: string): Set<string> {
  // Variable references have to go before the words are cut out, not after. `universe` is full of
  // routing conditions — `SMK_12 = 2 and OPI_35 = 1` — and a word matcher stops at the underscore,
  // leaving `smk` and `opi` behind as though they were vocabulary. `opi` reached 63 records that
  // way and outranked `opioids` as the correction for `opiod`.
  //
  // The rule is that an English or French word contains no digit and no underscore, so any token
  // carrying either is dropped whole rather than truncated.
  const prose = text.replace(/[A-Za-zÀ-ÿ]*[0-9_][A-Za-z0-9_À-ÿ]*/g, ' ');
  const out = new Set<string>();
  for (const word of prose.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) ?? []) {
    if (word.length >= MIN_LENGTH) out.add(word);
  }
  return out;
}

/**
 * The text a record contributes to the vocabulary: its prose, and **not** its variable name.
 *
 * Every other field `buildSearchText` indexes is here, because a word in the vocabulary that the
 * search cannot then find would be a correction leading to a second empty page. The exception is
 * `name`, and it is not an oversight:
 *
 * Mnemonics fragment into things that are not words. `OPI_40F` yields `opi`, which appears in 93
 * records and therefore outranked `opioids` as the correction for `opiod` — the very query that
 * prompted this feature answered with a three-letter fragment. Nothing is lost by excluding them,
 * because exact and prefix mnemonic lookup is already served by the trigram index on
 * `corpus_variable.name` and by `corpus_mnemonic`; this vocabulary exists for the prose.
 */
export function lexiconTextOf(v: CorpusVariable): string {
  return [v.concept, v.questionText, v.universe, v.note, ...v.codes.map((c) => c.label)]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
}

/** One vocabulary entry. Field names are the Postgres column names. */
export interface CorpusTermRow {
  term: string;
  /** Records the word appears in — the disambiguator when similarity ties. */
  records: number;
}

/**
 * Build the vocabulary over a set of occurrences.
 *
 * Document frequency, not total occurrences: a word repeated forty times in one long note is not
 * more central to the corpus than a word appearing once in each of forty records.
 */
export function buildLexicon(records: Iterable<CorpusVariable>): CorpusTermRow[] {
  const df = new Map<string, number>();
  for (const v of records) {
    for (const word of wordsOf(lexiconTextOf(v))) df.set(word, (df.get(word) ?? 0) + 1);
  }
  return [...df.entries()]
    .filter(([, n]) => n >= MIN_RECORDS)
    .map(([term, count]) => ({ term, records: count }))
    // Sorted so a re-run writes the same rows in the same order (D9).
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

/**
 * Trigram set, matching `pg_trgm`'s: the string is padded with two leading spaces and one
 * trailing space before being cut into three-character windows.
 *
 * Reimplemented here only so the ranking can be tested without a database. Postgres remains the
 * authority at query time.
 */
export function trigrams(value: string): Set<string> {
  const padded = `  ${value.trim().toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard similarity over trigrams, as `pg_trgm.similarity` computes it. */
export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Score a candidate correction. Higher wins.
 *
 * See the module note for why frequency is in here: without it, `maritial` corrects to `martial`
 * and `diabetis` to `diabetic`.
 */
export function suggestionScore(sim: number, records: number): number {
  return sim * (1 + Math.log(Math.max(1, records)));
}

/** Rank vocabulary entries as corrections for `query`. Mirrors what `corpus_suggest` does in SQL. */
export function rankSuggestions(
  query: string,
  terms: readonly CorpusTermRow[],
  { minSimilarity = 0.3, limit = 5 }: { minSimilarity?: number; limit?: number } = {},
): Array<CorpusTermRow & { similarity: number; score: number }> {
  return terms
    .map((t) => {
      const sim = similarity(query, t.term);
      return { ...t, similarity: sim, score: suggestionScore(sim, t.records) };
    })
    .filter((t) => t.similarity >= minSimilarity)
    .sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1))
    .slice(0, limit);
}
