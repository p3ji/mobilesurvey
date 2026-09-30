/**
 * Deterministic cross-document "master-file counterpart" extractor (spec #2).
 *
 * StatCan publishes the same variable twice for some surveys: once in the PUMF data
 * dictionary (`T15.2`, frequencies) and once in the master/RDC codebook ("no freqs",
 * "NoCounts CdBk") that documents the confidential master file. The two occurrences
 * share the exact variable name within one survey cycle — a deterministic fact, not an
 * inference — so each shared name becomes a verified `counterpart` edge: the PUMF
 * occurrence (target) was published from / has as primary source the master-file
 * occurrence (source). PROV-O reading: the PUMF variable `wasDerivedFrom` the master
 * file's record layout; GSIM reading: same concept, different dissemination product.
 *
 * Scope rules (v1):
 *   - Same survey group AND same cycle only. Rebased groups whose records carry no
 *     cycle (e.g. GSS_ESG_12-32) are excluded — their master docs span cycles 12–20 and
 *     a path-segment cycle is not yet trustworthy enough for auto-verification.
 *   - Document type comes from the FILENAME, because `docKind` in corpus.jsonl is
 *     uniformly `data-dictionary` (the T-code classifier cannot see "no freqs").
 *   - A PUMF doc pairs with at most ONE master doc: exact subpopulation signature
 *     (`plus`/disability tokens) first, else the base master. Every shared name between that
 *     pair becomes an edge — each PUMF document has its own target record, so linking all of a
 *     cycle's PUMF docs to their master codebook is not redundant (the unique index keys on the
 *     target record, and distinct documents have distinct records).
 *   - Names present in two or more master docs are ambiguous and withheld.
 */

import { createReadStream } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusVariable } from '../types.js';
import { credentialsFromEnv, envWithFile } from '../load.js';
import { MOBILESURVEY_UUID_NAMESPACE, uuidV5 } from '@mobilesurvey/ddi-xml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const CORPUS_JSONL = path.join(PACKAGE_DIR, 'out', 'corpus.jsonl');
const SQL_EXPORT_PATH = path.join(PACKAGE_DIR, 'out', 'counterpart_edges.sql');

/** Confidence per match kind; both are auto-verified (deterministic rule). */
export const COUNTERPART_CONFIDENCE: Record<'exact' | 'fallback', number> = { exact: 0.95, fallback: 0.85 };

/** One logical cross-document counterpart pair, before record-ID resolution. */
export interface CounterpartPair {
  surveyGroup: string;
  cycle: string;
  /** PUMF data-dictionary doc (target side). */
  targetDocPath: string;
  /** Master/RDC codebook doc (source side). */
  sourceDocPath: string;
  name: string;
  matchKind: 'exact' | 'fallback';
  confidence: number;
  evidence: string;
}

/** A pair resolved to concrete corpus record IDs, ready for SQL export / REST import. */
export interface ResolvedCounterpartEdge extends CounterpartPair {
  targetRecordId: string;
  sourceRecordId: string;
}

// ---------------------------------------------------------------------------------------------
// Document typing (filename-based — see module doc) and subpopulation signatures
// ---------------------------------------------------------------------------------------------

/** Master/RDC codebook markers in the filename. */
const MASTER_FILENAME_REGEX = /master|_cdbk|cdbk|zero.?count|zero.?freq|no.?freq/i;

export type DocType = 'master' | 'pumf' | 'analytical';

/**
 * Classify a corpus document by its filename (and, when known, its T-code).
 * `T15.2` is the PUMF data-dictionary code; master markers win over everything else.
 */
export function classifyDocType(docPath: string, tcode?: string): DocType {
  const fname = docPath.split('/').pop() ?? '';
  if (MASTER_FILENAME_REGEX.test(fname)) return 'master';
  if (tcode === 'T15.2' || /t15[._-]?2/i.test(fname) || /\bf\d+\b/i.test(fname)) return 'pumf';
  return 'analytical';
}

/** Subpopulation signature: does this doc cover the CIS-Plus and/or disability subpopulations? */
export function subpopulationSignature(docPath: string): { plus: boolean; dis: boolean } {
  const tokens = (docPath.split('/').pop() ?? '').replace(/\.pdf$/i, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return { plus: tokens.includes('plus'), dis: tokens.includes('d') || tokens.includes('disability') };
}

// ---------------------------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------------------------

interface DocEntry {
  tcode?: string;
  namesInOrder: Map<string, number>; // upper(name) -> first-seen index (document order)
}

/**
 * Scan the corpus for cross-document counterpart pairs. English occurrences only.
 * Deterministic: document order and name order come from file order in corpus.jsonl.
 */
export async function scanCounterpartPairs(corpusPath: string = CORPUS_JSONL): Promise<{
  pairs: CounterpartPair[];
  withheldAmbiguousNames: number;
  scannedEnRecords: number;
}> {
  // survey|cycle -> doc path (insertion order) -> DocEntry
  const idx = new Map<string, Map<string, DocEntry>>();
  let scannedEnRecords = 0;

  const rl = createInterface({ input: createReadStream(corpusPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    if (v.source?.lang !== 'en') continue;
    scannedEnRecords++;
    const cycle = v.source.cycle;
    if (!cycle) continue; // rebased groups: excluded in v1 (see module doc)
    const key = `${v.source.surveyGroup}|${cycle}`;
    let byDoc = idx.get(key);
    if (!byDoc) {
      byDoc = new Map();
      idx.set(key, byDoc);
    }
    let doc = byDoc.get(v.source.path);
    if (!doc) {
      doc = { tcode: v.source.tcode, namesInOrder: new Map() };
      byDoc.set(v.source.path, doc);
    }
    const nm = (v.name ?? '').toUpperCase();
    if (!doc.namesInOrder.has(nm)) doc.namesInOrder.set(nm, doc.namesInOrder.size);
  }

  const pairs: CounterpartPair[] = [];
  let withheldAmbiguousNames = 0;

  for (const [key, byDoc] of idx) {
    const sep = key.indexOf('|');
    const surveyGroup = key.slice(0, sep);
    const cycle = key.slice(sep + 1);

    const masterDocs: string[] = [];
    const pumfDocs: string[] = [];
    for (const [docPath] of byDoc) {
      const t = classifyDocType(docPath, byDoc.get(docPath)?.tcode);
      if (t === 'master') masterDocs.push(docPath);
      else if (t === 'pumf') pumfDocs.push(docPath);
    }
    if (!masterDocs.length || !pumfDocs.length) continue;

    // Names present in >1 master doc are ambiguous for this cycle.
    const nameMasterCount = new Map<string, number>();
    for (const md of masterDocs) {
      for (const nm of byDoc.get(md)?.namesInOrder.keys() ?? []) {
        nameMasterCount.set(nm, (nameMasterCount.get(nm) ?? 0) + 1);
      }
    }

    for (const pd of pumfDocs) {
      const psig = subpopulationSignature(pd);
      let md = masterDocs.find((m) => {
        const ms = subpopulationSignature(m);
        return ms.plus === psig.plus && ms.dis === psig.dis;
      });
      const exact = !!md;
      if (!md) md = masterDocs.find((m) => !subpopulationSignature(m).plus && !subpopulationSignature(m).dis);
      if (!md) continue;

      const targetNames = byDoc.get(pd)?.namesInOrder ?? new Map<string, number>();
      const sourceNames = byDoc.get(md)?.namesInOrder ?? new Map<string, number>();
      for (const [nm] of [...targetNames.entries()].sort((a, b) => a[1] - b[1])) {
        if (!sourceNames.has(nm)) continue;
        if ((nameMasterCount.get(nm) ?? 0) > 1) {
          withheldAmbiguousNames++;
          continue;
        }
        pairs.push({
          surveyGroup,
          cycle,
          targetDocPath: pd,
          sourceDocPath: md,
          name: nm,
          matchKind: exact ? 'exact' : 'fallback',
          confidence: COUNTERPART_CONFIDENCE[exact ? 'exact' : 'fallback'],
          evidence: exact
            ? `Same variable name in PUMF dictionary and matched master codebook (subpopulation signature ${psig.plus || psig.dis ? 'matched' : 'base'})`
            : `Same variable name in PUMF dictionary; no subpopulation-matched master, linked to base master codebook`,
        });
      }
    }
  }

  return { pairs, withheldAmbiguousNames, scannedEnRecords };
}

// ---------------------------------------------------------------------------------------------
// Live resolution + SQL export (same patterns as grouped.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Resolve logical pairs against the LIVE Supabase corpus. The live table is deduped at load
 * time (`factKey`), so local `recordId`s can be absent even when their fact exists under another
 * UUID — an explicit-ID insert would violate the FK and abort the transaction. Resolving by
 * (survey_group, path, name) against live rows mirrors renderVerifiedSql's join semantics; pairs
 * that cannot be resolved on either side are dropped (reported), never emitted with a dangling ID.
 */
export async function resolveCounterpartPairs(
  pairs: readonly CounterpartPair[],
  creds: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ edges: ResolvedCounterpartEdge[]; unresolved: number }> {
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

  const edges: ResolvedCounterpartEdge[] = [];
  let unresolved = 0;

  for (const p of pairs) {
    const [targetRows, sourceRows] = await Promise.all([
      liveRows(p.surveyGroup, p.targetDocPath, p.name),
      liveRows(p.surveyGroup, p.sourceDocPath, p.name),
    ]);
    if (targetRows.length === 0 || sourceRows.length === 0) {
      unresolved++;
      continue;
    }
    const pick = (rows: Array<{ record_id: string; cycle: string | null }>) =>
      rows.find((r) => r.cycle === p.cycle && p.cycle !== '') ?? rows[0]!;
    edges.push({ ...p, targetRecordId: pick(targetRows).record_id, sourceRecordId: pick(sourceRows).record_id });
  }

  return { edges, unresolved };
}

const sqlEscape = (s: string) => s.replace(/'/g, "''");

/** Render resolved counterpart edges as an idempotent Supabase migration. */
export function renderCounterpartSql(edges: readonly ResolvedCounterpartEdge[]): string {
  const rows = edges.map((e) => [
    `'${e.targetRecordId}'`, // target_record_id (PUMF occurrence)
    `'${e.sourceRecordId}'`, // source_record_id (master-file occurrence)
    `'${sqlEscape(e.name)}'`, // source_var_name
    `'${sqlEscape(e.surveyGroup)}'`, // survey_group
    `'${sqlEscape(e.cycle)}'`, // cycle
    `'ai_inferred'`, // data_authority (the pairing is inferred from StatCan's own publication convention)
    `'none (deterministic rule)'`, // ai_model
    `'counterpart_extractor_v1'`, // ai_auditor
    `'counterpart'`, // derivation_type
    `${e.confidence}`, // confidence
    `'verified'`, // review_status
    `'${sqlEscape(`Published in PUMF dictionary; master-file counterpart (match: ${e.matchKind})`)}'`, // ai_expression_summary
    `'${sqlEscape(e.evidence)}'`, // statcan_verbatim_note
    `'deterministic_cross_doc_rule'`, // extraction_method
    `jsonb_build_object('doc', '${sqlEscape(e.targetDocPath)}', 'counterpart_doc', '${sqlEscape(e.sourceDocPath)}', 'licence', 'Statistics Canada Open Licence')`, // statcan_citation
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
    '-- Deterministic cross-document master-file counterpart edges.',
    `-- ${edges.length} same-name pairs between PUMF data dictionaries and master/RDC codebooks within one survey cycle.`,
    '-- No LLM involved: extraction_method records the deterministic rule. Re-running is safe (unique index arbiter).',
    'begin;',
    ...chunks,
    'commit;',
  ].join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Live import (service-role REST) — same pattern as grouped.ts's importer
// ---------------------------------------------------------------------------------------------

/**
 * Deterministic edge identity: UUIDv5 of the logical pair under the suite namespace. The random
 * `gen_random_uuid()` default cannot make repeated imports idempotent, so we mint our own stable
 * id from the facts that define the edge — target/source record ids plus the variable name and
 * the derivation type (so a future collapse/counterpart collision on one pair stays distinct).
 */
export function counterpartEdgeId(e: ResolvedCounterpartEdge): string {
  return uuidV5(`counterpart|${e.targetRecordId}|${e.sourceRecordId}|${e.name}`, MOBILESURVEY_UUID_NAMESPACE);
}

/** One REST row for corpus_derivation_edge, mirroring the SQL export column-for-column. */
export function counterpartEdgeToRow(e: ResolvedCounterpartEdge): Record<string, unknown> {
  return {
    edge_id: counterpartEdgeId(e),
    target_record_id: e.targetRecordId,
    source_record_id: e.sourceRecordId,
    source_var_name: e.name,
    survey_group: e.surveyGroup,
    cycle: e.cycle,
    data_authority: 'ai_inferred', // the pairing is inferred from StatCan's own publication convention
    ai_model: 'none (deterministic rule)',
    ai_auditor: 'counterpart_extractor_v1',
    derivation_type: 'counterpart',
    confidence: e.confidence,
    review_status: 'verified',
    ai_expression_summary: `Published in PUMF dictionary; master-file counterpart (match: ${e.matchKind})`,
    statcan_verbatim_note: e.evidence,
    extraction_method: 'deterministic_cross_doc_rule',
    statcan_citation: { doc: e.targetDocPath, counterpart_doc: e.sourceDocPath, licence: 'Statistics Canada Open Licence' },
  };
}

/**
 * Fetch the logical identities already present in live for the given target record IDs:
 * `${targetRecordId}|${upper(btrim(source_var_name))}` — exactly the unique-index key. An earlier
 * run may have published a pair under a RANDOM edge_id, which `on_conflict=edge_id` cannot dedupe;
 * prefiltering on this identity keeps the import safe against BOTH unique indexes.
 */
export async function existingCounterpartPairs(
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
 * Upsert resolved counterpart edges into live Supabase via service-role PostgREST.
 * `on_conflict=edge_id` + deterministic ids ⇒ re-running is a no-op (merge-duplicates keeps the
 * row identical). Batches of 250 keep request bodies small; returns rows actually written.
 */
export async function importCounterpartEdges(
  edges: readonly ResolvedCounterpartEdge[],
  creds: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
  /** Logical identities already live (from existingCounterpartPairs); those rows are skipped. */
  skipExisting?: ReadonlySet<string>,
): Promise<{ written: number; skippedExisting: number }> {
  let written = 0;
  let skippedExisting = 0;
  for (let i = 0; i < edges.length; i += 250) {
    const rows = edges
      .slice(i, i + 250)
      .filter((e) => !skipExisting?.has(`${e.targetRecordId}|${e.name.toUpperCase().trim()}`))
      .map(counterpartEdgeToRow);
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
      throw new Error(`Counterpart import failed at row ${i}: HTTP ${res.status} — ${detail.slice(0, 400)}`);
    }
    written += rows.length;
    skippedExisting += edges.slice(i, i + 250).length - rows.length;
  }
  return { written, skippedExisting };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('counterpart.ts')) {
  const { pairs, withheldAmbiguousNames, scannedEnRecords } = await scanCounterpartPairs();
  const byKind: Record<'exact' | 'fallback', number> = { exact: 0, fallback: 0 };
  for (const p of pairs) byKind[p.matchKind]++;

  // Resolve logical pairs to LIVE record IDs — the live table is deduped at load time, so local
  // UUIDs can be absent even when their fact is present under another row.
  const creds = credentialsFromEnv(envWithFile(path.join(PACKAGE_DIR, '.env.local')));
  const { edges, unresolved } = await resolveCounterpartPairs(pairs, creds);

  writeFileSync(SQL_EXPORT_PATH, renderCounterpartSql(edges), 'utf8');

  console.log('Cross-document master-file counterpart extraction (deterministic):');
  console.log(`  EN records scanned:   ${scannedEnRecords}`);
  console.log(`  Pairs found:          ${pairs.length}  (exact=${byKind.exact}, fallback=${byKind.fallback})`);
  console.log(`  Withheld (ambiguous): ${withheldAmbiguousNames}`);
  console.log(`  Resolved to live IDs: ${edges.length}  (unresolved on Supabase: ${unresolved})`);
  console.log(`  SQL written to:       ${SQL_EXPORT_PATH}`);

  const surveys = new Map<string, number>();
  for (const e of edges) surveys.set(e.surveyGroup, (surveys.get(e.surveyGroup) ?? 0) + 1);
  console.log('Surveys:');
  for (const [s, n] of [...surveys.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(34)} ${n}`);
  }

  // `--import` pushes the resolved edges to live Supabase (service-role REST). Idempotent:
  // deterministic edge_id + on_conflict=edge_id, plus a prefilter for pairs an earlier run already
  // published under a random edge_id (the other unique index would otherwise reject them).
  if (process.argv.includes('--import')) {
    const existing = await existingCounterpartPairs([...new Set(edges.map((e) => e.targetRecordId))], creds);
    const { written, skippedExisting } = await importCounterpartEdges(edges, creds, fetch, existing);
    console.log(
      `\nImported ${written} edges to live Supabase corpus_derivation_edge (verified/counterpart)` +
        `${skippedExisting > 0 ? `; skipped ${skippedExisting} already-live logical pair(s)` : ''}.`,
    );
  } else {
    console.log('\n(export only — re-run with --import to push the resolved edges to live Supabase)');
  }
}
