import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { householdInstrument } from '@mobilesurvey/instrument-schema';
import { flattenInstrument } from '../flatten.js';
import { instanceKey, seedPrefill } from '../scope.js';
import { runtimeMachine } from '../machine.js';
import type { RuntimeState } from '../types.js';

function stateWith(responses: Record<string, unknown>, language = 'en'): RuntimeState {
  return {
    responses: { ...seedPrefill(householdInstrument, { contact_name: 'Sam', region_code: 'QC' }), ...responses },
    sample: { contact_name: 'Sam', region_code: 'QC' },
    language,
  };
}

describe('flattenInstrument', () => {
  it('pipes pre-filled sample values into statement text', () => {
    const { items } = flattenInstrument(householdInstrument, stateWith({}));
    const intro = items.find((i) => i.kind === 'statement');
    expect(intro && 'text' in intro ? intro.text : '').toContain('Sam');
  });

  it('expands the household-members roster by hhSize', () => {
    const responses = { [instanceKey('hhSize', [])]: 2 };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    const headings = items.filter((i) => i.kind === 'loopHeading' && i.title.startsWith('Member'));
    expect(headings).toHaveLength(2);
  });

  it('expands a NESTED roster (employers within members)', () => {
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 1,
      [instanceKey('memberAge', [{ name: 'm', index: 1 }])]: 30,
      [instanceKey('employerCount', [{ name: 'm', index: 1 }])]: 3,
    };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    const employerHeadings = items.filter(
      (i) => i.kind === 'loopHeading' && i.title.startsWith('Employer'),
    );
    expect(employerHeadings).toHaveLength(3);
  });

  it('fires a hard edit when hhSize is out of range', () => {
    const responses = { [instanceKey('hhSize', [])]: 99 };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    const q = items.find((i) => i.kind === 'question' && i.instanceKey === instanceKey('hhSize', []));
    expect(q && q.kind === 'question' ? q.firedEdits.some((e) => e.type === 'hard') : false).toBe(true);
  });

  it('hides the employer loop when employerCount is 0 (routing)', () => {
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 1,
      [instanceKey('memberAge', [{ name: 'm', index: 1 }])]: 40,
      [instanceKey('employerCount', [{ name: 'm', index: 1 }])]: 0,
    };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    expect(items.some((i) => i.kind === 'loopHeading' && i.title.startsWith('Employer'))).toBe(false);
  });

  it('computes the derived largeHousehold flag via lazy resolution', () => {
    const { computed } = flattenInstrument(
      householdInstrument,
      stateWith({ [instanceKey('hhSize', [])]: 8 }),
    );
    // flagReview computation construct: hhSize > 10 -> false here.
    expect(computed[instanceKey('flagReview', [])]).toBe(false);
  });

  it('localizes to French', () => {
    const { items } = flattenInstrument(householdInstrument, stateWith({}, 'fr'));
    const intro = items.find((i) => i.kind === 'statement');
    expect(intro && 'text' in intro ? intro.text : '').toContain('Bonjour');
  });

  it('ignores stale child responses when hhSize is 0', () => {
    // Orphaned responses from a previous run must never surface as rendered items.
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 0,
      [instanceKey('memberName', [{ name: 'm', index: 1 }])]: 'Stale Alice',
      [instanceKey('employerName', [{ name: 'm', index: 1 }, { name: 'e', index: 1 }])]: 'Stale Corp',
    };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    expect(items.some((i) => i.kind === 'loopHeading')).toBe(false);
  });

  it('passes null and -1 (refused) values through nested rosters without throwing', () => {
    const scope1 = [{ name: 'm', index: 1 }];
    const scope1e1 = [{ name: 'm', index: 1 }, { name: 'e', index: 1 }];
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 1,
      [instanceKey('memberAge', scope1)]: 30,
      [instanceKey('employerCount', scope1)]: 1,
      [instanceKey('annualIncome', scope1e1)]: null,   // refused — null
      [instanceKey('employerName', scope1e1)]: -1,      // refused — sentinel
    };
    expect(() => flattenInstrument(householdInstrument, stateWith(responses))).not.toThrow();
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    const incomeQ = items.find(
      (i) => i.kind === 'question' && i.instanceKey === instanceKey('annualIncome', scope1e1),
    );
    expect(incomeQ).toBeDefined();
    // Value must pass through as-is; piping converts null→'' without crashing.
    expect(incomeQ?.kind === 'question' ? incomeQ.value : 'wrong').toBeNull();
  });

  it('two-level nested roster emits only known item kinds (no phantom error nodes)', () => {
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 2,
      [instanceKey('employerCount', [{ name: 'm', index: 1 }])]: 2,
      [instanceKey('employerCount', [{ name: 'm', index: 2 }])]: 1,
    };
    const { items } = flattenInstrument(householdInstrument, stateWith(responses));
    const knownKinds = new Set([
      'question', 'statement', 'section', 'pageBreak', 'loopHeading', 'grid', 'markAll',
    ]);
    expect(items.every((i) => knownKinds.has(i.kind))).toBe(true);
    const memberHeadings = items.filter(
      (i) => i.kind === 'loopHeading' && i.title.startsWith('Member'),
    );
    const employerHeadings = items.filter(
      (i) => i.kind === 'loopHeading' && i.title.startsWith('Employer'),
    );
    expect(memberHeadings).toHaveLength(2);
    expect(employerHeadings).toHaveLength(3); // 2 under member 1, 1 under member 2
  });

  it('nested roster flattens without error for an RTL language (Phase 9 fallback)', () => {
    // householdInstrument has no Arabic strings; pick() falls back to 'en'. Must not throw.
    const responses: Record<string, unknown> = {
      [instanceKey('hhSize', [])]: 1,
      [instanceKey('employerCount', [{ name: 'm', index: 1 }])]: 1,
    };
    expect(() => flattenInstrument(householdInstrument, stateWith(responses, 'ar'))).not.toThrow();
    const { items } = flattenInstrument(householdInstrument, stateWith(responses, 'ar'));
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('runtimeMachine', () => {
  it('records answers and toggles language', () => {
    const actor = createActor(runtimeMachine, {
      input: { instrument: householdInstrument, sample: { contact_name: 'Sam' } },
    }).start();

    actor.send({ type: 'ANSWER', instanceKey: instanceKey('hhSize', []), value: 4 });
    expect(actor.getSnapshot().context.state.responses[instanceKey('hhSize', [])]).toBe(4);

    actor.send({ type: 'SET_LANGUAGE', language: 'fr' });
    expect(actor.getSnapshot().context.state.language).toBe('fr');
  });
});
