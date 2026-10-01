import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BenchmarkQuery } from './types.js';

// Exercise the exact public semantic endpoint and 0.55 cutoff used by Searcher.
for (const path of [
  resolve(import.meta.dirname, '../../.env.local'),
  resolve(import.meta.dirname, '../../.env'),
  resolve(import.meta.dirname, '../../../../../platform/hub/.env.local'),
]) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '');
  }
}

const baseUrl = (process.env.VITE_CORPUS_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.replace(/\/+$/, '');
const key = process.env.VITE_CORPUS_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!baseUrl || !key) throw new Error('Corpus Supabase URL and publishable key are required.');

interface Candidate {
  recordId: string;
  score: number;
  name: string;
  concept: string | null;
  questionText: string | null;
  surveyGroup: string;
  year: number | null;
}

interface Result {
  id: string;
  query: string;
  lexicalTotal: number;
  semanticError: string | null;
  latencyMs: number;
  candidates: Candidate[];
}

async function rpc<T>(name: string, args: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${name} returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json() as Promise<T>;
}

async function evaluate(query: BenchmarkQuery): Promise<Result> {
  const lexical = await rpc<Array<{ total_count: number }>>('corpus_search', {
    q: query.query, max_rows: 5, row_offset: 0,
  });
  const t0 = performance.now();
  let points: Array<{ record_id: string; score: number }> = [];
  let semanticError: string | null = null;
  try {
    const response = await fetch(`${baseUrl}/functions/v1/corpus-semantic-search`, {
      method: 'POST',
      headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.query, limit: 5, score_threshold: 0.55, filters: {} }),
      signal: AbortSignal.timeout(2500),
    });
    const body = await response.json() as { points?: Array<{ record_id: string; score: number }>; error?: string };
    if (!response.ok || body.error) semanticError = body.error ?? `HTTP ${response.status}`;
    else points = body.points ?? [];
  } catch (error) {
    semanticError = error instanceof Error ? error.message : String(error);
  }
  const latencyMs = Math.round(performance.now() - t0);
  let candidates: Candidate[] = [];
  if (points.length > 0) {
    const records = await rpc<Array<{
      record_id: string; name: string; concept: string | null; question_text: string | null;
      survey_group: string; year: number | null;
    }>>('corpus_get_variables', { p_record_ids: points.map((point) => point.record_id) });
    const byId = new Map(records.map((record) => [record.record_id, record]));
    candidates = points.flatMap((point) => {
      const record = byId.get(point.record_id);
      return record ? [{
        recordId: point.record_id,
        score: point.score,
        name: record.name,
        concept: record.concept,
        questionText: record.question_text,
        surveyGroup: record.survey_group,
        year: record.year,
      }] : [];
    });
  }
  return { id: query.id, query: query.query, lexicalTotal: lexical[0]?.total_count ?? 0, semanticError, latencyMs, candidates };
}

async function main(): Promise<void> {
  const all = JSON.parse(readFileSync(resolve(import.meta.dirname, 'queries.json'), 'utf8')) as BenchmarkQuery[];
  const ids = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
  const selected = process.argv.includes('--all') ? all : all.filter((query) => ids.has(query.id));
  if (selected.length === 0) throw new Error('Pass query IDs (e.g. lab-02 fra-01) or --all.');
  const results: Result[] = [];
  for (const [index, query] of selected.entries()) {
    const result = await evaluate(query);
    results.push(result);
    console.log(`${index + 1}/${selected.length} ${result.id}: lexical=${result.lexicalTotal} semantic=${result.candidates.length}${result.semanticError ? ` error=${result.semanticError}` : ''}`);
  }
  const out = resolve(import.meta.dirname, '../../out/search-production-semantic.json');
  mkdirSync(resolve(import.meta.dirname, '../../out'), { recursive: true });
  writeFileSync(out, JSON.stringify({ timestamp: new Date().toISOString(), threshold: 0.55, results }, null, 2));
  console.log(`Saved ${out}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
