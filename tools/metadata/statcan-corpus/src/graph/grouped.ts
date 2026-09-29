/**
 * Deterministic PUMF grouped-recode (G-suffix) collapse extractor.
 *
 * StatCan publishes collapsed analytical recodes as `X` + trailing `G` (`AGEG`,
 * `NPRCODEG`) beside the base variable in the SAME data dictionary, and its own
 * concept text marks them ("… - Grouped", "age group", "(G)"). This module turns
 * that convention into verified `collapse` lineage edges — no LLM involved.
 *
 * Why same-document pairs only: across documents the G-suffix is ambiguous
 * (master-file codebooks repeat variable names; `LOLICOAG` is a low-income GAP,
 * not a grouped recode). Requiring target and base to appear in one document
 * plus an evidence tier keeps precision high enough for auto-verification.
 *
 * Evidence tiers (strongest first):
 *   A — target concept carries the classifier's grouped marker ("… - Grouped", "(G)") → 0.98
 *   B — target note cites the base variable verbatim ("Derived based on DAGEYRS …")     → 0.95
 *   C — lexical gate: best target/base concept overlap ≥ 0.5 AND a grouping word
 *       ("group", "aggregat…", "collapse…", "band…", "categoris…") in the target's
 *       own concept/note ("Person's age group …" vs "Age as of …")                  → 0.90
 * Pairs with no tier are withheld (reported, not emitted).
 */

import { createReadStream } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusVariable } from '../types.js';
import { credentialsFromEnv, envWithFile } from '../load.js';
import { MOBILESURVEY_UUID_NAMESPACE, uuidV5 } from '@mobilesurvey/ddi-xml';
import { GROUPED_CONCEPT_REGEX } from './classifier.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const CORPUS_JSONL = path.join(PACKAGE_DIR, 'out', 'corpus.jsonl');
const SQL_EXPORT_PATH = path.join(PACKAGE_DIR, 'out', 'grouped_collapse_edges.sql');

export type GroupedTier = 'A' | 'B' | 'C';

/** Confidence per evidence tier; all three are auto-verified (deterministic rule). */
export const TIER_CONFIDENCE: Record<GroupedTier, number> = { A: 0.98, B: 0.95, C: 0.9 };

const TIER_RANK: Record<GroupedTier, number> = { A: 3, B: 2, C: 1 };

/** Grouping vocabulary in the target's own concept/note (English + French stems). */
export const GROUPING_WORD_REGEX =
  /\b(group|groups|grouping|aggregat\w*|collapse[d]?|band(ed)?|categoris\w*|groupe[eé]?\w*)\b/i;

/** One logical grouped-recode pair, before record-ID resolution. */
export interface GroupedPair {
  surveyGroup: string;
  cycle: string;
  /** Document path (within the bundle) both occurrences were found in. */
  docPath: string;
  targetName: string;
  baseName: string;
  tier: GroupedTier;
  confidence: number;
  /** Verbatim StatCan text that earned the tier (concept or note snippet). */
  evidence: string;
  /** Page the target occurrence was printed on (citation). */
  page: number;
}

/** A pair resolved to concrete corpus record IDs, ready for SQL export. */
export interface ResolvedGroupedEdge extends GroupedPair {
  targetRecordId: string;
  sourceRecordId: string;
}

/**
 * Resolve logical pairs against the LIVE Supabase corpus instead of local record IDs.
 *
 * The live table is deduped at load time (`factKey`), so a local `recordId` can be absent even
 * though its fact is present under another UUID — an explicit-ID insert would then violate the
 * FK and abort the whole transaction. Resolving by (survey_group, path, name) against live rows
 * mirrors renderVerifiedSql's join semantics: same document first, cycle preferred when both
 * sides carry one, any in-scope row otherwise. Pairs that cannot be resolved on either side are
 * dropped (reported), never emitted with a dangling ID.
 */
export async function resolveAgainstSupabase(
  pairs: readonly GroupedPair[],
  creds: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ edges: ResolvedGroupedEdge[]; unresolved: number }> {
  const liveCache = new Map<string, Array<{ record_id: string; cycle: string | null }>>();

  async function liveRows(surveyGroup: string, docPath: string, name: string) {
    const key = `${surveyGroup}|${docPath}|${name}`;
    let rows = liveCache.get(key);
    if (!rows) {
      const q =
        `${creds.url}/rest/v1/corpus_variable?select=record_id,cycle` +
        `&survey_group=eq.${encodeURIComponent(surveyGroup)}` +
        `&path=eq.${encodeURIComponent(docPath)}` +
        `&name=ilike.${encodeURIComponent(name)}&lang=eq.en` +
        `&order=record_id.asc`; // stable tie-break: PostgREST does not guarantee row order
      const res = await fetchImpl(q, {
        headers: { apikey: creds.serviceRoleKey, Authorization: `Bearer ${creds.serviceRoleKey}` },
      });
      if (!res.ok) throw new Error(`Live lookup failed for ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      rows = (await res.json()) as Array<{ record_id: string; cycle: string | null }>;
      liveCache.set(key, rows);
    }
    return rows;
  }

  const edges: ResolvedGroupedEdge[] = [];
  let unresolved = 0;

  for (const p of pairs) {
    const [targetRows, sourceRows] = await Promise.all([
      liveRows(p.surveyGroup, p.docPath, p.targetName),
      liveRows(p.surveyGroup, p.docPath, p.baseName),
    ]);
    if (targetRows.length === 0 || sourceRows.length === 0) {
      unresolved++;
      continue;
    }
    // Prefer the occurrence whose cycle matches the pair's cycle when both sides carry one.
    const pick = (rows: Array<{ record_id: string; cycle: string | null }>) =>
      rows.find((r) => r.cycle === p.cycle && p.cycle !== '') ?? rows[0]!;
    edges.push({ ...p, targetRecordId: pick(targetRows).record_id, sourceRecordId: pick(sourceRows).record_id });
  }

  return { edges, unresolved };
}

/** `AGEG` → `AGE`; null when the name is not a G-suffix candidate. */
export function baseOfGroupedName(name: string): string | null {
  const n = name.trim().toUpperCase();
  if (n.length < 3 || !n.endsWith('G')) return null;
  return n.slice(0, -1);
}

const tokenize = (s: string) =>
  new Set((s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));

/** Overlap of two concept strings: shared tokens / smaller token set. 0 when either is empty. */
export function conceptOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Assign the evidence tier to a same-document G-suffix pair. Pure and exported
 * for tests. `overlap` is conceptOverlap(targetConcept, baseConcept).
 */
export function classifyGroupedEvidence(opts: {
  targetConcept: string;
  targetNote: string;
  baseName: string;
  overlap: number;
}): GroupedTier | null {
  const concept = opts.targetConcept ?? '';
  const note = opts.targetNote ?? '';
  if (GROUPED_CONCEPT_REGEX.test(concept)) return 'A';
  if (note.toLowerCase().includes(opts.baseName.toLowerCase())) return 'B';
  if (opts.overlap >= 0.5 && GROUPING_WORD_REGEX.test(`${concept} ${note}`)) return 'C';
  return null;
}

interface IndexedRecord {
  name: string;
  concept: string;
  note: string;
  page: number;
  position: string;
}

/**
 * Scan the corpus for same-document G-suffix pairs and resolve them to record IDs.
 * English occurrences only (the lineage graph is published EN-first, matching the
 * rest of the pipeline). Deterministic: best (tier, overlap) occurrence pair wins,
 * ties broken by document order.
 */
export async function scanGroupedPairs(corpusPath: string = CORPUS_JSONL): Promise<{
  pairs: GroupedPair[];
  withheldNoTier: number;
  scannedEnRecords: number;
}> {
  // survey|cycle -> doc path -> upper(name) -> occurrences in document order
  const idx = new Map<string, Map<string, Map<string, IndexedRecord[]>>>();
  let scannedEnRecords = 0;

  const rl = createInterface({ input: createReadStream(corpusPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    if (v.source?.lang !== 'en') continue;
    scannedEnRecords++;
    const cycle = v.source.cycle || String(v.source.year ?? '');
    const key = `${v.source.surveyGroup}|${cycle}`;
    let byPath = idx.get(key);
    if (!byPath) {
      byPath = new Map();
      idx.set(key, byPath);
    }
    let names = byPath.get(v.source.path);
    if (!names) {
      names = new Map();
      byPath.set(v.source.path, names);
    }
    const nm = (v.name ?? '').toUpperCase();
    let arr = names.get(nm);
    if (!arr) {
      arr = [];
      names.set(nm, arr);
    }
    arr.push({
      name: v.name,
      concept: (v.concept ?? '').trim(),
      note: (v.note ?? '').trim(),
      page: v.source.page,
      position: v.position ?? '',
    });
  }

  const pairs: GroupedPair[] = [];
  let withheldNoTier = 0;

  for (const [key, byPath] of idx) {
    const sep = key.indexOf('|');
    const surveyGroup = key.slice(0, sep);
    const cycle = key.slice(sep + 1);
    for (const [docPath, names] of byPath) {
      for (const [targetName, targetArr] of names) {
        const baseName = baseOfGroupedName(targetName);
        if (!baseName) continue;
        const sourceArr = names.get(baseName);
        if (!sourceArr || sourceArr.length === 0) continue;

        // Best (tier rank, overlap) occurrence pair; document order breaks ties.
        let best: { t: IndexedRecord; s: IndexedRecord; tier: GroupedTier; overlap: number } | null = null;
        for (const t of targetArr) {
          for (const s of sourceArr) {
            const overlap = conceptOverlap(t.concept, s.concept);
            const tier = classifyGroupedEvidence({
              targetConcept: t.concept,
              targetNote: t.note,
              baseName,
              overlap,
            });
            if (!tier) continue;
            if (
              !best ||
              TIER_RANK[tier] > TIER_RANK[best.tier] ||
              (TIER_RANK[tier] === TIER_RANK[best.tier] && overlap > best.overlap)
            ) {
              best = { t, s, tier, overlap };
            }
          }
        }

        if (!best) {
          withheldNoTier++;
          continue;
        }

        const evidence =
          best.tier === 'A'
            ? `Concept: ${best.t.concept}`
            : best.tier === 'B'
              ? `Note: ${snippetAround(best.t.note, baseName)}`
              : `Target concept: ${best.t.concept || '(empty)'}; base concept: ${best.s.concept || '(empty)'}`;

        pairs.push({
          surveyGroup,
          cycle,
          docPath,
          targetName,
          baseName,
          tier: best.tier,
          confidence: TIER_CONFIDENCE[best.tier],
          evidence,
          page: best.t.page,
        });
      }
    }
  }

  return { pairs, withheldNoTier, scannedEnRecords };
}

/** Short verbatim window around the base-name mention in a note. */
function snippetAround(note: string, needle: string): string {
  const i = note.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return note.slice(0, 200);
  const start = Math.max(0, i - 60);
  const end = Math.min(note.length, i + needle.length + 140);
  return `${start > 0 ? '…' : ''}${note.slice(start, end)}${end < note.length ? '…' : ''}`;
}

const sqlEscape = (s: string) => s.replace(/'/g, "''");

/**
 * Render resolved edges as an idempotent Supabase migration. Explicit record IDs
 * (stable UUIDv5 from the corpus load), so no name-join resolution is needed —
 * unlike renderVerifiedSql, this also works when target and base live in different
 * documents of a cycle. The unique index on (target_record_id, normalized source
 * name) makes re-runs safe.
 */
export function renderGroupedCollapseSql(edges: readonly ResolvedGroupedEdge[]): string {
  const rows = edges.map((e) => [
    `'${e.targetRecordId}'`, // target_record_id
    `'${e.sourceRecordId}'`, // source_record_id
    `'${sqlEscape(e.baseName)}'`, // source_var_name
    `'${sqlEscape(e.surveyGroup)}'`, // survey_group
    `'${sqlEscape(e.cycle)}'`, // cycle
    `'ai_inferred'`, // data_authority (the pairing is inferred from StatCan's own convention)
    `'none (deterministic rule)'`, // ai_model
    `'grouped_recode_extractor_v1'`, // ai_auditor
    `'collapse'`, // derivation_type
    `${e.confidence}`, // confidence
    `'verified'`, // review_status
    `'${sqlEscape(`PUMF grouped/collapsed recode of ${e.baseName} (tier ${e.tier})`)}'`, // ai_expression_summary
    `'${sqlEscape(e.evidence)}'`, // statcan_verbatim_note
    `'deterministic_g_suffix_rule'`, // extraction_method
    `jsonb_build_object('doc', '${sqlEscape(e.docPath)}', 'page', ${e.page}, 'licence', 'Statistics Canada Open Licence')`, // statcan_citation
  ].join(', '));
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    chunks.push(
      `insert into corpus_derivation_edge (\n` +
        `  target_record_id, source_record_id, source_var_name, survey_group, cycle,\n` +
        `  data_authority, ai_model, ai_auditor, derivation_type, confidence, review_status,\n` +
        `  ai_expression_summary, statcan_verbatim_note, extraction_method, statcan_citation\n` +
        `)\nvalues\n${rows.slice(i, i + 500).map((r) => `(${r})`).join(',\n')}\non conflict (target_record_id, (upper(btrim(source_var_name)))) do nothing;`,
    );
  }

  return [
    '-- Deterministic PUMF grouped-recode (G-suffix) collapse edges.',
    `-- ${edges.length} same-document pairs across the EN corpus; tiers: A=explicit "Grouped" concept, B=note cites base, C=lexical gate.`,
    '-- No LLM involved: extraction_method records the deterministic rule. Re-running is safe (unique index arbiter).',
    'begin;',
    ...chunks,
    'commit;',
  ].join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Live import (service-role REST) — same pattern as load.ts's upsertBatch, but keyed on a
// DETERMINISTIC edge id so re-runs are no-ops without touching the unique index.
// ---------------------------------------------------------------------------------------------

/**
 * Deterministic edge identity: UUIDv5 of the logical pair under the suite namespace.
 * The random `gen_random_uuid()` default cannot make repeated imports idempotent (see the
 * comment on idx_derivation_target_source_name_unique), so we mint our own stable id from the
 * facts that define the edge — target/source record ids plus the base name.
 */
export function groupedEdgeId(e: ResolvedGroupedEdge): string {
  return uuidV5(`grouped-collapse|${e.targetRecordId}|${e.sourceRecordId}|${e.baseName}`, MOBILESURVEY_UUID_NAMESPACE);
}

/** One REST row for corpus_derivation_edge, mirroring the SQL export column-for-column. */
export function edgeToRow(e: ResolvedGroupedEdge): Record<string, unknown> {
  return {
    edge_id: groupedEdgeId(e),
    target_record_id: e.targetRecordId,
    source_record_id: e.sourceRecordId,
    source_var_name: e.baseName,
    survey_group: e.surveyGroup,
    cycle: e.cycle,
    data_authority: 'ai_inferred', // the pairing is inferred from StatCan's own convention
    ai_model: 'none (deterministic rule)',
    ai_auditor: 'grouped_recode_extractor_v1',
    derivation_type: 'collapse',
    confidence: e.confidence,
    review_status: 'verified',
    ai_expression_summary: `PUMF grouped/collapsed recode of ${e.baseName} (tier ${e.tier})`,
    statcan_verbatim_note: e.evidence,
    extraction_method: 'deterministic_g_suffix_rule',
    statcan_citation: { doc: e.docPath, page: e.page, licence: 'Statistics Canada Open Licence' },
  };
}

/**
 * Fetch the logical identities already present in live for the given target record IDs:
 * `${targetRecordId}|${upper(btrim(source_var_name))}` — exactly the unique-index key. An earlier
 * run (reviewer/queue) may have published a pair under a RANDOM edge_id, which `on_conflict=edge_id`
 * cannot dedupe; prefiltering on this identity keeps the import safe against BOTH unique indexes.
 */
export async function existingLogicalPairs(
  targetRecordIds: readonly string[],
  creds: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < targetRecordIds.length; i += 500) {
    // unquoted UUIDs: PostgREST casts them to uuid inside in.(...)
    const chunk = targetRecordIds.slice(i, i + 500).join(',');
    const q = `${creds.url}/rest/v1/corpus_derivation_edge?select=target_record_id,source_var_name&target_record_id=in.(${chunk})`;
    const res = await fetchImpl(q, {
      headers: { apikey: creds.serviceRoleKey, Authorization: `Bearer ${creds.serviceRoleKey}` },
    });
    if (!res.ok) throw new Error(`Existing-edge prefilter failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as Array<{ target_record_id: string; source_var_name: string }>;
    for (const r of rows) out.add(`${r.target_record_id}|${r.source_var_name.toUpperCase().trim()}`);
  }
  return out;
}

/**
 * Upsert resolved edges into live Supabase via service-role PostgREST.
 * `on_conflict=edge_id` + deterministic ids ⇒ re-running is a no-op (merge-duplicates keeps the
 * row identical). Batches of 250 keep request bodies small; returns rows actually written.
 */
export async function importGroupedEdges(
  edges: readonly ResolvedGroupedEdge[],
  creds: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
  /** Logical identities already live (from existingLogicalPairs); those rows are skipped. */
  skipExisting?: ReadonlySet<string>,
): Promise<{ written: number; skippedExisting: number }> {
  let written = 0;
  let skippedExisting = 0;
  for (let i = 0; i < edges.length; i += 250) {
    const rows = edges
      .slice(i, i + 250)
      .filter((e) => !skipExisting?.has(`${e.targetRecordId}|${e.baseName.toUpperCase().trim()}`))
      .map(edgeToRow);
    if (rows.length === 0) {
      skippedExisting += edges.slice(i, i + 250).length;
      continue;
    }
    const res = await fetchImpl(`${creds.url}/rest/v1/corpus_derivation_edge?on_conflict=edge_id`, {
      method: 'POST',
      headers: {
        apikey: creds.serviceRoleKey,
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Edge import failed at row ${i}: HTTP ${res.status} — ${detail.slice(0, 400)}`);
    }
    written += rows.length;
    skippedExisting += edges.slice(i, i + 250).length - rows.length;
  }
  return { written, skippedExisting };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('grouped.ts')) {
  const { pairs, withheldNoTier, scannedEnRecords } = await scanGroupedPairs();
  const byTier: Record<GroupedTier, number> = { A: 0, B: 0, C: 0 };
  for (const p of pairs) byTier[p.tier]++;

  // Resolve logical pairs to LIVE record IDs — the live table is deduped at load time, so local
  // UUIDs can be absent even when their fact is present under another row.
  const creds = credentialsFromEnv(envWithFile(path.join(PACKAGE_DIR, '.env.local')));
  const { edges, unresolved } = await resolveAgainstSupabase(pairs, creds);

  writeFileSync(SQL_EXPORT_PATH, renderGroupedCollapseSql(edges), 'utf8');

  console.log('PUMF grouped-recode collapse extraction (deterministic):');
  console.log(`  EN records scanned:   ${scannedEnRecords}`);
  console.log(`  Pairs with evidence:  ${pairs.length}  (A=${byTier.A}, B=${byTier.B}, C=${byTier.C})`);
  console.log(`  Withheld (no tier):   ${withheldNoTier}`);
  console.log(`  Resolved to live IDs: ${edges.length}  (unresolved on Supabase: ${unresolved})`);
  console.log(`  SQL written to:       ${SQL_EXPORT_PATH}`);

  const surveys = new Map<string, number>();
  for (const e of edges) surveys.set(e.surveyGroup, (surveys.get(e.surveyGroup) ?? 0) + 1);
  console.log('Top surveys:');
  for (const [s, n] of [...surveys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${s.padEnd(34)} ${n}`);
  }

  // `--import` pushes the resolved edges to live Supabase (service-role REST). Idempotent:
  // deterministic edge_id + on_conflict=edge_id, plus a prefilter for pairs an earlier run already
  // published under a random edge_id (the other unique index would otherwise reject them).
  if (process.argv.includes('--import')) {
    const existing = await existingLogicalPairs([...new Set(edges.map((e) => e.targetRecordId))], creds);
    const { written, skippedExisting } = await importGroupedEdges(edges, creds, fetch, existing);
    console.log(
      `\nImported ${written} edges to live Supabase corpus_derivation_edge (verified/collapse)` +
        `${skippedExisting > 0 ? `; skipped ${skippedExisting} already-live logical pair(s)` : ''}.`,
    );
  } else {
    console.log('\n(export only — re-run with --import to push the resolved edges to live Supabase)');
  }
}
