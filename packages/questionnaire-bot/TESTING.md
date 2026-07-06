# Questionnaire Bot Testing Guide

This document describes test cases and error scenarios for validating the Questionnaire Tester bot.

## Test Instruments

### 1. Test Error Survey (`test-errors.instrument.ts`)

A bilingual survey intentionally designed with multiple categories of errors for bot validation.

#### Errors by Category

**Textual Errors (Typos)**
- Variable label: "Do you have an **acount** with us?" → should be "account"
- Statement text: "your **experiance** with us" → should be "experience"
- Affects: bot should detect text mismatches between schema and rendered UI

**Logical Errors (Dead-End Flows)**
- Question: "This question is unreachable (condition can never be true)"
- Condition: `$has_account == "maybe"` but category scheme only defines "yes" and "no"
- Impact: path enumeration will detect this as an unreachable branch
- Expected bot output: "Dead-end flow detected" or "unreachable question"

**Soft Edit (Validation) Errors**
- Question: "Age (Recommended: 20–65)" with soft edit rule
- Rule: if age < 20 or > 65, show warning "This age is outside our typical range"
- Testing: bot should verify soft edit fires/doesn't fire based on test values

**Spec Mismatches**
- Design spec says: "Thank you for completing the survey"
- Rendered text (in instrument): "Thank you for your time"
- Expected bot output: text mismatch detected

#### Question Flow

1. **Q1: Do you have an account?** (required, code/binary)
   - Yes → Q2
   - No → Q3

2. **Q2: How long have you been a member?** (visible only if Q1=yes)
   - Type: numeric (0-100 years)
   - Routing: always leads to Q3

3. **Q3: Satisfaction** (always visible)
   - Type: code/single (5 options: very satisfied → very dissatisfied)
   - Routing: if not "very_dissatisfied" → Q4, else → Q5

4. **Q4: NPS** (visible only if satisfaction ≠ very_dissatisfied)
   - Type: numeric (0-10)
   - Hard edit: value must be 0-10
   - Routing: always leads to Q5

5. **Q5: Age** (always visible, with soft edit)
   - Type: numeric (0-120)
   - Soft edit: warning if < 20 or > 65 (non-blocking)

6. **Q6: Comments** (always visible)
   - Type: text/multiline
   - Optional

7. **Closing**: "Thank you for your time" (statement)

#### Expected Paths (without dead-end)

1. No → Satisfaction → NPS → Age → Comments → End
2. No → Satisfaction (very_dissatisfied) → Age → Comments → End
3. Yes → Account Age → Satisfaction → NPS → Age → Comments → End
4. Yes → Account Age → Satisfaction (very_dissatisfied) → Age → Comments → End

**Note**: The dead-end flow (`has_account == "maybe"`) is unreachable and should be flagged.

---

## Design Spec Document (Reference)

Below is what the survey *should* look like according to a hypothetical design spec (in Word/PDF format):

```
CUSTOMER SATISFACTION SURVEY
==============================

INTRODUCTION
Thank you for being a valued customer. Please answer a few quick questions
about your experience with our service.

SECTION 1: ACCOUNT INFORMATION
-------------------------------

Q1: Do you have an account with us?
    [ ] Yes
    [ ] No

[IF YES] Q2: How long have you been a member?
    Please enter the number of years: _______

SECTION 2: FEEDBACK
-------------------

Q3: How satisfied are you with our service?
    ( ) Very satisfied
    ( ) Satisfied
    ( ) Neutral
    ( ) Dissatisfied
    ( ) Very dissatisfied

[IF NOT VERY DISSATISFIED] Q4: How likely are you to recommend us?
    Please rate 0-10 (where 0 = not at all, 10 = very likely): _______

Q5: What is your age?
    Please enter your age in years: _______
    (Note: We typically work with ages 20-65, but all ages welcome)

Q6: Any additional comments?
    _________________________________________________________________
    _________________________________________________________________

CLOSING
-------
Thank you for completing the survey.
Your feedback helps us improve.
```

### Spec vs Implementation Mismatches

| Aspect | Design Spec | Implementation | Issue |
|--------|-------------|-----------------|-------|
| Q1 label | "Do you have an account with us?" | "Do you have an **acount** with us?" | **TYPO** |
| Intro text | "your experience with us" | "your **experiance** with us" | **TYPO** |
| Q2 condition | if Q1 = "Yes" | if $has_account == "yes" | ✓ Correct |
| Q3 options | 5 options (Very sat → Very dissat) | 5 options | ✓ Correct |
| Q4 condition | if NOT very dissatisfied | if $satisfaction != "very_dissatisfied" | ✓ Correct |
| Q4 range | 0-10 | numeric min:0, max:10 | ✓ Correct |
| Q5 age note | "20-65, but all ages welcome" | Soft edit rule (warning, not blocking) | ✓ Correct impl, matches intent |
| Closing | "Thank you for **completing** the survey" | "Thank you for your **time**" | **TEXT MISMATCH** |

---

## Findings from Running the Bot Against These Fixtures

Running `enumeratePaths` against `testErrorsInstrument` and `specMismatchInstrument`
(see `src/__tests__/test-instruments.test.ts`) surfaced one real defect and confirmed
several capabilities/gaps:

### Fixed: `boundary` strategy ignored non-routing fields

**Before**: `generateCandidates` only applied boundary/edge-case values to variables
that also appeared in a routing/visibility expression. Since edit rules (hard/soft)
typically live on fields that do **not** affect routing — e.g. `nps` and
`soft_edit_triggered` in `testErrorsInstrument` — the `boundary` strategy silently
fell back to canonical values for exactly the fields it exists to stress-test. A
`--strategy boundary` run would never have exercised the NPS hard-edit range or the
age soft-edit threshold.

**Fix**: `boundary` mode now generates boundary values for every question, not just
routing variables (`enumerator.ts`, `generateCandidates`).

### Known limitation: BFS strategies under-sample deep conditional fields under a low `maxPaths`

`all-paths` and `boundary` are implemented as strict FIFO BFS over the answer tree.
Shorter paths (ones that skip a conditionally-visible question) complete before
longer ones, so a low `maxPaths` cap can systematically miss boundary values on a
field that sits behind an `ifThenElse`. In `testErrorsInstrument`, `nps` is only
visible when `satisfaction != "very_dissatisfied"` — one level deeper than
`soft_edit_triggered`, which is unconditional. At `maxPaths: 100`, boundary
coverage reliably reaches every boundary value of `soft_edit_triggered` but misses
`nps`'s max/max+1 values entirely; raising `maxPaths` to `5000` reaches full coverage.

**Practical guidance**: when targeting validation rules on deeply-conditional
fields, either raise `maxPaths` well above the default, or prefer the `coverage`
strategy (greedy, targets specific variable×value pairs directly rather than
enumerating breadth-first).

### Confirmed: dead-end/unreachable branches don't stall enumeration

`testErrorsInstrument` includes an `ifThenElse` gated on `$has_account == "maybe"` —
a value that doesn't exist in the `cs.yesno` scheme, so the branch is structurally
unreachable. `enumeratePaths` correctly never produces a scenario that answers
`dead_end_question`, and every generated scenario still completes normally (the
enumerator doesn't get stuck trying to satisfy an impossible condition). Detecting
*that a branch is unreachable* (as opposed to *never taking it*) would need an
explicit "unreachable code" schema lint — the enumerator currently just skips what
it can't reach, silently.

### Confirmed gap: text/spec content is invisible to Phase A

Phase A operates purely on the schema's structural shape (paths, routing, edit
*conditions*). It has no notion of text quality or content correctness, so:
- The `acount` / `experiance` typos in `testErrorsInstrument` are undetectable —
  nothing inspects `label`/`text` strings for spelling.
- The `specMismatchInstrument` rating scale (schema defines 4 categories, but the
  question text promises "1=poor, 5=excellent") is undetectable — nothing
  cross-checks free text against the `categorySchemes` it references.
- One category of spec mismatch **is** schema-detectable without a browser: in
  `specMismatchInstrument`, `purchase_intent` asks a yes/no question but its
  `responseDomain` wires up `cs.products` (codes `A`/`B`) instead of a yes/no
  scheme. `enumeratePaths` shows every generated answer for that variable is `'A'`
  or `'B'` — a text-vs-domain consistency lint could flag this today, entirely
  offline, as a Phase A/C feature. Text-drift and option-vs-design-doc mismatches
  remain Phase B/D (browser + external doc comparison) territory.

---

## Bot Testing Checklist

The bot should:

- [ ] **Path Enumeration**: Detect all 4 complete, reachable paths
- [ ] **Dead-End Detection**: Flag the unreachable `has_account == "maybe"` branch
- [ ] **Typo Detection**: Catch "acount" and "experiance" if comparing schema text to rendered UI
- [ ] **Edit Validation**: Verify hard edit on NPS (0-10 range) fires/doesn't fire appropriately
- [ ] **Soft Edit Validation**: Verify soft edit on age (< 20 or > 65) triggers warning without blocking
- [ ] **Text Drift**: Report mismatch between "Thank you for completing..." (spec) and "Thank you for your time..." (implementation)
- [ ] **Scenario Completeness**: All generated scenarios should reach the closing statement (7/7 complete)
- [ ] **No Orphaned Questions**: Dead-end flow should be flagged as unreachable, not executed

---

## Running Tests

### Phase A (Current): Path Enumeration & Answer Generation

```typescript
import { enumeratePaths, collectRoutingVariables } from '@mobilesurvey/questionnaire-bot';
import { testErrorsInstrument } from '@mobilesurvey/instrument-schema';

// Enumerate all reachable paths
const scenarios = enumeratePaths(testErrorsInstrument, { strategy: 'coverage' });
console.log(`Found ${scenarios.length} scenarios (expected 4 + 1 dead-end attempt)`);

// Show routing variables
const routingVars = collectRoutingVariables(testErrorsInstrument);
console.log('Routing variables:', [...routingVars]);  
// Expected: { has_account, satisfaction }
```

**Expected Output** (Phase A):
- 4 complete scenarios covering yes/no × satisfied/very_dissatisfied branches
- 1 scenario attempting the dead-end flow (should fail to complete or be marked incomplete)
- Routing variables: `has_account`, `satisfaction`

### Phase B (Future): Browser Driver + Assertions

When Phase B is complete, the bot will:
1. Launch the survey in a browser
2. Execute each scenario's answer steps
3. Assert rendered text matches schema
4. Detect dead-end flows in real time
5. Produce an HTML report with screenshots

---

## Integration with CI/CD

Future GitHub Actions workflow:

```yaml
- name: Run Questionnaire Tests
  run: |
    pnpm test:qbot --schema ./demo.instrument.json \
      --url http://localhost:5174/?survey=demo \
      --strategy coverage \
      --output ./qbot-report.html
    
- name: Upload Report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: questionnaire-bot-report
    path: qbot-report.html
```

---

## Future Enhancements

- [ ] Phase B: Browser automation with Playwright
- [ ] Phase C: Full assertion engine (text drift, edit validation, routing)
- [ ] Phase D: Discovery mode (schema-agnostic crawl for external questionnaires)
- [ ] LLM-based text classifier for robust element detection
- [ ] Multi-language testing support
- [ ] Export results to CI-friendly formats (JUnit XML, SARIF)
