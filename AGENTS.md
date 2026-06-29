# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short. *(Updated 2026-06-26; edit freely — re-runs won't overwrite an existing AGENTS.md.)*

**Brain note (goals, backlog, full context):** `H:\My Drive\Brain2\Projects\mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest · **Supabase** (prod persistence; Hono `apps/api` is a local-dev fallback)

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm@9` if missing; corepack fails on this machine).
- **`pnpm --filter @mobilesurvey/hub dev` — survey hub (landing page) at http://localhost:5175** → `/mobilesurvey/` in production.
- `pnpm --filter @mobilesurvey/api dev` — local Hono API at http://localhost:8787. **Local-dev fallback only** — production reads/writes go directly to Supabase (this is used only when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset).
- `pnpm --filter @mobilesurvey/designer dev` — authoring tool at http://localhost:5173 → `/mobilesurvey/designer/` in prod.
- `pnpm --filter @mobilesurvey/runtime dev` — respondent app at http://localhost:5174 → `/mobilesurvey/respondent/` in prod.
- `pnpm test` — all package test suites (Vitest); `pnpm typecheck` — all packages.
- `pnpm build` — production builds for GitHub Pages (hub at root, designer and runtime in subdirs).

## Layout
- `packages/instrument-schema` — DDI-aligned spec (types + Zod + validation + examples: LFS, Demo, Household).
- `packages/expression-engine` — safe (no-eval) evaluator for routing, edits, derived fields.
- `packages/runtime-engine` — thin XState machine: flattening, piping, edits, rosters (nested supported).
- `packages/metadata-registry` — TF-IDF indexer + semantic search for question/component reuse.
- `apps/designer` — Vite + React authoring tool with flowchart view, PDF export, Library search/insert.
- `apps/runtime` — Vite + React respondent app; loads surveys by `?survey=<id>` (anonymous or code-gated).
- `apps/hub` — Vite + React survey management home screen; create, edit, configure, publish, launch surveys.
- `apps/api` — Hono + Node.js + `node:sqlite` backend. **Local-dev fallback only**; production persistence is **Supabase** (browser → Supabase REST). Tables: surveys, responses, sessions, paradata, access_codes.

## Phase status
1. **Phases 1–4 DONE:** Schema, expression engine, runtime skeleton, designer with flowchart/PDF, metadata registry, demo survey, library panel.
2. **Phase 5 DONE (2026-06-25):** Survey hub (list, create, publish); API surveys resource (CRUD, config); runtime & designer wired to load/save by link; anonymous auto-start; code-gated gate; all tests + typecheck pass. Committed & pushed.
3. **Phase 6 IN PROGRESS (2026-06-26):** 
   - ✓ Q-numbers everywhere (runtime + tree + inspector)
   - ✓ Enhanced progress bar
   - ✓ HTML export from designer Export menu
   - ✓ Mode dropdown (Pro / Easy)
   - ✓ Easy Mode category editing inline (CatEditor), add/delete questions, routing display
   - ✓ Training Hub view with NotebookLM video resource (new 🎓 module on hub home)
   - ✓ Designer defaults to blank instrument (not LFS)
   - ✓ File import in Designer (⬆ Import instrument JSON)
   - NOT DONE: searchable/collapsible tree for 100+ question surveys
4. **Phase 7:** Analytics dashboard (monitor responses, completion/drop-off, paradata).

## Conventions & gotchas
- Keep this file short; put goals/backlog/decisions in the Brain note, not here.
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with `.js` suffix, `.tsx` with `.jsx` (esbuild resolution).
- Expression engine must stay eval-free; extend via `packages/expression-engine/src/evaluator.ts` function whitelist.
- Dev base paths are `/` (Vite dev serves at root); production uses `/mobilesurvey/` (hub, landing page), `/mobilesurvey/designer/`, `/mobilesurvey/respondent/` for GitHub Pages.
- Anonymous respondents use stable localStorage-based ID (`anon-<timestamp>`) to resume on the same device.
- **Prod backend = browser→Supabase REST** with a public *publishable* key baked into the client bundle (`VITE_SUPABASE_*`, injected by `deploy.yml`). No server authz layer — security rests entirely on **Supabase RLS**. For this demo, survey definitions + responses are intentionally public (non-sensitive). Never put a `service_role`/`sb_secret_` key in a `VITE_*` var or CI. (Rationale + RLS hardening plan: Brain note.)
- **Exploration-only bundled surveys** (currently `lfs`) must **never** persist to Supabase — no row, responses, sessions, or paradata; they run on local mocks but stay launchable/editable as demos. Only `demo` collects data. Drive seeding/persistence from the `collectsData` flag in the `packages/instrument-schema` bundled-survey registry, not ad-hoc id checks.
- **Never commit MCP/test artifacts** — `.playwright-mcp/`, `playwright-report/`, `test-results/`, root `*.png` are gitignored. `.playwright-mcp/` captures cross-site browser console output (can include third-party secrets/API keys); treat it as sensitive.

## Decision Routing (When you update the notes)

When a chat session produces bugs, decisions, or changes, **route them here:**

| What was decided | Write it in AGENTS.md | Write it in Brain2 |
|---|---|---|
| Bug found | → Open Bugs | — |
| New feature / phase added | → Pending Features | → Additional Requirements |
| Fundamental principle changed | — | → Evergreen Requirements + Architecture Notes |
| Operational gotcha / convention | → Conventions & gotchas | — |
| Architecture decision (why X over Y) | — | → Architecture & Design Notes |
| Code changed | (git commit only, never re-describe in prose) | — |

**End-of-session instruction to agents:**  
> "Update the project notes with what we decided today."

The agent uses this table to route updates to the correct files.

## Open Bugs
*(Log bugs here as discovered; mark resolved with date)*
- **(2026-06-26, RESOLVED)** Server-side **session persistence + resume was completely broken** for every collecting survey. The session key was built from `instrument.id` (the DDI urn, e.g. `urn:ddi:mobilesurvey:demo:1.0`), so `sessions.survey_id`/`paradata.survey_id` got the urn — but `surveys.id` is the short alias (`demo`), so the FK failed (`POST /sessions` → 409). Responses survived only because `submitResponse` used the alias. Fix: the runtime session key now uses the survey alias (`surveys.id`); verified — `sessions` now persists with `survey_id='demo'` and resume works.
- **(2026-06-26, OPEN — config, not code)** **Paradata is never collected in prod:** anon `INSERT` on the `paradata` table is blocked by RLS (`POST /paradata` → 401), while `responses` is allowed. The keying is now correct, so paradata will flow once an anon-insert policy is added (Supabase dashboard). Blocks the Phase 7 analytics/paradata view until fixed.
- **(2026-06-26, RESOLVED)** `lfs` (Household & Employment) was seeded into Supabase by the hub + runtime and collected real responses — contradicting the intent (and on-screen copy) that only the Feature Demo survey collects data. Root cause: seeding/persistence ignored the exploration-only flag. Fix: all bundled-survey persistence now routes through a `collectsData` registry in `packages/instrument-schema`; exploration-only surveys run entirely on local mocks (verified — no responses/sessions/paradata writes). The stale `lfs` row left in Supabase is inert (a deliberate test case; nothing writes to it).
- **(2026-06-29, RESOLVED — Playwright QA)** Runtime page label rendered a nonsensical question range on **zero-question pages** (e.g. a final statement-only page): `Q26–25 of 25` (demo) and `Q11–10 of 10` (lfs), where start > end > total. Cause: the `eq__page-label` guard only checked `totalQuestions > 0`, not whether the current page had any questions. Fix (`apps/runtime/src/components/SurveyRunner.tsx`): also require `(questionsPerPage[currentPage] ?? 0) > 0`. Verified by Playwright walk — final pages now show just `Page N of M`; question pages still show the range.
- **(2026-06-29, OPEN — Playwright QA)** Unknown `?survey=<id>` silently falls back to the **lfs access gate** instead of a "survey not found" state (`apps/runtime/src/App.tsx` L100-102: `bundledSurvey(effectiveId) ?? bundledSurvey('lfs')`). A respondent with a broken/mistyped link sees a code gate for a *different* survey. Recommend: when an explicit `?survey` id resolves to neither a served nor a bundled survey, render an explicit error (keep the no-param demo fallback).
- **(2026-06-29, OPEN — Playwright QA, demo-only)** Completion screen prints `Debug: {saveError}` (raw error text) and dumps the full response JSON + paradata to the respondent. Intentional for the teaching demo, but must be gated out before any real/sensitive collection.
- **(2026-06-29, NOTE — Playwright QA)** A11y: runtime survey pages have **no `<h1>`** (title is a `<span>`); designer Pro emits `<h3>` before `<h2>`. Moderate WCAG 1.3.1/2.4.x best-practice gaps; full axe-core + manual audit still pending (Phase 9). Otherwise labels/aria/roles are solid (edits use role=alert/status, progressbar has aria-valuenow).
- **(2026-06-29, NOTE — Playwright QA)** Drift risk: the respondent UI is implemented by **three separate renderers** — runtime `SurveyRunner` (`eq__*`), designer `PreviewPane` (Preview tab), designer `RespondentApp` (Render, `rapp__*`). Same fix may not reach all three; consider converging on one shared view over the runtime-engine flatten output.

## Pending Features / Decisions
*(Log chat decisions and new feature requests here; move to Brain note when scope is confirmed. Decisions are append-only — add a new dated line, don't overwrite a prior one.)*
- **Decision (2026-06-26):** Staying on GitHub Pages for now; Vercel deferred for future hosting migration.
- **Decision (2026-06-26):** Demo site is public-by-design — survey definitions + responses are non-sensitive, so the public Supabase publishable key + permissive RLS is acceptable for now. Full RLS lockdown (responses INSERT-only, access-code validation server-side via RPC, auth-scoped writes) deferred until real/sensitive data is collected.
- **Decision (2026-06-26):** Only the Feature Demo survey (`demo`) connects to live collection; Household & Employment (`lfs`) is exploration-only and must never touch Supabase. Enforced via a `collectsData` flag in the instrument-schema bundled-survey registry.
- **Decision (2026-06-26):** Evaluated a Netlify migration; deferred. Would require a base-path env var (current Vite configs hard-code `/mobilesurvey/`) plus SPA redirect rules. Staying on GitHub Pages.
- Phase 6 remaining: searchable/collapsible tree for 100+ question surveys
- Phase 7: Analytics dashboard (monitor responses, completion/drop-off, paradata)
- **Decision (2026-06-28):** Reframed the roadmap around an enterprise-client review (see `docs/enterprise-adoption-plan.md`). Next phases ordered by client business impact; the keystone is DDI-XML interoperability with external repositories. Phase 7 broadened beyond analytics to "Interoperability & Proof Foundation."
- **Phase 7 started (2026-06-28):** `packages/ddi-xml` — DDI-XML import/export codec with a per-import fidelity report. Loss-free round-trip for the full Instrument model today (verified against all 4 bundled instruments); next increment is a full DDI-Lifecycle 3.3 / Codebook 2.5 adapter for external repository files. The low-level XML reader/writer is isolated in `src/xml.ts` so it can be swapped for a hardened parser without touching the mapping layer. Still open from the plan: fix prod paradata RLS, publish a versioned API contract.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
- Commit `.playwright-mcp/`, `playwright-report/`, `test-results/`, or root screenshots (gitignored; `.playwright-mcp/` may contain third-party secrets).
- Connect an exploration-only bundled survey (`lfs`) to Supabase — it must stay on local mocks.
- Use better-sqlite3 (no prebuilt binary for Node 24); use built-in `node:sqlite` instead (applies to the local `apps/api` fallback).
