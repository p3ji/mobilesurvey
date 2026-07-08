/**
 * Orchestrates a full validation run over a dataset. Two-phase by nature: L1/L2 checks are
 * per-record (streamable), L3 stat checks need the whole column/dataset. Both phases are
 * synchronous pure functions over in-memory arrays — no IO happens in this package; callers
 * (the hub's `validatorApi.ts`) own fetching responses and persisting the result.
 *
 * IMPORTANT: pass the "edited view" (raw responses with `applyCorrections` already applied) as
 * `responses`, not raw responses directly — otherwise corrected values keep re-flagging on every
 * run. See docs/validator-plan.md §6.3 and `corrections.ts`.
 */
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { buildFieldRegistry, runMetadataChecks } from './metadataChecks.js';
import { runInstrumentEditRerun } from './editRerun.js';
import { runValidatorRules } from './ruleRunner.js';
import { runConfrontationChecks } from './confront.js';
import {
  computeMissingness,
  runDuplicateChecks,
  runOutlierChecks,
  runSpeederChecks,
  runStraightLineChecks,
} from './statChecks.js';
import { finalizeFlags } from './score.js';
import {
  DEFAULT_CHECK_CONFIG,
  type CheckConfig,
  type CheckKind,
  type ConfrontationGap,
  type ConfrontationMapping,
  type DraftFlag,
  type ReferenceDataset,
  type RunResult,
  type RunSummary,
  type Suppression,
  type ValidatorParadataEvent,
  type ValidatorResponse,
  type ValidatorRule,
} from './types.js';

export interface RunValidationInput {
  runId: string;
  surveyId: string;
  startedAt: string;
  instrument: Instrument;
  /** The edited view (raw + corrections applied) — see the module docstring. */
  responses: ValidatorResponse[];
  /** Reserved for paradata-driven checks beyond duration_ms (not yet used in V1). */
  paradata?: ValidatorParadataEvent[];
  rules?: ValidatorRule[];
  suppressions?: Suppression[];
  /** V2: each entry confronts `responses` against one uploaded reference dataset. */
  referenceDatasets?: { dataset: ReferenceDataset; mappings: ConfrontationMapping[] }[];
  config?: Partial<CheckConfig>;
}

const EMPTY_BY_CHECK_KIND: Record<CheckKind, number> = {
  metadata: 0,
  'instrument-edit': 0,
  rule: 0,
  stat: 0,
  confront: 0,
  llm: 0,
};

export function runValidation(input: RunValidationInput): RunResult {
  const config: CheckConfig = { ...DEFAULT_CHECK_CONFIG, ...input.config };
  const { instrument, responses } = input;
  const rules = input.rules ?? [];
  const suppressions = input.suppressions ?? [];
  const skipped: { checkId: string; reason: string }[] = [];
  const draft: DraftFlag[] = [];

  if (config.metadata) {
    const registry = buildFieldRegistry(instrument);
    for (const r of responses) draft.push(...runMetadataChecks(instrument, r, registry));
  }
  if (config.instrumentEdits) {
    for (const r of responses) draft.push(...runInstrumentEditRerun(instrument, r));
  }
  if (config.rules && rules.length > 0) {
    for (const r of responses) draft.push(...runValidatorRules(instrument, r, rules));
  }
  if (config.stats) {
    const outliers = runOutlierChecks(responses, config.outlierThreshold, config.outlierMinObservations);
    draft.push(...outliers.flags);
    skipped.push(...outliers.skipped);

    draft.push(...runDuplicateChecks(responses));

    const speeders = runSpeederChecks(responses, config.speederMs);
    draft.push(...speeders.flags);
    skipped.push(...speeders.skipped);

    draft.push(...runStraightLineChecks(instrument, responses));
  }

  const confrontationGaps: ConfrontationGap[] = [];
  if (config.confrontation && input.referenceDatasets) {
    for (const { dataset, mappings } of input.referenceDatasets) {
      const result = runConfrontationChecks(instrument, responses, dataset, mappings);
      draft.push(...result.flags);
      confrontationGaps.push(...result.gaps);
    }
  }

  const flags = finalizeFlags(draft, input.runId, responses, suppressions);
  const missingness = config.stats ? computeMissingness(instrument, responses) : [];

  const byCheckKind: Record<CheckKind, number> = { ...EMPTY_BY_CHECK_KIND };
  let fatalCount = 0;
  let queryCount = 0;
  for (const f of flags) {
    byCheckKind[f.checkKind] += 1;
    if (f.severity === 'fatal') fatalCount += 1;
    else queryCount += 1;
  }

  const summary: RunSummary = {
    responsesAnalyzed: responses.length,
    flagCount: flags.length,
    fatalCount,
    queryCount,
    byCheckKind,
    skipped,
    missingness,
    confrontationGaps,
  };

  return {
    run: { id: input.runId, surveyId: input.surveyId, startedAt: input.startedAt, config, summary },
    flags,
  };
}
