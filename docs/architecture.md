> **Reference only — not actively maintained.** For current state see `AGENTS.md` (phase status, bugs) and `H:\My Drive\Brain2\Projects\mobilesurvey.md` (requirements, decisions).

# Architecture Overview

mobilesurvey is a DDI-compliant, mobile-first survey design and Electronic Questionnaire (EQ)
authoring platform. This document covers the architectural pillars and the decisions taken for
**Iteration 1**; the three execution phases from the original specification are detailed in
[phase1-schema.md](phase1-schema.md), [phase2-state-engine.md](phase2-state-engine.md) and
[phase3-components.md](phase3-components.md).

## Architectural pillars

### A. Standards-based design (DDI)
Every structural element authored in the tool maps to a DDI-Lifecycle / Codebook metadata object
(Variable, ResponseDomain, ControlConstruct, Concept, Universe, CategoryScheme, Loop, …). The
mapping is enumerated in [phase1-schema.md](phase1-schema.md).

### B. Separation of concerns
The **instrument specification** (a strict, validated JSON document) is fully decoupled from both
the **rendering engine** and the **runtime state engine**. This is enforced at the dependency
level by splitting the code into independent packages:

```
packages/instrument-schema   the contract: TS types + Zod + validation + JSON Schema
packages/expression-engine   the logic core: parse/evaluate (no eval), shared by all layers
packages/runtime-engine      the state engine: flatten + piping + edits + XState machine
apps/designer                the authoring UI (consumes the three packages above)
apps/runtime  (future)        respondent-facing EQ (will reuse the same three packages)
```

The designer never reaches around the schema; the runtime never imports designer code. A future
respondent runtime can be built on the exact same `instrument-schema`, `expression-engine` and
`runtime-engine` without touching the authoring tool.

### C. Security & access (interface seams in Iteration 1)
Respondent access codes, encrypted session caching, and the CMS round-trip are defined as
TypeScript interfaces (`apps/designer/src/integrations/types.ts`) with mock implementations.
This keeps the data-flow boundary real while deferring the backend. See
[phase3-components.md](phase3-components.md#integration-boundary).

## Data flow

```
[Sample file]  ─ contact info + auxiliary pre-fills ─┐
                                                      ▼
                       ┌──────────── CMS ────────────┐  (resolveAccessCode → case + pre-fills)
                       │  access code → case + sample │  (reportStatus ← EQ)
                       └──────────────┬───────────────┘
                                      ▼
                       ┌──── Electronic Questionnaire ────┐
                       │  instrument-schema  (definition) │
                       │  expression-engine  (logic)      │
                       │  runtime-engine     (state)      │
                       └──────────────┬───────────────────┘
                                      ▼
                       ┌──── Paradata / Analytics ────┐  (ParadataSink — buffered in Iter 1)
                       └──────────────────────────────┘
```

In Iteration 1 the EQ is exercised by the designer's **Preview** pane, which drives the
`runtime-engine` XState machine over a mock sample profile.

## Technology decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | One type system across schema, engine and UI. |
| Schema validation | Zod (+ `zod-to-json-schema`) | Single runtime source of truth; emits a JSON Schema artifact. |
| Logic evaluation | Custom AST parser/evaluator | No `eval`/`Function`; author-authored expressions cannot reach host globals. |
| Runtime state | XState v5 | Explicit, inspectable state machine — the seam for pagination/persistence/paradata. |
| UI | React 18 + Vite | Fast mobile-first SPA. |
| Designer document state | Zustand + Immer | Immutable edits with cheap structural sharing; simple undo/redo history. |
| Accessible primitives | Radix UI + semantic HTML | WCAG 2.1 AA baseline (keyboard, ARIA, focus). |
| Monorepo | pnpm workspaces | Enforces package boundaries; shared tooling. |

## Repository layout

See [the repo README](../README.md) for the full tree and run/build/test commands.

## What is deferred (and where it plugs in)

- **Respondent runtime app** (`apps/runtime`): reuses the three packages; the `runtime-engine`
  machine is the extension point (pagination, resume).
- **Real backend**: implement `SampleProvider`, `CmsClient`, `ParadataSink`, `SessionStore`
  (interfaces already defined) against an API + database.
- **Encrypted session caching**: replace the base64 placeholder in `localSessionStore` with
  WebCrypto AES-GCM keyed by the session token.
- **Advanced lookup data**: back the `lookup` response domain with a real taxonomy service
  (fuzzy/auto-suggest/hierarchical).