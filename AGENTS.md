# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short — completed phases, resolved bugs, and superseded decisions rotate to the Brain note's Log (see 00_Centralcommand rotation rule). *(Updated 2026-07-09.)*

**Brain note (goals, requirements, decisions, full phase/bug history):** `H:\My Drive\Brain2\Projects\mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest · **Supabase** (prod persistence; Hono `apps/api` is a local-dev fallback)

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm@9` if missing; corepack fails on this machine).
- **`pnpm --filter @mobilesurvey/hub dev` — survey hub (landing page) at http://localhost:5175** → `/mobilesurvey/` in production.
- `pnpm --filter @mobilesurvey/api dev` — local Hono API at http://localhost:8787. **Local-dev fallback only** — production reads/writes go directly to Supabase (used only when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset).
- `pnpm --filter @mobilesurvey/designer dev` — authoring tool at http://localhost:5173 → `/mobilesurvey/designer/` in prod.
- `pnpm --filter @mobilesurvey/runtime dev` — respondent app at http://localhost:5174 → `/mobilesurvey/respondent/` in prod.
- `pnpm test` — all package test suites (Vitest); `pnpm typecheck` — all packages.
- `pnpm build` — production builds for GitHub Pages (hub at root, designer and runtime in subdirs).

## Layout
- `packages/instrument-schema` — DDI-aligned spec (types + Zod + validation + examples: LFS, Demo, Household, FSEP).
- `packages/expression-engine` — safe (no-eval) evaluator for routing, edits, derived fields.
- `packages/runtime-engine` — thin XState machine: flattening, piping, edits, rosters (nested supported).
- `packages/metadata-registry` — TF-IDF indexer + semantic search for question/component reuse.
- `packages/ddi-xml` — DDI-Lifecycle 3.3 XML codec: `exportDdiXml` / `importDdiXml`. Zero external deps.
- `packages/respondent-view` — shared question-rendering React components (`Control`, `EditList`, `QuestionPage`) + `eq__*` CSS, used by both `apps/runtime`'s `SurveyRunner` and the designer's `RespondentApp` so the two full-page respondent renderers can't drift. The designer's `PreviewPane` (compact 380px device-frame mockup) intentionally keeps its own `pv-*` rendering but shares pagination/numbering logic (`paginate`/`numberQuestions`/`collectEdits` from `runtime-engine`).
- `packages/validation-engine` — post-collection Validator: L1–L4 checks, corrections overlay, selective-editing scoring.
- `packages/questionnaire-migrator` — external questionnaire → instrument JSON (incl. StatCan EQ dialect, PDF upload).
- `packages/questionnaire-bot` — automated testing bot (Phase 14, in progress): path enumeration, Playwright driver, HTML reports, CLI.
- `apps/designer` — Vite + React authoring tool with flowchart view, PDF export, Library search/insert.
- `apps/runtime` — Vite + React respondent app; loads surveys by `?survey=<id>` (anonymous or code-gated).
- `apps/hub` — Vite + React survey management home: create/edit/publish/launch, Analyzer, Validator, CATI views.
- `apps/api` — Hono + Node.js + `node:sqlite` backend. **Local-dev fallback only**; production persistence is **Supabase**. CATI is local-API-only (on-prem feature).

## Current state
- **Phases 1–13 DONE** (full history: Brain note → Log). Latest: Validator V1/V2/V3 complete and verified live end-to-end against Supabase (2026-07-09); all DEPLOYMENT.md §§9b/9c tables live.
- **Phase 14 IN PROGRESS:** Questionnaire Testing Bot (`packages/questionnaire-bot`). Phases A–C done (path enumeration ×3 strategies, browser-driven scenario execution, HTML report + CLI; 91 tests, 12 real-Chromium).
  - NOT DONE: e2e run against a live `apps/runtime` dev server (tests use a static fixture), text-drift/edit-firing assertion engine, discovery mode for external questionnaires (Phase D).
- **Phase 15 DONE (2026-07-17, +P5 2026-07-20): DDI-Lifecycle 3.3 compliance** (`packages/ddi-xml`; full design, P1 findings and P2–P5 results in `docs/ddi-compliance-plan.md`). XSD gate against vendored official 3.3 schemas runs in `pnpm test`; canonical URNs under configurable `agencyId` (`InstrumentMetadata`, designer root-sequence Inspector; unset ≡ placeholder `io.github.p3ji` — **never hardcode `ca.statcan`**); `exportDdiXml(instrument, {packaging: 'fragment'|'instance'})` both schema-valid, fragment mode is Colectica-style (schemes reference children — fragment consumers never recurse into inline children); ddigraph 0.4.2 ingests our exports with correct graphs (`scripts/ddigraph-interop/`, on-demand, results in its README); real Colectica Ireland-LFS files (14.5–66 MB) import clean with complete fidelity notes (`fixtures/external/fetch.mjs` downloads them; never committed; `external-import.test.ts` skips when absent).
  - **P5 (reviewer feedback):** URN identity defaults to **UUIDv5** derived from the internal id (`idScheme: 'uuid' | 'readable'`) — matches the Colectica/DDI-repository convention and retires the dot-escaping workaround (UUIDs have no dots, so the defective `BaseIDType` post-dot class is never hit). Round-trip relies on the `mst:id` extension + a UUID→id alias map, not on the URN being invertible. **`exportJsonLd`** emits a FAIR JSON-LD `@graph` (disco/SKOS/DCTerms + explicit `mst:` for un-standardized terms) whose `@id`s are the *same* URNs as the XML.
  - Still open (future work): faithful `d:QuestionGrid` mapping for the establishment `table` domain (currently projects to TextDomain natively + authoritative `mst:rd` JSON).
- **Phase 16 DONE (2026-07-18): Sensor module** (`docs/sensor-module-plan.md` — design, build results and deviations in its §8). Two consent-gated response domains: `geolocation` (precision dial, manual fallback, `{base}+_LAT/_LON/_ACC/_TS/_SRC`) and `photo` (client-side EXIF strip, base variable = attachment ref, `_TS/_SRC`, optional respondent-confirmed ML coding → `{prefix}_N_ITEMS+_I{i}_LABEL/QTY/UNIT/CONF`). Consent lives in reserved root-scoped `CONSENT_GEOLOCATION`/`CONSENT_CAMERA` variables (routable; consent-trap validation); `SensorServices`+`RecognitionProvider` integration interfaces with mocks; Anthropic-vision demo provider behind `VITE_ANTHROPIC_API_KEY` (graceful absence); paradata audit trail; bot enumerates consent branches; DDI round-trips via `mst:rd`.
  - **Manual step outstanding:** create the private `attachments` Storage bucket + policies (DEPLOYMENT.md §9d) — until then photo uploads fail gracefully. Not yet exercised: real on-device GPS/camera over HTTPS (needs deploy), real Anthropic vision call (needs key), browser-driver sensor UI (rides on Phase 14's live-runtime work).

- **Phase 17 — StatCan metadata repository: M1–M2 done, M3/M4 MVP shipped (2026-08-19)** (`docs/metadata-repo-plan.md`) — the RDC non-confidential documentation corpus (2.4 GB zip in `docs/metadatarepo/`, **gitignored, never commit**) is now searchable end to end: archive → classify → extract → parse → Supabase → ranked search in the hub's Searcher. **1,368 dictionary PDFs → 436,962 variable occurrences + 850,912 response categories, in 24 min.** Occurrences and concepts stay modelled separately; records project onto the existing `RegistryEntry`, so designer insertion and the DDI/JSON-LD export chain work unchanged. Licence: **Statistics Canada Open Licence** — attribution, no-endorsement and identify-as-adaptation are live in the UI, carried by the single `CORPUS_ATTRIBUTION` string.
  - **M1 (2026-08-18):** classifier + pdfjs extractor + ingest + reporter + CLI. All 3,006 files classified in 4.9 s, **96.8% typed**, 1,919 data dictionaries; extraction 0 failures. Committed artifact: `docs/statcan-corpus-report.md` (byte-identical per run). 66-file stratified hand-check found zero wrong values.
  - **M2 (2026-08-19):** `corpus:parse` runs the whole corpus. **84.6% of documents produce records**; layout is detected from content (`labelled` 78.8% / `collection` 4.2% / `field` 1.6%). Committed artifact: `docs/statcan-corpus-parse-report.md`. **The ≥95%-clean-parse bar is NOT met** — the 210 barren documents cluster by survey group (`BC_CB_K12` and friends), which reads as *a fourth layout*, not a long tail. Fill rates: position/length ~99%, concept 88.1%, universe 81.8%, questionText 57.2%, codes 39.2% (en 42.9% · fr 37.3% · **unknown-language 1.7%** — the unknown-language and missing-category problems share a cause).
  - **M3/M4 MVP (2026-08-19):** `sql/schema.sql` (table + language-aware generated `tsvector` + GIN/trigram/facet indexes + RLS + `corpus_search`/`corpus_stats`/`corpus_surveys` RPCs), `corpus:load` (streaming upsert, service-role credential), `metadata-registry/corpus.ts` (browser-safe `SupabaseCorpusSource`, still zero external deps), and the Searcher's "Statistics Canada" scope with facets, paging and per-record citation. Setup: **DEPLOYMENT.md §9e**. 388 tests across the two packages.
  - **LIVE (2026-08-19):** **194,507 English records loaded and searchable** against the real Supabase — 183 surveys, 1982–2025. English-only because 99.8% of French records are translations (only 232 French-only variable pairs), so it costs wording, not coverage, and needs no schema change. A fourth layout (`definition`: `Variable name:` / `Short Description:` / `Column number:`, documenting linked administrative files) took productive documents from 84.6% to **86.5%**.
  - **NOT DONE / open:** French (`--lang fr` — needs the derived-column slimming and the category-row fix first); the **fourth dictionary layout** (210 documents, 15.4%, clustered by survey group); EN↔FR pairing and concept clustering (rest of M3); designer insertion of a corpus record not exercised; `.doc`/`.docx` (M4, 604 files); `age`-style broad queries still ~1 s because `total_count` counts every match.

## Conventions & gotchas
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with `.js` suffix, `.tsx` with `.jsx` (esbuild resolution).
- Expression engine must stay eval-free; extend via `packages/expression-engine/src/evaluator.ts` function whitelist.
- Expressions use `==`/`!=` only — the lexer has no `===`/`!==` tokens; generators must emit the two-char forms (multi-select membership: `contains($var, 'code')`).
- Dev base paths are `/` (Vite dev serves at root); production uses `/mobilesurvey/` (hub), `/mobilesurvey/designer/`, `/mobilesurvey/respondent/` for GitHub Pages.
- Anonymous respondents use stable localStorage-based ID (`anon-<timestamp>`) to resume on the same device.
- **Prod backend = browser→Supabase REST** with a public *publishable* key baked into the client bundle (`VITE_SUPABASE_*`, injected by `deploy.yml`). No server authz layer — security rests entirely on **Supabase RLS**. Demo is public-by-design (non-sensitive data). Never put a `service_role`/`sb_secret_` key in a `VITE_*` var or CI. (Rationale + RLS hardening plan: Brain note → Architecture Notes.)
- **New Supabase tables need explicit `GRANT select/insert/update ... TO anon`** in addition to RLS policies (older tables inherited default privileges that new tables don't get) — see DEPLOYMENT.md §§9b/9c.
- **Exploration-only bundled surveys** (currently `lfs`) must **never** persist to Supabase — they run on local mocks but stay launchable/editable as demos. Only `demo` collects data. Drive seeding/persistence from the `collectsData` flag in the `packages/instrument-schema` bundled-survey registry, not ad-hoc id checks.
- **Bump `demoInstrument.version` on every content change** — hub seeding refreshes the stored Supabase row only when the shipped bundle is newer (or same-version content differs); without a bump the change never reaches production. Beware the dev loop: an open hub tab's HMR can re-run the seeding effect mid-edit and write a half-edited snapshot (the content-diff check self-heals it on the next full load).
- **`CONSENT_GEOLOCATION`/`CONSENT_CAMERA` are reserved variable names** (runtime-written sensor consent, root-scoped keys `NAME@`); sensor questions require a matching declaration in `Instrument.sensors`, and a required sensor question needs a decline path (manual fallback / optional / visibleWhen on the consent var) or validation flags a consent trap.
- `VITE_ANTHROPIC_API_KEY` (Validator V3 LLM assistance) is a real secret bundled client-side if set — personal/low-stakes demo only; the production-safe serverless proxy is documented but **not built** (DEPLOYMENT.md Security notes).
- statcan.gc.ca is blocked by the remote-session egress proxy — obtain StatCan questionnaires as user-provided PDFs/text.
- **`corpus:parse` must be run with `--tcodes all`.** The flag defaults to the `T15` family, and a file with *no* T-code matches no family — so the default silently drops every dictionary the classifier recovered by keyword, roughly a third of them. Select on `--kinds data-dictionary` and let `docKind` decide.
- **The corpus can live in its own Supabase project** — `VITE_CORPUS_URL`/`VITE_CORPUS_ANON_KEY` override the app's project and fall back to it when unset. Not decoration: at 437k occurrences the corpus alone projects to ~400 MB against a shared 500 MB free tier, so splitting it is the cheapest fix that changes no data model.
- **`corpus:load` needs the service-role key** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, set for that command only). It bypasses RLS — never a `VITE_*` var, never CI. The loader refuses a key that looks publishable, because an RLS-refused write looks exactly like a successful load into an empty table.
- **`service_role` needs its own table grants.** Bypassing RLS is a *policy* exemption, not a *privilege*, and a new table grants nothing to anyone — without them every corpus call returns 42501, including the read-only RPCs (they are `SECURITY INVOKER`, so they run as the caller).
- **A whole-table `DELETE` on `corpus_variable` exceeds the statement timeout.** Partition it — deleting by `survey_group` clears 193k rows in 183 requests. Deleted space is not returned until vacuum, so the table can read 210 MB with zero rows; a re-load reuses it.
- **A full re-load bloats the table; vacuum after one.** Upserting 193k existing rows writes a new tuple version for each and leaves the old dead: 213 MB became 333 MB for 0.7% more rows, `corpus_stats` went from 1.6 s to a timeout, and `smoking` from 189 ms to 1.5 s. `vacuum (full, analyze) corpus_variable;` in the SQL editor reclaims it. Deleting rows has the same effect — the space is not returned until vacuum.
- **Corpus size is measured, never estimated** — `corpus_size()` / `corpus_columns()` read `pg_total_relation_size` over the API. Two arithmetic projections were wrong in opposite directions: the stored `fts` tsvector is 27.2% of the table and was priced as index cost only, and GIN index overhead amortizes hard with scale (484 B/row at 25k rows, 181 B/row at 193k).
- **`sql/schema.sql` is checked by a real Postgres parser** (`schema.test.ts`, libpg_query via wasm) because nothing in the repo executes it. Note `position` and `length` are `col_name_keyword`s: legal as table column names, rejected as function parameter names, so they must stay quoted in `corpus_search`'s `RETURNS TABLE`.
- **Never commit MCP/test artifacts** — `.playwright-mcp/`, `playwright-report/`, `test-results/`, root `*.png` are gitignored. `.playwright-mcp/` captures cross-site browser console output (can include third-party secrets); treat as sensitive.
- **Do not report as complete** (deliberately skipped 2026-07-02): 10k-concurrent load test (approach documented in `docs/load-test-plan.md`, not run), SOC 2 program, DDI-XML validation against a real external agency file. Manual screen-reader (NVDA/VoiceOver) pass also not done; `tests/e2e/` (axe suite) runs on demand only — no CI test gate exists, only `deploy.yml`.

## Decision Routing (when you update the notes)

| What was decided | Write it in AGENTS.md | Write it in Brain2 |
|---|---|---|
| Bug found | → Open Bugs | — |
| Bug resolved (after it ships) | (remove here) | → Log (dated, with root cause) |
| New feature / phase added | → Current state | → Additional Requirements |
| Phase completed | (collapse to one line here) | → Log (full detail) |
| Fundamental principle changed | — | → Evergreen Requirements + Architecture Notes |
| Operational gotcha / convention | → Conventions & gotchas | — |
| Architecture decision (why X over Y) | — | → Architecture & Design Notes |
| Code changed | (git commit only, never re-describe in prose) | — |

**End-of-session instruction to agents:** "Update the project notes with what we decided today."

## Open Bugs
*(Log bugs here as discovered; when resolved, move to Brain note → Log with root cause + fix.)*
- *(none currently — 13 resolved bugs rotated to the Brain note Log on 2026-07-09)*

## Still-binding decisions
- **(2026-06-26)** Hosting stays GitHub Pages; Vercel/Netlify migrations evaluated and deferred (Netlify would need a base-path env var + SPA redirects).
- **(2026-06-26)** Demo is public-by-design; full RLS lockdown deferred until real/sensitive data is collected.
- **(2026-07-04)** Migrator natively supports StatCan EQ dialect (`packages/questionnaire-migrator/src/statcan-eq.ts`); unsupported constructs warn instead of guessing; real StatCan questionnaires committed as regression fixtures.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
- Commit `.playwright-mcp/`, `playwright-report/`, `test-results/`, or root screenshots.
- Connect an exploration-only bundled survey (`lfs`) to Supabase — it must stay on local mocks.
- Use better-sqlite3 (no prebuilt binary for Node 24); use built-in `node:sqlite` instead (applies to the local `apps/api` fallback).
