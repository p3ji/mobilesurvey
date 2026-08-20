# mobilesurvey

A series of **free, open-source, modular apps that help individuals and organizations run
surveys** — design a questionnaire, run it on any device, collect the responses, and validate the
data afterward. It is **mobile-first**, **DDI-Lifecycle 3.3 compliant** (instruments export/import
as schema-valid DDI XML and FAIR JSON-LD), and built around a clean separation between the
instrument **definition**, the **rendering** layer, and the **runtime state engine** so each app
can be used on its own or together.

> The suite now spans a survey-management **hub**, an **authoring tool** with live preview and a
> question-reuse library, a standalone **respondent app** (including consent-gated GPS/camera
> questions), a post-collection **Validator**, an automated **questionnaire-testing bot**, and a
> searchable metadata corpus of ~195,000 real Statistics Canada survey variables. Production
> persistence is **Supabase**; see [AGENTS.md](AGENTS.md) for the full, actively-maintained phase
> status and [`docs/architecture.md`](docs/architecture.md) for the original Iteration-1 design
> (historical — the packages/apps below have grown well past it).

## Quick start

```bash
npm i -g pnpm        # if you don't have pnpm
pnpm install
pnpm --filter @mobilesurvey/hub      dev   # survey hub (start here) → http://localhost:5175
pnpm --filter @mobilesurvey/designer dev   # authoring tool          → http://localhost:5173
pnpm --filter @mobilesurvey/runtime  dev   # respondent EQ           → http://localhost:5174
pnpm --filter @mobilesurvey/api      dev   # local backend fallback  → http://localhost:8787 (optional)
```

The **hub** is the entry point: manage surveys, search/reuse questions (including the Statistics
Canada corpus), run the post-collection Validator, and launch the designer or respondent app for a
given survey. The respondent runtime can also be opened standalone: enter a demo access code
(`ABC123` or `DEF456`), answer page-by-page with live edit checks, reload to resume where you left
off, and submit to see the collected response data and the paradata trail.

**Backend:** production reads/writes go directly from the browser to **Supabase** (`VITE_SUPABASE_URL`
/ `VITE_SUPABASE_ANON_KEY`); this is what the hosted demo uses. The local **`api`** app (Hono +
`node:sqlite`) is a local-dev / air-gapped fallback used automatically when those env vars are
unset — see [DEPLOYMENT.md](DEPLOYMENT.md) for on-premises setup and [backend-service.md](docs/backend-service.md)
for the API's own design.

Other commands:

```bash
pnpm test        # all Vitest suites, every package
pnpm typecheck   # typecheck every package
pnpm build       # production build of the designer only (root script's current default)

# The GitHub Pages deploy (.github/workflows/deploy.yml) builds all three apps explicitly:
pnpm --filter @mobilesurvey/hub build
pnpm --filter @mobilesurvey/designer build
pnpm --filter @mobilesurvey/runtime build
```

## What you can do

### In the hub (survey management)

- **Collector** — create, publish, and monitor surveys; share respondent links; view a response
  dashboard with a redacted-CSV export (PII variables excluded per the instrument definition).
- **Searcher** — find and reuse questions, variables, and code lists across every survey in the
  hub ("Your surveys" scope), *or* search a **Statistics Canada** scope: ~195,000 real variable
  occurrences extracted from ~580 StatCan RDC documentation dictionaries, with subject facets, a
  typo-tolerant did-you-mean, a concept-clustering "Concepts over time" view that flags where a
  variable's coding changed across survey cycles, and a source-document viewer that opens every
  record at its cited page.
- **Migrator** — paste or upload a plain-text/Word/PDF questionnaire (including Statistics Canada
  EQ-dialect exports) and get back a live instrument with inferred response types and routing.
- **Validator** — post-collection data editing: metadata-derived checks, re-run of collection-time
  edits, robust statistical outliers, cross-source confrontation against a reference dataset, and
  analyst-authored rules, scored and triaged into one flag queue with optional LLM assistance.
- **Analyzer** — completion funnels, frequency distributions, and field-level charts from live
  responses.
- **Designer — Business Collection** — a form-first designer for establishment surveys (numeric
  grids, paste-from-Excel entry, balance edits), modeled on StatCan's FSEP questionnaire.
- **Interviewer Mode / Supervisor Dashboard** — CATI case queues and call-back scheduling
  (on-premises / local-API only; roadmap).

See [docs/manuals/hub.md](docs/manuals/hub.md) for the full manual.

### In the designer (authoring tool)

- Author a DDI instrument: sections, questions, branches, **rosters and nested rosters**,
  derived/hidden variables, statements and computations, and consent-gated **sensor questions**
  (GPS location, camera photo) — via the **Structure** tree.
- Edit **bilingual** labels, response domains, **soft/hard validation edits**, **visibility /
  routing conditions** (with live parse feedback), and **pre-fill mappings**.
- **Preview** the questionnaire live in a mobile frame: routing, nested rosters, text piping,
  pre-fill, language toggle, and soft/hard edits all evaluate in real time.
- Visualise the **flow logic** as a flowchart (questions, pages, branches and rosters) with zoom
  and SVG export.
- **Reuse questions** across surveys: the **Library** tab searches a metadata registry of the
  bundled surveys (non-exact / synonym search) and inserts a question, section, page, code list or
  variable into the current instrument — copying its dependencies automatically.
- Export / import the instrument as validated JSON, as **schema-valid DDI-Lifecycle 3.3 XML** or
  **FAIR JSON-LD**, download the generated JSON Schema, or **print the specification as a PDF**
  (questions, response options, edits, routing, variables, code lists).

Three surveys ship by default: a **Labour Force**-style household survey, an anonymous **Feature
Demo Survey** (collects no personal information, including a sensor-question page) that exercises
every question type, and a **FSEP**-style business/establishment survey.

The default document is a bilingual (EN/FR) household & employment survey demonstrating every
feature (see `packages/instrument-schema/src/examples/lfs.instrument.ts`). Try the **▶ Render** button to see the full respondent-facing app with page navigation, conditional routing, and response collection.

## Live demo

[https://p3ji.github.io/mobilesurvey/](https://p3ji.github.io/mobilesurvey/)

## Repository layout

```
packages/
  instrument-schema       DDI-aligned types + Zod validation + JSON Schema + examples (LFS, Demo, FSEP)
  expression-engine       no-eval parser/evaluator shared by routing, visibility, derived, edits
  runtime-engine          flatten + piping + edit evaluation + XState machine
  respondent-view         shared question-rendering React components (runtime + designer preview)
  metadata-registry       TF-IDF indexer + semantic search for question/component reuse
  ddi-xml                 DDI-Lifecycle 3.3 XML codec (export/import) + JSON-LD serialization
  validation-engine       post-collection Validator: L1-L4 checks, corrections, selective editing
  questionnaire-migrator  external questionnaire (incl. StatCan EQ) / PDF → instrument JSON
  questionnaire-bot       automated survey-path testing: enumeration, Playwright driver, HTML reports
  statcan-corpus          StatCan RDC documentation corpus: classify/extract/parse/load/search
apps/
  hub                     Vite + React survey management console (entry point)
  designer                Vite + React authoring tool
  runtime                 respondent-facing EQ app: access codes, resume, paradata, sensor questions
  api                     Hono + Node.js/SQLite backend — local-dev / air-gapped fallback only
docs/                     architecture, phase history, plans, and user manuals
```

## User manuals

How-to guides for using the tools:

- [Manuals index](docs/manuals/README.md)
- [Hub (survey management)](docs/manuals/hub.md)
- [Authoring tool (designer)](docs/manuals/authoring-tool.md)
- [Respondent app (runtime EQ)](docs/manuals/respondent-app.md)
- [Expression language reference](docs/manuals/expression-language.md)

## Architecture & design docs

- **[AGENTS.md](AGENTS.md)** — the actively-maintained source of truth for current phase status,
  conventions, and open items.
- [Architecture overview](docs/architecture.md) *(historical — documents Iteration 1)*
- [Phase 1 — DDI instrument schema](docs/phase1-schema.md) *(historical)*
- [Phase 2 — state engine & logic parser](docs/phase2-state-engine.md) *(historical)*
- [Phase 3 — component framework](docs/phase3-components.md) *(historical)*
- [Phase 4 — metadata registry & semantic search](docs/phase4-metadata-registry.md) *(historical)*
- [Backend service (API + SQLite)](docs/backend-service.md)
- [DDI-Lifecycle 3.3 compliance, explained](docs/ddi-explained.md)
- [Sensor module plan](docs/sensor-module-plan.md) (geolocation / photo questions)
- [Validator plan](docs/validator-plan.md)
- [StatCan metadata repository plan](docs/metadata-repo-plan.md)
- [On-premises / air-gapped deployment](DEPLOYMENT.md)

## Contributing & feedback

Have a feature request, bug report, or idea? Reach out:

- **GitHub Issues**: [github.com/p3ji/mobilesurvey/issues](https://github.com/p3ji/mobilesurvey/issues)
- **Email**: [push.peji@gmail.com](mailto:push.peji@gmail.com)

## More work

Explore other projects: [portfolio-pi-lake-ypm5sq0qik.vercel.app](https://portfolio-pi-lake-ypm5sq0qik.vercel.app/#home)

## License

Free and open-source. An OSI-approved license (e.g. MIT or Apache-2.0) will be added as a
`LICENSE` file; until then, treat it as intended-to-be-open-source.
