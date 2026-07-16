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
- **Phase 15 IN PROGRESS (2026-07-09): DDI-Lifecycle 3.3 compliance.** Full design + P1 findings in `docs/ddi-compliance-plan.md`. Driven by an expert standards reviewer at the target org; their tool (https://github.com/pbisson44/ddigraph, ingests Lifecycle-as-FragmentInstance and does XML→RDF itself) is the acceptance target — so schema-valid FragmentInstance XML, not a JSON-LD exporter.
  - ✓ **P1 DONE:** official 3.3 XSDs vendored (`packages/ddi-xml/schemas/3.3/`, CC BY 4.0, provenance in SOURCE.md); `xmllint-wasm` CI gate (`xsd-validation.test.ts` — runs in `pnpm test` by default); exporter fixed until **all five bundled instruments validate** while all round-trip tests still pass. New `src/urn.ts`: canonical URN minting + bijective ID mapping (every dot → `@`, because the official XSD's `BaseIDType` post-dot character class is *defective* — `[A-Zz-z…]` omits lowercase a–y, so even spec-legal one-dot ids fail). `mst:rd` JSON extension at QuestionItem is now the authoritative response-domain representation (RepresentationType domains admit no UserID children; GridDomain isn't even legal in QuestionItemType — `table`/`grid` project natively to TextDomain pending a real `d:QuestionGrid` mapping). Importer keeps legacy fallbacks for every changed shape, so pre-compliance XML still imports.
  - NOT DONE: P2 identity model (`agencyId` config field in instrument-schema + designer settings; exporter currently derives agency from the instrument id with `sanitizeAgency()` falling back to placeholder `io.github.p3ji` — **never hardcode `ca.statcan`**, we don't act for the agency); P3 FragmentInstance packaging + ddigraph interop harness; P4 import ddigraph's real 14.5 MB Ireland-LFS fixtures; faithful `d:QuestionGrid` mapping for the establishment `table` domain.

## Conventions & gotchas
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with `.js` suffix, `.tsx` with `.jsx` (esbuild resolution).
- Expression engine must stay eval-free; extend via `packages/expression-engine/src/evaluator.ts` function whitelist.
- Expressions use `==`/`!=` only — the lexer has no `===`/`!==` tokens; generators must emit the two-char forms (multi-select membership: `contains($var, 'code')`).
- Dev base paths are `/` (Vite dev serves at root); production uses `/mobilesurvey/` (hub), `/mobilesurvey/designer/`, `/mobilesurvey/respondent/` for GitHub Pages.
- Anonymous respondents use stable localStorage-based ID (`anon-<timestamp>`) to resume on the same device.
- **Prod backend = browser→Supabase REST** with a public *publishable* key baked into the client bundle (`VITE_SUPABASE_*`, injected by `deploy.yml`). No server authz layer — security rests entirely on **Supabase RLS**. Demo is public-by-design (non-sensitive data). Never put a `service_role`/`sb_secret_` key in a `VITE_*` var or CI. (Rationale + RLS hardening plan: Brain note → Architecture Notes.)
- **New Supabase tables need explicit `GRANT select/insert/update ... TO anon`** in addition to RLS policies (older tables inherited default privileges that new tables don't get) — see DEPLOYMENT.md §§9b/9c.
- **Exploration-only bundled surveys** (currently `lfs`) must **never** persist to Supabase — they run on local mocks but stay launchable/editable as demos. Only `demo` collects data. Drive seeding/persistence from the `collectsData` flag in the `packages/instrument-schema` bundled-survey registry, not ad-hoc id checks.
- `VITE_ANTHROPIC_API_KEY` (Validator V3 LLM assistance) is a real secret bundled client-side if set — personal/low-stakes demo only; the production-safe serverless proxy is documented but **not built** (DEPLOYMENT.md Security notes).
- statcan.gc.ca is blocked by the remote-session egress proxy — obtain StatCan questionnaires as user-provided PDFs/text.
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
