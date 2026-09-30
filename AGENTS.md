# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short — completed phases, resolved bugs, and superseded decisions rotate to the Brain note's Log (see 00_Centralcommand rotation rule). *(Updated 2026-07-09.)*

**Brain note (goals, requirements, decisions, full phase/bug history):** `H:\My Drive\Brain2\Projects\mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Live site:** https://p3ji.github.io/mobilesurvey/ — push `main` to run `.github/workflows/deploy.yml`.
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest · **Supabase** (prod persistence; Hono `platform/api` is a local-dev fallback). Current module map: `ARCHITECTURE.md`.

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm@9` if missing; corepack fails on this machine).
- **`pnpm --filter @mobilesurvey/hub dev` — survey hub (landing page) at http://localhost:5175** → `/mobilesurvey/` in production.
- `pnpm --filter @mobilesurvey/api dev` — local Hono API at http://localhost:8787. **Local-dev fallback only** — production reads/writes go directly to Supabase (used only when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset).
- `pnpm --filter @mobilesurvey/designer dev` — authoring tool at http://localhost:5173 → `/mobilesurvey/designer/` in prod.
- `pnpm --filter @mobilesurvey/runtime dev` — respondent app at http://localhost:5174 → `/mobilesurvey/respondent/` in prod.
- `pnpm test` — all package test suites (Vitest); `pnpm typecheck` — all packages.
- `pnpm build` — production builds for GitHub Pages (hub at root, designer and runtime in subdirs).

## Layout
- `packages/` — suite-wide contracts: `instrument-schema` (DDI-aligned Instrument), `expression-engine` (safe evaluator), `ddi-xml` (DDI/XML and JSON-LD interchange).
- `tools/authoring/` — `designer` app and `questionnaire-migrator` package.
- `tools/collection/` — `respondent` app, `runtime-engine` state package, and shared `respondent-view` controls. The designer uses the same engine and controls for its full-page render mode; its compact `PreviewPane` keeps its own UI.
- `tools/validation/` — `validation-engine` package; its current UI and persistence adapter are in `platform/hub`.
- `tools/metadata/` — browser-safe `metadata-registry` and Node-only `statcan-corpus` ETL/graph package; Searcher UI is in `platform/hub`.
- `tools/testing/` — `questionnaire-bot` CLI and package.
- `platform/hub` — suite entry point, Collector, Analyzer, Searcher, Validator and CATI screens. `platform/api` — local Hono/SQLite fallback only; production persistence is Supabase.
- `ARCHITECTURE.md` — package relationships, ownership boundaries, and instructions for adding or extracting a tool.

## Current state
- **Phases 1–13 DONE** (full history: Brain note → Log). Latest: Validator V1/V2/V3 complete and verified live end-to-end against Supabase (2026-07-09); all DEPLOYMENT.md §§9b/9c tables live.
- **Phase 14 IN PROGRESS:** Questionnaire Testing Bot (`tools/testing/questionnaire-bot`). Phases A–C done (path enumeration ×3 strategies, browser-driven scenario execution, HTML report + CLI; 91 tests, 12 real-Chromium).
  - NOT DONE: e2e run against a live `tools/collection/respondent` dev server (tests use a static fixture), text-drift/edit-firing assertion engine, discovery mode for external questionnaires (Phase D).
- **Phase 15 DONE:** DDI-Lifecycle compliance details are in the `ddi-lifecycle` skill.
- **Phase 16 DONE (2026-07-18): Sensor module** (`docs/sensor-module-plan.md` — design, build results and deviations in its §8). Two consent-gated response domains: `geolocation` (precision dial, manual fallback, `{base}+_LAT/_LON/_ACC/_TS/_SRC`) and `photo` (client-side EXIF strip, base variable = attachment ref, `_TS/_SRC`, optional respondent-confirmed ML coding → `{prefix}_N_ITEMS+_I{i}_LABEL/QTY/UNIT/CONF`). Consent lives in reserved root-scoped `CONSENT_GEOLOCATION`/`CONSENT_CAMERA` variables (routable; consent-trap validation); `SensorServices`+`RecognitionProvider` integration interfaces with mocks; Anthropic-vision demo provider behind `VITE_ANTHROPIC_API_KEY` (graceful absence); paradata audit trail; bot enumerates consent branches; DDI round-trips via `mst:rd`.
  - **Manual step outstanding:** create the private `attachments` Storage bucket + policies (DEPLOYMENT.md §9d) — until then photo uploads fail gracefully. Not yet exercised: real on-device GPS/camera over HTTPS (needs deploy), real Anthropic vision call (needs key), browser-driver sensor UI (rides on Phase 14's live-runtime work).

- **Phase 17:** StatCan metadata repository M3/M4 MVP shipped; details and operating guidance are in the `metadata-corpus` skill.

- **Phase 18 (2026-09-04): Statistics Canada Knowledge Graph & Searcher Integration** (`tools/metadata/statcan-corpus/src/graph/`, `platform/hub/src/CorpusGraphExplorer.tsx`, `platform/hub/src/CorpusSearch.tsx`). 100% full-corpus census complete: 438,931 variables classified across 113 survey programs and 260 cycles. Formal GSIM 2D taxonomy (Data Origin × Computation Status), W3C PROV-O derivation extraction (12,210 explicit links), PUMF grouped recodes (`- (G)`, 15,134 variables), and primary unit identifiers (1,914). Harmonized sociodemographic concept mesh across 10 core domains. Searcher UI updated with GSIM role filters, paradata/weight suppression toggle (default active), interactive variable lineage inspection (`prov:wasDerivedFrom`), and a sober, high-density Knowledge Graph Explorer tab in Hub. Zero database writes (Rule D3 compliant). Reports: `docs/cchs-knowledge-graph-pilot.md`, `docs/gss-cis-knowledge-graph-pilot.md`, `docs/batch3-knowledge-graph-pilot.md`, `docs/batch4-full-corpus-knowledge-graph.md`.

- **Phase 19 IN PROGRESS (2026-09-27): Computational Derivation Extraction & Reviewer Agent** (`tools/metadata/statcan-corpus/src/graph/queue.ts`, `src/graph/reviewer.ts`, `src/graph/suggester.ts`, `docs/METADATA_ARCHITECTURE_PLAN.md`). Tri-layer hybrid architecture consensus with OpenAI Codex second opinion: relational Postgres/SQLite WAL lineage store + GSIM variable cascade + bilingual deduplicated vector search. Durable extraction queue runner backed by local LLMs with atomic leases; forensic Reviewer Agent (Check 2 verbatim grounding, Check 2a range expansion `C13A to C13X` / `E14A-E28A`, Check 3b component retargeting `A02→A02_DOB/_MOB/_YOB`, Check 3c Question-Name alias retargeting via `src/graph/aliases.ts` with underscore-normalized matching), sha256 name-only `dedupe_key` UNIQUE guard (PUMF+RDC double-ingest collapses to one row), and Check 4 suggester (`suggester.ts`: reverse-note + lexical + embedding candidates, batched `qwen3.8-flash-next` adjudication with `reasoning_effort:none`, human accept via `accept SURVEY SOURCE NAME` → verified @0.95). Full-corpus drain complete: 1,472 locally auto-verified candidate pairs; 1,359 direct-input pairs pass the SQL export filter. Supabase holds 1,183 public verified same-document English links and 5 `needs_review` links (2026-09-29). Searcher cards read verified inputs and evidence via the batched `corpus_get_direct_inputs` RPC; note-parsed guesses are no longer displayed as links. Another 208 unique unresolved edges have per-survey rationale + revisit paths in `docs/unresolved-derivation-links.md`. Epistemic attribution (official_statcan vs ai_inferred) is retained; stratified human sign-off remains pending. Strategy & "Why" in `docs/METADATA_ARCHITECTURE_PLAN.md` §2; import guidance in `DEPLOYMENT.md` §9g. Two deterministic extractors now live (2026-09-29): `src/graph/grouped.ts` (`pnpm corpus:grouped`, `--import`) — same-document G-suffix collapse, 509 verified edges; and `src/graph/counterpart.ts` (`pnpm corpus:counterpart`, `--import`) — cross-document master-file counterpart links (PUMF frequency docs → master codebooks, filename doc-type classifier + subpopulation signature matching), 3,673 verified `counterpart` edges. Both use deterministic UUIDv5 edge IDs (idempotent upsert) and name-based live resolution; ~149 collapse pairs + ~1,887 counterpart pairs are deferred until the next `corpus:load` brings their reference docs into Supabase — re-running is idempotent.

- **Searcher improvement (2026-09-29):** Searcher is dedicated to the StatCan corpus; Designer handles reuse of local survey questions. Repeated columns for a question are grouped per results page. `sql/search-performance.sql` adds reviewed search aliases and a survey-count snapshot used by the stats, survey, subject, and unclassified RPCs; `corpus:load` refreshes the snapshot. Live search baseline and measured changes: `docs/search-evaluation.md`. Searcher UI changes still require the normal GitHub Pages deployment to appear on the public site.

## Conventions & gotchas
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with `.js` suffix, `.tsx` with `.jsx` (esbuild resolution).
- Keep new tool-specific packages under `tools/<capability>/`; put only contracts consumed by multiple capabilities under `packages/`. Connect tools through package exports and the `Instrument` contract, not source-relative imports across tool folders. The Hub owns suite integration; do not move a tool's reusable rules into Hub UI code.
- Expression engine must stay eval-free; extend via `packages/expression-engine/src/evaluator.ts` function whitelist.
- Expressions use `==`/`!=` only — the lexer has no `===`/`!==` tokens; generators must emit the two-char forms (multi-select membership: `contains($var, 'code')`).
- Dev base paths are `/` (Vite dev serves at root); production uses `/mobilesurvey/` (hub), `/mobilesurvey/designer/`, `/mobilesurvey/respondent/` for GitHub Pages.
- Anonymous respondents use stable localStorage-based ID (`anon-<timestamp>`) to resume on the same device.
- **Prod backend = browser→Supabase REST** with a public *publishable* key baked into the client bundle (`VITE_SUPABASE_*`, injected by `deploy.yml`). No server authz layer — security rests entirely on **Supabase RLS**. Demo is public-by-design (non-sensitive data). Never put a `service_role`/`sb_secret_` key in a `VITE_*` var or CI. (Rationale + RLS hardening plan: Brain note → Architecture Notes.)
- **New Supabase tables need explicit `GRANT select/insert/update ... TO anon`** in addition to RLS policies (older tables inherited default privileges that new tables don't get) — see DEPLOYMENT.md §§9b/9c.
- **Knowledge Graph counts describe different stages:** 12,210 detected note references in the local census are not published derivation edges. The public lineage browser reads only `verified` Supabase links; on 2026-09-29 that is 1,183 links across 340 targets in 10 survey groups. Do not present the larger extraction count as live DAG coverage.
- **Exploration-only bundled surveys** (currently `lfs`) must **never** persist to Supabase — they run on local mocks but stay launchable/editable as demos. Only `demo` collects data. Drive seeding/persistence from the `collectsData` flag in the `packages/instrument-schema` bundled-survey registry, not ad-hoc id checks.
- **Bump `demoInstrument.version` on every content change** — hub seeding refreshes the stored Supabase row only when the shipped bundle is newer (or same-version content differs); without a bump the change never reaches production. Beware the dev loop: an open hub tab's HMR can re-run the seeding effect mid-edit and write a half-edited snapshot (the content-diff check self-heals it on the next full load).
- **`CONSENT_GEOLOCATION`/`CONSENT_CAMERA` are reserved variable names** (runtime-written sensor consent, root-scoped keys `NAME@`); sensor questions require a matching declaration in `Instrument.sensors`, and a required sensor question needs a decline path (manual fallback / optional / visibleWhen on the consent var) or validation flags a consent trap.
- `VITE_ANTHROPIC_API_KEY` (Validator V3 LLM assistance) is a real secret bundled client-side if set — personal/low-stakes demo only; the production-safe serverless proxy is documented but **not built** (DEPLOYMENT.md Security notes).
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
- **(2026-07-04)** Migrator natively supports StatCan EQ dialect (`tools/authoring/questionnaire-migrator/src/statcan-eq.ts`); unsupported constructs warn instead of guessing; real StatCan questionnaires committed as regression fixtures.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
- Commit `.playwright-mcp/`, `playwright-report/`, `test-results/`, or root screenshots.
- Connect an exploration-only bundled survey (`lfs`) to Supabase — it must stay on local mocks.
- Use better-sqlite3 (no prebuilt binary for Node 24); use built-in `node:sqlite` instead (applies to the local `platform/api` fallback).
