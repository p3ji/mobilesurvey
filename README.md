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
pnpm --filter @mobilesurvey/designer dev   # authoring tool → http://localhost:5173
pnpm --filter @mobilesurvey/runtime  dev   # respondent EQ  → http://localhost:5174
pnpm --filter @mobilesurvey/api      dev   # backend API   → http://localhost:8787 (optional)
```

The respondent runtime is the standalone questionnaire app: enter a demo access code
(`ABC123` or `DEF456`), answer page-by-page with live edit checks, reload to resume where you left
off, and submit to see the collected response data and the paradata trail.

If the **API** is running, the runtime app connects to it automatically and persists sessions and
paradata **server-side** (resume works across devices). If it isn't, the app falls back to local
in-browser storage, so the hosted demo works with no server. See
[backend-service.md](docs/backend-service.md).

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
feature (see `packages/instrument-schema/src/examples/lfs.instrument.ts`). Try the **▶ Render** button to see the full respondent-facing app with page navigation, conditional routing, and response collection.

## Live demo

[https://p3ji.github.io/mobilesurvey/](https://p3ji.github.io/mobilesurvey/)

## Repository layout

```
packages/
  instrument-schema   DDI-aligned types + Zod validation + JSON Schema + example
  expression-engine   no-eval parser/evaluator shared by routing, visibility, derived, edits
  runtime-engine      flatten + piping + edit evaluation + XState machine (thin in Iter 1)
apps/
  designer            Vite + React authoring tool (Iteration-1 focus)
  runtime             respondent-facing EQ app: access codes, resume, paradata (Phase 2)
  api                 Node/TS + SQLite backend implementing the integration interfaces (Phase 3)
docs/                 architecture + the phase blueprint
```

## User manuals

How-to guides for using the tools:

- [Manuals index](docs/manuals/README.md)
- [Authoring tool (designer)](docs/manuals/authoring-tool.md)
- [Respondent app (runtime EQ)](docs/manuals/respondent-app.md)
- [Expression language reference](docs/manuals/expression-language.md)

## Architecture & design docs

- [Architecture overview](docs/architecture.md)
- [Phase 1 — DDI instrument schema](docs/phase1-schema.md)
- [Phase 2 — state engine & logic parser](docs/phase2-state-engine.md)
- [Phase 3 — component framework](docs/phase3-components.md)
- [Backend service (API + SQLite)](docs/backend-service.md)
- [Phase 4 — metadata registry & semantic search](docs/phase4-metadata-registry.md)

## Contributing & feedback

Have a feature request, bug report, or idea? Reach out:

- **GitHub Issues**: [github.com/p3ji/mobilesurvey/issues](https://github.com/p3ji/mobilesurvey/issues)
- **Email**: [push.peji@gmail.com](mailto:push.peji@gmail.com)

## More work

Explore other projects: [portfolio-pi-lake-ypm5sq0qik.vercel.app](https://portfolio-pi-lake-ypm5sq0qik.vercel.app/#home)

## License

Unpublished / internal demo. No license granted yet.
