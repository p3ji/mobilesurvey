# mobilesurvey

A DDI-compliant, **mobile-first survey design & Electronic Questionnaire (EQ) authoring tool**,
built to national-statistical-agency standards: extreme structural flexibility, multi-layer
validation, strict accessibility, and a strict separation between the instrument **definition**,
the **rendering** layer, and the **runtime state engine**.

> **Iteration 1** delivers the architecture blueprint (`docs/`) plus a runnable scaffold: the
> DDI instrument schema, a safe expression engine, a thin runtime state engine, and the
> **authoring/design tool** with a live preview. Backend concerns (sample ingestion, CMS,
> paradata, encrypted session storage) are mocked behind interfaces. See
> [`docs/architecture.md`](docs/architecture.md).

## Quick start

```bash
npm i -g pnpm        # if you don't have pnpm
pnpm install
pnpm --filter @mobilesurvey/designer dev   # → http://localhost:5173
```

Other commands:

```bash
pnpm test        # all Vitest suites
pnpm typecheck   # typecheck every package
pnpm build       # production build of the designer
```

## What you can do in the designer

- Author a DDI instrument: sections, questions, branches, **rosters and nested rosters**,
  derived/hidden variables, statements and computations — via the **Structure** tree.
- Edit **bilingual** labels, response domains, **soft/hard validation edits**, **visibility /
  routing conditions** (with live parse feedback), and **pre-fill mappings**.
- **Preview** the questionnaire live in a mobile frame: routing, nested rosters, text piping,
  pre-fill, language toggle, and soft/hard edits all evaluate in real time.
- Export / import the instrument as validated JSON, and download the generated JSON Schema.

The default document is a bilingual (EN/FR) household & employment survey demonstrating every
feature (see `packages/instrument-schema/src/examples/household.instrument.ts`).

## Repository layout

```
packages/
  instrument-schema   DDI-aligned types + Zod validation + JSON Schema + example
  expression-engine   no-eval parser/evaluator shared by routing, visibility, derived, edits
  runtime-engine      flatten + piping + edit evaluation + XState machine (thin in Iter 1)
apps/
  designer            Vite + React authoring tool (Iteration-1 focus)
docs/                 architecture + the three-phase blueprint
```

## Documentation

- [Architecture overview](docs/architecture.md)
- [Phase 1 — DDI instrument schema](docs/phase1-schema.md)
- [Phase 2 — state engine & logic parser](docs/phase2-state-engine.md)
- [Phase 3 — component framework](docs/phase3-components.md)

## License

Unpublished / internal demo. No license granted yet.
