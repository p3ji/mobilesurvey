/**
 * Level 2 (Eurostat) — evaluates validator-authored rules (`ValidatorRule`) against a stored
 * response, using the same expression grammar and root-scope resolution as the runtime engine
 * (`makeContext`), so a rule can reference top-level variables and synthetic table totals, e.g.
 * `isAnswered($RD_TOT_TOT) && $RD_TOT_TOT > 10 * $deptBudget`.
 *
 * V1 limitation (documented in docs/validator-plan.md §5.2): rules are evaluated at the ROOT
 * scope only. A rule referencing a variable that lives inside a roster will see that variable
 * unresolved (its root-scope instance key, `{name}@`, doesn't exist in a rostered response), so
 * the rule simply won't fire for rostered data. Deferred to V2 (per-scope rule evaluation).
 * Establishment-survey rules — this platform's primary Validator use case — overwhelmingly
 * target top-level and table variables, so this is an acceptable v1 gap, not a silent one.
 */
import { buildSyntheticTotals, instanceKey, makeContext } from '@mobilesurvey/runtime-engine';
import { evaluateSource } from '@mobilesurvey/expression-engine';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import type { DraftFlag, ValidatorResponse, ValidatorRule } from './types.js';

export function runValidatorRules(
  instrument: Instrument,
  response: ValidatorResponse,
  rules: ValidatorRule[],
): DraftFlag[] {
  const synthetic = buildSyntheticTotals(instrument);
  const ctx = makeContext(instrument, response.answers, {}, [], synthetic);
  const flags: DraftFlag[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;
    let fired: boolean;
    try {
      fired = Boolean(evaluateSource(rule.when, ctx));
    } catch {
      // A malformed rule is the rule author's problem (surfaced at save-time via compile() in
      // the rule editor), not a data problem for this response -- skip rather than flag.
      continue;
    }
    if (!fired) continue;

    const iKey = rule.variableName ? instanceKey(rule.variableName, []) : null;
    flags.push({
      responseId: response.id,
      respondentId: response.respondentId,
      variableName: rule.variableName,
      instanceKey: iKey,
      checkKind: 'rule',
      checkId: rule.id,
      severity: rule.severity,
      message: rule.message,
      observed: iKey ? response.answers[iKey] : undefined,
      suspicion: rule.severity === 'fatal' ? 1.0 : 0.6,
    });
  }
  return flags;
}
