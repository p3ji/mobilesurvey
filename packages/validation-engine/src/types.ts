/**
 * Core data model for the Validator. See `docs/validator-plan.md` for the full design and
 * rationale; this file is the TypeScript source of truth for §4 of that document.
 */

export type CheckKind =
  | 'metadata' // L1, generated from instrument
  | 'instrument-edit' // L2, re-run of a collection-time edit
  | 'rule' // L2, validator-authored expression rule
  | 'stat' // L3, statistical (outlier, duplicate, missingness, paradata)
  | 'confront' // L4, reference-dataset comparison (V2)
  | 'llm'; // L5, LLM-drafted suspicion (V3, always severity 'query')

/**
 * Maps 1:1 to the platform's hard/soft edit vocabulary. 'fatal' = cannot publish/export the
 * record unresolved; 'query' = needs review. Same vocabulary end-to-end on purpose — one
 * severity model for collection-time edits and post-collection flags.
 */
export type Severity = 'fatal' | 'query';

/** A single flagged issue on a response, produced by a validation run. */
export interface ValidationFlag {
  id: string;
  runId: string;
  responseId: string;
  respondentId: string;
  /** null = record-level flag (e.g. duplicate, speeder), not attached to one variable. */
  variableName: string | null;
  /** Exact `answersJson` key (`name@` or `name@i=2` inside rosters) when cell-level. */
  instanceKey: string | null;
  checkKind: CheckKind;
  /** Stable id for the check that fired, e.g. 'range:revGross', 'edit.funds.balance', 'mad:RD_TOT_TOT'. */
  checkId: string;
  severity: Severity;
  message: string;
  /** Value snapshot at flag time — survives later correction so the flag stays legible. */
  observed: unknown;
  expected?: string;
  /** 0..1 — how anomalous, per the check's own heuristic. */
  suspicion: number;
  /** 0..1 — how much this value matters (share of a variable's total, etc). */
  impact: number;
  /** suspicion * impact — the queue sort key. */
  score: number;
}

export type DispositionAction =
  | 'accept' // value is correct as reported; suppresses this checkId+instanceKey pair
  | 'correct' // analyst supplies a new value -> corrections overlay
  | 'follow-up' // route to recontact; flag stays open
  | 'suppress'; // check is wrong/noisy here; suppress + feed rule calibration

export interface Disposition {
  flagId: string;
  action: DispositionAction;
  /** Free text, REQUIRED — the raw material for rule elicitation and LLM grounding (V3). */
  reason: string;
  correctedValue?: unknown;
  decidedBy: string;
  decidedAt: string;
}

export interface ValidatorRule {
  id: string;
  surveyId: string;
  name: string;
  /** expression-engine source; TRUE means the flag fires. */
  when: string;
  message: string;
  severity: Severity;
  variableName: string | null;
  /** Provenance — display + trust signal. */
  source: 'authored' | 'elicited' | 'llm';
  /** For 'elicited': the disposition that spawned it. */
  sourceFlagId?: string;
  /** Rules are deactivated, never deleted (audit). */
  active: boolean;
  createdAt: string;
}

export interface VariableAnnotation {
  surveyId: string;
  variableName: string;
  note: string;
  author: string;
  updatedAt: string;
}

/** A correction to a single stored cell. Raw responses are never mutated; see applyCorrections. */
export interface Correction {
  id: string;
  surveyId: string;
  responseId: string;
  instanceKey: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  flagId?: string;
  decidedBy: string;
  decidedAt: string;
}

/** Suppression memory: an accepted flag must not resurrect on the next run unless the value changed. */
export interface Suppression {
  surveyId: string;
  responseId: string;
  checkId: string;
  instanceKey: string | null;
  acceptedValue: unknown;
  flagId: string;
}

/** One response row as fed into the engine — a subset of the hub's ResponseRow shape. */
export interface ValidatorResponse {
  id: string;
  respondentId: string;
  submittedAt: string;
  durationMs: number | null;
  completed: boolean;
  answers: Record<string, unknown>;
}

/** One paradata event as fed into the engine — a subset of the hub's SurveyParadataRow shape. */
export interface ValidatorParadataEvent {
  respondentId: string | null;
  sessionKey: string | null;
  ts: string;
  type: string;
  payload: unknown;
}

export interface CheckConfig {
  metadata: boolean;
  instrumentEdits: boolean;
  rules: boolean;
  stats: boolean;
  /** MAD modified z-score threshold for numeric outliers (default 3.5). */
  outlierThreshold: number;
  /** Minimum observed (non-blank) values before a variable's outlier check runs (default 8). */
  outlierMinObservations: number;
  /** Speeder threshold in ms; a completed response faster than this is flagged (default 60000). */
  speederMs: number;
}

export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  metadata: true,
  instrumentEdits: true,
  rules: true,
  stats: true,
  outlierThreshold: 3.5,
  outlierMinObservations: 8,
  speederMs: 60_000,
};

/**
 * A variable with a high item-nonresponse rate. Deliberately NOT a `ValidationFlag` — it
 * describes a column across the whole dataset, not one respondent's record, so it doesn't fit
 * the per-response flag shape. A 40%-blank variable is a collection-design problem, not 40
 * individual record problems; surfacing it once in the run summary keeps the flag queue clean.
 */
export interface MissingnessEntry {
  variableName: string;
  observedRate: number;
  totalResponses: number;
}

export interface RunSummary {
  responsesAnalyzed: number;
  flagCount: number;
  fatalCount: number;
  queryCount: number;
  byCheckKind: Record<CheckKind, number>;
  /** Checks that were skipped and why (e.g. "too few observations") — no silent truncation. */
  skipped: { checkId: string; reason: string }[];
  missingness: MissingnessEntry[];
}

export interface ValidationRun {
  id: string;
  surveyId: string;
  startedAt: string;
  config: CheckConfig;
  summary: RunSummary;
}

export interface RunResult {
  run: ValidationRun;
  flags: ValidationFlag[];
}

/**
 * What an individual check module produces: everything about a flag except the fields that can
 * only be computed once the whole batch is known (`id`, `runId` — assigned by the orchestrator;
 * `impact`, `score` — computed by `score.ts` against the full response set).
 */
export type DraftFlag = Omit<ValidationFlag, 'id' | 'runId' | 'score' | 'impact'>;
