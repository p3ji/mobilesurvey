/**
 * Phase 25: T15.4 Derived Variable Specification Ingestion Engine
 *
 * Statistics Canada's health and social surveys (CCHS, CHMS, CCAHS, SAHCPDP, SCMH, SLCDC, NPHS)
 * frequently omit derivation rules from their T15.2/T15.6 Data Dictionaries, printing only:
 *   "Universe: See documentation on derived variables."
 * while publishing the full multi-page specifications in separate T15.4 Derived Variable
 * Specification manuals (`docKind = 'derived-spec'`).
 *
 * This module:
 * 1. Extracts all English T15.4 PDFs from the RDC archive into `out/documents/<docId>/`.
 * 2. Deterministically parses `Variable name:`, `Based on:`, `Description:`, and `Temporary Reformat`
 *    sections from the T15.4 manuals.
 * 3. Resolves target and source variables against `out/corpus.jsonl` (supporting both exact-cycle
 *    matching and concept-verified same-program cycle propagation).
 * 4. Persists verified edges into `out/derivation_queue.db` under the strict Two-Clause Epistemic
 *    Transparency Contract:
 *      `Evidence from data dictionary: "..."; AI interpretation and action: ...`
 */

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentRecordId } from '../ingest.js';
import { toChunks } from '../documents.js';
import { extractPdf } from '../pdf.js';
import { listEntries, readEntry } from '../zip.js';
import type { CorpusVariable } from '../types.js';
import { buildQuestionNameAliasIndex } from './aliases.js';
import { edgeDedupeKey, ensureEdgeDedupeSchema } from './queue.js';
import { expandRangeToken } from './reviewer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..', '..');
const ARCHIVE_DIR = path.join(REPO_ROOT, 'docs', 'metadatarepo');
const INVENTORY_PATH = path.join(PACKAGE_DIR, 'out', 'inventory.jsonl');
const DOCUMENTS_DIR = path.join(PACKAGE_DIR, 'out', 'documents');
const CORPUS_JSONL = path.join(PACKAGE_DIR, 'out', 'corpus.jsonl');
const DB_PATH = path.join(PACKAGE_DIR, 'out', 'derivation_queue.db');

export interface DerivedSpecBlock {
  targetVarName: string;
  basedOnRaw: string;
  description: string;
  sourceTokens: string[];
}

export interface DerivedSpecIngestResult {
  documentsProcessed: number;
  blocksParsed: number;
  verifiedEdgesInserted: number;
  bySurveyCycle: Record<string, number>;
}

const STOP_TOKENS = new Set([
  'AND',
  'OR',
  'FOR',
  'ALL',
  'HOUSEHOLD',
  'MEMBERS',
  'MEMBER',
  'THE',
  'FROM',
  'WITH',
  'IN',
  'TO',
  'OF',
  'BY',
  'NOT',
  'IF',
  'THEN',
  'ELSE',
  'SOURCE',
  'CENSUS',
  'PCCF',
  'ICD',
  'NOC',
  'NAICS',
  'ISCO',
  'SAMPLEID',
  'PERSONID',
  'MASTERID',
  'SSID',
  'CLINICID',
  'HHLDID',
  'SHAREID',
  'FILE',
  'DATA',
  'CODE',
  'CODES',
  'YEAR',
  'YEARS',
  'AGE',
  'SEX',
  'RESPONDENT',
  'INFORMATION',
  'ADDRESS',
  'POSTAL',
  'CONVERSION',
  'AVAILABLE',
  'SEE',
  'NOTE',
  'NOTES',
  'TABLE',
  'SECTION',
  'MODULE',
  'QUESTION',
  'QUESTIONS',
  'VARIABLE',
  'VARIABLES',
  'DERIVED',
  'SPECIFICATIONS',
  'DESCRIPTION',
  'VALUE',
  'VALUES',
  'CANADIAN',
  'SURVEY',
  'HEALTH',
  'STATISTICS',
  'CANADA',
  'CYCLE',
  'WAVE',
  'PART',
]);

/**
 * Extract candidate variable tokens from a `Based on:` specification string,
 * expanding explicit ranges (`ADL_01 to ADL_05`, `KB_Q05A-KB_Q05M`).
 */
export function extractDerivedSpecTokens(raw: string): string[] {
  const out = new Set<string>();
  const normalized = raw.replace(
    /\b([A-Za-z0-9_]+)\s+(?:to|through|-|–|—)\s+([A-Za-z0-9_]+)\b/gi,
    '$1-$2',
  );
  for (const part of normalized.split(/[,;()\s]+/)) {
    const clean = part.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, '').toUpperCase();
    if (!clean || clean.length < 2) continue;
    if (clean.includes('-')) {
      const expanded = expandRangeToken(clean);
      if (expanded) {
        for (const e of expanded) {
          if (!STOP_TOKENS.has(e)) out.add(e);
        }
        continue;
      }
    }
    if (/^[A-Z][A-Z0-9_]{1,19}$/.test(clean) && !STOP_TOKENS.has(clean) && !/^\d+$/.test(clean)) {
      out.add(clean);
    }
  }
  return [...out];
}

/**
 * Parse `Temporary Reformat` blocks inside a T15.4 document (e.g. `ADLT005` -> `ADL_005`).
 */
export function parseTemporaryReformats(text: string): Map<string, Set<string>> {
  const tempMap = new Map<string, Set<string>>();
  const tempRe = /\b([A-Z]{2,5}T[A-Z0-9_]{1,8})\s*\n\s*\(?([A-Z][A-Z0-9_]{2,})/g;
  for (const tm of text.matchAll(tempRe)) {
    const tName = tm[1]!.toUpperCase();
    const srcName = tm[2]!.toUpperCase();
    if (!STOP_TOKENS.has(srcName)) {
      let set = tempMap.get(tName);
      if (!set) {
        set = new Set();
        tempMap.set(tName, set);
      }
      set.add(srcName);
    }
  }
  return tempMap;
}

/**
 * Parse all Derived Variable specification blocks from a T15.4 document's full text.
 */
export function parseDerivedSpecBlocks(text: string): DerivedSpecBlock[] {
  const tempMap = parseTemporaryReformats(text);

  const blockRe =
    /(?:(?:Variable [Nn]ame|Longitudinal [Nn]ame)\s*:\s*([A-Za-z][A-Za-z0-9_]*)|\b\d+\s*\)\s*([A-Z][A-Za-z0-9_]{2,})\s*[-–—][^\n]+)\s*\n(?:Source:[^\n]*\n|Statistics Canada[^\n]*\n)*Based on\s*:?\s*([\s\S]+?)(?=\n(?:Previous [Uu]sage|Description|Universe|Note|\*Note|Specifications|Value|Code|Internet site|Technical Specs|This derived variable|This variable|\d+\s*\)|$))/g;

  const results: DerivedSpecBlock[] = [];
  for (const m of text.matchAll(blockRe)) {
    const targetVarName = (m[1] || m[2] || '').trim().toUpperCase();
    if (!targetVarName || STOP_TOKENS.has(targetVarName)) continue;

    const basedOnRaw = m[3]!.replace(/\s+/g, ' ').trim();
    const afterIdx = m.index! + m[0].length;
    const afterSlice = text.slice(afterIdx, afterIdx + 1000);
    const descMatch = afterSlice.match(
      /(?:Description\s*:?\s*\.?\s*|This (?:derived )?variable\s+)([^\n]+(?:\n(?!(?:Universe|Note|Specifications|Value|Code|Internet site|Technical Specs|\d+\s*\)))[^\n]+)*)/i,
    );
    const description = descMatch ? descMatch[1]!.replace(/\s+/g, ' ').trim() : '';

    const rawTokens = extractDerivedSpecTokens(basedOnRaw);
    const expandedTokens = new Set<string>();
    for (const tok of rawTokens) {
      expandedTokens.add(tok);
      const mapped = tempMap.get(tok);
      if (mapped) {
        for (const s of mapped) expandedTokens.add(s);
      }
      // Standard CCHS temporary reformat pattern: XXXTNNN -> XXX_NNN (e.g. ADLT005 -> ADL_005)
      const tMatch = tok.match(/^([A-Z]{3})T(\d{3}[A-Z]?)$/);
      if (tMatch) expandedTokens.add(`${tMatch[1]}_${tMatch[2]}`);
    }

    if (expandedTokens.size > 0) {
      results.push({
        targetVarName,
        basedOnRaw,
        description,
        sourceTokens: [...expandedTokens],
      });
    }
  }
  return results;
}

/**
 * Formats verbatim evidence and AI/rule interpretation according to the Two-Clause
 * Epistemic Transparency Contract.
 */
export function formatT154Attribution(params: {
  docTitle: string;
  targetVarName: string;
  sourceVarName: string;
  basedOnRaw: string;
  description: string;
  surveyGroup: string;
  cycle: string;
  specCycle: string;
  aliasNote?: string;
}): { rawEvidence: string; expressionSummary: string; auditNotes: string } {
  const cleanBasedOn = params.basedOnRaw.replace(/\s+/g, ' ').trim().slice(0, 260);
  const cleanDesc = params.description
    ? params.description.replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';

  const rawEvidence =
    `Based on: ${cleanBasedOn}.` +
    (cleanDesc ? ` Description: ${cleanDesc}` : '') +
    ` [T15.4 Derived Variable Specification: ${params.docTitle}]`;

  const isExactCycle = params.cycle === params.specCycle;
  const aliasDetail = params.aliasNote ? ` (${params.aliasNote})` : '';

  const actionClause = isExactCycle
    ? `Extracted from official T15.4 Derived Variable Specification (${params.docTitle}) and linked ${params.targetVarName} to input variable ${params.sourceVarName}${aliasDetail}, verified in ${params.surveyGroup} (${params.cycle}).`
    : `T15.6 dictionary states "See documentation on derived variables"; applied program T15.4 specification (${params.docTitle}) and linked ${params.targetVarName} to input variable ${params.sourceVarName}${aliasDetail} after verifying both columns exist in ${params.surveyGroup} (${params.cycle}).`;

  const expressionSummary =
    `Evidence from data dictionary: "Based on: ${cleanBasedOn} [${params.docTitle}]"; ` +
    `AI interpretation and action: ${actionClause}`;

  return {
    rawEvidence,
    expressionSummary,
    auditNotes: expressionSummary,
  };
}

/**
 * Computes word-level Jaccard similarity between two variable concept labels,
 * used to guard 3-digit <-> 2-digit CCHS number normalization across cycles.
 */
export function conceptSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/\([dfg]\)/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 2),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

type InventoryRow = import('../types.js').CorpusFile;

function selectEnglishDerivedSpecPdfs(inventoryPath: string): InventoryRow[] {
  const lines = readFileSync(inventoryPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as InventoryRow);
  return lines.filter(
    (r) =>
      r.ext === 'pdf' &&
      r.lang !== 'fr' &&
      (r.docKind === 'derived-spec' || /derived[ _]variable/i.test(r.path)) &&
      !/\/(?:ECSS_|ecsa_|escc_)|Doc_F /i.test(r.path),
  );
}

export async function ensureDerivedSpecPdfsExtracted(
  inventoryPath: string = INVENTORY_PATH,
  documentsDir: string = DOCUMENTS_DIR,
  archiveDir: string = ARCHIVE_DIR,
): Promise<InventoryRow[]> {
  const pdfSpecs = selectEnglishDerivedSpecPdfs(inventoryPath);
  const byBundle = new Map<string, InventoryRow[]>();
  for (const s of pdfSpecs) {
    let list = byBundle.get(s.bundle);
    if (!list) {
      list = [];
      byBundle.set(s.bundle, list);
    }
    list.push(s);
  }

  for (const [bundle, items] of byBundle.entries()) {
    let zipBuf: Buffer | null = null;
    let entries: ReturnType<typeof listEntries> | null = null;

    for (const item of items) {
      const docId = documentRecordId({ bundle: item.bundle, path: item.path });
      const docDir = path.join(documentsDir, docId);
      if (existsSync(path.join(docDir, '1.json'))) continue;

      const zipPath = path.join(archiveDir, bundle);
      if (!existsSync(zipPath)) continue;
      if (!zipBuf) {
        zipBuf = readFileSync(zipPath);
        entries = listEntries(zipBuf, bundle);
      }
      const entry = entries!.find((e) => e.path === item.path);
      if (!entry) continue;

      const pdfBuf = readEntry(zipBuf, entry, bundle);
      const doc = await extractPdf(pdfBuf, item);
      mkdirSync(docDir, { recursive: true });
      for (const chunk of toChunks(docId, doc)) {
        writeFileSync(path.join(docDir, `${chunk.from}.json`), JSON.stringify(chunk));
      }
    }
  }
  return pdfSpecs;
}

function readCachedDocText(docId: string, documentsDir: string = DOCUMENTS_DIR): string {
  const dir = path.join(documentsDir, docId);
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const pages: string[] = [];
  for (const f of files) {
    const chunk = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
      pages?: Array<{ page: number; text: string }>;
    };
    for (const p of chunk.pages ?? []) {
      if (p.text) pages.push(p.text);
    }
  }
  return pages.join('\n');
}

function surveyFamilyKey(surveyGroup: string, filePath: string = ''): string {
  if (surveyGroup.startsWith('CCHS_ESCC')) return 'CCHS_ESCC';
  if (surveyGroup.startsWith('CCAHS_ECSAC')) return 'CCAHS_ECSAC';
  if (surveyGroup === 'CHSS_ESCA' && filePath.toLowerCase().includes('cchs_')) return 'CCHS_ESCC';
  return surveyGroup;
}

export async function ingestDerivedSpecsToQueue(
  options: { dryRun?: boolean; dbPath?: string } = {},
): Promise<DerivedSpecIngestResult> {
  const pdfSpecs = await ensureDerivedSpecPdfsExtracted();

  // 1. Build occurrence + concept lookup from corpus.jsonl
  console.log('Building occurrence and concept index from corpus.jsonl...');
  const byGroupCycle = new Map<
    string,
    Map<string, Map<string, { recordId: string; concept: string }>>
  >();
  // Also track canonical concept per (family, varName) from 2015-2020 cycles to verify 3-digit -> 2-digit renames
  const familyConceptMap = new Map<string, string>();

  const rl = createInterface({
    input: createReadStream(CORPUS_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const v = JSON.parse(line) as CorpusVariable;
    if (v.source.lang !== 'en') continue;
    const g = v.source.surveyGroup;
    const c = v.source.cycle || String(v.source.year || '');
    let cmap = byGroupCycle.get(g);
    if (!cmap) {
      cmap = new Map();
      byGroupCycle.set(g, cmap);
    }
    let vmap = cmap.get(c);
    if (!vmap) {
      vmap = new Map();
      cmap.set(c, vmap);
    }
    const upperName = v.name.toUpperCase();
    vmap.set(upperName, { recordId: v.recordId, concept: v.concept || '' });
    const fam = surveyFamilyKey(g);
    if (v.concept && !familyConceptMap.has(`${fam}:${upperName}`)) {
      familyConceptMap.set(`${fam}:${upperName}`, v.concept);
    }
  }

  console.log('Building Question Name -> Variable Name alias index...');
  const aliasIdx = await buildQuestionNameAliasIndex();

  // 2. Parse all T15.4 documents
  const specsByFamily = new Map<
    string,
    Array<DerivedSpecBlock & { docTitle: string; docCycle: string }>
  >();
  let blocksParsed = 0;

  for (const item of pdfSpecs) {
    const docId = documentRecordId({ bundle: item.bundle, path: item.path });
    const text = readCachedDocText(docId);
    if (!text) continue;
    const blocks = parseDerivedSpecBlocks(text);
    blocksParsed += blocks.length;

    const family = surveyFamilyKey(item.surveyGroup, item.path);
    let list = specsByFamily.get(family);
    if (!list) {
      list = [];
      specsByFamily.set(family, list);
    }
    const docTitle = path.basename(item.path);
    const docCycle = item.cycle || String(item.year || '');
    for (const b of blocks) {
      list.push({ ...b, docTitle, docCycle });
    }
  }

  // 3. Match against corpus cycles and build verified edges
  const db = new DatabaseSync(options.dbPath || DB_PATH);
  db.exec(`PRAGMA busy_timeout = 30000; PRAGMA journal_mode = WAL;`);
  ensureEdgeDedupeSchema(db);

  const upsertStmt = db.prepare(`
    INSERT INTO candidate_edge (
      edge_id, dedupe_key, target_record_id, target_var_name, source_record_id, source_var_name,
      survey_group, cycle, derivation_type, expression_summary, raw_evidence,
      extraction_method, confidence, review_status, created_at, auditor, audit_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, 't15_4_spec_engine_v1', ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      target_record_id = excluded.target_record_id,
      source_record_id = excluded.source_record_id,
      expression_summary = excluded.expression_summary,
      raw_evidence = excluded.raw_evidence,
      extraction_method = excluded.extraction_method,
      confidence = excluded.confidence,
      review_status = 'verified',
      auditor = 't15_4_spec_engine_v1',
      audit_notes = excluded.audit_notes
    WHERE candidate_edge.review_status != 'verified' OR candidate_edge.source_record_id IS NULL
  `);

  let verifiedEdgesInserted = 0;
  const bySurveyCycle: Record<string, number> = {};
  const seenDedupe = new Set<string>();
  const now = Date.now();

  if (!options.dryRun) db.exec('BEGIN IMMEDIATE');
  try {
    for (const [g, cmap] of byGroupCycle.entries()) {
      const family = surveyFamilyKey(g);
      const familySpecs = specsByFamily.get(family);
      if (!familySpecs) continue;

      for (const [cycle, varMap] of cmap.entries()) {
        const sortedSpecs = [...familySpecs].sort((a, b) =>
          a.docCycle === cycle ? -1 : b.docCycle === cycle ? 1 : 0,
        );

        for (const spec of sortedSpecs) {
          const targetEntry = varMap.get(spec.targetVarName);
          if (!targetEntry) continue;

          for (const tok of spec.sourceTokens) {
            const resolvedSources = new Map<string, string | undefined>(); // srcVarName -> aliasNote

            if (varMap.has(tok)) {
              resolvedSources.set(tok, undefined);
            }
            const groupAliases = aliasIdx.get(g)?.get(tok);
            if (groupAliases) {
              for (const a of groupAliases) {
                if (varMap.has(a) && !resolvedSources.has(a)) {
                  resolvedSources.set(a, `resolved from Question Name ${tok}`);
                }
              }
            }
            const noQ = tok.replace(/_Q(\d)/, '_$1');
            if (noQ !== tok && varMap.has(noQ) && !resolvedSources.has(noQ)) {
              resolvedSources.set(noQ, `resolved from question code ${tok}`);
            }

            // Concept-verified 3-digit -> 2-digit CCHS number normalization (e.g. PAA_010B -> PAA_10B)
            const twoDigit = tok.replace(/_0(\d{2}[A-Z]?)$/, '_$1');
            if (twoDigit !== tok && varMap.has(twoDigit) && !resolvedSources.has(twoDigit)) {
              const origConcept = familyConceptMap.get(`${family}:${tok}`);
              const targetConcept = varMap.get(twoDigit)?.concept;
              if (conceptSimilarity(origConcept, targetConcept) >= 0.7) {
                resolvedSources.set(
                  twoDigit,
                  `concept-verified CCHS 2-digit renumbering from ${tok}`,
                );
              }
            }

            // Battery stem expansion (e.g. CCC_60 -> CCC_60A..I) when exact stem is not a single column
            if (resolvedSources.size === 0) {
              for (const stem of [tok, noQ]) {
                for (const vName of varMap.keys()) {
                  if (
                    vName !== spec.targetVarName &&
                    (new RegExp(`^${stem}[A-Z]$`).test(vName) ||
                      new RegExp(`^${stem}_[A-Z0-9]{1,2}$`).test(vName))
                  ) {
                    resolvedSources.set(vName, `expanded battery item from stem ${tok}`);
                  }
                }
              }
            }

            for (const [srcVar, aliasNote] of resolvedSources.entries()) {
              if (srcVar === spec.targetVarName) continue;
              const srcEntry = varMap.get(srcVar);
              if (!srcEntry) continue;

              const edgeIdentity = {
                survey_group: g,
                cycle,
                target_var_name: spec.targetVarName,
                source_var_name: srcVar,
                derivation_type: 'formula',
              };
              const dedupeKey = edgeDedupeKey(edgeIdentity);
              if (seenDedupe.has(dedupeKey)) continue;
              seenDedupe.add(dedupeKey);

              const edgeId = crypto
                .createHash('sha256')
                .update(`${dedupeKey}:${targetEntry.recordId}`)
                .digest('hex');

              const attr = formatT154Attribution({
                docTitle: spec.docTitle,
                targetVarName: spec.targetVarName,
                sourceVarName: srcVar,
                basedOnRaw: spec.basedOnRaw,
                description: spec.description,
                surveyGroup: g,
                cycle,
                specCycle: spec.docCycle,
                aliasNote,
              });

              const confidence = spec.docCycle === cycle ? 0.99 : 0.95;

              if (!options.dryRun) {
                upsertStmt.run(
                  edgeId,
                  dedupeKey,
                  targetEntry.recordId,
                  spec.targetVarName,
                  srcEntry.recordId,
                  srcVar,
                  g,
                  cycle,
                  'formula',
                  attr.expressionSummary,
                  attr.rawEvidence,
                  't15_4_spec',
                  confidence,
                  now,
                  attr.auditNotes,
                );
              }

              verifiedEdgesInserted++;
              const gcKey = `${g}:${cycle}`;
              bySurveyCycle[gcKey] = (bySurveyCycle[gcKey] || 0) + 1;
            }
          }
        }
      }
    }
    if (!options.dryRun) db.exec('COMMIT');
  } catch (err) {
    if (!options.dryRun) db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }

  return {
    documentsProcessed: pdfSpecs.length,
    blocksParsed,
    verifiedEdgesInserted,
    bySurveyCycle,
  };
}

// CLI Runner
if (process.argv[1] && process.argv[1].endsWith('derived-specs.ts')) {
  const dryRun = process.argv.includes('--dry-run');
  ingestDerivedSpecsToQueue({ dryRun }).then((res) => {
    console.log('\n=== Phase 25: T15.4 Derived Variable Specification Ingestion ===');
    console.log(`Documents processed:     ${res.documentsProcessed}`);
    console.log(`DV spec blocks parsed:   ${res.blocksParsed}`);
    console.log(`Verified edges resolved: ${res.verifiedEdgesInserted} (dryRun=${dryRun})`);
    for (const [k, cnt] of Object.entries(res.bySurveyCycle).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      console.log(`  ${k.padEnd(44)} -> ${String(cnt).padStart(5)} edges`);
    }
  });
}
