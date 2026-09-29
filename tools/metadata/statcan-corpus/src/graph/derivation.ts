/**
 * Derivation Lineage Extractor (W3C PROV-O wasDerivedFrom)
 *
 * Parses variable notes to extract input variables that fed into a derived variable.
 * Aligns with W3C PROV-O (`prov:wasDerivedFrom`) and DDI-Lifecycle `l:Derivation`.
 */

import type { CorpusVariable } from '../types.js';
import type { DerivationLineage } from './types.js';

const DERIVATION_LEAD_REGEX = /(?:based on|derived from:?|calcul[eé] [aà] partir de|compos[eé] de|selon)\s+([^.]+)/i;

const STOPWORDS = new Set([
  'AND', 'OR', 'THE', 'FOR', 'WITH', 'SEE', 'CENSUS', 'POPULATION', 'SURVEY',
  'USERS', 'USER', 'ARE', 'DUE', 'TO', 'NOT', 'DATA', 'TABLE', 'OF', 'IN',
  'HEALTH', 'CYCLE', 'YEAR', 'DOCUMENTATION', 'ON', 'DERIVED', 'VARIABLES',
  'VARIABLE', 'FILE', 'FILES', 'REPORT', 'SAMPLE', 'FRAME', 'COMPONENT', 'STATISTICS',
  'CANADA', 'ET', 'OU', 'LES', 'DES', 'POUR', 'AVEC', 'VOIR', 'DANS', 'DONNEES',
  'EN', 'DU', 'DE', 'LA', 'LE', 'PAR', 'ADDRESS', 'WITHIN', 'MODULE', 'ROSTER',
  'DESIGN', 'SAMPLING', 'INTERNAL', 'MASTER', 'BOTH', 'INFORMATION', 'ALGORITHM',
  'SELECTION', 'PROCESSING', 'HOUSEHOLD', 'FORM', 'FORMAT', 'CODE', 'ONLY', 'NOTE',
  'QUESTION', 'QUESTIONS', 'ITEM', 'ITEMS', 'REPONSE', 'REPONSES'
]);

/**
 * Extracts candidate source variable names from a derivation statement,
 * optionally grounding them to concrete record IDs if a cycle index is provided.
 */
export function extractDerivationLineage(
  v: CorpusVariable,
  cycleVarIndex?: Map<string, string>,
): DerivationLineage | null {
  const note = (v.note ?? '').trim();
  if (note.length === 0) return null;

  const match = note.match(DERIVATION_LEAD_REGEX);
  if (!match || !match[1]) return null;

  const rawClause = match[1].trim();

  // Replace parentheses with spaces so parenthetical mnemonics like 2(Q02) yield Q02
  const cleanClause = rawClause.replace(/[()]/g, ' ');

  // Split on commas, semicolons, whitespace, and isolated conjunctions ('and'/'et')
  const rawTokens = cleanClause
    .replace(/\b(?:and|et)\b/gi, ' , ')
    .split(/[,;\s]+/)
    .map((t) => t.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''))
    .filter((t) => t.length >= 2 && t.length <= 32);

  const targetName = v.name.trim().toUpperCase();
  const sourceVarNames = new Set<string>();

  for (const token of rawTokens) {
    if (token === targetName) continue; // No self-derivation
    if (STOPWORDS.has(token)) continue;

    // Check if token looks like a StatCan variable identifier:
    // e.g. DHH_AGE, GEN_01, HWTDHTM, WHC_03, GEODPC, INC_D05, STATHO2, PR5, INTERNAL_FILE_VAR
    if (/^[A-Z][A-Z0-9_]{1,31}$/.test(token) && !/^\d+$/.test(token)) {
      sourceVarNames.add(token);
    }
  }

  if (sourceVarNames.size === 0) return null;

  const namesList = [...sourceVarNames];
  let sourceRecordIds: string[] | undefined;
  let unresolvedVarNames: string[] | undefined;

  if (cycleVarIndex) {
    sourceRecordIds = [];
    unresolvedVarNames = [];
    for (const name of namesList) {
      const recordId = cycleVarIndex.get(name);
      if (recordId) {
        sourceRecordIds.push(recordId);
      } else {
        unresolvedVarNames.push(name);
      }
    }
  }

  return {
    targetRecordId: v.recordId,
    targetVarName: targetName,
    cycle: v.source.cycle ?? String(v.source.year ?? 'unknown'),
    sourceVarNames: namesList,
    sourceRecordIds,
    unresolvedVarNames,
    rawEvidence: rawClause.slice(0, 150),
    confidence: 0.90,
  };
}
