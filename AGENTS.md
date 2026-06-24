# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude and Antigravity both read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short. *(Auto-generated 2026-06-22; edit freely — re-runs won't overwrite an existing AGENTS.md.)*

**Brain note (goals, backlog, full context):** `H:\My Drive\Brain2\Projects\mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm` if missing).
- `pnpm --filter @mobilesurvey/designer dev` — run the authoring tool at http://localhost:5173.
- `pnpm test` — run all package test suites (Vitest).
- `pnpm typecheck` — typecheck every package.
- `pnpm build` — production build of the designer app.

## Layout
- `packages/instrument-schema` — DDI-aligned instrument spec (types + Zod + validation + JSON Schema).
- `packages/expression-engine` — safe (no-eval) expression parser/evaluator shared by routing, edits, derived fields.
- `packages/runtime-engine` — flattening, piping, edit evaluation, XState runtime machine (thin).
- `apps/designer` — Vite + React authoring tool (Iteration-1 focus). See `docs/` for the blueprint.

## Conventions & gotchas
- Keep this file short; put goals/backlog in the linked Brain note, not here.
- Cross-package imports use workspace deps (`@mobilesurvey/*`). In source, import `.ts` files with a `.js` suffix and `.tsx` files with a `.jsx` suffix (Bundler/esbuild resolution).
- The expression language must stay eval-free; extend it via the whitelisted function table in `packages/expression-engine/src/evaluator.ts`.

## Do NOT
- Commit secrets (`.env`) or large build artifacts.
