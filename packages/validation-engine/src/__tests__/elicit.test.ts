import { describe, it, expect } from 'vitest';
import { draftRuleFromDisposition } from '../elicit.js';
import { fixtureInstrument } from './fixtures.js';
import type { Disposition, ValidationFlag } from '../types.js';

function flag(overrides: Partial<ValidationFlag> = {}): ValidationFlag {
  return {
    id: 'f1',
    runId: 'run1',
    responseId: 'r1',
    respondentId: 'p1',
    variableName: 'revenue',
    instanceKey: 'revenue@',
    checkKind: 'metadata',
    checkId: 'range:revenue',
    severity: 'fatal',
    message: 'Value is below the minimum.',
    observed: -50,
    suspicion: 1,
    impact: 0.5,
    score: 0.5,
    ...overrides,
  };
}

function disposition(overrides: Partial<Disposition> = {}): Disposition {
  return {
    flagId: 'f1',
    action: 'accept',
    reason: 'Negative revenue is valid here — a refund period.',
    decidedBy: 'analyst1',
    decidedAt: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

describe('draftRuleFromDisposition', () => {
  it('returns null for follow-up and suppress dispositions', () => {
    expect(draftRuleFromDisposition(flag(), disposition({ action: 'follow-up' }), fixtureInstrument)).toBeNull();
    expect(draftRuleFromDisposition(flag(), disposition({ action: 'suppress' }), fixtureInstrument)).toBeNull();
  });

  it('returns null for record-level flags with no variable', () => {
    const recordFlag = flag({ variableName: null, checkKind: 'stat', checkId: 'duplicate-exact' });
    expect(draftRuleFromDisposition(recordFlag, disposition(), fixtureInstrument)).toBeNull();
  });

  it('drafts the narrowest exact-value condition for a metadata flag', () => {
    const draft = draftRuleFromDisposition(flag(), disposition(), fixtureInstrument);
    expect(draft).not.toBeNull();
    expect(draft!.when).toBe('$revenue == -50');
    expect(draft!.variableName).toBe('revenue');
    expect(draft!.hint).toContain('narrowest possible starting point');
  });

  it('quotes string observed values correctly', () => {
    const stringFlag = flag({ variableName: 'status', observed: "O'Brien", checkId: 'code:status' });
    const draft = draftRuleFromDisposition(stringFlag, disposition(), fixtureInstrument);
    expect(draft!.when).toBe("$status == 'O\\'Brien'");
  });

  it('starts from the authored edit expression for instrument-edit flags', () => {
    const editFlag = flag({
      checkKind: 'instrument-edit',
      checkId: 'edit.budget.balance',
      variableName: 'budget',
      severity: 'fatal',
      message: 'Budget must equal the table grand total.',
    });
    const draft = draftRuleFromDisposition(editFlag, disposition(), fixtureInstrument);
    expect(draft).not.toBeNull();
    expect(draft!.when).toBe('isAnswered($T_TOT_TOT) && $budget != $T_TOT_TOT');
    expect(draft!.hint).toContain('edit.budget.balance');
  });

  it('falls back to the narrow-value draft when the edit id cannot be found in the instrument', () => {
    const unknownEditFlag = flag({ checkKind: 'instrument-edit', checkId: 'edit.does.not.exist', variableName: 'revenue' });
    const draft = draftRuleFromDisposition(unknownEditFlag, disposition(), fixtureInstrument);
    expect(draft!.when).toBe('$revenue == -50');
  });

  it('does not draft from the synthetic required-check id even if checkKind is instrument-edit', () => {
    const requiredFlag = flag({ checkKind: 'instrument-edit', checkId: 'required:revenue', variableName: 'revenue' });
    const draft = draftRuleFromDisposition(requiredFlag, disposition(), fixtureInstrument);
    // no authored edit named "required:revenue" exists, so this falls back to the narrow draft
    expect(draft!.when).toBe('$revenue == -50');
  });
});
