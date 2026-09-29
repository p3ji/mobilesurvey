#!/usr/bin/env npx tsx
/**
 * Check 4 — Source-suggestion pass for needs_review edges.
 *
 * When a derivation note cites a source token that has no published column, no
 * component siblings and no dictionary Question Name (Checks 2/3 all miss), the
 * data dictionary may still contain a plausible match: e.g. ACS_EEA notes cite
 * questionnaire item 'F31A' while the analytical file only ships derived columns.
 *
 * Strategy per unresolved source token (per survey group):
 *   1. Lexical candidates — published names within edit distance <=2 of the
 *      underscore-normalized token, plus prefix/suffix variants.
 *   2. Semantic candidates — embed "Questionnaire item <TOKEN>. Context: <target
 *      question + note>" and cosine-rank against raw (non-derived) column
 *      descriptions (questionText || concept || label). Derived columns are
 *      excluded from the pool because they echo their own notes' wording and
 *      would dominate every query.
 *   3. LLM adjudication — local qwen3.8-27b picks one candidate or abstains,
 *      with reasoning. Nothing is auto-verified: results land in
 *      `source_suggestion` + out/suggestions_review.md for human review.
 *
 * Commands:
 *   suggest [--survey GROUP]     build suggestions (embeddings + LLM)
 *   accept SURVEY SOURCE NAME    record a human-approved retarget as verified edge
 */

import { DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { buildOccurrenceLookup, edgeDedupeKey } from './queue.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(PACKAGE_DIR, 'out');
const DB_PATH = path.join(OUT_DIR, 'derivation_queue.db');
const CORPUS_PATH = path.join(OUT_DIR, 'corpus.jsonl');
const REPORT_PATH = path.join(OUT_DIR, 'suggestions_review.md');

const EMBED_URL = process.env.LOCAL_EMBED_URL || 'http://127.0.0.1:11434/v1';
const EMBED_MODEL = process.env.LOCAL_EMBED_MODEL || 'text-embedding-nomic-embed-text-v1.5';
const LLM_URL = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:1234/v1';
// qwen3.8-27b cannot be switched off its thinking tokens via this server build and
// burns ~3.5k reasoning tokens per decision; flash-next + reasoning_effort:none is
// instant and still adjudicates well (verified 2026-09-29).
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen3.8-flash-next';

const DERIVED_NOTE = /\bderived\b|\bbased on\b/i;
const SEMANTIC_TOP_K = 8;
const LEXICAL_MAX_DIST = 2;

interface CorpusVar {
  name: string;
  questionText?: string | null;
  concept?: string | null;
  label?: string | null;
  note?: string | null;
  source: { surveyGroup?: string; lang?: string };
}

export interface Candidate {
  name: string;
  description: string;
  method: 'lexical' | 'semantic' | 'reverse_note';
  score: number; // lexical: 1 - dist/len ; semantic: cosine ; reverse_note: fixed high
  /** Published column is itself a derived variable (proxy for the raw item). */
  derived?: boolean;
  /** Dictionary note of a derived candidate — shown to LLM/reviewer as corroboration. */
  note?: string;
}

/* ----------------------------- pure helpers ------------------------------ */

/** Bounded Levenshtein: returns maxDist+1 when farther apart than maxDist. */
export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export function normalizeName(s: string): string {
  return s.toUpperCase().replace(/[_\s-]+/g, '');
}

/** Lexical candidates: near-exact published names (underscore/space-insensitive). */
export function lexicalCandidates(token: string, poolNames: Iterable<string>): Candidate[] {
  const t = normalizeName(token);
  const out: Candidate[] = [];
  for (const name of poolNames) {
    if (normalizeName(name) === t) continue; // exact alias would have resolved already
    const dist = boundedEditDistance(t, normalizeName(name), LEXICAL_MAX_DIST);
    if (dist <= LEXICAL_MAX_DIST) {
      out.push({
        name,
        description: '',
        method: 'lexical',
        score: 1 - dist / Math.max(t.length, normalizeName(name).length),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Query text for embedding an unresolved token with its derivation context. */
export function buildQueryText(token: string, contexts: string[]): string {
  const ctx = contexts.slice(0, 3).join(' | ');
  return `Questionnaire item ${token}. Context from data dictionary notes: ${ctx}`.slice(0, 900);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? s / Math.sqrt(na * nb) : 0;
}

/**
 * Strongest deterministic signal for an unresolved token X in survey G:
 * a published column Y whose OWN dictionary note cites X ("Derived based on ... X ...").
 * Y is then a derived proxy that consumes the raw item X — e.g. D2WORDYN's note
 * "Derived based on F29A, F30A and F31A" proves D2WORDYN ← (raw) F31A.
 */
export function reverseNoteCandidates(
  token: string,
  pool: Array<{ name: string; note?: string | null; questionText?: string | null; concept?: string | null; label?: string | null }>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const v of pool) {
    if (!v.note || v.name.toUpperCase() === token.toUpperCase()) continue;
    if (!DERIVED_NOTE.test(v.note)) continue;
    // Token must appear as a whole word inside the citing note.
    const re = new RegExp(`(^|[^A-Z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9_]|$)`, 'i');
    if (re.test(v.note))
      out.push({
        name: v.name,
        description: ((v.questionText || v.concept || v.label || '').replace(/\s+/g, ' ').trim().slice(0, 300)) || v.name,
        method: 'reverse_note',
        score: 1.5,
        derived: true,
        note: v.note.replace(/\s+/g, ' ').trim().slice(0, 300),
      });
  }
  return out;
}

export function describeVar(v: CorpusVar): string {
  const text = (v.questionText || v.concept || v.label || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 300) || v.name;
}

/* ------------------------------ remote calls ----------------------------- */

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embedding endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
  return json.data.sort((x, y) => x.index - y.index).map((d) => d.embedding);
}

async function embedAll(texts: string[], batchSize = 64): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    out.push(...(await embedBatch(texts.slice(i, i + batchSize))));
  }
  return out;
}

interface LlmVerdict {
  best_match: string | null;
  confidence: number;
  reasoning: string;
}

interface AdjudicationRequest {
  token: string;
  context: string;
  candidates: Candidate[];
}

/**
 * The model sometimes emits best_match as prose ("Candidate 2 (C06A)") or with
 * markdown decoration instead of a bare name. Resolve it against the candidate
 * list; anything unresolvable counts as an abstain.
 */
export function resolveBestMatch(raw: string | null | undefined, names: string[]): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[*`]/g, '');
  if (!cleaned || /^(null|none|n\/a|abstain)$/i.test(cleaned)) return null;
  const upper = new Map(names.map((n) => [n.toUpperCase(), n]));
  const direct = upper.get(cleaned.toUpperCase());
  if (direct) return direct;
  // Scan embedded identifier-like tokens, longest first ("D2AGWRD5" before "D2").
  const toks = [...cleaned.toUpperCase().matchAll(/[A-Z][A-Z0-9_]{1,}/g)].map((m) => m[0]).sort((a, b) => b.length - a.length);
  for (const t of toks) {
    const hit = upper.get(t);
    if (hit) return hit;
  }
  return null;
}

/**
 * One local-LLM call adjudicates up to `batch` unresolved tokens of the same
 * survey. Empty best_match means abstain; on budget exhaustion we retry once
 * with a larger cap. Verdicts are resolved against each request's candidate list.
 */
async function adjudicateBatch(requests: AdjudicationRequest[]): Promise<Map<string, LlmVerdict>> {
  const blocks = requests.map((r) => {
    const list = r.candidates
      .map((c, i) => {
        if (c.method === 'reverse_note')
          return `${i + 1}. ${c.name}: ${c.description.slice(0, 150)} [DERIVED PROXY — its own dictionary note cites the token: "${(c.note || '').slice(0, 200)}"]`;
        return `${i + 1}. ${c.name}: ${c.description.slice(0, 200)}`;
      })
      .join('\n');
    return `--- Unresolved source token: ${r.token}\nDerivation context:\n${r.context.slice(0, 900)}\nCandidates (published columns of the same file):\n${list}`;
  });

  const body = {
    model: LLM_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a Statistics Canada metadata specialist. Each item below cites a source token that is NOT a published column of the file (usually a raw questionnaire item). For EACH token, choose the single candidate most likely meant by the note (questionnaire item numbering often differs from published column names), or an empty best_match if none plausibly matches — do not force a choice. A DERIVED PROXY candidate is itself computed FROM the token (its note cites it), so it consumes the raw item rather than being identical to it; pick one only when no better semantic equivalent exists and the proxy genuinely represents the same concept. Return one verdict per token.',
      },
      { role: 'user', content: blocks.join('\n\n') },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'source_match_batch',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  best_match: { type: 'string', description: 'Candidate name or empty string to abstain' },
                  confidence: { type: 'number', description: '0..1' },
                  reasoning: { type: 'string' },
                },
                required: ['token', 'best_match', 'confidence', 'reasoning'],
                additionalProperties: false,
              },
            },
          },
          required: ['verdicts'],
          additionalProperties: false,
        },
      },
    },
    temperature: 0.05,
    reasoning_effort: 'none',
  };

  // With thinking disabled, verdicts are short; retry once with headroom if truncated.
  for (const budget of [requests.length * 700 + 1000, requests.length * 2000 + 2000]) {
    let json: { choices: Array<{ message: { content?: string; reasoning_content?: string } }> };
    try {
      const res = await fetch(`${LLM_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, max_tokens: budget }),
      });
      if (!res.ok) throw new Error(`LLM endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
      json = (await res.json()) as typeof json;
    } catch (err) {
      // Transient LM Studio hiccups ("fetch failed") — one quick retry before giving up on the budget.
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`${LLM_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, max_tokens: budget }),
      });
      if (!res.ok) throw new Error(`LLM endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
      json = (await res.json()) as typeof json;
    }
    const msg = json.choices[0]?.message || {};
    let raw = (msg.content || '').trim();
    if (!raw && msg.reasoning_content) {
      const m = msg.reasoning_content.match(/\{[\s\S]*"verdicts"[\s\S]*\}/);
      raw = m ? m[0] : '';
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { verdicts: Array<{ token: string; best_match: string; confidence: number; reasoning: string }> };
        const out = new Map<string, LlmVerdict>();
        for (const v of parsed.verdicts || []) {
          const req = requests.find((r) => r.token.toUpperCase() === String(v.token).toUpperCase());
          const names = req?.candidates.map((c) => c.name) || [];
          out.set(String(v.token).toUpperCase(), {
            best_match: resolveBestMatch(v.best_match, names),
            confidence: Number.isFinite(v.confidence) ? v.confidence : 0,
            reasoning: v.reasoning || '',
          });
        }
        return out;
      } catch {
        /* fall through to retry with bigger budget */
      }
    }
  }
  throw new Error('LLM returned no parseable verdicts after retries');
}

/* --------------------------------- data ---------------------------------- */

interface UnresolvedToken {
  surveyGroup: string;
  cycle: string;
  source: string;
  targets: Array<{ name: string; questionText: string; note: string }>;
}

function loadUnresolved(db: DatabaseSync, surveyFilter?: string): UnresolvedToken[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT ce.survey_group g, ce.cycle c, ce.source_var_name s, ce.target_var_name t, ce.raw_evidence e
       FROM candidate_edge ce WHERE ce.review_status='needs_review'
         AND (? IS NULL OR ce.survey_group = ?)`,
    )
    .all(surveyFilter ?? null, surveyFilter ?? null) as Array<{ g: string; c: string; s: string; t: string; e: string | null }>;

  const byToken = new Map<string, UnresolvedToken>();
  for (const r of rows) {
    const key = `${r.g}\u0000${r.s}`;
    let tok = byToken.get(key);
    if (!tok) {
      tok = { surveyGroup: r.g, cycle: r.c, source: r.s, targets: [] };
      byToken.set(key, tok);
    }
    tok.targets.push({ name: r.t, questionText: '', note: r.e || '' });
  }
  return [...byToken.values()];
}

/** Load English corpus variables per survey group; fill target question texts. */
async function loadCorpus(groups: Set<string>, tokens: UnresolvedToken[]): Promise<Map<string, CorpusVar[]>> {
  const byGroup = new Map<string, CorpusVar[]>();
  for (const g of groups) byGroup.set(g, []);

  const rl = createReadStream(CORPUS_PATH, { encoding: 'utf8' });
  let buf = '';
  const feed = (line: string) => {
    if (!line.trim()) return;
    let v: CorpusVar;
    try {
      v = JSON.parse(line);
    } catch {
      return;
    }
    const g = v.source?.surveyGroup;
    if (!g || !byGroup.has(g) || (v.source.lang && v.source.lang !== 'en')) return;
    byGroup.get(g)!.push(v);
  };
  for await (const chunk of rl) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      feed(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  feed(buf);

  // enrich target question texts for query context
  const descIndex = new Map<string, string>();
  for (const [g, vars] of byGroup) for (const v of vars) descIndex.set(`${g}\u0000${v.name}`, describeVar(v));
  for (const tok of tokens)
    for (const t of tok.targets) t.questionText = descIndex.get(`${tok.surveyGroup}\u0000${t.name}`) || t.name;

  return byGroup;
}

/* --------------------------------- main ----------------------------------- */

function ensureSuggestionTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_suggestion (
      survey_group TEXT NOT NULL,
      cycle TEXT,
      source_var_name TEXT NOT NULL,
      suggested_name TEXT NOT NULL,
      method TEXT NOT NULL,
      score REAL,
      llm_pick INTEGER DEFAULT 0,
      llm_confidence REAL,
      llm_reasoning TEXT,
      affected_targets TEXT,
      decision TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (survey_group, source_var_name, suggested_name)
    );
  `);
}

async function cmdSuggest(surveyFilter?: string) {
  const db = new DatabaseSync(DB_PATH);
  ensureSuggestionTable(db);

  const tokens = loadUnresolved(db, surveyFilter);
  console.log(`Suggesting candidates for ${tokens.length} unresolved source tokens...`);
  const byGroup = await loadCorpus(new Set(tokens.map((t) => t.surveyGroup)), tokens);

  let llmErrors = 0;
  const poolVecCache = new Map<string, number[][]>(); // per survey group

  // Phase 1: candidate generation (lexical + semantic), no LLM yet.
  interface Prepared {
    tok: UnresolvedToken;
    contexts: string[];
    candidates: Candidate[];
  }
  const prepared: Prepared[] = [];

  for (const tok of tokens) {
    const poolAll = byGroup.get(tok.surveyGroup) || [];
    // Raw columns only: derived columns echo their own notes and swamp semantic ranking.
    const rawPool = poolAll.filter((v) => !DERIVED_NOTE.test(v.note || ''));

    // Reverse-note signal runs on the FULL pool: a proxy is itself a derived column.
    const rev = reverseNoteCandidates(tok.source, poolAll);
    if (rawPool.length === 0 && rev.length === 0) continue;

    const lex = lexicalCandidates(tok.source, rawPool.map((v) => v.name));
    const descByName = new Map(rawPool.map((v) => [v.name, describeVar(v)]));
    for (const c of lex) c.description = descByName.get(c.name) || '';

    const contexts = tok.targets.map((t) => `${t.name} (${t.questionText}): ${t.note}`);
    let sem: Candidate[] = [];
    try {
      const [qvec] = await embedAll([buildQueryText(tok.source, contexts)]);
      let poolVecs = poolVecCache.get(tok.surveyGroup);
      if (!poolVecs) {
        poolVecs = await embedAll(rawPool.map(describeVar));
        poolVecCache.set(tok.surveyGroup, poolVecs);
      }
      const scored = rawPool
        .map((v, i) => ({ name: v.name, description: descByName.get(v.name) || '', method: 'semantic' as const, score: cosine(qvec!, poolVecs[i]!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SEMANTIC_TOP_K);
      sem = scored;
    } catch (err) {
      console.warn(`  embed failed for ${tok.surveyGroup}/${tok.source}: ${(err as Error).message} — falling back to lexical/reverse-note candidates`);
      llmErrors++;
    }

    // Merge: dedupe by name keeping best score; method priority reverse_note > lexical > semantic.
    const merged = new Map<string, Candidate>();
    for (const c of [...rev, ...lex, ...sem]) {
      // A candidate equal to one of this token's own targets would create a self-loop edge.
      if (tok.targets.some((t) => t.name.toUpperCase() === c.name.toUpperCase())) continue;
      const prev = merged.get(c.name);
      if (!prev || c.score > prev.score) merged.set(c.name, prev ? { ...c, description: c.description || prev.description } : c);
    }
    const rank = (m: Candidate['method']) => (m === 'reverse_note' ? 0 : m === 'lexical' ? 1 : 2);
    const candidates = [...merged.values()].sort((a, b) => (rank(a.method) !== rank(b.method) ? rank(a.method) - rank(b.method) : b.score - a.score)).slice(0, 10);
    if (candidates.length === 0) continue;
    prepared.push({ tok, contexts, candidates });
  }

  // Phase 2: batched LLM adjudication (reasoning model — one call per few tokens).
  const ins = db.prepare(`
    INSERT OR REPLACE INTO source_suggestion
      (survey_group, cycle, source_var_name, suggested_name, method, score, llm_pick, llm_confidence, llm_reasoning, affected_targets, decision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT decision FROM source_suggestion WHERE survey_group=? AND source_var_name=? AND suggested_name=?),'pending'), datetime('now'))
  `);

  // Long reasoning batches risk LM Studio connection timeouts; keep them small.
  const BATCH = 3;
  let doneTokens = 0;
  for (let i = 0; i < prepared.length; i += BATCH) {
    const batch = prepared.slice(i, i + BATCH);
    let verdicts = new Map<string, LlmVerdict>();
    let llmBatchFailed = false;
    try {
      verdicts = await adjudicateBatch(
        batch.map((p) => ({ token: p.tok.source, context: p.contexts.join('\n'), candidates: p.candidates })),
      );
    } catch (err) {
      llmBatchFailed = true;
      console.warn(`  LLM batch failed (${batch.map((b) => b.tok.source).join(', ')}): ${(err as Error).message}`);
      llmErrors += batch.length;
    }
    for (const p of batch) {
      let verdict = verdicts.get(p.tok.source.toUpperCase()) ?? null;
      if (!verdict && !llmBatchFailed) {
        // Model skipped this token in the batch — one individual retry.
        try {
          const solo = await adjudicateBatch([{ token: p.tok.source, context: p.contexts.join('\n'), candidates: p.candidates }]);
          verdict = solo.get(p.tok.source.toUpperCase()) ?? null;
        } catch {
          /* stay unjudged */
        }
      }
      const targetsJson = JSON.stringify(p.tok.targets.map((t) => t.name));
      for (const c of p.candidates) {
        const isPick = verdict?.best_match?.toUpperCase() === c.name.toUpperCase() ? 1 : 0;
        // Confidence only means something on an actual pick; abstain rows keep NULL.
        const conf = isPick && typeof verdict?.confidence === 'number' && Number.isFinite(verdict.confidence) ? verdict.confidence : null;
        ins.run(p.tok.surveyGroup, p.tok.cycle, p.tok.source, c.name, c.method, c.score, isPick, conf, verdict?.reasoning || null, targetsJson, p.tok.surveyGroup, p.tok.source, c.name);
      }
      doneTokens++;
      const pick = verdict?.best_match ? ` -> LLM: ${verdict.best_match} (${(verdict.confidence ?? 0).toFixed(2)})` : ' -> LLM: abstain/error';
      console.log(`  [${doneTokens}/${prepared.length}] ${p.tok.surveyGroup}/${p.tok.source}${pick}`);
    }
  }

  await writeReport(db, surveyFilter);
  db.close();
  console.log(`\nDone. ${doneTokens} tokens suggested (${llmErrors} errors). Report: ${REPORT_PATH}`);
}

export async function writeReport(db: DatabaseSync, surveyFilter?: string) {
  const rows = db
    .prepare(
      `SELECT * FROM source_suggestion WHERE (? IS NULL OR survey_group=?) ORDER BY survey_group, source_var_name, llm_pick DESC, score DESC`,
    )
    .all(surveyFilter ?? null, surveyFilter ?? null) as Array<Record<string, unknown>>;

  const md: string[] = [
    '# Source Suggestions for Needs-Review Edges (human review required)',
    '',
    'For each unresolved source token: dictionary candidates ranked by lexical/semantic match, plus the local LLM verdict.',
    'Method `reverse_note` = a published column whose OWN derivation note cites this token (a derived proxy consuming the raw item — strongest deterministic signal).',
    '**Nothing is applied automatically.** To accept a suggestion, reply with e.g. `accept ACS_EEA_2006 F31A <NAME>` or run:',
    '`npx tsx src/graph/suggester.ts accept SURVEY SOURCE NAME`',
    '',
  ];
  let lastToken = '';
  for (const r of rows) {
    const tokenKey = `${r.survey_group} / ${r.source_var_name}`;
    if (tokenKey !== lastToken) {
      md.push('', `## ${tokenKey}`, `Affected targets: ${(JSON.parse(String(r.affected_targets || '[]')) as string[]).join(', ')}`);
      const why = String(r.llm_reasoning || '').trim();
      if (why && !/^abstain\/error$/i.test(why)) md.push('', `> **LLM verdict:** ${why.replace(/\n+/g, ' ')}`);
      md.push('', '| Accept | Candidate | Method | Score | LLM pick | Confidence |', '|---|---|---|---|---|---|');
      lastToken = tokenKey;
    }
    md.push(`| [ ] | \`${r.suggested_name}\` | ${r.method} | ${(Number(r.score) || 0).toFixed(3)} | ${r.llm_pick ? '**YES**' : ''} | ${r.llm_confidence != null ? Number(r.llm_confidence).toFixed(2) : ''} |`);
  }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, md.join('\n'), 'utf8');
}

/** Record a human-approved retarget: verified edge SOURCE->NAME for every affected target. */
export async function cmdAccept(surveyGroup: string, sourceName: string, suggestedName: string) {
  const db = new DatabaseSync(DB_PATH);
  ensureSuggestionTable(db);
  const sug = db
    .prepare(`SELECT * FROM source_suggestion WHERE survey_group=? AND UPPER(source_var_name)=UPPER(?) AND UPPER(suggested_name)=UPPER(?)`)
    .get(surveyGroup, sourceName, suggestedName) as { affected_targets: string; cycle: string } | undefined;
  if (!sug) throw new Error(`No suggestion ${surveyGroup}/${sourceName} -> ${suggestedName}`);

  const byName = await buildOccurrenceLookup();
  const targets = JSON.parse(sug.affected_targets || '[]') as string[];
  const cycleKey = `${surveyGroup}:${sug.cycle}:`;
  const srcRecId = byName.get(`${cycleKey}${suggestedName.toUpperCase()}`) ?? null;

  let inserted = 0;
  for (const t of targets) {
    const recId = byName.get(`${cycleKey}${t.toUpperCase()}`);
    if (!recId || !srcRecId) {
      console.warn(`  skip ${t}: missing corpus record (target=${!!recId} source=${!!srcRecId})`);
      continue;
    }
    const key = edgeDedupeKey({ survey_group: surveyGroup, cycle: sug.cycle, target_var_name: t.toUpperCase(), source_var_name: suggestedName.toUpperCase(), derivation_type: 'formula' });
    const id = crypto.createHash('sha256').update(`human:${key}`).digest('hex');
    const r = db.prepare(`
      INSERT OR IGNORE INTO candidate_edge (edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name, survey_group, cycle, derivation_type, expression_summary, raw_evidence, extraction_method, confidence, review_status, created_at, audit_notes, auditor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'formula', ?, ?, 'human_review', 0.95, 'verified', datetime('now'), ?, 'human_suggestion_accept')
    `).run(
      id, key, recId, t.toUpperCase(), srcRecId, suggestedName.toUpperCase(), surveyGroup, sug.cycle,
      `${t} derived from ${suggestedName} (questionnaire item '${sourceName}' retargeted by human review)`,
      `Human-approved suggestion for unresolved source '${sourceName}'`,
      `Retargeted via Check 4 suggestion + human approval: '${sourceName}' -> '${suggestedName}'`,
    );
    inserted += Number(r.changes);
  }
  const superseded = Number(db.prepare(`UPDATE candidate_edge SET review_status='rejected', audit_notes=COALESCE(audit_notes,'')||' | Superseded by human-approved retarget to '||? WHERE survey_group=? AND UPPER(source_var_name)=UPPER(?) AND review_status='needs_review'`).run(suggestedName, surveyGroup, sourceName).changes);
  db.prepare(`UPDATE source_suggestion SET decision='accepted' WHERE survey_group=? AND UPPER(source_var_name)=UPPER(?) AND UPPER(suggested_name)=UPPER(?)`).run(surveyGroup, sourceName, suggestedName);
  db.close();
  console.log(`Accepted: ${surveyGroup}/${sourceName} -> ${suggestedName}; ${inserted} verified edges inserted (of ${targets.length} targets); ${superseded} stale needs_review rows superseded.`);
}

const [, , cmd = 'suggest', ...rest] = process.argv;
if (process.argv[1] && process.argv[1].endsWith('suggester.ts')) {
  if (cmd === 'suggest') {
    const idx = rest.indexOf('--survey');
    await cmdSuggest(idx >= 0 ? rest[idx + 1] : undefined);
  } else if (cmd === 'accept') {
    if (rest.length < 3) throw new Error('usage: suggester.ts accept SURVEY SOURCE NAME');
    await cmdAccept(rest[0]!, rest[1]!, rest[2]!);
  } else {
    console.error('unknown command; use: suggest [--survey GROUP] | accept SURVEY SOURCE NAME');
    process.exit(1);
  }
}
