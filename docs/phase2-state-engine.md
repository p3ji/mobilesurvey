> **Reference only — not actively maintained.** For current state see `AGENTS.md` (phase status, bugs) and `H:\My Drive\Brain2\Projects\mobilesurvey.md` (requirements, decisions).

# Phase 2 — State Engine & Logic Parser

Two packages make up the runtime logic layer:

- `packages/expression-engine` — the shared logic core (parse + evaluate).
- `packages/runtime-engine` — flattening, piping, edit evaluation, and the XState machine.

## Expression engine

A single evaluator powers **routing, visibility, derived computation and edit rules** so the four
never diverge. It is deliberately small and safe — **no `eval`, no `Function`, no host access**.

- `lexer.ts` — tokenizes numbers, strings, `$variable` refs, operators, identifiers.
- `parser.ts` — precedence-climbing parser → AST (`ast.ts`). Keyword aliases `and/or/not`;
  function calls are `ident(`. Bare identifiers are a parse error (variables must be `$name`).
- `evaluator.ts` — tree-walking evaluator with a **whitelisted** function table
  (`count`, `sum`, `isAnswered`, `len`, `contains`, `matches`, `upper`, `lower`, `min`, `max`,
  `abs`, `round`, `floor`, `ceil`). Function lookup uses an own-property guard so inherited
  members (`constructor`, `toString`, …) are never reachable.

Public API (`index.ts`): `parse`, `evaluate`, `compile` (non-throwing, for live editor feedback),
`evaluateSource`, `evaluateCondition`, `variablesUsed` (static dependency analysis), and
`referencedVariables`.

```ts
evaluateCondition('$age >= 18 && $country == "CA"', { age: 20, country: 'CA' }) // true
variablesUsed('$a + count($b)')                                                 // ['a','b']
```

Coercion rules are predictable: arithmetic/`<,<=,>,>=` coerce to number (blank → `NaN`, so
comparisons on unanswered fields are `false`); `==`/`!=` are type-aware; `&&`/`||` short-circuit
and return booleans; `+` concatenates when an operand is a non-numeric string.

## Runtime engine

### Roster-aware state (`scope.ts`)
Answers are stored under instance keys that encode the loop path:

```
hhSize@                 (root)
memberName@m=1          (member 1)
employerName@m=1;e=2    (member 1, employer 2)   ← nested roster
```

`makeContext()` builds an `EvalContext` for a scope; resolution order is: **loop index → stored
answer at this/ancestor scope → derived variable (lazy compute, cycle-guarded) → sample field**.
Walking outward through ancestor scopes lets an inner question read an outer answer (e.g. an
employer question piping the member's name).

### Flattening (`flatten.ts`)
`flattenInstrument(instrument, state)` walks the `ControlConstruct` tree once and produces an
ordered list of render-ready items, while:

- evaluating `visibleWhen` / `IfThenElse` (**routing & visibility**),
- expanding `Loop` constructs into per-iteration instances — **nested loops supported** — with a
  safety cap to keep mobile browsers responsive,
- resolving `${…}` **piping** in text and per-item headings,
- running **soft/hard edits** (plus a synthetic localized "required" hard edit) per question
  instance,
- evaluating `ComputationConstruct`s into a cloned working copy (never mutating input).

It is **pure** and recomputed from state on every change — the model that the future paginated
runtime and the current preview share.

### XState machine (`machine.ts`)
A deliberately small v5 machine owns the canonical `RuntimeState` (`responses`, `sample`,
`language`). Iteration 1 has a single `active` state handling `ANSWER`, `SET_LANGUAGE`, `RESET`
and `COMPLETE`. This is the seam where later iterations add:

- **pagination** (current-screen sub-states, `NEXT`/`BACK` with hard-edit gating),
- **persistence** (encrypted `SessionStore` save/restore on every transition),
- **paradata emission** (invoke a `ParadataSink` actor on transitions: time-per-question,
  back-ups, answer changes, device/orientation).

Performance: flattening is O(visible nodes), recomputed via memoization keyed on
`(instrument, state)`; roster expansion is capped; structural sharing (Immer/Zustand) keeps
re-renders cheap.

## Runtime app (`apps/runtime`) — implemented

The standalone respondent EQ is built on the same three packages:

- **Access codes** — `AccessGate` resolves a code via `CmsClient.resolveAccessCode` → case +
  pre-fill sample. Demo codes `ABC123` / `DEF456`.
- **Pagination** — `paginate()` (shared in `runtime-engine`) groups the flattened items at page
  breaks; `pageHasHardEdits()` gates the Next/Submit button. Conditional pages
  (`visibleWhen` on a page sequence) appear/disappear live as answers change.
- **Resume / persistence** — progress (responses + current page) is saved to `SessionStore` on
  every change; re-entering the same code restores state via the machine's `restore` input. The
  saved session is cleared on submit.
- **Paradata** — a `ParadataSink` records `session_start`/`session_resume`, `page_next`,
  `page_back`, `answer`, `page_complete` and `submit`; the completion screen shows the trail.
- **Submission** — reports `completed` to the CMS and renders the collected responses in
  data-schema form (not persisted to any server in this demo).

The integration interfaces now live in `@mobilesurvey/runtime-engine` so the designer preview and
the runtime app share one contract. Still deferred: moving pagination *into* the XState chart as
explicit screen sub-states, WebCrypto session encryption, and a real backend behind the
interfaces.