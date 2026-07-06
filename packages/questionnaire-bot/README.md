# Questionnaire Bot — Automated Testing for Survey Instruments

An automated testing tool that validates questionnaire designs by enumerating all possible flows, generating test answers, and comparing intended structure against actual rendering.

## Overview

The Questionnaire Bot is designed to catch errors that manual testing misses:

- **Logical errors**: dead-end flows, unreachable questions, broken routing
- **Textual errors**: typos, inconsistent wording, text drift between design and implementation
- **Validation issues**: edit rules not firing, soft edits vs hard edits not working as designed
- **Spec mismatches**: implementation differs from design document (missing options, different ordering, etc.)

Works with any web-based questionnaire, not just surveys built with mobilesurvey.

## Phases

### Phase A ✅ COMPLETE
- **Path enumerator**: Given an instrument schema, enumerate all reachable paths
- **Answer generator**: Produce test values for each response domain
- **Coverage strategies**: all-paths, coverage (greedy), boundary
- **Status**: 66 tests, typecheck clean

### Phase B ✅ COMPLETE (core loop)
- **`BrowserDriver`**: generic Playwright interaction primitives (fill text/numeric/date,
  select-radio/checkbox-set by visible label, aria-label targeting for grid/markAll cells,
  Next/Back navigation with a mobilesurvey-specific fast path + generic text-match fallback,
  passive console/pageerror/requestfailed capture)
- **`schema-adapter.ts`**: resolves a Scenario's `AnswerStep`s to concrete locator strategies by
  re-flattening the instrument at each step (handles roster scoping, conditional visibility,
  markAll/grid sub-items)
- **`runScenario`/`runScenarios`**: drives one or many Scenarios end-to-end against a live
  respondent-runtime URL, tracking page boundaries via `flattenInstrument`+`paginate` in lockstep
  with the browser
- **`buildReport`/`formatReportText`**: structured JSON + plain-text issue summary
  (`DEAD_END`, `STEP_FAILED`, `FATAL_ERROR`, `CONSOLE_ERROR`)
- **Status**: 85 tests total (12 are real-Chromium integration tests against a static fixture
  mirroring respondent-view's actual markup — not mocks); typecheck clean
- **Found and fixed a real bug while building this**: `QuestionPage.tsx` assigned the same `id`
  to both a question's `<label>` and its form control for every non-group domain (text/numeric/
  datetime/lookup/file) — invalid duplicate DOM ids, caught by Playwright's strict-mode locator
  matching. Fixed in `packages/respondent-view/src/QuestionPage.tsx`.
- **Not yet built**: HTML report with screenshots, `--url`/`--schema` CLI entry point, running
  against a live dev server end-to-end (tests use a static fixture, not `apps/runtime` itself)

### Phase C 🔮 FUTURE
- Full assertion engine (text-drift detection comparing schema text to rendered DOM text,
  edit-rule firing validation against the rendered UI, not just the schema)
- N-wise path enumeration
- Multi-language testing
- Discovery mode (schema-agnostic, works on external questionnaires)
- CLI entry point + HTML report with screenshots

### Phase D 🔮 FUTURE
- LLM-based element classifier (optional, for robust detection)
- CI/CD integration (JUnit XML, SARIF output)
- Statistical analysis of coverage

---

## Installation

```bash
pnpm install
```

The bot is a workspace package under `packages/questionnaire-bot/`.

---

## Usage

### Phase A: Enumerate Paths (Headless)

```typescript
import { enumeratePaths } from '@mobilesurvey/questionnaire-bot';
import { demoInstrument } from '@mobilesurvey/instrument-schema';

const scenarios = enumeratePaths(demoInstrument, {
  strategy: 'coverage',
  maxPaths: 200,
  rosterCounts: [1, 2],
});

for (const s of scenarios) {
  console.log(`${s.id}: ${s.questionCount} Qs, ${s.pageCount} pages, ${s.complete ? '✓' : '✗'}`);
}
```

**Output**:
```
scenario-1: 23 Qs, 4 pages, ✓
scenario-2: 21 Qs, 4 pages, ✓
scenario-3: 19 Qs, 4 pages, ✓
...
```

### Coverage Strategies

| Strategy | Use Case | Scalability |
|----------|----------|------------|
| `all-paths` | Small surveys, exact coverage | Exponential; use `maxPaths` to cap |
| `coverage` (default) | Medium-to-large surveys, practical testing | Linear in routing variables |
| `boundary` | Validation rule testing (edge cases) | Linear; uses min/max/invalid values |
| `n-wise` | (Stub) N-way combinations | TBD |

### Phase B: Drive a Live Survey in a Browser

```typescript
import { enumeratePaths, runScenarios, buildReport, formatReportText } from '@mobilesurvey/questionnaire-bot';
import { demoInstrument } from '@mobilesurvey/instrument-schema';

const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });

const results = await runScenarios(demoInstrument, scenarios, {
  url: 'http://localhost:5174/?survey=demo',
  headless: true,
});

const report = buildReport(results);
console.log(formatReportText(report));
```

**Output**:
```
Questionnaire Bot Report: 4/4 scenarios completed (0 issues, 8213ms)
No issues found.
```

Each `ScenarioRunResult` records, per step: which locator strategy was used, whether the
interaction succeeded, and any console/page errors captured during that scenario's run. A
scenario that never reaches the completion screen (`.done__title`) is reported as a `DEAD_END`
issue — this is the browser-driven counterpart to Phase A's structural dead-end detection.

**Note**: `runScenarios` launches one shared Chromium instance and reuses it across scenarios
(faster than relaunching per scenario). Pass an explicit `browser` in `RunOptions` to reuse a
browser you've already launched elsewhere (e.g. across multiple survey URLs in one CI job).

---

## Test Instruments

Two test instruments are provided in `packages/instrument-schema/src/examples/`:

### 1. Test Error Survey (`testErrorsInstrument`)

A survey with intentional errors across multiple categories.

**Error Types**:
- Textual: "acount" instead of "account", "experiance" vs "experience"
- Logical: unreachable condition (`$has_account == "maybe"` with only yes/no options)
- Soft Edit: age validation (warning if < 20 or > 65)
- Spec Mismatch: closing text differs between spec and implementation

**Expected Behavior**:
- Enumerator finds 4 complete paths (yes/no × satisfied/very-dissatisfied)
- Dead-end branch (`has_account == "maybe"`) detected as unreachable
- All scenarios reach closing statement

**Import**:
```typescript
import { testErrorsInstrument } from '@mobilesurvey/instrument-schema';
```

### 2. Spec Mismatch Survey (`specMismatchInstrument`)

A survey deliberately implemented differently from its design spec.

**Mismatches**:
- Missing option: Design spec includes "Product C", implementation omits it
- Reordered options: Rating scale (1-5 in spec, 1-4 in implementation with wrong order)
- Changed requirement: Purchase intent is optional in spec, required in implementation
- Wrong condition: Q4 is always visible in spec, conditional in implementation
- Wrong question type: Purchase intent should be yes/no, implementation uses products scheme
- Text mismatch: Multiple closing/intro text differences

**Expected Behavior**:
- Enumerator finds paths, but discovery of mismatches deferred to Phase B
- Useful for demonstrating bot's future assertion capabilities

**Import**:
```typescript
import { specMismatchInstrument } from '@mobilesurvey/instrument-schema';
```

---

## API Reference

### `enumeratePaths(instrument, options?)`

Enumerate all reachable paths through an instrument.

**Parameters**:
- `instrument: Instrument` — DDI instrument schema
- `options?: EnumeratorOptions`
  - `strategy?: CoverageStrategy` — (default: `"coverage"`)
  - `language?: LanguageCode` — (default: instrument.defaultLanguage)
  - `maxPaths?: number` — (default: 200)
  - `rosterCounts?: number[]` — (default: [1, 2])

**Returns**: `Scenario[]`

Each scenario has:
```typescript
interface Scenario {
  id: string;
  strategy: CoverageStrategy;
  steps: AnswerStep[];     // Ordered list of (instanceKey, value) pairs
  pageCount: number;
  questionCount: number;
  complete: boolean;       // true if all visible questions are answered
}
```

### `collectRoutingVariables(instrument)`

Static analysis: which variables affect visibility, routing, or loop counts?

**Returns**: `Set<string>` of variable names

### `collectRosterCountVariables(instrument)`

Static analysis: which variables are used as loop count references?

**Returns**: `Set<string>` of variable names

### `generateValues(domain, instrument, mode)`

Generate test values for a `ResponseDomain`.

**Parameters**:
- `domain: ResponseDomain`
- `instrument: Instrument`
- `mode: 'routing' | 'canonical' | 'boundary'`

**Returns**: `unknown[]` — test values (empty for file/markAll/grid domains)

---

## Testing

```bash
# Run all tests
pnpm test

# Run questionnaire-bot tests only
pnpm --filter @mobilesurvey/questionnaire-bot test

# Typecheck
pnpm --filter @mobilesurvey/questionnaire-bot typecheck
```

**Test Coverage**:
- Answer generation: 22 tests across all domain types
- Enumerator: 25 tests including linear/branching/roster instruments

---

## Example: Finding Errors

```typescript
import { enumeratePaths, collectRoutingVariables } from '@mobilesurvey/questionnaire-bot';
import { testErrorsInstrument } from '@mobilesurvey/instrument-schema';

const routingVars = collectRoutingVariables(testErrorsInstrument);
console.log('Routing variables:', [...routingVars]);
// Output: Routing variables: has_account, satisfaction

const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'coverage' });
console.log(`Found ${scenarios.length} scenarios`);

// Check for dead ends or incomplete paths
const incomplete = scenarios.filter(s => !s.complete);
if (incomplete.length > 0) {
  console.log(`⚠️  Found ${incomplete.length} incomplete paths (possible dead ends)`);
  for (const s of incomplete) {
    console.log(`  - ${s.id}: reached ${s.questionCount} questions, ${s.pageCount} pages`);
  }
}

// All scenarios should be complete if routing logic is correct
console.assert(
  scenarios.every(s => s.complete),
  'All scenarios should reach completion'
);
```

---

## Design & Architecture

### Path Enumeration Strategy: Coverage (Greedy)

Rather than exploring all possible answer combinations (exponential), the coverage strategy:

1. **Identify routing variables** — which variables appear in any condition/visibility expression
2. **Build coverage map** — for each routing variable, list all values that must be tested
3. **Generate directed paths** — run single-path scenarios with a target override mechanism:
   - Use canonical values for non-routing questions (no branching)
   - Systematically vary routing variables to hit all `(variable, value)` pairs
4. **Stop** when all routing pairs are covered or `maxPaths` is reached

**Complexity**: O(n) where n = sum of routing variable values (not exponential)

**Example**: A survey with 3 binary branching variables and 2 code variables (4 options each):
- All-paths: 2^3 × 4 × 4 = 512 paths
- Coverage: 3×2 + 2×4 = 14 target pairs → ~14 scenarios

### Pure Functions, No Side Effects

The enumerator and answer generator are pure TypeScript functions — no browser, no network, no I/O. Built on existing proven primitives:
- `flattenInstrument()` from runtime-engine
- `variablesUsed()` from expression-engine
- `evaluateCondition()` for routing logic

---

## Future Work

- **Phase B**: Browser driver, element mapping, assertion engine
- **Phase C**: Discovery mode for external questionnaires, LLM classifier
- **Phase D**: CI/CD pipeline, statistical coverage reports
- Multi-language survey testing
- Performance profiling on large instruments (1000+ questions)

---

## Contributing

Tests are in `src/__tests__/`:
- `answer-gen.test.ts` — value generation per domain
- `enumerator.test.ts` — path enumeration strategies

When adding new domain types or strategies:
1. Add tests first (TDD)
2. Update both the enumerator and answer-gen to handle the new type
3. Ensure all 47+ tests pass
4. Add example usage to this README

---

## See Also

- [TESTING.md](./TESTING.md) — detailed test case documentation and error scenarios
- [packages/instrument-schema](../instrument-schema) — DDI instrument types
- [packages/runtime-engine](../runtime-engine) — flatten/scope algorithms
- [packages/expression-engine](../expression-engine) — expression evaluation
