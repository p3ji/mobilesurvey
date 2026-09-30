/**
 * Variable Role Classifier
 *
 * Implements rule-based classification of StatCan dictionary variables into the 4 standard GSIM roles:
 * - `collected`: Direct question answered by respondent
 * - `derived`: Computed, recoded, or synthesized variable
 * - `process`: Operational paradata, sampling weights, inclusion flags, identifiers
 * - `administrative`: Data linked from external administrative sources
 */

import type { CorpusVariable } from '../types.js';
import type { DerivationStatus, RoleEvidence, VariableOrigin, VariableRole } from './types.js';

const WEIGHT_NAME_REGEX = /^(WTS?_|WTM_|WT_|WGHT|BOOT|BSW|FWT|REPWT|FWEIGHT|HWEIGHT|WT[0-9]+|WTBS|WTPS|WVCBS|SPFWT|BWT)/i;
const WEIGHT_CONCEPT_REGEX = /\b(sampling weight|sample weight|bootstrap|poids [eé]chantillon|share weight|master weight|survey weight|final weight|replicate weights?|poids r[eé]plique)\b/i;

export const BOOTSTRAP_WEIGHT_REGEX = /^(WTPS_?[0-9]+|WTBS_?[0-9]+|BSW_?[0-9]+|WVCBS_?[0-9]+|REPWT_?[0-9]+|SPFWT[0-9]+|BWT_?[0-9]+)$/i;
export const BOOTSTRAP_CONCEPT_REGEX = /\b(bootstrap|pond[eé]ration bootstrap|poids bootstrap|replicate weights?|poids r[eé]plique)\b/i;

/** Returns true if a variable is a replicate bootstrap weight (e.g. WTPS_0001, WTBS_001, BSW_001). */
export function isBootstrapWeight(name: string, concept?: string): boolean {
  if (BOOTSTRAP_WEIGHT_REGEX.test(name.trim())) return true;
  if (concept && BOOTSTRAP_CONCEPT_REGEX.test(concept)) return true;
  return false;
}
const SYSTEM_ID_REGEX = /^(SAMPLEID|PERSONID|MASTERID|HHID|RECID|VERDATE|REFPER|RECORDID|CASEID|USERID|FORMID|PUMFID|BATCHID|STRAT|FRAME|SEQNUM|IDENT)/i;
const PARADATA_NAME_REGEX = /^(ADM_|SAM_|INT_|COL_|MET_|SURV)/i;
const FLAG_CONCEPT_REGEX = /(\s*-\s*\(F\)$|\(F\)$|\binclusion flag\b|\bindicateur\b)/i;
const CCHS_INCLUSION_FLAG_REGEX = /^DO[A-Z]{3}$/i; // e.g. DOHWT, DOCAC, DODHH
const DERIVED_CONCEPT_REGEX = /(\s*-\s*\(D\)$|\(D\)$|\s*-\s*D$|\(derived\)$|\bderived variable\b|\bvariable d[eé]riv[eé]e\b)/i;
/**
 * Concept-text marker for PUMF grouped/collapsed recodes ("… - Grouped", "(G)", "groupée").
 * Exported so the deterministic G-suffix extractor (grouped.ts) shares this exact rule.
 */
export const GROUPED_CONCEPT_REGEX = /(\s*-\s*\(G\)$|\(G\)$|\s*-\s*G$|\bgrouped\b|\bgroup[eé]e?s?\b)/i;
const ADMIN_LINKAGE_REGEX = /\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b/i;

export function classifyVariableRole(v: CorpusVariable): RoleEvidence {
  const name = v.name.trim().toUpperCase();
  const concept = (v.concept ?? '').trim();
  const note = (v.note ?? '').trim();
  const hasQuestionText = Boolean(v.questionText && v.questionText.trim().length > 0);
  const surveyAcronym = (v.source.surveyAcronym ?? '').toUpperCase();

  // --- AXIS 2: COMPUTATION / DERIVATION STATUS ---
  let derivation: DerivationStatus = 'base';
  let isGrouped = false;
  let derivationConfidence = 0.90;
  let derivationRule = '';
  let derivationDetails = '';

  if (GROUPED_CONCEPT_REGEX.test(concept) || /^[A-Z]{2,4}G[A-Z0-9]+$/.test(name)) {
    derivation = 'derived';
    isGrouped = true;
    derivationConfidence = 0.95;
    derivationRule = 'pumf_grouped_variable';
    derivationDetails = `PUMF grouped/collapsed analytical recode: '${concept || name}'`;
  } else if (DERIVED_CONCEPT_REGEX.test(concept)) {
    derivation = 'derived';
    derivationConfidence = 0.99;
    derivationRule = 'statcan_derived_concept_flag';
    derivationDetails = `Concept contains StatCan standard derived marker: '${concept}'`;
  } else if (name.includes('DV') || /^[A-Z]{2,4}D[A-Z0-9]{2,}$/.test(name) || name.endsWith('_DV') || name.endsWith('DV')) {
    derivation = 'derived';
    derivationConfidence = 0.95;
    derivationRule = 'statcan_derived_name_convention';
    derivationDetails = `Variable name '${name}' contains standard 'DV' derived abbreviation`;
  } else if (/^(based on|derived from|calcul[eé]|selon|compos[eé])/i.test(note) || /see documentation on derived variables/i.test(note)) {
    derivation = 'derived';
    derivationConfidence = 0.92;
    derivationRule = 'derived_note_evidence';
    derivationDetails = `Note contains explicit derivation instructions`;
  }

  // --- AXIS 1: DATA ORIGIN / SOURCE PROVENANCE ---
  let origin: VariableOrigin = 'collected';
  let isIdentifier = false;
  let originRule = '';
  let originDetails = '';
  let confidence = 0.85;

  // 1. Process / Paradata / System Identifiers / Weights
  if (SYSTEM_ID_REGEX.test(name)) {
    origin = 'process';
    isIdentifier = true;
    confidence = 0.99;
    originRule = 'system_identifier_name';
    originDetails = `Unit identifier matching standard survey key: '${name}'`;
  } else if (WEIGHT_NAME_REGEX.test(name) || WEIGHT_CONCEPT_REGEX.test(concept)) {
    origin = 'process';
    confidence = 0.98;
    originRule = 'sampling_weight';
    originDetails = `Sampling weight or bootstrap replicate: '${name}'`;
  } else if (PARADATA_NAME_REGEX.test(name)) {
    origin = 'process';
    confidence = 0.95;
    originRule = 'interview_paradata_prefix';
    originDetails = `Collection/interview paradata prefix (ADM_, SAM_): '${name}'`;
  } else if (
    FLAG_CONCEPT_REGEX.test(concept) ||
    CCHS_INCLUSION_FLAG_REGEX.test(name) ||
    name.startsWith('DOF') ||
    name.startsWith('FLG_') ||
    name.endsWith('_F')
  ) {
    origin = 'process';
    confidence = 0.95;
    originRule = 'inclusion_or_flow_flag';
    originDetails = `Inclusion/flow operational flag: '${concept || name}'`;
  }

  // 2. Administrative Linkage
  else if (ADMIN_LINKAGE_REGEX.test(concept) || ADMIN_LINKAGE_REGEX.test(note)) {
    origin = 'administrative';
    confidence = 0.92;
    originRule = 'external_admin_linkage';
    originDetails = `Cites external administrative registry or tax linkage`;
  } else if (name.startsWith('GEO') || concept.toLowerCase().includes('province') || concept.toLowerCase().includes('postal code')) {
    origin = 'administrative';
    confidence = 0.85;
    originRule = 'geographic_attribute';
    originDetails = `Geographical coding without explicit survey question`;
  } else if (surveyAcronym === 'CIS' && /^(CF|EF|HH|AT|WT)/.test(name) && /tax|income|market|transfer|pension/i.test(concept)) {
    // CIS is predominantly administrative CRA tax data
    origin = 'administrative';
    confidence = 0.85;
    originRule = 'cis_administrative_tax_file';
    originDetails = `CIS tax/income component linked from CRA administrative records`;
  }

  // 3. Derived Variables (analytical content derived from respondent survey answers)
  else if (derivation === 'derived') {
    origin = 'collected';
    confidence = derivationConfidence;
    originRule = derivationRule;
    originDetails = derivationDetails;
  }

  // 4. Collected (Direct Question or Substantive Measure)
  else if (hasQuestionText) {
    origin = 'collected';
    confidence = 0.95;
    originRule = 'question_text_present';
    originDetails = `Has direct questionnaire wording: '${v.questionText?.slice(0, 60)}...'`;
  } else if (/^[A-Z]{2,6}_[0-9A-Z]{1,6}$/.test(name) || /^[A-Z]{2,6}_(SEX|AGE|MS|PRV|Q[0-9]+)$/.test(name)) {
    origin = 'collected';
    confidence = 0.88;
    originRule = 'question_item_naming_convention';
    originDetails = `Variable name '${name}' follows question item numbering convention`;
  } else if (v.codes.length > 0) {
    origin = 'collected';
    confidence = 0.75;
    originRule = 'has_code_categories_default';
    originDetails = `Analytical variable with categorical response options`;
  } else if (v.length !== undefined && v.length.trim().length > 0 && concept.length > 0) {
    // Continuous quantitative variable without discrete codebook categories (e.g. income in $, height in cm)
    origin = 'collected';
    confidence = 0.65;
    originRule = 'continuous_collected_measure';
    originDetails = `Continuous analytical variable with quantitative format: '${concept}'`;
  } else {
    origin = 'process';
    confidence = 0.50;
    originRule = 'unknown_default_process';
    originDetails = `No question text, no categories, and no analytical concept`;
  }

  // --- COMPOSITE LEGACY ROLE (backwards compatibility) ---
  let role: VariableRole = 'collected';
  if (
    isIdentifier ||
    originRule === 'sampling_weight' ||
    originRule === 'interview_paradata_prefix' ||
    originRule === 'inclusion_or_flow_flag' ||
    originRule === 'unknown_default_process'
  ) {
    role = 'process';
  } else if (derivation === 'derived') {
    role = 'derived';
  } else if (origin === 'administrative') {
    role = 'administrative';
  } else {
    role = 'collected';
  }

  const primaryRule = derivation === 'derived' && origin === 'collected' ? derivationRule : (originRule || derivationRule);
  const primaryDetails = [originDetails, derivationDetails].filter(Boolean).join('; ');

  return {
    role,
    origin,
    derivation,
    isIdentifier: isIdentifier || undefined,
    isGrouped: isGrouped || undefined,
    confidence,
    rule: primaryRule,
    details: primaryDetails,
  };
}
