# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short. *(Updated 2026-06-25; edit freely — re-runs won't overwrite an existing AGENTS.md.)*

**Brain note (goals, backlog, full context):** `H:\My Drive\Brain2\Projects\mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm@9` if missing; corepack fails on this machine).
- **`pnpm --filter @mobilesurvey/hub dev` — survey hub (entry point) at http://localhost:5175.** Lists, creates, configures, and publishes surveys.
- `pnpm --filter @mobilesurvey/api dev` — backend API at http://localhost:8787 (required by hub for survey persistence).
- `pnpm --filter @mobilesurvey/designer dev` — authoring tool at http://localhost:5173 (launched from hub; linked from toolbar to return).
- `pnpm --filter @mobilesurvey/runtime dev` — respondent app at http://localhost:5174 (launched from hub via "Launch" button).
- `pnpm test` — all package test suites (Vitest); `pnpm typecheck` — all packages.
- `pnpm build` — production builds (GitHub Pages deployment of designer, runtime, hub).

## Layout
- `packages/instrument-schema` — DDI-aligned spec (types + Zod + validation + examples: LFS, Demo, Household).
- `packages/expression-engine` — safe (no-eval) evaluator for routing, edits, derived fields.
- `packages/runtime-engine` — thin XState machine: flattening, piping, edits, rosters (nested supported).
- `packages/metadata-registry` — TF-IDF indexer + semantic search for question/component reuse.
- `apps/designer` — Vite + React authoring tool with flowchart view, PDF export, Library search/insert.
- `apps/runtime` — Vite + React respondent app; loads surveys by `?survey=<id>` (anonymous or code-gated).
- `apps/hub` — Vite + React survey management home screen; create, edit, configure, publish, launch surveys.
- `apps/api` — Hono + Node.js backend; SQLite persistence (cases, access codes, sessions, paradata, surveys).

## Phase status
1. **Phases 1–4 DONE:** Schema, expression engine, runtime skeleton, designer with flowchart/PDF, metadata registry, demo survey, library panel.
2. **Phase 5 DONE (2026-06-25):** Survey hub (list, create, publish); API surveys resource (CRUD, config); runtime & designer wired to load/save by link; anonymous auto-start; code-gated gate; all tests + typecheck pass. **Pending:** git commit + push.
3. **Phase 6:** UI cleanup for surveys up to ~100 questions (defer if time-constrained).
4. **Phase 7:** Analytics dashboard (monitor responses, completion/drop-off, paradata).

## Conventions & gotchas
- Keep this file short; put goals/backlog/decisions in the Brain note, not here.
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with `.js` suffix, `.tsx` with `.jsx` (esbuild resolution).
- Expression engine must stay eval-free; extend via `packages/expression-engine/src/evaluator.ts` function whitelist.
- Dev base paths are `/` (Vite dev serves at root); production uses `/mobilesurvey/`, `/mobilesurvey-runtime/`, `/mobilesurvey-hub/` for GitHub Pages.
- Anonymous respondents use stable localStorage-based ID (`anon-<timestamp>`) to resume on the same device.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
- Use better-sqlite3 (no prebuilt binary for Node 24); use built-in `node:sqlite` instead.
