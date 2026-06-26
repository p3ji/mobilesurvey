> **Reference only — not actively maintained.** For current state see `AGENTS.md` (phase status, bugs) and `H:\My Drive\Brain2\Projects\mobilesurvey.md` (requirements, decisions).

# Phase 3 — Component Framework

The authoring tool (`apps/designer`) is a Vite + React 18 + TypeScript SPA. It is the
Iteration-1 functional focus; the same component patterns and the `runtime-engine` will be reused
by the future respondent runtime.

## Layout

`App.tsx` is a three-pane workspace:

- **Left** (`Tabs`): `StructureTree` (the ControlConstruct tree with add/move/delete) and
  `VariablesPanel` (variables + pre-fill mappings).
- **Center**: `Inspector` — edits the selected construct or variable.
- **Right** (`Tabs`): `PreviewPane` (live runtime preview) and `SpecPanel` (JSON + validation).

State of the instrument-under-edit lives in a Zustand + Immer store
(`store/instrumentStore.ts`): `update(recipe)` applies an Immer producer and snapshots history,
giving cheap **undo/redo**. The active editing **language** and **selection** also live here.

## Inspector editors

`Inspector.tsx` dispatches on the selected node type:

- **Bilingual label editor** (`IntlStringField`): one input per declared language; the toolbar
  language toggle re-localizes everything instantly without losing edit state.
- **Response-domain editor**: switch type and edit type-specific options (code scheme + single/
  multiple, numeric min/max/decimals, text multiline/length, datetime mode, file, lookup).
- **Edits builder**: add/remove soft/hard rules, each with a condition and a bilingual message.
- **Condition builder** (`ConditionField`): an expression input backed by
  `expression-engine.compile()` showing **live parse errors** and the variables referenced.
- **Hidden/derived variable editor** and **pre-fill mapping editor** (against a mock sample
  profile).

## Live preview (`PreviewPane.tsx`)

Drives the `runtime-engine` XState machine via `@xstate/react` and renders the flattened
instrument inside a mobile device frame. Demonstrates routing, nested rosters, piping, pre-fill,
language toggle, and soft (amber) / hard (red) edits. Each response domain renders an accessible
control (radio groups for codes, checkboxes for multi-select, `datalist` for lookup, native
date/number inputs, etc.).

## Accessibility (WCAG 2.1 AA / Section 508)

- **Semantic HTML**: `nav`, `fieldset`/`legend`, `label`/`htmlFor`, `form`, headings.
- **Keyboard**: all interactive elements are native buttons/inputs; Radix `Tabs` provide roving
  focus; a global `:focus-visible` outline meets contrast.
- **ARIA**: `role="radiogroup"`/`group` with `aria-labelledby`, `aria-pressed` on the language
  toggle, `aria-current` on the selected tree node, `aria-invalid` + `role="alert"` for parse and
  hard-edit errors, `role="status"` for soft warnings.
- **Color**: status is never conveyed by color alone (icons ⛔/⚠ accompany edit messages).

## Integration boundary

`src/integrations/types.ts` defines the seams from the spec's data-flow diagram; `mocks.ts`
ships in-memory/local implementations:

| Interface | Responsibility | Iteration-1 mock |
| --- | --- | --- |
| `SampleProvider` | Ingest sample file (contact info + pre-fills) | In-memory sample units. |
| `CmsClient` | Access-code → case + pre-fills; report status | Trivial code→case map. |
| `ParadataSink` | Audit trail of respondent behaviour | Buffered in memory. |
| `SessionStore` | Encrypted, resumable session cache | `localStorage` + base64 **placeholder** — production must use WebCrypto AES-GCM. |

Because these are interfaces, a real backend implements them without any change to the schema,
the engine, or the UI.

## Run / build / test

```
pnpm install
pnpm --filter @mobilesurvey/designer dev     # http://localhost:5173
pnpm test                                    # all package suites
pnpm typecheck                               # all packages
pnpm build                                   # production build of the designer
```