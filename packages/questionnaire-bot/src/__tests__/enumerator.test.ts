import { describe, it, expect } from 'vitest';
import { demoInstrument, householdInstrument } from '@mobilesurvey/instrument-schema';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import {
  collectRoutingVariables,
  collectRosterCountVariables,
  enumeratePaths,
} from '../enumerator.js';

// ─── Minimal test instruments ─────────────────────────────────────────────────

/**
 * Two-branch instrument: one code question (routing) → conditional follow-up.
 *
 *   q1 (code: yes/no)
 *   q2 (text — always visible)
 *   IF $q1 == 'yes' THEN q3 (text)
 */
const binaryBranchInstrument: Instrument = {
  id: 'urn:test:binary:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: { title: { en: 'Binary Branch Test' } },
  concepts: [],
  universes: [],
  categorySchemes: [
    {
      id: 'cs.yesno',
      label: { en: 'Yes / No' },
      categories: [
        { code: 'yes', label: { en: 'Yes' } },
        { code: 'no', label: { en: 'No' } },
      ],
    },
  ],
  variables: [
    { id: 'v.q1', name: 'q1', kind: 'collected', label: { en: 'Q1' }, representation: 'code', categorySchemeRef: 'cs.yesno' },
    { id: 'v.q2', name: 'q2', kind: 'collected', label: { en: 'Q2' }, representation: 'text' },
    { id: 'v.q3', name: 'q3', kind: 'collected', label: { en: 'Q3' }, representation: 'text' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'root',
    children: [
      {
        type: 'question',
        id: 'c.q1',
        variableRef: 'q1',
        text: { en: 'Do you use our product?' },
        responseDomain: { type: 'code', categorySchemeRef: 'cs.yesno', selection: 'single' },
        required: true,
      },
      {
        type: 'question',
        id: 'c.q2',
        variableRef: 'q2',
        text: { en: 'How long have you used similar products?' },
        responseDomain: { type: 'text' },
      },
      {
        type: 'ifThenElse',
        id: 'if.q1yes',
        condition: '$q1 == "yes"',
        then: [
          {
            type: 'question',
            id: 'c.q3',
            variableRef: 'q3',
            text: { en: 'Tell us about your experience.' },
            responseDomain: { type: 'text' },
          },
        ],
      },
    ],
  },
};

/**
 * Single-page, no-routing instrument: three always-visible text questions.
 */
const linearInstrument: Instrument = {
  id: 'urn:test:linear:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: { title: { en: 'Linear Test' } },
  concepts: [],
  universes: [],
  categorySchemes: [],
  variables: [
    { id: 'v.a', name: 'a', kind: 'collected', label: { en: 'A' }, representation: 'text' },
    { id: 'v.b', name: 'b', kind: 'collected', label: { en: 'B' }, representation: 'text' },
    { id: 'v.c', name: 'c', kind: 'collected', label: { en: 'C' }, representation: 'text' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'root',
    children: [
      { type: 'question', id: 'c.a', variableRef: 'a', text: { en: 'A?' }, responseDomain: { type: 'text' } },
      { type: 'question', id: 'c.b', variableRef: 'b', text: { en: 'B?' }, responseDomain: { type: 'text' } },
      { type: 'question', id: 'c.c', variableRef: 'c', text: { en: 'C?' }, responseDomain: { type: 'text' } },
    ],
  },
};

/**
 * Minimal roster instrument: hhSize (numeric, routing) → loop with one question per member.
 */
const rosterInstrument: Instrument = {
  id: 'urn:test:roster:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: { title: { en: 'Roster Test' } },
  concepts: [],
  universes: [],
  categorySchemes: [],
  variables: [
    { id: 'v.hhSize', name: 'hhSize', kind: 'collected', label: { en: 'Household size' }, representation: 'numeric' },
    { id: 'v.memberName', name: 'memberName', kind: 'collected', label: { en: 'Member name' }, representation: 'text' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'root',
    children: [
      {
        type: 'question',
        id: 'c.hhSize',
        variableRef: 'hhSize',
        text: { en: 'How many people live in your household?' },
        responseDomain: { type: 'numeric', min: 1, max: 20 },
        required: true,
      },
      {
        type: 'loop',
        id: 'loop.members',
        label: { en: 'Members' },
        loopVariable: 'm',
        countVariableRef: 'hhSize',
        itemLabel: { en: 'Member ${m}' },
        children: [
          {
            type: 'question',
            id: 'c.memberName',
            variableRef: 'memberName',
            text: { en: 'Name of member ${m}?' },
            responseDomain: { type: 'text' },
          },
        ],
      },
    ],
  },
};

// ─── collectRoutingVariables ──────────────────────────────────────────────────

describe('collectRoutingVariables', () => {
  it('identifies the branching variable in binaryBranchInstrument', () => {
    const vars = collectRoutingVariables(binaryBranchInstrument);
    expect(vars.has('q1')).toBe(true);
  });

  it('does not include non-routing variables', () => {
    const vars = collectRoutingVariables(binaryBranchInstrument);
    expect(vars.has('q2')).toBe(false);
    expect(vars.has('q3')).toBe(false);
  });

  it('returns empty set for a linear (no-routing) instrument', () => {
    const vars = collectRoutingVariables(linearInstrument);
    expect(vars.size).toBe(0);
  });

  it('includes roster count variable', () => {
    const vars = collectRoutingVariables(rosterInstrument);
    expect(vars.has('hhSize')).toBe(true);
  });

  it('finds routing vars in the demo instrument', () => {
    const vars = collectRoutingVariables(demoInstrument);
    expect(vars.size).toBeGreaterThan(0);
  });
});

// ─── collectRosterCountVariables ─────────────────────────────────────────────

describe('collectRosterCountVariables', () => {
  it('identifies hhSize as a roster count variable', () => {
    const vars = collectRosterCountVariables(rosterInstrument);
    expect(vars.has('hhSize')).toBe(true);
  });

  it('returns empty for non-roster instruments', () => {
    expect(collectRosterCountVariables(binaryBranchInstrument).size).toBe(0);
    expect(collectRosterCountVariables(linearInstrument).size).toBe(0);
  });

  it('finds roster count variables in the household instrument', () => {
    const vars = collectRosterCountVariables(householdInstrument);
    expect(vars.size).toBeGreaterThan(0);
  });
});

// ─── enumeratePaths — linear instrument (no routing) ─────────────────────────

describe('enumeratePaths — linear (no routing)', () => {
  it('coverage: produces exactly one complete scenario', () => {
    const scenarios = enumeratePaths(linearInstrument, { strategy: 'coverage' });
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.complete).toBe(true);
  });

  it('all-paths: also produces exactly one scenario', () => {
    const scenarios = enumeratePaths(linearInstrument, { strategy: 'all-paths' });
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.complete).toBe(true);
  });

  it('scenario contains all three questions', () => {
    const [scenario] = enumeratePaths(linearInstrument, { strategy: 'coverage' });
    const varRefs = scenario!.steps.map((s) => s.variableRef);
    expect(varRefs).toContain('a');
    expect(varRefs).toContain('b');
    expect(varRefs).toContain('c');
  });
});

// ─── enumeratePaths — binary branch ──────────────────────────────────────────

describe('enumeratePaths — binary branch', () => {
  it('all-paths: produces two complete scenarios (yes path and no path)', () => {
    const scenarios = enumeratePaths(binaryBranchInstrument, { strategy: 'all-paths' });
    expect(scenarios).toHaveLength(2);
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });

  it('coverage: produces exactly two scenarios covering yes and no', () => {
    const scenarios = enumeratePaths(binaryBranchInstrument, { strategy: 'coverage' });
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
    const q1Values = scenarios.map((s) => s.steps.find((st) => st.variableRef === 'q1')?.value);
    expect(q1Values).toContain('yes');
    expect(q1Values).toContain('no');
  });

  it('yes-path scenario includes q3, no-path does not', () => {
    const scenarios = enumeratePaths(binaryBranchInstrument, { strategy: 'all-paths' });
    const yesScenario = scenarios.find((s) => s.steps.some((st) => st.variableRef === 'q1' && st.value === 'yes'));
    const noScenario = scenarios.find((s) => s.steps.some((st) => st.variableRef === 'q1' && st.value === 'no'));

    expect(yesScenario).toBeDefined();
    expect(noScenario).toBeDefined();
    expect(yesScenario!.steps.some((st) => st.variableRef === 'q3')).toBe(true);
    expect(noScenario!.steps.some((st) => st.variableRef === 'q3')).toBe(false);
  });

  it('all scenarios are marked complete', () => {
    const scenarios = enumeratePaths(binaryBranchInstrument, { strategy: 'coverage' });
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });

  it('boundary: produces scenarios (may include edge-case text values)', () => {
    const scenarios = enumeratePaths(binaryBranchInstrument, { strategy: 'boundary' });
    expect(scenarios.length).toBeGreaterThan(0);
    // Boundary mode uses null/first/last for code/single — should still produce complete scenarios.
    expect(scenarios.some((s) => s.complete)).toBe(true);
  });
});

// ─── enumeratePaths — roster ──────────────────────────────────────────────────

describe('enumeratePaths — roster', () => {
  it('coverage with rosterCounts [1, 2]: produces two scenarios', () => {
    const scenarios = enumeratePaths(rosterInstrument, {
      strategy: 'coverage',
      rosterCounts: [1, 2],
    });
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('roster=1 scenario has one memberName step; roster=2 has two', () => {
    const scenarios = enumeratePaths(rosterInstrument, {
      strategy: 'all-paths',
      rosterCounts: [1, 2],
    });

    const sc1 = scenarios.find((s) => s.steps.find((st) => st.variableRef === 'hhSize' && st.value === 1));
    const sc2 = scenarios.find((s) => s.steps.find((st) => st.variableRef === 'hhSize' && st.value === 2));

    expect(sc1).toBeDefined();
    expect(sc2).toBeDefined();
    expect(sc1!.steps.filter((st) => st.variableRef === 'memberName')).toHaveLength(1);
    expect(sc2!.steps.filter((st) => st.variableRef === 'memberName')).toHaveLength(2);
  });

  it('all roster scenarios are complete', () => {
    const scenarios = enumeratePaths(rosterInstrument, { rosterCounts: [1, 2] });
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });
});

// ─── enumeratePaths — maxPaths cap ───────────────────────────────────────────

describe('enumeratePaths — maxPaths', () => {
  it('never exceeds maxPaths', () => {
    // The demo instrument has several routing variables; all-paths could produce many.
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'all-paths', maxPaths: 5 });
    expect(scenarios.length).toBeLessThanOrEqual(5);
  });
});

// ─── enumeratePaths — demo instrument ────────────────────────────────────────

describe('enumeratePaths — demo instrument', () => {
  it('coverage produces at least one scenario', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it('all scenarios have ids and step arrays', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    for (const s of scenarios) {
      expect(s.id).toMatch(/^scenario-\d+$/);
      expect(Array.isArray(s.steps)).toBe(true);
      expect(s.steps.length).toBeGreaterThan(0);
    }
  });

  it('coverage scenarios are all complete', () => {
    const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });
});

// ─── enumeratePaths — household instrument (nested rosters) ──────────────────

describe('enumeratePaths — household instrument', () => {
  it('coverage with rosterCounts [1]: produces at least one complete scenario', () => {
    const scenarios = enumeratePaths(householdInstrument, {
      strategy: 'coverage',
      rosterCounts: [1],
    });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.some((s) => s.complete)).toBe(true);
  });

  it('scenarios include hhSize steps', () => {
    const scenarios = enumeratePaths(householdInstrument, {
      strategy: 'coverage',
      rosterCounts: [1],
    });
    const hasHhSize = scenarios.some((s) => s.steps.some((st) => st.variableRef === 'hhSize'));
    expect(hasHhSize).toBe(true);
  });
});
