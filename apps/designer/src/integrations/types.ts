/**
 * Integration boundary (the spec's data-flow diagram). These interfaces decouple survey content
 * from operational systems; iteration 1 ships in-memory/local mocks (`./mocks.ts`) so a real
 * backend can be dropped in later without touching the schema, engine or UI.
 */

export interface SampleUnit {
  /** Sample unit identifier (case id). */
  id: string;
  /** Contact info + auxiliary pre-fill fields, e.g. `contact_name`, `region_code`, `email`. */
  fields: Record<string, unknown>;
}

/** Ingests the sample file (contact info + pre-fills). */
export interface SampleProvider {
  list(): Promise<SampleUnit[]>;
  get(id: string): Promise<SampleUnit | undefined>;
}

/** Collection Management System interface: case assignment + status round-trip. */
export interface CmsClient {
  /** Exchange a respondent access code for a case and its pre-fill context. */
  resolveAccessCode(accessCode: string): Promise<{ caseId: string; sample: SampleUnit } | null>;
  /** Push a status/mode change back to the CMS. */
  reportStatus(caseId: string, status: string): Promise<void>;
}

export interface ParadataEvent {
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
}

/** Collection paradata sink (audit trail of respondent behaviour). */
export interface ParadataSink {
  emit(event: ParadataEvent): void;
  flush(): Promise<void>;
  /** Snapshot of buffered events (for the demo analytics view). */
  buffer(): ParadataEvent[];
}

/** Encrypted, resumable session-state cache (guards against mobile network drop-outs). */
export interface SessionStore {
  save(key: string, state: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  clear(key: string): Promise<void>;
}
