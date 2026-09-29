/**
 * Level 5 (V3) — mechanical (non-LLM) rule elicitation from a disposition. See
 * docs/validator-plan.md §8.2. The draft is deliberately a narrow starting point, not a
 * generalized inference: without natural-language understanding of the disposition's free-text
 * `reason`, the honest thing to draft is either (a) the real authored expression the analyst can
 * narrow, when one exists, or (b) the narrowest possible condition (this exact value), which the
 * analyst is expected to broaden before saving. This is what makes elicitation trustworthy
 * without pretending to understand *why* the analyst made the call.
 */
import type { EditRule, Instrument } from '@mobilesurvey/instrument-schema';
import { walkQuestions } from './walkQuestions.js';
import type { Disposition, Severity, ValidationFlag } from './types.js';

export interface RuleDraft {
  when: string;
  message: string;
  severity: Severity;
  variableName: string;
  /** Explains where the draft came from and what the analyst should do with it. */
  hint: string;
}

function findEditRuleById(instrument: Instrument, editId: string): EditRule | undefined {
  let found: EditRule | undefined;
  walkQuestions(instrument, (q) => {
    if (found) return;
    found = q.edits?.find((e) => e.id === editId);
  });
  return found;
}

/**
 * Drafts a rule to generalize a disposition, or returns null when there's nothing sensible to
 * draft (record-level flags like duplicates/speeders have no single variable; follow-up/suppress
 * dispositions aren't a "this is fine" or "this was wrong" judgment about the value itself).
 */
export function draftRuleFromDisposition(
  flag: ValidationFlag,
  disposition: Disposition,
  instrument: Instrument,
): RuleDraft | null {
  if (disposition.action !== 'accept' && disposition.action !== 'correct') return null;
  if (flag.variableName === null) return null;

  if (flag.checkKind === 'instrument-edit' && !flag.checkId.startsWith('required:')) {
    const original = findEditRuleById(instrument, flag.checkId);
    if (original) {
      const originalMessage = original.message[instrument.defaultLanguage] ?? flag.message;
      return {
        when: original.when,
        message: disposition.action === 'accept'
          ? `${originalMessage} (narrowed after accepting a similar case: "${disposition.reason}")`
          : originalMessage,
        severity: flag.severity,
        variableName: flag.variableName,
        hint: `Started from the authored edit "${flag.checkId}". Narrow this condition (e.g. add "&& !(...)") so it stops firing for cases like this one, then save as a new rule.`,
      };
    }
  }

  const literal = typeof flag.observed === 'string' ? `'${flag.observed.replace(/'/g, "\\'")}'` : JSON.stringify(flag.observed);
  return {
    when: `$${flag.variableName} == ${literal}`,
    message: flag.message,
    severity: flag.severity,
    variableName: flag.variableName,
    hint: 'This is the narrowest possible starting point (an exact-value match) — there is no authored expression to start from for this check kind. Broaden the condition to cover the general case before saving.',
  };
}
