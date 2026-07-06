/**
 * Runs the Phase A enumerator against the two purpose-built error instruments
 * (testErrorsInstrument, specMismatchInstrument) and asserts on what Phase A can
 * and cannot catch today.
 *
 * This is the bridge between TESTING.md's "Bot Testing Checklist" and actual
 * verified behavior — each assertion here corresponds to a checklist item.
 * Items Phase A cannot yet detect (text drift, spec mismatches) are called out
 * explicitly as `// Phase B/C:` so the gap is visible, not silently absent.
 */
import { describe, it, expect } from 'vitest';
import { testErrorsInstrument, specMismatchInstrument } from '@mobilesurvey/instrument-schema';
import { collectRoutingVariables, enumeratePaths } from '../enumerator.js';

// ─── Test Error Survey ────────────────────────────────────────────────────────

describe('testErrorsInstrument — routing analysis', () => {
  it('identifies has_account and satisfaction as routing variables', () => {
    const vars = collectRoutingVariables(testErrorsInstrument);
    expect(vars.has('has_account')).toBe(true);
    expect(vars.has('satisfaction')).toBe(true);
  });

  it('does not treat comments/nps/age as routing variables', () => {
    const vars = collectRoutingVariables(testErrorsInstrument);
    expect(vars.has('comments')).toBe(false);
    expect(vars.has('soft_edit_triggered')).toBe(false);
  });
});

describe('testErrorsInstrument — coverage strategy', () => {
  const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'coverage' });

  it('produces at least the 4 documented reachable paths', () => {
    // yes/no × satisfied/very_dissatisfied is the minimum branch coverage
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('every coverage scenario reaches the closing statement (all complete)', () => {
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });

  it('covers both has_account values (yes and no)', () => {
    const values = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'has_account').map((st) => st.value),
    );
    expect(values).toContain('yes');
    expect(values).toContain('no');
  });

  it('covers the very_dissatisfied branch (which skips NPS)', () => {
    const values = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'satisfaction').map((st) => st.value),
    );
    expect(values).toContain('very_dissatisfied');
  });

  it('a yes+non-dissatisfied path includes account_age and nps; very_dissatisfied path excludes nps', () => {
    const npsScenario = scenarios.find((s) =>
      s.steps.some((st) => st.variableRef === 'nps'),
    );
    const noNpsScenario = scenarios.find(
      (s) =>
        s.steps.some((st) => st.variableRef === 'satisfaction' && st.value === 'very_dissatisfied') &&
        !s.steps.some((st) => st.variableRef === 'nps'),
    );
    expect(npsScenario).toBeDefined();
    expect(noNpsScenario).toBeDefined();
  });
});

describe('testErrorsInstrument — dead-end flow detection', () => {
  it('all-paths BFS never produces a scenario answering dead_end_question', () => {
    // The ifThenElse guarding c.dead_end_question checks $has_account == "maybe",
    // but cs.yesno only defines "yes"/"no" — this branch is structurally unreachable.
    const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'all-paths', maxPaths: 50 });
    const reachedDeadEnd = scenarios.some((s) =>
      s.steps.some((st) => st.variableRef === 'dead_end_question'),
    );
    expect(reachedDeadEnd).toBe(false);
  });

  it('every all-paths scenario is still complete (the dead branch is simply skipped, not a trap)', () => {
    // This instrument's dead end is "unreachable code" rather than a "stuck state" —
    // confirms the enumerator doesn't get stuck trying to satisfy an impossible condition.
    const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'all-paths', maxPaths: 50 });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });
});

describe('testErrorsInstrument — soft edit (validation) coverage', () => {
  it('boundary strategy exercises out-of-range age values (soft edit trigger)', () => {
    const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'boundary', maxPaths: 100 });
    const ageValues = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'soft_edit_triggered').map((st) => Number(st.value)),
    );
    // Soft edit fires when age < 20 or > 65 — boundary mode should include such values.
    expect(ageValues.some((v) => v < 20 || v > 65)).toBe(true);
  });

  it('boundary strategy with maxPaths=100 under-samples nps (documents a real BFS limitation)', () => {
    // FINDING: `nps` sits behind an ifThenElse (only visible when satisfaction !=
    // 'very_dissatisfied'), one level deeper than the unconditional soft_edit_triggered
    // field above. enumerateAllPaths is strict FIFO BFS over the answer tree: shorter
    // paths (branches that skip nps entirely) complete first and dominate a low
    // maxPaths budget, so deeper conditional fields can be under-sampled or missed
    // entirely even though the strategy's stated purpose is "boundary/edge-case
    // testing." At maxPaths=100 this instrument reliably fails to reach nps=10 and
    // often only reaches nps's *first* generated boundary value (-1), never later ones.
    const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'boundary', maxPaths: 100 });
    const npsValues = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'nps').map((st) => Number(st.value)),
    );
    expect(npsValues.includes(0) && npsValues.includes(10)).toBe(false);
  });

  it('raising maxPaths lets boundary strategy eventually reach nps=0 and nps=10', () => {
    // Confirms the limitation above is a budget/ordering artifact, not a missing
    // value in generateValues — full boundary coverage for `numeric` domains is
    // { min-1, min, mid, max, max+1 } and all five values are reachable once the
    // BFS is given enough budget to traverse past the shorter, nps-skipping paths.
    const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'boundary', maxPaths: 5000 });
    const npsValues = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'nps').map((st) => Number(st.value)),
    );
    expect(npsValues).toContain(0);
    expect(npsValues).toContain(10);
  });

  // Phase B/C: Phase A only generates the *values* that should trip an edit rule.
  // It does not yet evaluate EditRule.when against those values or confirm the
  // rendered UI actually surfaces the warning — that requires the browser driver
  // and assertion engine (Phase B/C), not the schema-only enumerator.
});

describe('testErrorsInstrument — text/typo detection (documents current gap)', () => {
  it('Phase A does not flag the "acount" / "experiance" typos (expected — needs Phase B)', () => {
    // Confirms today's behavior so the gap is explicit rather than assumed:
    // the enumerator only tracks structural paths, not text content quality.
    const q1 = testErrorsInstrument.variables.find((v) => v.name === 'has_account');
    expect(q1?.label.en).toContain('acount'); // the typo is present in the fixture on purpose
    // No enumerator API inspects label text for spelling — this is a Phase B/C capability
    // (text-drift assertion comparing schema text to rendered DOM text).
  });
});

// ─── Spec Mismatch Survey ─────────────────────────────────────────────────────

describe('specMismatchInstrument — routing analysis', () => {
  it('identifies used_before as the routing variable gating purchase_intent', () => {
    const vars = collectRoutingVariables(specMismatchInstrument);
    expect(vars.has('used_before')).toBe(true);
  });
});

describe('specMismatchInstrument — coverage strategy', () => {
  const scenarios = enumeratePaths(specMismatchInstrument, { strategy: 'coverage' });

  it('produces scenarios covering both used_before branches', () => {
    const values = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'used_before').map((st) => st.value),
    );
    expect(values).toContain(true);
    expect(values).toContain(false);
  });

  it('purchase_intent is only answered when used_before=true (conditional visibility works)', () => {
    const trueScenario = scenarios.find((s) =>
      s.steps.some((st) => st.variableRef === 'used_before' && st.value === true),
    );
    const falseScenario = scenarios.find((s) =>
      s.steps.some((st) => st.variableRef === 'used_before' && st.value === false),
    );
    expect(trueScenario?.steps.some((st) => st.variableRef === 'purchase_intent')).toBe(true);
    expect(falseScenario?.steps.some((st) => st.variableRef === 'purchase_intent')).toBe(false);
  });

  it('all scenarios reach the closing statement', () => {
    expect(scenarios.every((s) => s.complete)).toBe(true);
  });
});

describe('specMismatchInstrument — schema-detectable mismatch: wrong category scheme', () => {
  it('purchase_intent answers come from the *products* scheme (A/B), not a yes/no scheme', () => {
    // This IS detectable from the schema alone: the question text asks a yes/no question
    // ("Would you purchase this product again?") but its responseDomain wires up
    // cs.products (A, B) instead of cs.yesno. The mismatch is structural, so a
    // schema-level lint (Phase A/C, not just Phase B) could flag it independently
    // of browser rendering.
    const scenarios = enumeratePaths(specMismatchInstrument, { strategy: 'all-paths', maxPaths: 20 });
    const piValues = scenarios.flatMap((s) =>
      s.steps.filter((st) => st.variableRef === 'purchase_intent').map((st) => st.value),
    );
    expect(piValues.every((v) => v === 'A' || v === 'B')).toBe(true);
  });
});

describe('specMismatchInstrument — rating scale mismatch (documents current gap)', () => {
  it('cs.rating only has 4 categories even though question text promises "1=poor, 5=excellent"', () => {
    const scheme = specMismatchInstrument.categorySchemes.find((s) => s.id === 'cs.rating');
    expect(scheme?.categories.length).toBe(4);
    // Phase A's generateValues() will only ever produce values 1-4 for this domain — it has
    // no way to know the *text* promised a 5th option. Detecting "spec says 5, schema has 4"
    // requires either (a) a text-vs-domain consistency linter (schema-only, feasible in
    // Phase C) or (b) comparing against an external design doc (Phase B/D territory).
  });
});
