# mobilesurvey — Agent Guide

> Single source of truth for *how to work on this repo*. Claude, Hermes, and Antigravity all read this (`CLAUDE.md` → `@AGENTS.md`; `GEMINI.md` → pointer). Keep it short (<100 lines) — completed phases, resolved bugs, and superseded decisions rotate to the Brain note's Log (see 00_Centralcommand rotation rule). *(Updated 2026-10-16.)*

**Brain note (goals, requirements, decisions, full phase/bug history):** `/Users/pushp/Brain2/Projects/mobilesurvey.md`
**GitHub:** https://github.com/p3ji/mobilesurvey.git
**Live site:** https://msurvey.peji.ca/ (custom domain on GitHub Pages via Cloudflare DNS) — push `main` to run `.github/workflows/deploy.yml`.
**Stack:** pnpm monorepo · TypeScript (strict) · React 18 + Vite · XState v5 · Zod · Zustand+Immer · Vitest · **Supabase** (prod persistence; Hono `platform/api` is a local-dev fallback). Current module map: `ARCHITECTURE.md`.

## Run / build / test
- `pnpm install` — install workspace deps (needs pnpm; `npm i -g pnpm@9` if missing; corepack fails on this machine).
- **`pnpm --filter @mobilesurvey/hub dev` — survey hub (landing page) at http://localhost:5175** → `/` on `msurvey.peji.ca` in production.
- `pnpm --filter @mobilesurvey/api dev` — local Hono API at http://localhost:8787 (local-dev fallback only when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset).
- `pnpm --filter @mobilesurvey/designer dev` — authoring tool at http://localhost:5173 → `/designer/` in prod.
- `pnpm --filter @mobilesurvey/runtime dev` — respondent app at http://localhost:5174 → `/respondent/` in prod.
- `pnpm test` — all package test suites (Vitest); `pnpm typecheck` — all packages; `pnpm build` — prod builds for GitHub Pages.

## Layout
- `packages/` — suite-wide contracts: `instrument-schema` (DDI-aligned Instrument), `expression-engine` (safe evaluator), `ddi-xml` (DDI/XML and JSON-LD interchange).
- `tools/authoring/` — `designer` app and `questionnaire-migrator` package.
- `tools/collection/` — `respondent` app, `runtime-engine` state package, and shared `respondent-view` controls.
- `tools/validation/` — `validation-engine` package; UI and persistence adapter in `platform/hub`.
- `tools/metadata/` — browser-safe `metadata-registry` and Node-only `statcan-corpus` ETL/graph package; Searcher UI in `platform/hub`.
- `tools/research/researcher/` — OpenAlex, Crossref, CRDCN, and Pan-Canadian 4-Tier harvester (`pan_canadian_harvester.ts`, `crdcn.ts`, `scheduled_harvester.ts`).
- `tools/testing/` — `questionnaire-bot` CLI and package.
- `platform/hub` — suite entry point, Collector, Analyzer, Searcher, Researcher, Validator and CATI screens. `platform/api` — local Hono/SQLite fallback.

## Multi-Agent Teamwork & Verification Gates (`Hermes <-> Antigravity`)
- **Hermes (`qwen3.8-27b` + `microsoft/phi-4` local fleet / scheduled crons):**
  - Owns the 4-hour `statcan-derivation-drain-publish` cron (`tools/metadata/statcan-corpus`), the Adversarial Derivation Critic (`microsoft/phi-4` on LM Studio `:1234` — 5.6x faster than `JEV-27B` with 0 syntax errors), and the `scheduled_harvester.ts` Researcher jobs across all 4 Pan-Canadian tiers and CRDCN sitemaps.
  - **Single-Concurrent-Inference Rule:** Never run a heavy Splash (`:8000`) batch concurrently with an active LM Studio (`:1234`) `phi-4` critic drain to preserve M5 Ultra memory bandwidth (819 GB/s).
  - **Stuck-Lease Auto-Recovery:** Before any derivation drain pass, reset exhausted transient LM Studio leases: `UPDATE derivation_job SET attempts=0 WHERE status='pending' AND attempts>=3;`.
- **Antigravity (`Gemini 3.8 Pro` / `Claude Opus 4.6` interactive IDE):**
  - Owns Supabase SQL migrations & MVCC bloat management (`< 500 MB` Free Tier ceiling; currently 439 MB), Qdrant Cloud payload synchronization (`179,592` points), Tier 2 Escalation Arbitration (`gemini-3.8-flash`), Searcher/Researcher/Designer React UX (`platform/hub`), and Playwright E2E verification.
- **Mandatory Verification Gates (Required before `git push` or reporting DONE):**
  1. **Live Anon-RPC Latency & Timeout Gate:** After any SQL or Searcher change, verify against the live Supabase `anon` role (`8s` statement timeout ceiling) that `corpus_search_sorted` executes in `< 1,000ms` (baseline ~140ms using materialized `corpus_variable.role` column) and returns `0` leaking process variables when `hide_process = true`.
  2. **Empirical Searcher Playwright Gate:** Run `npx playwright test tests/e2e/searcher-empirical.spec.ts` (7/7 canonical empirical & typo-guardrail queries must pass) and `pnpm test && pnpm typecheck`.
  3. **Researcher Zero-Hallucination Quote Gate:** Any update to `researcherPilot.json` or `tools/research/researcher` must verify `flaggedClaims === 0` (`{"flaggedClaims": 0}`) and preserve explicit `verified` vs `provisional` Attribution Certainty badges.
  4. **Two-Clause Epistemic Transparency Gate:** Every published edge in `corpus_derivation_edge` or `corpus_concept_continuity` must format `rationale` with both `Evidence from data dictionary: "..."` and `AI interpretation and action: ...`.

## Current state (summary — full detail in Brain2 Log)
- **Phases 1–13, 15–19, 25–27 DONE:**
  - *Core Suite & Bilingual Hub (2026-10-04):* EN/FR toggle across Hub, Designer, and Respondent; scroll-settle motion; consented `newsletter_subscribers` signup (`docs/newsletter-notifications.md`). Sensor module (Phase 16: `geolocation` + `photo` with `CONSENT_*` root variables; private `attachments` Storage bucket manual step pending).
  - *StatCan Knowledge Graph & Lineage (Phases 18, 19, 25–27 — 2026-10-13):* 438,931 variables across 113 programs / 260 cycles classified in GSIM 2D taxonomy; 100% document chunk census in Supabase Storage (`1,477` chunks / 581 docs). **26,680 verified derivation links across 131 cycles** live in `corpus_derivation_edge` (combining note extraction, 10,948 T15.4 DV spec edges, and 832 questionnaire-to-dataset concordance links, audited by deterministic Checks 1b/6/7 + `phi-4` critic + `gemini-3.8-flash` arbitrator). **1,759 cross-cycle continuity bridges** live in `corpus_concept_continuity` across 32 longitudinal programs.
  - *Searcher & Database Scaling (2026-10-14):* Materialized `role` column on `corpus_variable` with `trg_set_corpus_variable_role` (138ms query latency; DB compacted via `VACUUM FULL` to 439 MB). Deployed 59+ academic/empirical aliases (`corpus_search_alias`), similarity-first suggest scoring, single-word `>= 0.48` auto-retry guardrail, `<optgroup>` program filter bar, and Qdrant Cloud (`179,592` synced points, `max_indexing_threads: 1`).
  - *Pan-Canadian Researcher (2026-10-16):* 4-Tier harvester (Federal, 8 Provinces/Territories, 8 CMAs, 44 institutes) + CRDCN 7-sitemap exhaust drain (`6,374` URLs) with Solr server-side exclusion (`fq=-organization:statcan`) and resource footnote parsing. Public catalogue (`researcherPilot.json`) holds **3,059 works** (2,747 Verified, 348 Provisional) across 19,050 jobs with **0 flagged claims**.
- **In Progress / Roadmap (`docs/roadmap-modular-tools.md`):**
  - *Phase 14:* Questionnaire Testing Bot (`tools/testing/questionnaire-bot`) — Phases A–C done (91 tests); live dev-server e2e & Phase D external discovery pending.
  - *Phase 21–23 Roadmap:* Remine Tabular Mining (`@mobilesurvey/remine`), WCAG 2.2 Survey A11y Auditor (`a11y-auditor`), and StatCan LoRA Survey Translator (`survey-translator`).

## Conventions & gotchas
- Apply `.agents/skills/researcher-protocol/SKILL.md` for Researcher tasks; keep provider details in `docs/researcher-plan.md`.
- Cross-package imports use `@mobilesurvey/*`; import `.ts` with `.js` suffix and `.tsx` with `.jsx`. Keep tool packages under `tools/<capability>/` and shared contracts under `packages/`.
- Expression engine stays eval-free (`packages/expression-engine/src/evaluator.ts` whitelist) and uses `==`/`!=` only (no `===`/`!==`; multi-select: `contains($var, 'code')`).
- **Supabase RLS & Anon Grants:** Prod browser talks directly to Supabase REST with publishable `VITE_SUPABASE_*` keys. Never put `service_role`/`sb_secret_` in `VITE_*` or CI. New tables require explicit `GRANT select/insert/update ... TO anon` plus RLS policies.
- **Role & Vector Sync:** `corpus_variable.role` is materialized via `trg_set_corpus_variable_role`. After changing role classification SQL, backfill `role` in batches (avoiding MVCC bloat > 500 MB) and run `pnpm --filter @mobilesurvey/statcan-corpus corpus:vector:sync-roles -- --apply`.
- **Searcher Edge Function CORS** must include `https://msurvey.peji.ca`.
- **Corpus re-parsing:** `resolveCorpus` reads only the first zip in `docs/metadatarepo/`. To re-parse notes without clobbering `out/corpus.jsonl`, run `scripts/reparse-notes-from-docs.ts`.
- **CLI & Chunked SQL:** Invoke reviewer scripts via `npx tsx src/graph/reviewer.ts <subcmd>` (never `pnpm corpus:review -- <subcmd>`). Import derivation chunks (`out/verified_chunks/chunk_N.sql`, ~450 rows/file, cycle-tolerant joins) via `supabase db query --linked -f <absolute path>` to avoid HTTP 413.
- **Bundled surveys:** Only `demo` persists to Supabase (`collectsData: true`); `lfs` is exploration-only on local mocks. Bump `demoInstrument.version` on every content change.
- **`CONSENT_GEOLOCATION`/`CONSENT_CAMERA`** are reserved root-scoped variable names; required sensor questions need a decline path.
- **Do not report as complete:** 10k-concurrent load test (`docs/load-test-plan.md`), SOC 2 program, external agency DDI-XML validation, or manual NVDA/VoiceOver pass.

## Decision Routing & Do NOT
- **Rotate to Brain2 (`/Users/pushp/Brain2/Projects/mobilesurvey.md`):** Resolved bugs & completed phase details → `Log / Decision history`; architecture rationale → `Architecture & Design Notes`. Keep only active state, open bugs, and operational conventions here.
- **Open Bugs:** *(None currently.)*
- **Do NOT:** Commit `.env`, `.playwright-mcp/`, `playwright-report/`, `test-results/`, or root `*.png`; connect `lfs` to Supabase; or use `better-sqlite3` (use built-in `node:sqlite` for Node 24).

