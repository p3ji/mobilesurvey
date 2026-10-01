/**
 * Browser-safe Knowledge Graph & GSIM classifier for Searcher hits.
 * Aligned with UNECE / Statistics Canada GSIM 2D taxonomy and W3C PROV-O.
 */
import type { CorpusMeta } from '@mobilesurvey/metadata-registry';

export type VariableOrigin = 'collected' | 'administrative' | 'process';
export type DerivationStatus = 'base' | 'derived';
export type VariableRole = 'collected' | 'derived' | 'process' | 'administrative';

export interface ClassifiedHit {
  origin: VariableOrigin;
  derivation: DerivationStatus;
  role: VariableRole;
  isGrouped: boolean;
  isIdentifier: boolean;
  derivedInputs: string[];
}

const WEIGHT_NAME_REGEX = /^(WTS?_|WTM_|WT_|WGHT|BOOT|BSW|FWT|REPWT|FWEIGHT|HWEIGHT|WT[0-9]+|WTBS|WTPS|WVCBS|SPFWT|BWT|SAMPLEID|PERSONID|MASTERID|HHID|RECID|VERDATE|REFPER|RECORDID|CASEID|USERID|FORMID|PUMFID|BATCHID|STRAT|FRAME|SEQNUM|IDENT|DO[A-Z]{3}|ADM_|SAM_|INT_|COL_|MET_|SURV|DOF|FLG_|FLAG_|IF_|IMP_|QFLG_|I[0-9]{4,})/i;
const WEIGHT_CONCEPT_REGEX = /(?:[-–—]\s*\(F\)$|\(F\)$|\b(?:sampling weight|sample weight|bootstrap|poids [eé]chantillon|share weight|master weight|survey weight|final weight|replicate weights?|poids r[eé]plique|inclusion flag|imputation flag|imputation|allocation flag|quality flag|data quality flag|status flag|edit flag|indicateur d[''’]imputation|drapeau d[''’]imputation|indicateur)\b|^imputation\b)/i;
const SYSTEM_ID_REGEX = /^(SAMPLEID|PERSONID|MASTERID|HHID|RECID|VERDATE|REFPER|RECORDID|CASEID|USERID|FORMID|PUMFID|BATCHID|STRAT|FRAME|SEQNUM|IDENT)/i;
const CCHS_INCLUSION_FLAG_REGEX = /^DO[A-Z]{3}$/i;
const DERIVED_CONCEPT_REGEX = /(\s*-\s*\(D\)$|\(D\)$|\s*-\s*D$|\(derived\)$|\bderived variable\b|\bvariable d[eé]riv[eé]e\b)/i;
const GROUPED_CONCEPT_REGEX = /(\s*-\s*\(G\)$|\(G\)$|\s*-\s*G$|\bgrouped\b|\bgroup[eé]e?s?\b)/i;
const ADMIN_LINKAGE_REGEX = /\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b/i;
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

export function extractLineageFromNote(note?: string): string[] {
  if (!note) return [];
  const match = note.match(DERIVATION_LEAD_REGEX);
  if (!match || !match[1]) return [];

  const rawClause = match[1].trim();
  const cleanClause = rawClause.replace(/[()]/g, ' ');
  const rawTokens = cleanClause
    .replace(/\b(?:and|et)\b/gi, ' ')
    .split(/[,;\s]+/)
    .map((t) => t.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter((t) => t.length > 0);

  const found: string[] = [];
  for (const token of rawTokens) {
    const upper = token.toUpperCase();
    if (/^[A-Z][A-Z0-9_]{1,31}$/.test(upper) && !STOPWORDS.has(upper)) {
      if (!found.includes(upper)) found.push(upper);
    }
  }
  return found;
}

export function classifyHit(meta: CorpusMeta, label?: string): ClassifiedHit {
  const name = meta.variableName.trim().toUpperCase();
  const concept = (label ?? '').trim();
  const note = (meta.note ?? '').trim();
  const surveyGroup = (meta.surveyGroup ?? '').toUpperCase();

  const isIdentifier = SYSTEM_ID_REGEX.test(name);
  const isPumfGrouped = GROUPED_CONCEPT_REGEX.test(concept) || /^[A-Z]{2,4}G[A-Z0-9]+$/.test(name);
  const derivedInputs = extractLineageFromNote(note);

  // 1. Origin classification
  let origin: VariableOrigin = 'collected';
  if (
    WEIGHT_NAME_REGEX.test(name) ||
    WEIGHT_CONCEPT_REGEX.test(concept) ||
    CCHS_INCLUSION_FLAG_REGEX.test(name) ||
    name.endsWith('_F') ||
    name.endsWith('_FLG') ||
    /\b(imputation flag|indicateur d[''’]imputation)\b/i.test(note) ||
    isIdentifier
  ) {
    origin = 'process';
  } else if (
    ADMIN_LINKAGE_REGEX.test(concept) ||
    ADMIN_LINKAGE_REGEX.test(note) ||
    surveyGroup.includes('VITAL') ||
    surveyGroup.includes('TAX') ||
    surveyGroup.includes('T1FF')
  ) {
    origin = 'administrative';
  }

  // 2. Derivation classification
  let derivation: DerivationStatus = 'base';
  if (
    DERIVED_CONCEPT_REGEX.test(concept) ||
    isPumfGrouped ||
    derivedInputs.length > 0 ||
    /^(?:DV_|D[A-Z]{2,4}[0-9]|DV[A-Z])/.test(name)
  ) {
    derivation = 'derived';
  }

  // 3. Composite legacy role projection
  let role: VariableRole = 'collected';
  if (origin === 'process') {
    role = 'process';
  } else if (derivation === 'derived') {
    role = 'derived';
  } else if (origin === 'administrative') {
    role = 'administrative';
  }

  return {
    origin,
    derivation,
    role,
    isGrouped: isPumfGrouped,
    isIdentifier,
    derivedInputs,
  };
}
