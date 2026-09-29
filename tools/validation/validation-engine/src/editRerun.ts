/**
 * Level 2 (Eurostat) — re-runs the instrument's authored collection-time edits (hard/soft,
 * including `required`) over a single stored response via the exact same
 * `flattenInstrument()` / `evalEdits()` path the live runtime uses. This gives the Validator
 * byte-identical edit semantics with zero reimplementation — see docs/validator-plan.md §5.2.
 *
 * This is also why the grid/markAll `firedEdits: []` bug (fixed in runtime-engine just before
 * this package was written) mattered here specifically: without that fix, any hard/soft edit
 * authored on a grid or markAll question would have silently never surfaced through this path.
 */
import { flattenInstrument, type RuntimeState } from '@mobilesurvey/runtime-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { baseName } from './keys.js';
import type { DraftFlag, ValidatorResponse } from './types.js';

export function runInstrumentEditRerun(instrument: Instrument, response: ValidatorResponse): DraftFlag[] {
  const state: RuntimeState = { responses: response.answers, sample: {}, language: instrument.defaultLanguage };
  const { items } = flattenInstrument(instrument, state);
  const flags: DraftFlag[] = [];

  for (const item of items) {
    if (item.kind !== 'question' && item.kind !== 'grid' && item.kind !== 'markAll' && item.kind !== 'table') continue;
    if (item.firedEdits.length === 0) continue;

    // question items have one instance key + one value; the compound kinds (grid/markAll/
    // table) fire edits at the whole-question level, so there's no single cell to attach to —
    // group them under the question's variablePrefix instead (also usable as an annotation key).
    const variableName = item.kind === 'question' ? baseName(item.instanceKey) : item.variablePrefix;
    const instanceKeyForItem = item.kind === 'question' ? item.instanceKey : null;
    const observed = item.kind === 'question' ? item.value : undefined;

    for (const edit of item.firedEdits) {
      flags.push({
        responseId: response.id,
        respondentId: response.respondentId,
        variableName,
        instanceKey: instanceKeyForItem,
        checkKind: 'instrument-edit',
        checkId: edit.id === '__required__' ? `required:${variableName}` : edit.id,
        severity: edit.type === 'hard' ? 'fatal' : 'query',
        message: edit.message,
        observed,
        suspicion: edit.type === 'hard' ? 1.0 : 0.6,
      });
    }
  }
  return flags;
}
