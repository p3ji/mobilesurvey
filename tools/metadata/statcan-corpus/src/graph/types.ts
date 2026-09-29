/**
 * Knowledge Graph Ontology & Types
 *
 * Aligned with:
 * - UNECE / Statistics Canada GSIM (Generic Statistical Information Model)
 * - DDI-Lifecycle 3.3 (Variable Cascade & Schemes)
 * - DDI-RDF Discovery Vocabulary (disco)
 * - W3C PROV-O (Provenance Ontology)
 */

/**
 * Variable Roles as formalized by GSIM (UNECE/StatCan):
 * - `collected`: Direct question asked of the respondent (has questionnaire wording).
 * - `derived`: Calculated/recoded variable (indices, scales, groupings, e.g. BMI).
 * - `process`: Operational/paradata/sampling variable (survey weights, mode, flags).
 * - `administrative`: Data integrated from external registers/files (tax, health records, geography).
 */
export type VariableRole = 'collected' | 'derived' | 'process' | 'administrative';

/** GSIM Axis 1: Data Origin / Source Provenance */
export type VariableOrigin = 'collected' | 'administrative' | 'process';

/** GSIM Axis 2: Computation / Derivation Status */
export type DerivationStatus = 'base' | 'derived';

export interface RoleEvidence {
  /** Legacy 1D projection for backwards compatibility */
  role: VariableRole;
  /** GSIM Axis 1: Source provenance of the underlying data */
  origin: VariableOrigin;
  /** GSIM Axis 2: Transformation status */
  derivation: DerivationStatus;
  /** True if this is a primary unit identifier (e.g. SAMPLEID, PERSONID, HHID) */
  isIdentifier?: boolean;
  /** True if this is a PUMF collapsed/grouped analytical recode (marked with - (G) or (G)) */
  isGrouped?: boolean;
  confidence: number; // 0.0 to 1.0
  rule: string;
  details?: string;
}

export type ModuleKind = 
  | 'harmonized_core' 
  | 'rotating_thematic' 
  | 'process_system' 
  | 'administrative'
  | 'statistical_unit';

export type UnitOfAnalysis = 'person' | 'census_family' | 'economic_family' | 'household';

export interface ContentModule {
  id: string;
  code: string;
  label: string;
  kind: ModuleKind;
  unitOfAnalysis?: UnitOfAnalysis;
}

export interface DerivationLineage {
  targetRecordId: string;
  targetVarName: string;
  cycle: string;
  sourceVarNames: string[];
  /** Resolved record IDs in the local cycle when available */
  sourceRecordIds?: string[];
  /** Names that could not be grounded in the local cycle (e.g. internal master files) */
  unresolvedVarNames?: string[];
  rawEvidence: string;
  confidence: number;
}

export type GraphNodeType = 
  | 'StudyGroup'          // disco:StudyGroup / DDI s:Series (e.g. CCHS, LFS)
  | 'Study'               // disco:Study / DDI s:StudyUnit (e.g. CCHS 2015)
  | 'ContentModule'       // disco:Questionnaire / Sequence / GSIM QuestionModule
  | 'Variable'            // disco:Variable / DDI l:Variable (occurrence)
  | 'RepresentedVariable' // DDI l:RepresentedVariable (conceptual variable + representation)
  | 'ConceptualVariable'  // DDI l:ConceptualVariable (concept + universe)
  | 'Concept';            // skos:Concept / DDI c:Concept (unit of meaning)

export type GraphEdgeType =
  | 'hasCycle'          // StudyGroup -> Study
  | 'includesModule'    // Study -> ContentModule
  | 'containsVariable'  // ContentModule -> Variable
  | 'wasDerivedFrom'    // Variable (derived) -> Variable (source) (W3C PROV-O)
  | 'instanceOf'        // Variable -> RepresentedVariable (DDI Cascade)
  | 'represents'        // RepresentedVariable -> ConceptualVariable (DDI Cascade)
  | 'measuresConcept'   // ConceptualVariable or Variable -> Concept (DDI Cascade)
  | 'hadPrimarySource'  // Variable -> Administrative Source (W3C PROV-O)
  | 'harmonizedWith';   // Cross-cycle harmonization link

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  properties?: Record<string, unknown>;
}

export interface PilotStats {
  totalVariables: number;
  byRole: Record<VariableRole, number>;
  byOrigin?: Record<VariableOrigin, number>;
  byDerivation?: Record<DerivationStatus, number>;
  byCycle: Record<string, number>;
  modulesFound: number;
  derivationsExtracted: number;
  cyclesList: string[];
}
