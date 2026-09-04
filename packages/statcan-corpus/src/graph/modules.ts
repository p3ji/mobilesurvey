/**
 * Content Module Extractor & Rotation Mapper
 *
 * Groups variables into standard Content Modules and identifies:
 * - Harmonized Core Content (Sociodemographics: DHH, INC, EDU, LFS, GEO)
 * - Thematic / Rotating Modules (GEN, SMK, ALC, HWT, FSC, etc.)
 * - Operational & System Modules (WTS, SYS)
 */

import type { ContentModule, ModuleKind, UnitOfAnalysis } from './types.js';

interface KnownModuleInfo {
  label: string;
  kind: ModuleKind;
  unitOfAnalysis?: UnitOfAnalysis;
}

const KNOWN_MODULES: Record<string, KnownModuleInfo> = {
  // Harmonized Core Sociodemographics
  DHH: { label: 'Demographics and Household', kind: 'harmonized_core', unitOfAnalysis: 'person' },
  GEO: { label: 'Geography', kind: 'harmonized_core' },
  INC: { label: 'Income', kind: 'harmonized_core' },
  ED:  { label: 'Education', kind: 'harmonized_core' },
  EDU: { label: 'Education', kind: 'harmonized_core' },
  LFS: { label: 'Labour Force Status', kind: 'harmonized_core' },
  IMM: { label: 'Immigration and Citizenship', kind: 'harmonized_core' },
  IND: { label: 'Indigenous Peoples Identity', kind: 'harmonized_core' },
  LANG:{ label: 'Languages', kind: 'harmonized_core' },
  DIS: { label: 'Disability & Activity Limitations', kind: 'harmonized_core' },
  SDC: { label: 'Socio-Demographic Characteristics', kind: 'harmonized_core' },

  // Health Thematic / Rotating Modules (CCHS & related)
  GEN: { label: 'General Health', kind: 'rotating_thematic' },
  SMK: { label: 'Smoking and Tobacco Use', kind: 'rotating_thematic' },
  ALC: { label: 'Alcohol Consumption', kind: 'rotating_thematic' },
  HWT: { label: 'Height and Weight (Self-reported)', kind: 'rotating_thematic' },
  MHW: { label: 'Height and Weight (Measured) / Mental Health', kind: 'rotating_thematic' },
  CCC: { label: 'Chronic Health Conditions', kind: 'rotating_thematic' },
  PAC: { label: 'Physical Activity', kind: 'rotating_thematic' },
  PAA: { label: 'Physical Activities (Adults)', kind: 'rotating_thematic' },
  FV:  { label: 'Fruit and Vegetable Consumption', kind: 'rotating_thematic' },
  FSC: { label: 'Food Security', kind: 'rotating_thematic' },
  INJ: { label: 'Injuries', kind: 'rotating_thematic' },
  HC:  { label: 'Health Care Services & Contact', kind: 'rotating_thematic' },
  ACC: { label: 'Access to Health Care Services', kind: 'rotating_thematic' },
  HMC: { label: 'Home Care Services', kind: 'rotating_thematic' },
  FLU: { label: 'Flu Shot / Immunization', kind: 'rotating_thematic' },
  MED: { label: 'Medication Use', kind: 'rotating_thematic' },
  MEX: { label: 'Medication Use (Prescription & Over-the-Counter)', kind: 'rotating_thematic' },
  DRG: { label: 'Illicit Drug Use', kind: 'rotating_thematic' },
  SPS: { label: 'Social Support', kind: 'rotating_thematic' },
  STR: { label: 'Stress', kind: 'rotating_thematic' },
  SLP: { label: 'Sleep Quality', kind: 'rotating_thematic' },
  ORH: { label: 'Oral Health', kind: 'rotating_thematic' },
  DEN: { label: 'Dental Care', kind: 'rotating_thematic' },
  EYE: { label: 'Eye Examinations / Vision', kind: 'rotating_thematic' },

  // Social Survey Modules (GSS)
  CRG: { label: 'Caregiving and Care Receiving', kind: 'rotating_thematic' },
  VCM: { label: 'Victimization and Safety', kind: 'rotating_thematic' },
  TUS: { label: 'Time Use', kind: 'rotating_thematic' },

  // Income Survey (CIS) Statistical Units of Analysis
  CFC: { label: 'Census Family Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'census_family' },
  EFC: { label: 'Economic Family Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'economic_family' },
  HHC: { label: 'Household Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'household' },
  CFA: { label: 'Census Family Assets and Income', kind: 'statistical_unit', unitOfAnalysis: 'census_family' },
  EFA: { label: 'Economic Family Assets and Income', kind: 'statistical_unit', unitOfAnalysis: 'economic_family' },
  HHA: { label: 'Household Assets and Income', kind: 'statistical_unit', unitOfAnalysis: 'household' },
  CFP: { label: 'Census Family Person Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'census_family' },
  EFP: { label: 'Economic Family Person Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'economic_family' },
  HHP: { label: 'Household Person Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'household' },
  CFO: { label: 'Census Family Other Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'census_family' },
  EFO: { label: 'Economic Family Other Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'economic_family' },
  HHO: { label: 'Household Other Characteristics', kind: 'statistical_unit', unitOfAnalysis: 'household' },

  // Income Low-Income Measures & Subsidies
  LIM:  { label: 'Low Income Measure (LIM) Thresholds', kind: 'harmonized_core' },
  LIMS: { label: 'Low Income Measure Summaries', kind: 'harmonized_core' },
  UCN:  { label: 'Unemployment & Child Benefits', kind: 'harmonized_core' },

  // Operational / Weights / System
  WTS: { label: 'Sampling Weights & Bootstrap Replicates', kind: 'process_system' },
  WTM: { label: 'Master Weights', kind: 'process_system' },
  SYS: { label: 'Survey System & Administration Identifiers', kind: 'process_system' },
  ADM: { label: 'Administrative & Linkage Identifiers', kind: 'administrative' },
};

/**
 * Extracts the 2-4 letter module acronym from a variable name.
 */
export function extractModuleCode(varName: string): string {
  const name = varName.trim().toUpperCase();

  // System IDs
  if (/^(SAMPLEID|PERSONID|VERDATE|REFPER|RECORDID|CASEID|USERID|PUMFID)/.test(name)) {
    return 'SYS';
  }

  // Sampling Weights
  if (/^(WTS|WTM|WT_|WGHT|BOOT|BSW|FWT|REPWT|FWEIGHT|HWEIGHT|WT[0-9]+)/.test(name)) {
    return 'WTS';
  }

  // Name with underscore: PREFIX_... (e.g. DHH_SEX, GEN_01, SMK_020)
  const underscoreIndex = name.indexOf('_');
  if (underscoreIndex >= 2 && underscoreIndex <= 5) {
    return name.slice(0, underscoreIndex);
  }

  // Derived variable conventions:
  // e.g. HWTDVBMI -> HWT, DHHGAGE -> DHH, SMKDSTY -> SMK, GEODPC -> GEO
  const dvMatch = name.match(/^([A-Z]{2,4})(DV|D|G|F)[A-Z0-9]+$/);
  if (dvMatch && dvMatch[1]) {
    return dvMatch[1];
  }

  // Fallback: first 3 characters
  if (name.length >= 3) {
    return name.slice(0, 3);
  }

  return 'OTHER';
}

export function resolveModule(moduleCode: string): ContentModule {
  const code = moduleCode.toUpperCase();
  const known = KNOWN_MODULES[code];
  if (known) {
    return {
      id: `module:${code.toLowerCase()}`,
      code,
      label: known.label,
      kind: known.kind,
      unitOfAnalysis: known.unitOfAnalysis,
    };
  }

  return {
    id: `module:${code.toLowerCase()}`,
    code,
    label: `Module ${code}`,
    kind: 'rotating_thematic',
  };
}
