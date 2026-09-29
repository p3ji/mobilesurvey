/**
 * Question-Name → Variable-Name alias index built from the parsed data dictionaries.
 *
 * StatCan RDC/master-file dictionaries document each published column with BOTH a
 * `Variable Name` (the actual dataset column, e.g. `ALC_45`) and a `Question Name`
 * (the collection-instrument item, e.g. `ALC_Q45`). Derivation notes cite the
 * Question Name ("Based on: ALC_Q45"), while the corpus occurrence index only knows
 * Variable Names — so edges citing question items used to land in needs_review even
 * though the dictionary itself states the connection. This module recovers that
 * mapping deterministically (no LLM) from `out/documents/<documentId>/<page>.json`.
 *
 * A Question Name may legitimately map to several columns (a multi-part item:
 * `CAN_Q25` → `CAN_25A..I`), so the value is a set. Callers resolve each candidate
 * against the cycle's occurrence index and only keep names that exist as records.
 */

import { readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';
import { documentRecordId } from '../ingest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '..', '..');
const INVENTORY_PATH = path.join(PACKAGE_DIR, 'out', 'inventory.jsonl');
const DOCUMENTS_DIR = path.join(PACKAGE_DIR, 'out', 'documents');

/** Field labels that follow an empty `Question Name:` line in the PDF text layer. */
const FOLLOWING_LABELS =
  '(?:Concept|Question Text|Universe|Note|Source|Answer|Length|Position|Code)';

const VARIABLE_RE = /(?:Variable Name|Nom de la variable)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9_]*)/g;
// Same-line colon only: a bare `Question Name:` followed by the next field label on the
// following line must NOT capture that label as a question name.
const QUESTION_RE = new RegExp(
  `(?:Question Name|Nom de la question)[ \\t]*:[ \\t]*(?!${FOLLOWING_LABELS})([A-Z][A-Za-z0-9_]*)`,
  'g',
);

/** Max characters of block text scanned for a Question Name after its Variable Name. */
const BLOCK_SCAN_LIMIT = 2500;

export interface AliasPair {
  questionName: string;
  variableName: string;
}

/**
 * Extract (Question Name → Variable Name) pairs from one dictionary's full text.
 * Pure and exported for tests: each `Variable Name:` block owns the Question Names
 * printed until the next `Variable Name:` header (capped, since answer-category
 * tables can run long).
 */
export function parseAliasBlocks(text: string): AliasPair[] {
  const pairs: AliasPair[] = [];
  const varMatches = [...text.matchAll(VARIABLE_RE)];
  for (let i = 0; i < varMatches.length; i++) {
    const variableName = varMatches[i]![1]!.toUpperCase();
    const blockStart = varMatches[i]!.index! + varMatches[i]![0].length;
    const blockEnd = i + 1 < varMatches.length ? varMatches[i + 1]!.index : text.length;
    const block = text.slice(blockStart, Math.min(blockEnd, blockStart + BLOCK_SCAN_LIMIT));
    for (const m of block.matchAll(QUESTION_RE)) {
      pairs.push({ questionName: m[1]!.toUpperCase(), variableName });
    }
  }
  return pairs;
}

interface InventoryRow {
  bundle?: string;
  path?: string;
  docKind?: string;
  surveyGroup?: string;
}

async function readDocumentText(docDir: string): Promise<string> {
  const parts: string[] = [];
  let files: string[];
  try {
    files = await readdir(docDir);
  } catch {
    return '';
  }
  for (const fn of files) {
    if (!fn.endsWith('.json')) continue;
    try {
      const obj = JSON.parse(await readFile(path.join(docDir, fn), 'utf8')) as {
        pages?: { page?: number; text?: string }[];
      };
      for (const seg of [...(obj.pages ?? [])].sort((a, b) => (a.page ?? 0) - (b.page ?? 0))) {
        if (seg.text) parts.push(seg.text);
      }
    } catch {
      // A corrupt page file contributes nothing; the rest of the document still parses.
    }
  }
  return parts.join('\n');
}

/**
 * Build `surveyGroup -> Question Name -> Set<Variable Name>` from every parsed
 * data dictionary on disk. Documents whose extraction directory is absent (not
 * extracted, or cleaned up) are skipped silently — the index covers what we have.
 */
export async function buildQuestionNameAliasIndex(
  inventoryPath: string = INVENTORY_PATH,
  documentsDir: string = DOCUMENTS_DIR,
): Promise<Map<string, Map<string, Set<string>>>> {
  const index = new Map<string, Map<string, Set<string>>>();

  const addPair = (group: string, questionName: string, variableName: string) => {
    let byQuestion = index.get(group);
    if (!byQuestion) {
      byQuestion = new Map();
      index.set(group, byQuestion);
    }
    // Index under the raw name AND the underscore-stripped form: notes cite
    // 'CAN_Q30A' while dictionaries spell 'CAN_Q30_A'. Corpus-wide this merge
    // produced zero conflicting target sets.
    for (const key of new Set([questionName, questionName.replace(/_/g, '')])) {
      let vars = byQuestion.get(key);
      if (!vars) {
        vars = new Set();
        byQuestion.set(key, vars);
      }
      vars.add(variableName);
    }
  };

  const rl = readline.createInterface({
    input: createReadStream(inventoryPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: InventoryRow;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.docKind !== 'data-dictionary' || !row.surveyGroup || !row.bundle || !row.path) continue;

    const docId = documentRecordId({ bundle: row.bundle, path: row.path });
    const text = await readDocumentText(path.join(documentsDir, docId));
    if (!text) continue;
    for (const pair of parseAliasBlocks(text)) {
      addPair(row.surveyGroup, pair.questionName, pair.variableName);
    }
  }
  return index;
}
