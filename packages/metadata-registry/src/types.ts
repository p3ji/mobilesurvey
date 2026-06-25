/**
 * Metadata-registry entry model. Each reusable component of an instrument — the whole instrument
 * down to a single code list — becomes a `RegistryEntry`. Fields are grouped into DDI-aligned
 * metadata (captured as available), registry/discovery metadata (non-DDI), and EQ-specific
 * metadata (non-DDI). See docs/phase4-metadata-registry.md.
 */
import type { InternationalString } from '@mobilesurvey/instrument-schema';

export type ComponentType =
  | 'instrument'
  | 'section'
  | 'page'
  | 'question'
  | 'variable'
  | 'codeList';

/** DDI-aligned metadata; only what the source provides is populated. */
export interface DdiMeta {
  urn?: string;
  agency?: string;
  version?: string;
  label?: InternationalString;
  description?: InternationalString;
  conceptRef?: string;
  universeRef?: string;
  keywords?: string[];
  /** e.g. 'QuestionItem', 'CodeList', 'Variable'. */
  ddiElementType?: string;
}

/** Registry / discovery metadata (non-DDI). */
export interface RegistryMeta {
  tags: string[];
  /** URN/id of the instrument this component was lifted from. */
  provenance?: string;
  /** How many constructs reference this component (e.g. questions using a code list). */
  usageCount: number;
  license?: string;
  usageRights?: string;
  deprecated?: boolean;
  /** ISO timestamp. */
  lastUpdated: string;
  /**
   * Quantized embedding vector for semantic search. Absent until the (future) embedding indexer
   * runs; the lexical search works without it.
   */
  embedding?: number[];
}

/** Electronic-questionnaire-specific metadata (non-DDI). */
export interface EqMeta {
  /** DDI control constructs route between constructs; an EQ routes between page screens. */
  flowTarget: 'question' | 'screen';
  deviceHints?: string[];
}

export interface RegistryEntry {
  /** Registry-local id (stable for a given source component). */
  entryId: string;
  componentType: ComponentType;
  /** The actual DDI fragment (an Instrument, a QuestionConstruct, a CategoryScheme, a Variable…). */
  payload: unknown;
  /** Plain-text used for search/embedding (label + description + keywords + tags, flattened). */
  searchText: string;
  ddi: DdiMeta;
  registry: RegistryMeta;
  eq?: EqMeta;
}

/** A scored search result. */
export interface SearchHit {
  entry: RegistryEntry;
  /** 0..1 relevance score. */
  score: number;
  /** Why it matched (matched query terms), for UI explanation. */
  matched: string[];
}
