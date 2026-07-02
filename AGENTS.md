# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short. *(Updated 2026-06-29; edit freely — re-runs won't overwrite an existing AGENTS.md.)*

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
- `packages/ddi-xml` — DDI-Lifecycle 3.3 XML codec: `exportDdiXml` / `importDdiXml`. Zero external deps. MST-specific fields as `<r:UserID type="mst:KEY">` extensions; FidelityReport for lossy external files.
- `packages/respondent-view` — shared question-rendering React components (`Control`, `EditList`, `QuestionPage`) + `eq__*` CSS, used by both `apps/runtime`'s `SurveyRunner` and the designer's `RespondentApp` (Render mode) so the two full-page respondent renderers can't drift. The designer's `PreviewPane` (compact 380px device-frame mockup) intentionally keeps its own `pv-*` rendering — different visual density by design — but shares its pagination/numbering logic (`paginate`/`numberQuestions`/`collectEdits` from `runtime-engine`) with everything else.
- `apps/designer` — Vite + React authoring tool with flowchart view, PDF export, Library search/insert.
- `apps/runtime` — Vite + React respondent app; loads surveys by `?survey=<id>` (anonymous or code-gated).
- `apps/hub` — Vite + React survey management home screen; create, edit, configure, publish, launch surveys.
- `apps/api` — Hono + Node.js + `node:sqlite` backend. **Local-dev fallback only**; production persistence is **Supabase** (browser → Supabase REST). Tables: surveys, responses, sessions, paradata, access_codes.

## Phase status
1. **Phases 1–4 DONE:** Schema, expression engine, runtime skeleton, designer with flowchart/PDF, metadata registry, demo survey, library panel.
2. **Phase 5 DONE (2026-06-25):** Survey hub (list, create, publish); API surveys resource (CRUD, config); runtime & designer wired to load/save by link; anonymous auto-start; code-gated gate; all tests + typecheck pass. Committed & pushed.
3. **Phase 6 IN PROGRESS (2026-06-26/27):** 
   - ✓ Q-numbers everywhere (runtime + tree + inspector)
   - ✓ Enhanced progress bar
   - ✓ HTML export from designer Export menu
   - ✓ Mode dropdown (Pro / Easy)
   - ✓ Easy Mode category editing inline (CatEditor), add/delete questions, routing display
   - ✓ Training Hub view with YouTube intro video embed (new 🎓 module on hub home)
   - ✓ Designer defaults to blank instrument (not LFS)
   - ✓ File import in Designer (⬆ Import instrument JSON)
   - ✓ Questionnaire Migrator (hub tile)
   - ✓ Questionnaire Tester (hub tile)
   - ✓ Designer Interviewer (AI-assisted interview flow for building questionnaires)
   - NOT DONE: searchable/collapsible tree for 100+ question surveys
4. **Phase 6 remaining:** searchable/collapsible tree for 100+ question surveys — DONE (committed to main).
5. **Phase 7 DONE (2026-06-29):**
   - ✓ `@mobilesurvey/ddi-xml` — DDI-L 3.3 round-trip codec; 18 tests; wired into Designer toolbar.
   - ✓ Analyzer view in hub (completion funnel, response CSV export).
   - ✓ Versioned API contract: canonical `/api/v1/*`; deprecated `/api/*` alias adds `Deprecation`, `X-API-Version`, `Link`, and `Sunset` headers. Sunset: 2027-01-01.
   - ✓ Paradata RLS policy SQL documented in `DEPLOYMENT.md` §9 — apply once in Supabase dashboard to unblock anon INSERT on `paradata` (see Open Bugs for status).
6. **Phase 8 DONE (2026-06-29):** Expression engine coverage (50 tests: `len`, `contains`, `upper`/`lower`, `abs`/`round`/`floor`/`ceil`, `min`/`max`, `/`, `%`, `null`, nested calls). 1000-question `flattenInstrument` benchmark (< 200 ms). All 152 tests pass.
7. **Phase 9 DONE (2026-06-29):** WCAG 2.1 AA + RTL in `apps/runtime`:
   - Skip-to-main-content link; `document.lang`+`dir` synced to locale.
   - `aria-required`, `aria-invalid`, `aria-describedby` on all controls.
   - Grid radio `aria-label` (row + column). Directional arrows flip in RTL.
   - CSS: logical properties (`margin-inline-end`, `text-align: end`), RTL progress-fill, `aria-invalid` red border.
8. **Phase 10 DONE (2026-06-29):** Audit trail, PII redaction, on-prem deployment guide.
   - `Variable.isPII` flag in schema + Zod; `redactResponses()` / `piiVariableNames()` utilities.
   - Hub Analyzer: "↓ Redacted CSV" export; `logAudit()` fire-and-forget to Supabase `audit_log`.
   - Hub events audited: survey.create, survey.publish/unpublish, survey.delete, responses.export.
   - `audit_log` table in local SQLite (`apps/api/src/db.ts`) + Supabase SQL in `apps/hub/src/audit.ts`.
   - `DEPLOYMENT.md`: full on-prem guide (local SQLite API, nginx, Docker Compose, env vars).
9. **Phase 11 DONE (2026-06-29):** Interviewer Mode GA — CATI workflow, supervisor dashboard, call-back scheduling.
   - `interviewers` table + CATI columns on `cases` (`interviewer_id`, `callback_at`, `callback_note`).
   - API: `GET/POST /api/interviewers`; `GET /api/cases`; `POST /api/cases/:id/assign`; `POST /api/cases/:id/outcome`.
   - `seedCati()`: 3 demo interviewers (Alice, Bob, Chen); 6 demo cases with mixed statuses.
   - Hub `InterviewerView`: case queue sorted by callback urgency, launch interview, record outcome, schedule callback.
   - Hub `SupervisorView`: aggregate stats strip, per-interviewer breakdown table, case assignment panel.
   - Both tiles promoted to live on home screen. CATI is local-API-only (on-prem feature, not Supabase).

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
- **(2026-06-26, RESOLVED 2026-06-29)** **Paradata never collected in prod:** anon `INSERT` on `paradata` was blocked by missing RLS policy + sequence permission. Fixed in Supabase dashboard: `CREATE POLICY "anon_insert_paradata"` + `GRANT USAGE, SELECT ON SEQUENCE paradata_id_seq TO anon`. Live INSERT test confirmed — paradata collection is fully active in production.
- **(2026-06-26, RESOLVED)** `lfs` (Household & Employment) was seeded into Supabase by the hub + runtime and collected real responses — contradicting the intent (and on-screen copy) that only the Feature Demo survey collects data. Root cause: seeding/persistence ignored the exploration-only flag. Fix: all bundled-survey persistence now routes through a `collectsData` registry in `packages/instrument-schema`; exploration-only surveys run entirely on local mocks (verified — no responses/sessions/paradata writes). The stale `lfs` row left in Supabase is inert (a deliberate test case; nothing writes to it).
- **(2026-06-29, RESOLVED — Playwright QA)** Runtime page label rendered a nonsensical question range on **zero-question pages** (e.g. a final statement-only page): `Q26–25 of 25` (demo) and `Q11–10 of 10` (lfs), where start > end > total. Cause: the `eq__page-label` guard only checked `totalQuestions > 0`, not whether the current page had any questions. Fix (`apps/runtime/src/components/SurveyRunner.tsx`): also require `(questionsPerPage[currentPage] ?? 0) > 0`. Verified by Playwright walk — final pages now show just `Page N of M`; question pages still show the range.
- **(2026-06-29, RESOLVED — Playwright QA)** Unknown `?survey=<id>` silently fell back to the **lfs access gate** instead of a "survey not found" state (`apps/runtime/src/App.tsx`). A respondent with a broken/mistyped link saw a code gate for a *different* survey. Fix: an explicit `?survey` id that matches neither a served nor a bundled survey now renders a "Survey not found" card naming the bad id; the no-param demo fallback is preserved. Verified via Playwright (`?survey=does-not-exist` → not-found, no access input; `/` and `?survey=lfs` still gate).
- **(2026-06-29, RESOLVED 2026-06-30 — Playwright QA)** Completion screen printed `Debug: {saveError}` (raw error text) and dumped the full response JSON + paradata to every respondent. Fix: gated behind a registry-driven `isDemo` flag (`bundledSurvey(id) !== undefined`) — bundled teaching demos keep the inspection panel; real (user-created) surveys get a clean thank-you screen with friendly save-status copy and no data echo. Verified by Playwright: demo still shows the panel; a served user-created survey shows none of Debug/response-data/paradata.
- **(2026-06-30, RESOLVED — found while verifying)** **Local API crashed on every startup** since Phase 11: the CATI column migration used `ALTER TABLE cases ADD COLUMN IF NOT EXISTS …` — Postgres syntax that SQLite rejects — inside a swallowing `try/catch`, and `CREATE TABLE cases` lacks the CATI columns, so `seedCati()` hit "no such column: interviewer_id" on fresh *and* upgraded DBs (broke the entire on-prem/CATI story). Fix (`apps/api/src/db.ts`): probe `PRAGMA table_info(cases)` and `ALTER TABLE ADD COLUMN` only the missing columns, no swallowed errors. Verified against both a pre-Phase-11 `data/app.db` and a fresh DB; CATI endpoints + seed data work.
- **(2026-06-29, RESOLVED 2026-07-02 — Playwright QA)** A11y headings. Runtime survey pages had **no `<h1>`** (title was a `<span>`) — fixed earlier: title is now `<h1 class="eq__title">`. Designer Pro also had **no `<h1>`** and emitted orphan `<h3>`/`<h4>` panel headings (Inspector, VariablesPanel, InterviewerModeView) with no `<h2>` ancestor — an inconsistent per-panel heading base caused by three-column DOM order, so a screen reader's heading-jump list showed h3 before any h2 existed. Fix: promoted the toolbar survey title (`Toolbar.tsx`) to `<h1>`; every major panel's own top heading is now `<h2>` (Inspector's node/scheme/variable title, `VariablesPanel`'s three subsection headings, `InterviewerModeView`'s config title), with their children demoted one level (`<h4>`→`<h3>`) to keep valid nesting. All CSS visual sizing pinned via explicit `font-size`/`margin` overrides so the rename is semantic-only — verified via Playwright screenshots, zero visual diff. Full heading-chain audit (blank designer, question selected, code-list selected, Variables tab, Interviewer Mode) now shows `h1 → h2 → h3` everywhere, no skips, no orphans. Still pending: a full `axe-core` CI gate + manual screen-reader (NVDA/VoiceOver) pass — heuristic-only coverage so far.
- **(2026-06-29, RESOLVED 2026-07-02)** Drift risk: the respondent UI was implemented by **three separate renderers** — runtime `SurveyRunner` (`eq__*`), designer `PreviewPane` (Preview tab), designer `RespondentApp` (Render, `rapp__*`). Confirmed a live bug caused by exactly this: `RespondentApp`'s local `pageHasHardEdits` copy checked `item.kind === 'question'` only, missing `markAll`/`grid`, so a hard edit on a matrix/mark-all question didn't block Next in Render mode (production `SurveyRunner` was correct). Fix: new `packages/respondent-view` (`Control`, `EditList`, `QuestionPage`) plus `numberQuestions` added to `runtime-engine/paginate.ts` (a third, previously-divergent qNum algorithm). `SurveyRunner` and `RespondentApp` now both render through the shared package — `RespondentApp` (a full-screen `position:fixed` render, not a device mockup) also gained ARIA/RTL support and now visually matches production instead of the compact preview styling it had been borrowing. `PreviewPane` intentionally did **not** converge onto the shared component: its 380px mobile-device-frame mockup uses deliberately compact `pv-*` CSS (e.g. `.pv-radio` has no border/padding vs `.eq__radio`'s bordered "card" style) — forcing `eq__*` sizing into it would visually break the mockup. It converged only on the pure logic (`paginate`, `numberQuestions`, `collectEdits`, already shared) and explicitly kept its "always navigable, not gated on hard edits" behavior (a deliberate authoring UX, not a bug). ~800 duplicated lines removed. Verified with Playwright: full regression suite, demo + lfs walks, soft/hard edit gating (including the fixed markAll/grid case, unit-tested directly in `paginate.test.ts`), EN/FR, resume, and visual screenshots of both Preview and Render mode. 12 packages typecheck, 181 tests pass.

## Pending Features / Decisions
*(Log chat decisions and new feature requests here; move to Brain note when scope is confirmed. Decisions are append-only — add a new dated line, don't overwrite a prior one.)*
- **Decision (2026-06-26):** Staying on GitHub Pages for now; Vercel deferred for future hosting migration.
- **Decision (2026-06-26):** Demo site is public-by-design — survey definitions + responses are non-sensitive, so the public Supabase publishable key + permissive RLS is acceptable for now. Full RLS lockdown (responses INSERT-only, access-code validation server-side via RPC, auth-scoped writes) deferred until real/sensitive data is collected.
- **Decision (2026-06-26):** Only the Feature Demo survey (`demo`) connects to live collection; Household & Employment (`lfs`) is exploration-only and must never touch Supabase. Enforced via a `collectsData` flag in the instrument-schema bundled-survey registry.
- **Decision (2026-06-26):** Evaluated a Netlify migration; deferred. Would require a base-path env var (current Vite configs hard-code `/mobilesurvey/`) plus SPA redirect rules. Staying on GitHub Pages.
- **Decision (2026-06-28):** Enterprise adoption phased roadmap adopted (Phases 7–11), framed by an enterprise-client review (see `docs/enterprise-adoption-plan.md`). Keystone gap was no DDI-XML round-trip; `@mobilesurvey/ddi-xml` (Phase 7 first deliverable) addresses this — government statistical agency client repos are DDI-XML; tool now reads/writes without information loss. See Phase status above for remaining Phase 7 items.
- Phase 7 fully resolved 2026-06-29: versioned API shipped; paradata RLS SQL documented in DEPLOYMENT.md §9 (requires one Supabase dashboard SQL run).
- **Decision (2026-06-29):** Phases 8, 9, and 10 complete. Next: Phase 11 (Interviewer Mode GA).
- **Decision (2026-06-29):** Phase 11 complete. CATI is an on-prem/local-API feature — no Supabase schema required. Hub CATI views fall back to the local Hono API (http://localhost:8787). 169 tests pass.
- **Playwright QA (2026-06-29):** Browser-driven sweep of hub/runtime/designer found + fixed three respondent-facing runtime bugs (zero-question Q-range, unknown-`?survey` not-found state, missing survey `<h1>`); see Open Bugs. Engine behaviours (required/edits/i18n/resume/rosters) verified correct.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
- Commit `.playwright-mcp/`, `playwright-report/`, `test-results/`, or root screenshots (gitignored; `.playwright-mcp/` may contain third-party secrets).
- Connect an exploration-only bundled survey (`lfs`) to Supabase — it must stay on local mocks.
- Use better-sqlite3 (no prebuilt binary for Node 24); use built-in `node:sqlite` instead (applies to the local `apps/api` fallback).
