import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { documentRecordId } from './ingest.js';
import { parseDictionary } from './parse.js';
import type { CorpusFile, ExtractedDoc } from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS_DIR = path.resolve(ROOT, 'out/documents');
const INVENTORY_FILE = path.resolve(ROOT, 'out/inventory.jsonl');
const CANDIDATES_FILE = path.resolve(ROOT, 'out/supabase_truncated_candidates.json');
const OUTPUT_SQL = path.resolve(ROOT, 'sql/patch-2026-10-02-repo-wide-category-repair.sql');

interface InventoryEntry extends CorpusFile {
  sizeBytes: number;
  ext: string;
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

async function main() {
  console.log('--- 100% REPO-WIDE CATEGORY TRUNCATION AUDIT & REPAIR ---');
  console.log('1. Loading inventory and all extracted documents...');
  const inventoryLines = fs.readFileSync(INVENTORY_FILE, 'utf8').trim().split('\n');
  const docMap = new Map<string, InventoryEntry>();

  for (const line of inventoryLines) {
    if (!line) continue;
    const entry = JSON.parse(line) as InventoryEntry;
    if (entry.ext === 'pdf' && entry.docKind === 'data-dictionary') {
      const id = documentRecordId(entry);
      docMap.set(id, entry);
    }
  }

  const docIds = fs.readdirSync(DOCS_DIR).filter((d) => docMap.has(d));
  console.log(`Scanning all ${docIds.length} extracted data dictionary documents across ALL survey programs...`);

  // Parse all variables from all documents
  const allParsedVars = new Map<string, { surveyGroup: string; name: string; codes: any[] }>();

  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i]!;
    const entry = docMap.get(docId)!;
    const dir = path.join(DOCS_DIR, docId);
    if (!fs.statSync(dir).isDirectory()) continue;

    const chunkFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return numA - numB;
    });

    const allPages: any[] = [];
    for (const cf of chunkFiles) {
      const chunk = JSON.parse(fs.readFileSync(path.join(dir, cf), 'utf8'));
      if (chunk.pages) allPages.push(...chunk.pages);
    }
    if (allPages.length === 0) continue;

    const extractedDoc: ExtractedDoc = {
      file: entry,
      pages: allPages,
      charCount: 0,
      engine: 'pdfjs',
      likelyScanned: false,
    };

    const parseResult = parseDictionary(extractedDoc, (v) => v.name);
    for (const v of parseResult.variables) {
      if (v.codes.length > 0) {
        const key = `${entry.surveyGroup}::${v.name}`;
        if (!allParsedVars.has(key) || entry.lang === 'en') {
          allParsedVars.set(key, {
            surveyGroup: entry.surveyGroup,
            name: v.name,
            codes: v.codes,
          });
        }
      }
    }
  }

  console.log(`Parsed ${allParsedVars.size} distinct variables with code lists across the entire corpus.`);

  console.log('2. Loading Supabase candidate truncated variables...');
  const candidatesRaw = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  const candidates = candidatesRaw.rows[0].payload as Array<{
    survey_group: string;
    name: string;
    codes: Array<{ c: string; l: string; f?: number; w?: number }>;
  }>;
  console.log(`Loaded ${candidates.length} candidate truncated variables from Supabase.`);

  const verifiedRepairs: Array<{
    surveyGroup: string;
    name: string;
    oldCodes: any[];
    newCodes: any[];
    diffs: string[];
  }> = [];

  for (const row of candidates) {
    const parsed = allParsedVars.get(`${row.survey_group}::${row.name}`);
    if (!parsed) continue;

    const currentCodes = row.codes || [];
    const newCodes = parsed.codes.map((c) => ({
      c: c.code || c.c || '',
      l: (c.label || c.l || '').trim(),
      ...(c.frequency !== undefined ? { f: c.frequency } : {}),
      ...(c.weighted !== undefined ? { w: c.weighted } : {}),
    }));

    // Validation guardrails on newCodes
    if (newCodes.length === 0) continue;
    const codeSet = new Set(newCodes.map((c) => c.c));
    if (newCodes.length > 1 && codeSet.size === 1) continue;
    if (newCodes.some((c) => /\s+\d+\s+\d+(?:\s+\d+)*$/.test(c.l))) continue;
    if (newCodes.some((c) => /Data Dictionary|Totals may not add/i.test(c.l))) continue;

    const currentMap = new Map<string, string>(currentCodes.map((c) => [c.c, c.l]));
    const diffs: string[] = [];

    for (const nc of newCodes) {
      const curLabel = currentMap.get(nc.c);
      if (curLabel === undefined) {
        if (/^\d{1,2}$/.test(nc.c) && currentCodes.length > 0 && currentCodes.length < newCodes.length) {
          diffs.push(`added scale code ${nc.c}: "${nc.l}"`);
        }
      } else if (nc.l.length > curLabel.length && nc.l.startsWith(curLabel.replace(/\.\.\.$/, ''))) {
        diffs.push(`expanded code ${nc.c}: "${curLabel}" -> "${nc.l}"`);
      } else if (
        nc.l.length > curLabel.length &&
        (curLabel.endsWith(' to') ||
          curLabel.endsWith(' or') ||
          curLabel.endsWith(' of') ||
          curLabel.endsWith(' in') ||
          curLabel.endsWith(' for') ||
          curLabel.endsWith(' with') ||
          curLabel.endsWith(' and') ||
          curLabel.endsWith(' was') ||
          curLabel.endsWith(' mobile') ||
          curLabel.endsWith('’s') ||
          curLabel.endsWith('\'s') ||
          curLabel.endsWith('(other than'))
      ) {
        diffs.push(`repaired truncated ${nc.c}: "${curLabel}" -> "${nc.l}"`);
      } else if (
        curLabel !== nc.l &&
        (nc.l.includes('prior to selling') ||
          nc.l.includes('1946 to 1960') ||
          nc.l.includes('in any CMA or CA') ||
          nc.l.includes('dealing with people') ||
          nc.l.includes('to send money') ||
          nc.l.includes('free heat pump program') ||
          nc.l.includes('utility rebates and incentives'))
      ) {
        diffs.push(`corrected code ${nc.c}: "${curLabel}" -> "${nc.l}"`);
      }
    }

    if (diffs.length > 0) {
      verifiedRepairs.push({
        surveyGroup: row.survey_group,
        name: row.name,
        oldCodes: currentCodes,
        newCodes,
        diffs,
      });
    }
  }

  console.log(`Total verified repairs identified across all surveys: ${verifiedRepairs.length}`);

  // Write SQL patch
  const sql: string[] = [
    `-- ==============================================================================`,
    `-- Migration: Repo-Wide Category Label Truncation Repair (All Survey Programs)`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total Updates: ${verifiedRepairs.length}`,
    `-- ==============================================================================`,
    `BEGIN;`,
    ``,
  ];

  for (const ch of verifiedRepairs) {
    const codesJson = JSON.stringify(ch.newCodes);
    sql.push(`-- ${ch.surveyGroup} ${ch.name}: ${ch.diffs.slice(0, 2).join('; ')}`);
    sql.push(
      `UPDATE corpus_variable SET codes = '${escapeSql(codesJson)}'::jsonb WHERE survey_group = '${escapeSql(ch.surveyGroup)}' AND name = '${escapeSql(ch.name)}';`,
    );
  }

  sql.push(``);
  sql.push(`-- Synchronize search_text with repaired category labels`);
  sql.push(`UPDATE corpus_variable`);
  sql.push(`   SET search_text = lower(concat_ws(' ',`);
  sql.push(`         name,`);
  sql.push(`         coalesce(concept, ''),`);
  sql.push(`         coalesce(question_text, ''),`);
  sql.push(`         coalesce(universe, ''),`);
  sql.push(`         coalesce(note, ''),`);
  sql.push(`         coalesce((SELECT string_agg(elem->>'l', ' ') FROM jsonb_array_elements(codes) elem), '')`);
  sql.push(`       ))`);
  sql.push(` WHERE survey_group || '::' || name IN (`);
  const keysList = verifiedRepairs.map((c) => `'${escapeSql(c.surveyGroup)}::${escapeSql(c.name)}'`).join(',\n   ');
  sql.push(`   ${keysList}`);
  sql.push(` );`);
  sql.push(``);
  sql.push(`COMMIT;`);

  fs.writeFileSync(OUTPUT_SQL, sql.join('\n'), 'utf8');
  console.log(`Saved repo-wide SQL patch with ${verifiedRepairs.length} updates to ${OUTPUT_SQL}`);

  // Breakdown by survey group
  const bySurvey = new Map<string, number>();
  for (const r of verifiedRepairs) {
    bySurvey.set(r.surveyGroup, (bySurvey.get(r.surveyGroup) || 0) + 1);
  }
  console.log('Survey group breakdown (top 15):');
  const sortedSurveys = Array.from(bySurvey.entries()).sort((a, b) => b[1] - a[1]);
  for (const [sg, count] of sortedSurveys.slice(0, 15)) {
    console.log(`  - ${sg}: ${count} variables repaired`);
  }
}

main().catch(console.error);
