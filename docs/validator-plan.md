# Validator — post-collection data editing & validation

*Design document. Status: approved for implementation, not started. (2026-07-06)*

## 1. Problem statement

When analysts receive raw collected data they decide, record by record and cell by cell,
whether a value is **acceptable**, needs to be **corrected**, or must be **flagged for
follow-up** (often recontacting the respondent). Today they do this with three kinds of
knowledge, none of which the platform captures:

1. **Algorithmic signals** — outliers, impossible combinations, duplicates, sums that don't
   balance. Mechanical, well-understood, automatable.
2. **Cross-source confrontation** — "this establishment reported $2.1M revenue to us but the
   admin file says $6.8M"; "last cycle they reported 40 FTEs, now 4 — probably a unit error."
   Requires linking to other datasets and knowing which comparisons are meaningful.
3. **Tacit domain knowledge** — "R&D spending at this agency never drops 30% without a
   program sunset"; "this industry always reports in units even though the form says
   thousands." Lives in analysts' heads, leaves when they do.

The Validator is a new hub module that covers all three. The honest design premise for the
hard parts: **cross-source confrontation is scoped, not solved** (explicit keys and mappings,
no magic linkage), and **tacit knowledge is ratcheted, not captured** (every manual judgment
must leave a durable, reusable artifact — the tool gets smarter with use rather than claiming
to know the domain up front).

### Relationship to the existing edit system

The platform already validates *during* collection (hard/soft edits authored in the designer,
evaluated by `runtime-engine`). The Validator is a different phase with a clean boundary:

| | Collection-time edits | Validator |
|---|---|---|
| When | While the respondent types | After submission, over the whole dataset |
| Unit | One live session | All responses to a survey (plus reference data) |
| Sees | Only this respondent's answers | Cross-record patterns, other sources, history |
| Can | Block/warn the respondent | Flag, correct (layered), route to follow-up |
| Rules | Fixed at publish time | Grow continuously as analysts work |

Same expression language, same severity vocabulary (hard→fatal, soft→query), different
execution context. Collection-time edits are *also* re-run by the Validator (see §5.2)
because analysts add rules after seeing data, and imported/legacy datasets never passed
through collection at all.

### Methodological grounding

This is a well-trodden domain in official statistics; we adopt its vocabulary and structure
rather than inventing our own:

- **Eurostat validation levels 0–5** — an ordered ladder from file structure up to
  cross-provider confrontation. We use it to organize the check taxonomy (§5) because it
  cleanly separates "free from metadata" from "needs a reference dataset" from "needs a
  human."
- **Selective editing** (Latouche & Berthelot, StatCan) — score every flag as
  *suspicion × impact* and work the queue top-down. Adopted because the primary failure mode
  of validators is not missed errors, it is **flag fatigue**: hundreds of low-value flags
  train analysts to ignore the tool. Prioritization is a first-class feature, not a nicety.
- **Hidiroglou–Berthelot ratio edits** — the standard method for period-over-period outliers
  in establishment surveys (our FSEP-style use case). Scheduled for V2 when previous-cycle
  data exists.
- **Never overwrite raw data** (Fellegi-Holt tradition & audit norms) — corrections are a
  layered overlay; the raw submission is immutable. See §6.3.

## 2. Design principles (the "why" behind everything below)

1. **One rule language.** Every executable check — metadata-derived, analyst-authored,
   elicited from a correction, or LLM-drafted — compiles to the existing
   `@mobilesurvey/expression-engine` grammar. Rationale: the engine is eval-free (safe to run
   over untrusted data), already has an authoring UI + live compile feedback in the designer,
   and analysts/designers only learn one syntax. LLM output becomes *reviewable text in a
   known grammar*, not opaque model behavior.
2. **One flag model, one queue, one audit trail.** A range violation, a confrontation
   mismatch, and an LLM suspicion all land as the same `ValidationFlag` shape with the same
   disposition workflow. Rationale: analysts triage in one place; downstream logic
   (scoring, exports, metrics) is written once.
3. **Raw data is immutable; corrections are an overlay.** Rationale: audit integrity (Phase
   10's audit trail is meaningless if values silently mutate), reversibility, and the ability
   to re-run validation against raw *or* edited views.
4. **Advisory AI only.** LLM components draft rules and explain anomalies; they never
   auto-correct and never auto-disposition. Rationale: trust calibration in a domain with
   strong data-integrity norms, and drafts are cheap to review because of principle 1.
5. **Client-side execution, server-side persistence** (V1). The engine runs in the browser
   over `fetchResponses()` exactly like the Analyzer does. Rationale: matches the platform's
   architecture (no server compute exists in prod — browser→Supabase), and demo-scale data
   (hundreds of responses) doesn't justify building one. The engine package is pure TS with
   no DOM dependencies so it can move server-side later without changes (§10 risk R2).
6. **Metadata first.** Anything derivable from the instrument (types, code lists, min/max,
   required, table totals, routing) is generated automatically and never authored by hand.
   Rationale: it's the cheapest correctness win and it's the layer generic tools (e.g.
   Great Expectations) make users write by hand — our schema already encodes it.

## 3. Architecture

```
packages/validation-engine        NEW — pure TS, zero React/DOM deps
  src/types.ts                    Flag, Rule, Disposition, RunResult, ScoredFlag …
  src/metadataChecks.ts           L1 checks generated from an Instrument
  src/editRerun.ts                L2: re-run instrument edits via flattenInstrument
  src/ruleRunner.ts               L2: evaluate validator-authored rules
  src/statChecks.ts               L3: outliers, duplicates, missingness, paradata
  src/confront.ts                 L4 (V2): reference-dataset comparison
  src/score.ts                    selective-editing scoring
  src/run.ts                      orchestrator: full validation run over a dataset
  src/__tests__/…

apps/hub
  src/ValidatorView.tsx           NEW — tile + triage UI (queue, record view, dispositions)
  src/validatorApi.ts             NEW — Supabase/local-API persistence for runs/flags/
                                  rules/corrections/annotations/reference datasets
  src/App.tsx                     new 'validator' tile (status: live, tag: Testing)

apps/api                          local-dev fallback parity
  src/db.ts                       new tables (see §6) + seed
  src/index.ts                    /api/v1/validator/* CRUD
```

**Why a new package** rather than folding into `runtime-engine`: the runtime engine is
per-session and ships to respondents' browsers; the validation engine is per-dataset and
ships only to the hub. Separate bundles keep the respondent app lean, and the dependency
direction is one-way (`validation-engine` imports `runtime-engine` + `expression-engine` +
`instrument-schema`; nothing imports it back).

### Data flow of a validation run

```
fetchSurveyInstrument(id)  ─┐
fetchResponses(id)         ─┤
fetchSurveyParadata(id)    ─┼─▶ runValidation(cfg) ─▶ RunResult{flags[]} ─▶ persist run+flags
validator rules (table)    ─┤        │
corrections overlay        ─┤        ├─ per-record pass  (L1, L2, per-record L3)
reference datasets (V2)    ─┘        └─ dataset pass     (cross-record L3, L4, scoring)
```

Two-phase execution inside `runValidation` because L1/L2 need only one record at a time
(streamable) while outlier detection and duplicates need the full column/dataset. Both phases
are synchronous pure functions over in-memory arrays — no IO in the engine package, all IO in
`validatorApi.ts`. This is what makes the engine trivially unit-testable and portable.

## 4. Data model concepts (TypeScript)

```ts
// packages/validation-engine/src/types.ts

export type CheckKind =
  | 'metadata'        // L1, generated from instrument
  | 'instrument-edit' // L2, re-run of a collection-time edit
  | 'rule'            // L2, validator-authored expression rule
  | 'stat'            // L3, statistical (outlier, duplicate, missingness, paradata)
  | 'confront'        // L4, reference-dataset comparison (V2)
  | 'llm';            // L5, LLM-drafted suspicion (V3, always severity 'query')

export type Severity = 'fatal' | 'query';
// Maps 1:1 to the platform's hard/soft. 'fatal' = cannot publish/export the record
// unresolved; 'query' = needs review. Same vocabulary end-to-end on purpose.

export interface ValidationFlag {
  id: string;
  runId: string;
  responseId: string;              // ResponseRow.id
  respondentId: string;
  variableName: string | null;     // null = record-level flag (e.g. duplicate, speeder)
  instanceKey: string | null;      // exact answersJson key (`name@`, `name@i=2`) when cell-level
  checkKind: CheckKind;
  checkId: string;                 // e.g. 'range:revGross', 'edit.funds.balance', 'mad:RD_TOT_TOT'
  severity: Severity;
  message: string;                 // human-readable, EN (bilingual deferred; analyst-facing tool)
  observed: unknown;               // value snapshot at flag time (survives later correction)
  expected?: string;               // e.g. '0 ≤ x ≤ 100', 'ref: 6800 ±10%'
  suspicion: number;               // 0..1, how anomalous (per-check heuristic, §7)
  impact: number;                  // 0..1, how much this value matters (§7)
  score: number;                   // suspicion × impact — queue sort key
}

export type DispositionAction =
  | 'accept'      // value is correct as reported; suppresses this checkId+instanceKey pair
  | 'correct'     // analyst supplies a new value → corrections overlay
  | 'follow-up'   // route to recontact (CATI case or manual); flag stays open
  | 'suppress';   // check is wrong/noisy here; suppress + feed rule calibration

export interface Disposition {
  flagId: string;
  action: DispositionAction;
  reason: string;                  // free text, REQUIRED — this is tacit-knowledge raw material
  correctedValue?: unknown;        // when action === 'correct'
  decidedBy: string;               // analyst identifier (free-text v1; no auth system yet)
  decidedAt: string;               // ISO
}

export interface ValidatorRule {
  id: string;
  surveyId: string;
  name: string;
  when: string;                    // expression-engine source; TRUE ⇒ flag fires
  message: string;
  severity: Severity;
  variableName: string | null;     // primary variable the flag attaches to
  source: 'authored' | 'elicited' | 'llm';   // provenance — display + trust signal
  sourceFlagId?: string;           // for 'elicited': the disposition that spawned it
  active: boolean;                 // rules are deactivated, never deleted (audit)
  createdAt: string;
}

export interface VariableAnnotation {   // V3, but the table ships in V1 (cheap, useful early)
  surveyId: string;
  variableName: string;
  note: string;                    // free-text domain knowledge
  author: string;
  updatedAt: string;
}
```

Design notes:

- **`observed` snapshot on the flag** — a flag must remain meaningful after the underlying
  value is corrected, otherwise the audit trail reads as nonsense ("flagged 4000000, current
  value 4000" with no explanation).
- **`instanceKey` vs `variableName`** — `answersJson` keys are runtime instance keys
  (`revGross@`, `T_a_x@i=2` inside rosters). Flags carry both the base variable name (for
  grouping/annotations) and the exact instance key (for locating/correcting the cell).
- **`accept` suppresses per (checkId, instanceKey)** — re-running validation must not
  resurrect flags an analyst already judged. Suppression is keyed to the check *and* the
  cell, so a *different* check on the same cell still fires, and the same check fires again
  if the value later *changes* (suppression stores the accepted value; a changed value
  invalidates it).
- **`reason` is required on every disposition.** This is deliberate friction: the reason
  string is the raw material for rule elicitation (§8.2) and LLM context (§8.3). One
  sentence, but never empty.

## 5. Check taxonomy (Eurostat levels → concrete checks)

### 5.1 Level 1 — metadata-derived (`metadataChecks.ts`) — V1, zero authoring

Generated by walking the instrument once. For each variable/question:

| Check id pattern | Source of truth | Fires when |
|---|---|---|
| `type:{var}` | `Variable.representation` | value not coercible to declared type |
| `range:{var}` | numeric domain `min`/`max`/`decimals` | out of range / wrong precision |
| `code:{var}` | question's category scheme | code not in scheme (incl. multi-select members) |
| `required:{var}` | `required: true` + routing | missing on a path where the question was visible |
| `unexpected:{var}` | routing (`visibleWhen`, conditions) | answered on a path where it was NOT visible |
| `tablebounds:{prefix}` | table domain min/max/decimals/disabledCells | cell out of bounds, or a disabled cell has a value |

`required`/`unexpected` need routing evaluation per record — implemented by re-flattening
(§5.2), which yields visibility for free; not re-implemented.

**Why generate rather than author:** this whole layer exists in the schema already; hand-
authoring it is pure toil and drifts from the instrument. Generated checks are recomputed
from the current instrument at run time — no stored artifacts to go stale.

### 5.2 Level 2 — consistency (`editRerun.ts`, `ruleRunner.ts`) — V1

**Instrument-edit re-run.** For each response, call
`flattenInstrument(instrument, { responses: answersJson, sample: {}, language: 'en' })`
and harvest every item's `firedEdits`. This is the single highest-fidelity reuse in the
design: flattening already evaluates authored hard/soft edits with correct loop scoping,
table semantics, synthetic totals (`RD_TOT_TOT` etc.), and routing — the Validator gets
byte-identical edit behavior to the runtime **by construction**, with zero reimplementation.
The known grid/markAll gap (AGENTS.md Open Bugs 2026-07-03: `flatten.ts` emits
`firedEdits: []` for those kinds) should be fixed as a precursor task — the Validator
inherits whatever flatten does, which is the argument *for* this reuse (one fix, two
systems healed) rather than against it.

**Validator-authored rules.** Evaluated with the runtime's own scope machinery:

```ts
const synthetic = buildSyntheticTotals(instrument);      // table totals resolve
const ctx = makeContext(instrument, answersJson, {}, [], synthetic);
const fired = Boolean(evaluateSource(rule.when, ctx));
```

Root scope (`[]`) means rules reference top-level variables and synthetic table totals
(`isAnswered($RD_TOT_TOT) && $RD_TOT_TOT > 10 * $deptBudget`). **Known V1 limitation:**
rules cannot target individual roster iterations (a rule referencing a roster variable sees
the root-scope resolution). Documented in the UI; the fix (iterate scopes discovered by
flatten and evaluate per scope) is mechanical and scheduled for V2 — deferred only because
establishment-survey rules overwhelmingly target top-level and table variables.

The rule editor reuses the designer's expression-editing pattern: `compile()` for live
syntax feedback, `variablesUsed()` to verify referenced variables exist in the instrument,
`FUNCTION_NAMES` for autocomplete. Expressions use `==`/`!=` (never `===`) per the platform
convention — any rule-*generating* code (metadata, elicitation, LLM prompt) must emit the
two-char forms.

### 5.3 Level 3 — statistical, within-dataset (`statChecks.ts`) — V1 core, V2 extensions

V1 (chosen for high value on small samples and no tuning burden):

- **Robust univariate outliers** — per numeric variable (including table cells and synthetic
  totals), modified z-score via MAD: flag |z| > 3.5, suspicion scaled from |z|. MAD over
  stddev because establishment data is heavy-tailed and stddev-based z is masked by the very
  outliers it hunts. Skip variables with < 8 observed values (meaningless statistics —
  silently skipped checks are listed in the run summary, per no-silent-caps).
- **Duplicate submissions** — exact: hash of `answersJson`; near: same `respondentId` with
  multiple completed responses. Record-level flags.
- **Missingness profile** — per variable, item-nonresponse rate vs dataset mean; flags
  *variables* (record-level flag on the run, informational) rather than records — a 40%-blank
  variable is a collection problem, not 40 record problems. Keeps the queue clean.
- **Paradata checks** — `duration_ms` speeders (below max(60s, 5th percentile) for completed
  responses), straight-lining (identical code across every row of a grid question). Paradata
  is a differentiator we already collect — most validators never see timing data.

V2: **Hidiroglou–Berthelot ratio edits** (current/previous-cycle ratio, transformed +
magnitude-weighted — the establishment-statistics standard, unlocked by cycle linking in
§5.4), user-defined **ratio pairs** ("fuel cost / km driven ∈ [0.05, 0.4]") which are just
sugar over L2 rules.

Explicitly rejected for now: Benford's law (needs thousands of records; noise at our scale),
multivariate outliers/Mahalanobis (unstable on small n, hard to explain to analysts —
explainability drives disposition quality).

### 5.4 Level 4 — cross-source confrontation (`confront.ts`) — V2

The scoping decision (from the design discussion): **entity resolution is explicitly out of
scope.** The user supplies the join; the tool does the comparison well.

```ts
export interface ReferenceDataset {
  id: string; surveyId: string; name: string;
  keyVariable: string;             // survey variable holding the join key
  keyColumn: string;               // reference column holding the join key
  columns: string[];
  rows: Record<string, unknown>[]; // parsed CSV, stored as JSONB
  uploadedAt: string;
}

export interface ConfrontationMapping {
  id: string; datasetId: string;
  surveyExpr: string;    // expression over survey vars: '$revGross' or '$RD_TOT_TOT + $RSA_TOT_TOT'
  refColumn: string;
  transform?: string;    // expression over $ref, e.g. '$ref / 1000'  (unit alignment)
  tolerancePct?: number; // relative tolerance
  toleranceAbs?: number; // absolute tolerance (either/both; both ⇒ pass if within either)
  severity: Severity;
  label: string;         // 'Revenue vs. CRA admin file'
}
```

Check: exact-match join on key → evaluate `surveyExpr` (root-scope `makeContext`, so table
totals work) → evaluate `transform` on the reference value → compare with tolerance →
flag with `expected: 'ref: 6,800 ±10%'`. Unmatched keys produce two informational flags
("in survey, not in reference" / vice versa) because coverage gaps are themselves findings.

**Why expressions on both sides:** unit conversions ('000s vs units) and derived comparisons
(survey *sum* vs one reference column) fall out for free from the engine we already have,
instead of a bespoke mapping mini-language.

Three reference sources, same mechanism: uploaded CSV, **another survey's responses** in the
platform (exported to the same shape; `metadata-registry` TF-IDF suggests variable pairings,
human confirms), and **previous cycle** of the same survey (same instrument ⇒ mappings are
auto-generated 1:1; this is the reference analysts trust most and it unlocks HB ratio edits).

**Macro-confrontation** (also V2, small but high-leverage): compare dataset *aggregates*
(sum/mean of a variable) against user-entered benchmark values ("published total for this
cell was $412M"). One systematic problem (unit confusion across many respondents) shows up
loudly at the aggregate level while every individual record looks plausible.

### 5.5 Level 5 — tacit knowledge (§8) — annotations V1, elicitation + LLM V3

## 6. Persistence

Supabase tables (prod) with local-API/SQLite parity (on-prem). SQL below is the Supabase
form; `apps/api/src/db.ts` mirrors it (mind the Phase-11 lesson: **no
`ADD COLUMN IF NOT EXISTS` in SQLite** — probe `PRAGMA table_info` for migrations).

```sql
create table validation_runs (
  id text primary key,             -- 'vr-<ts36>'
  survey_id text not null references surveys(id) on delete cascade,
  started_at timestamptz not null,
  config_json jsonb not null,      -- which check families ran, thresholds
  summary_json jsonb not null      -- counts by severity/kind, skipped checks
);

create table validation_flags (
  id text primary key,
  run_id text not null references validation_runs(id) on delete cascade,
  survey_id text not null,
  response_id text not null,
  respondent_id text not null,
  variable_name text,
  instance_key text,
  check_kind text not null,
  check_id text not null,
  severity text not null,
  message text not null,
  observed_json jsonb,
  expected text,
  suspicion real not null,
  impact real not null,
  score real not null,
  status text not null default 'open',   -- open|accepted|corrected|follow_up|suppressed
  disposition_json jsonb                  -- Disposition, embedded (1:1, immutable once set)
);

create table validation_corrections (
  id text primary key,
  survey_id text not null,
  response_id text not null,
  instance_key text not null,
  old_value_json jsonb,
  new_value_json jsonb,
  reason text not null,
  flag_id text references validation_flags(id),
  decided_by text not null,
  decided_at timestamptz not null
);

create table validator_rules (      -- ValidatorRule (§4)
  id text primary key, survey_id text not null, name text not null,
  when_expr text not null, message text not null, severity text not null,
  variable_name text, source text not null, source_flag_id text,
  active boolean not null default true, created_at timestamptz not null
);

create table validation_suppressions (   -- 'accept' memory across runs
  survey_id text not null, response_id text not null,
  check_id text not null, instance_key text,
  accepted_value_json jsonb,             -- re-fires if value changes
  flag_id text not null, created_at timestamptz not null,
  primary key (survey_id, response_id, check_id, instance_key)
);

create table variable_annotations (
  survey_id text not null, variable_name text not null,
  note text not null, author text not null, updated_at timestamptz not null,
  primary key (survey_id, variable_name)
);

create table reference_datasets (        -- V2
  id text primary key, survey_id text not null, name text not null,
  key_variable text not null, key_column text not null,
  columns_json jsonb not null, rows_json jsonb not null,
  uploaded_at timestamptz not null
);
create table confrontation_mappings (    -- V2; ConfrontationMapping (§5.4)
  id text primary key, dataset_id text not null references reference_datasets(id) on delete cascade,
  survey_expr text not null, ref_column text not null, transform_expr text,
  tolerance_pct real, tolerance_abs real, severity text not null, label text not null
);
```

RLS: same public-by-design posture as the rest of the demo (AGENTS.md decision 2026-06-26);
anon insert/select/update policies on the new tables, documented in `DEPLOYMENT.md` §9 style.
Revisit with the deferred RLS-lockdown plan when real data arrives.

Design decisions worth restating:

- **6.1 Annotations live in a table, not the instrument.** Attaching notes to
  `Variable` would mean domain knowledge accrues only by editing + re-publishing the
  instrument, couples an analyst artifact to a designer artifact, and pollutes DDI export.
  Keyed on `(survey_id, variable_name)` they evolve freely post-publication. (If sharing
  annotations across surveys via the metadata registry becomes a need, that's a later
  registry feature — not a reason to complicate v1.)
- **6.2 Dispositions are embedded in the flag row** (1:1, write-once) rather than a table —
  no re-disposition workflow exists in v1; changing your mind = new run, new flag. Audit
  events additionally go to the existing Phase-10 `logAudit()` channel
  (`validator.run`, `validator.disposition`, `validator.correction`, `validator.rule_created`).
- **6.3 Corrections overlay.** `answers_json` on `responses` is **never mutated**. The
  effective ("edited") dataset = raw + latest correction per `instance_key`, materialized by
  a pure `applyCorrections(raw, corrections)` in the engine. Validation runs execute against
  the *edited* view (else corrected values keep re-flagging); exports offer raw / edited /
  redacted-edited (composing the Phase-10 `redactResponses()`).
- **6.4 Exploration-only surveys** (`collectsData: false` — `lfs`, `fsep`) have no responses
  to validate. The Validator survey picker lists only collecting surveys (registry-driven via
  `surveyCollectsData()`, per convention — no ad-hoc id checks). Demo story: the `demo`
  survey's live responses. A bundled **synthetic response fixture** for `fsep` (generated by
  `questionnaire-bot`, seeded with deliberate errors: unit slips, transposed cells, a
  duplicate, a speeder) ships as a local mock so the establishment-data checks are
  demonstrable without real data — it loads client-side only, satisfying the never-persist
  rule.

## 7. Selective-editing scoring (`score.ts`)

Every check emits `suspicion ∈ [0,1]`; the runner computes `impact` and `score = suspicion ×
impact`. The queue sorts by score descending; that ordering **is** the product.

- **Suspicion** per check family: binary checks (type/code/required/edits) = 1.0 for fatal,
  0.6 for query; MAD outliers = scaled from |z| (3.5→0.5, ≥8→1.0); confrontation = scaled
  from how far outside tolerance; duplicates/speeders = fixed 0.7.
- **Impact** v1 = the flagged value's share of its variable's column total
  (`|v| / Σ|v|`, 0.5 default when non-numeric/record-level), i.e. "how much would published
  estimates move if this value is wrong." V2 lets the analyst designate *impact variables*
  (e.g. weight × revenue) per survey. This is deliberately simple — the point is *ordering*,
  not a defensible estimate of publication error.
- **Calibration loop** (V3): disposition history per check id (accept rate, correction rate)
  is surfaced next to each rule ("87% of this rule's flags were accepted as-is") and
  suggested threshold changes. Suppress-dispositions weigh heaviest. No silent auto-tuning —
  suggestions only, same advisory posture as the LLM.

## 8. The tacit-knowledge ratchet

Three mechanisms, in increasing order of automation. The ratchet property: **every analyst
action leaves an artifact that makes the next run smarter.**

### 8.1 Annotations (V1)

Free-text notes per variable (§6.1), editable inline in the triage UI, displayed whenever a
flag on that variable is reviewed. Zero execution semantics in V1. Why first: lowest
possible friction, immediately useful (the note IS the tacit knowledge, readable at exactly
the right moment), and it accumulates the corpus that §8.3 later consumes.

### 8.2 Rule elicitation from dispositions (V3)

The disposition dialog's required `reason` feeds a "generalize this?" prompt:

- **accept** + reason → offer a *suppression rule* draft: this check, narrowed by a
  condition ("accept large `RD_TOT_TOT` when `remarks` is non-empty" →
  `len($remarks) > 0` guard).
- **correct** + reason → offer a *detection rule* draft for the error pattern just fixed
  (unit slip corrected ÷1000 → draft a ratio rule that catches ×1000 values on that
  variable).

Drafts are prefilled expression-engine source shown in the rule editor (compile-checked,
`variablesUsed`-verified); the analyst edits and saves or discards. Saved rules get
`source: 'elicited'` + `sourceFlagId` so provenance is inspectable forever. Why this design:
the moment of disposition is when the analyst's reasoning is *explicit and fresh* — asking
"why" then costs one sentence; asking a month later costs an interview.

### 8.3 LLM assistance (V3, pluggable, advisory-only)

Provider abstraction (`ValidatorLlm` interface; Anthropic API implementation, key supplied
by the deployment, feature hidden without one — same graceful-absence pattern as CATI
without the local API). Two capabilities:

1. **Annotation → rule drafting.** Input: variable metadata + annotations + a data profile
   (min/max/quantiles). Output: candidate rules in expression-engine syntax (prompt includes
   the grammar + function whitelist + the `==`/`!=` convention). Every draft passes
   `compile()` + `variablesUsed()` gates before it is even *shown*; rejected drafts are
   dropped silently. Saved with `source: 'llm'`.
2. **Per-record anomaly explanation.** For a high-score flag, assemble context — the record,
   the flag, annotations for its variables, and dispositions of similar past flags (same
   check id, nearest values) — and produce a short "this resembles case X (accepted:
   restructuring); the remarks field mentions a merger" narrative with a recommended
   disposition. Displayed in the flag detail pane; never auto-applied.

Why LLM *here* and not as a first-class checker: grounded in annotations + disposition
history, the model applies *recorded* institutional knowledge; ungrounded, it hallucinates
domain rules. The ratchet (8.1, 8.2) is what makes 8.3 trustworthy — sequencing them in one
phase is deliberate.

### PII note

LLM context includes response values. `Variable.isPII` already exists — PII variables are
passed through `redactResponses()` before any LLM call, unconditionally. Names/emails are
never needed to judge numeric plausibility.

## 9. UI (hub `ValidatorView`)

New home-screen tile: **Validator** — "Flag, confront, and correct collected data" (tag:
Testing, live). Internal navigation view like Analyzer/Migrator (`onNavigate('validator')`).

Screens (V1):

1. **Survey picker + run panel** — collecting surveys only; check-family toggles +
   thresholds (persisted as run config); "Run validation"; run history with summary chips.
2. **Flag queue** — table sorted by score: severity dot, score bar, respondent, variable,
   message, observed/expected, status. Filters: status / severity / check kind / variable.
   Bulk accept for identical (checkId, reason) groups — flag fatigue relief.
3. **Record view** — one response, all its answers (edited view), flags inline beside the
   values they attach to, annotations beside variables, table questions rendered as tables
   (reuse the compact `pv-*` table rendering pattern), disposition dialog (action + required
   reason + corrected value input validated against the variable's domain).
4. **Rules manager** — validator rules list (provenance badge, active toggle, fire/accept
   stats), editor with live compile feedback; read-only list of instrument edits
   ("managed in Designer") so analysts see the *whole* rule surface in one place.
5. **Annotations** — per-variable notes editor (also editable inline from the record view).

V2 adds: reference-dataset upload (CSV → key pick → mapping table with expression fields +
tolerances + live preview against 5 records), macro-benchmark entry, cycle-link picker.
V3 adds: elicitation prompts in the disposition flow, LLM panels.

**Follow-up routing:** a `follow-up` disposition creates/updates a CATI case via the
existing local-API case endpoints when the local API is present (on-prem deployments — CATI
is local-only per Phase 11); otherwise the flag simply holds `follow_up` status as a
worklist. No new infrastructure.

## 10. Risks & mitigations

- **R1 — Flag fatigue** (the classic failure). Mitigations: selective-editing scores as the
  primary sort, missingness flags at variable level not record level, bulk dispositions,
  suppression memory across runs, calibration stats per rule (V3).
- **R2 — Browser-scale limits.** In-memory over thousands of responses × hundreds of
  variables is fine; tens of thousands is not. Mitigation: engine is pure TS with all IO
  outside (§3), so it can move behind the local API or an edge function without rewriting
  checks. Run config caps + a visible "N responses analyzed" line (no silent truncation).
- **R3 — Rule-language ceiling.** Some real edits (regex-ish string checks, date arithmetic)
  exceed the current function whitelist. Mitigation: extend the whitelist in
  `expression-engine` (the sanctioned path per AGENTS.md) as needs surface, benefiting the
  whole platform; never a second engine.
- **R4 — grid/markAll edit gap** (open bug 2026-07-03) becomes a Validator gap via the
  flatten re-run. Fix in `flatten.ts` as precursor task P0 (small: mirror the table branch).
- **R5 — Correction integrity.** A correction must be validated against the variable's
  domain before save (no fixing an error by introducing a type error), and the corrections
  overlay must be visibly distinguishable in exports (edited-view CSV includes a
  `_corrected` companion column per corrected variable).
- **R6 — LLM trust/PII.** Advisory-only + compile-gated drafts + `isPII` redaction (§8.3).

## 11. Phasing & acceptance criteria

**P0 (precursor, tiny):** fix grid/markAll `firedEdits` in `flatten.ts` (+ unit test in
`paginate.test.ts` pattern). Closes the open bug; makes §5.2 sound.

**V1 — foundation.** `validation-engine` package (types, metadata checks, edit re-run, rule
runner, stat checks v1, scoring, orchestrator); persistence tables + `validatorApi.ts` +
local-API parity; ValidatorView screens 1–5; annotations; corrections overlay + edited/raw
export; audit events; `fsep` synthetic error fixture.
*Accept when:* a run over `demo` responses produces a scored queue; every check family
demonstrably fires on the fixture; accept/correct/follow-up/suppress round-trip and survive
re-runs (suppression memory); corrected export shows overlay, raw untouched; all tests +
typecheck pass; Playwright walk of run → triage → disposition → re-run.

**V2 — confrontation.** Reference upload + mappings + tolerances; unmatched-key flags;
previous-cycle auto-mapping; HB ratio edits; macro-benchmarks; ratio-pair sugar; per-scope
rule evaluation (lifts the V1 root-scope limitation).
*Accept when:* CSV keyed on an id variable confronts `fsep` fixture values end-to-end with
a unit-transform mapping; cycle comparison flags a seeded 10× error; HB test vectors match
reference implementation.

**V3 — tacit ratchet.** Elicitation drafts from dispositions; provenance + calibration
stats; `ValidatorLlm` + rule drafting + record explanation (redacted, advisory).
*Accept when:* an accept-disposition can be generalized to a working suppression rule in ≤3
clicks; LLM drafts always compile or are dropped; explanation panel cites the annotations
and prior dispositions it used.

## 12. Explicit non-goals (v1–v3)

Automated imputation (suggest-only correction is the ceiling; Banff-style donor/model
imputation is a separate future phase), fuzzy/probabilistic record linkage, ML anomaly
models (rules + robust stats until disposition history exists to train on), real-time
collection validation (that's the edit system), multi-analyst workflow/assignment/locking
(no auth system exists), bilingual analyst UI (respondent-facing stays bilingual; the
analyst tool ships EN-first).

## 13. Decision log

| Decision | Why (short) |
|---|---|
| One expression language everywhere | Safety (no eval), one authoring UI, LLM output reviewable |
| Client-side engine, pure-TS package | Matches browser→Supabase architecture; portable later |
| Re-run `flattenInstrument` for L2 | Byte-identical edit semantics by construction |
| Raw immutable + corrections overlay | Audit integrity, reversibility, re-runnable |
| Confrontation = explicit keys/mappings | Entity resolution deferred honestly, not half-solved |
| Annotations in a table, not the instrument | Knowledge evolves post-publication; DDI stays clean |
| Required disposition reasons | Cheap at decision time; feeds elicitation + LLM grounding |
| Selective-editing scores | Flag fatigue is the #1 real-world failure mode |
| LLM advisory-only, compile-gated, redacted | Trust calibration; grounded in the ratchet's corpus |
| Suppression keyed (check, cell, value) | Re-runs must respect judgments; value change re-opens |
