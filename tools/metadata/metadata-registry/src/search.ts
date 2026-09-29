/**
 * Search over registry entries. Increment 1 is a dependency-free **TF-IDF cosine** ranker with
 * light stemming and **synonym expansion**, so non-exact queries still match (e.g. "occupation"
 * or "employment" find a "job title" question). The API is shaped so a future embedding-based
 * ranker (transformers.js) can replace or blend with the lexical score without changing callers.
 */
import type { ComponentType, RegistryEntry, SearchHit } from './types.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'were',
  'your', 'you', 'this', 'that', 'with', 'at', 'by', 'as', 'it', 'be', 'do', 'did', 'have',
  'what', 'which', 'how', 'many', 'did', 'last', 'all',
]);

/** Concept groups for query expansion — members are treated as near-synonyms. */
const SYNONYM_GROUPS: string[][] = [
  ['job', 'employment', 'employ', 'employer', 'work', 'occupation', 'labour', 'labor', 'career'],
  ['unemployed', 'unemployment', 'jobless', 'jobseeker'],
  ['income', 'salary', 'wage', 'earning', 'pay'],
  ['sex', 'gender'],
  ['marital', 'marriage', 'married', 'spouse'],
  ['household', 'home', 'family', 'house'],
  ['industry', 'sector', 'business'],
  ['education', 'school', 'study', 'student'],
  ['hour', 'time', 'duration'],
];

const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYMS.set(term, group.filter((t) => t !== term));
  }
}

/** Lowercase, strip light inflection (plurals / -ing) so variants match. */
function normalize(token: string): string {
  const t = token.toLowerCase();
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`; // industries → industry
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(normalize);
}

export interface SearchIndex {
  entries: RegistryEntry[];
  /** Per-document normalized tf-idf weight vectors. */
  docs: Array<Map<string, number>>;
  idf: Map<string, number>;
}

export function buildSearchIndex(entries: RegistryEntry[]): SearchIndex {
  const docTokens = entries.map((e) => tokenize(e.searchText));
  const n = entries.length || 1;

  // Document frequency.
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, freq] of df) idf.set(term, Math.log(1 + n / freq));

  // Normalized tf-idf vectors.
  const docs = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of tf) {
      const w = (1 + Math.log(count)) * (idf.get(term) ?? 0);
      vec.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, w] of vec) vec.set(term, w / norm);
    return vec;
  });

  return { entries, docs, idf };
}

/** Expand query tokens with synonyms (synonyms carry reduced weight). */
function expandQuery(tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (t: string, w: number) => weights.set(t, Math.max(weights.get(t) ?? 0, w));
  for (const t of tokens) {
    add(t, 1);
    for (const syn of SYNONYMS.get(t) ?? []) add(normalize(syn), 0.5);
  }
  return weights;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict to a component type. */
  type?: ComponentType;
}

export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 20;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const qWeights = expandQuery(qTokens);

  // Build a normalized query vector in tf-idf space.
  const qVec = new Map<string, number>();
  let qNorm = 0;
  for (const [term, w] of qWeights) {
    const weight = w * (index.idf.get(term) ?? 0);
    if (weight === 0) continue;
    qVec.set(term, weight);
    qNorm += weight * weight;
  }
  qNorm = Math.sqrt(qNorm) || 1;
  for (const [term, w] of qVec) qVec.set(term, w / qNorm);

  const hits: SearchHit[] = [];
  index.entries.forEach((entry, i) => {
    if (options.type && entry.componentType !== options.type) return;
    const doc = index.docs[i]!;
    let score = 0;
    const matched: string[] = [];
    for (const [term, qw] of qVec) {
      const dw = doc.get(term);
      if (dw) {
        score += qw * dw;
        if (qTokens.includes(term)) matched.push(term);
      }
    }
    if (score > 0) hits.push({ entry, score, matched });
  });

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
