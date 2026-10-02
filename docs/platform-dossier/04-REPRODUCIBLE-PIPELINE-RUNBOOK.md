# 04 — Reproducible Pipeline Runbook

> **Step-by-step CLI execution guide to reproduce ingestion, parsing, derivation extraction, vector sidecar indexing, and benchmark testing.**

---

## 1. Prerequisites & Environment Configuration

### Required Software
* **Node.js**: v22.x or v24.x (with native `node:sqlite` support)
* **pnpm**: v9.x (`npm install -g pnpm@9`)
* **Supabase CLI**: v2.x (`brew install supabase/tap/supabase`)
* **Git**

### Environment Credentials
Create or verify `.env.local` in `platform/hub/` and `tools/metadata/statcan-corpus/`:

```bash
# Supabase Production Persistence
VITE_SUPABASE_URL=https://suxvdjemgcilpmbitmpf.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...

# Qdrant Cloud Vector Sidecar
QDRANT_ENDPOINT=https://your-cluster.qdrant.io:6333
QDRANT_API_KEY=your-qdrant-key
QDRANT_COLLECTION=modularsurvey

# Local LLM Inference (Optional - for offline Reviewer & Concept pipelines)
LOCAL_LLM_URL=http://127.0.0.1:1234/v1
LOCAL_LLM_MODEL=qwen3.8-flash-next
```

---

## 2. Ingestion & Metadata Pipeline

All corpus commands are run from the repository root using the workspace filter:

```bash
# 1. Inspect data delivery zip files and build inventory
pnpm --filter @mobilesurvey/statcan-corpus corpus:inventory

# 2. Extract PDF text into structured page representations
pnpm --filter @mobilesurvey/statcan-corpus corpus:extract

# 3. Parse data dictionaries across labelled, collection, and field layouts
pnpm --filter @mobilesurvey/statcan-corpus corpus:parse

# 4. Generate document metadata bundles
pnpm --filter @mobilesurvey/statcan-corpus corpus:documents

# 5. Classify sociodemographic harmonized clusters & subject mappings
pnpm --filter @mobilesurvey/statcan-corpus corpus:cluster
pnpm --filter @mobilesurvey/statcan-corpus corpus:subjects

# 6. Load records and refresh stats snapshot into Supabase
pnpm --filter @mobilesurvey/statcan-corpus corpus:load
```

---

## 3. Computational Derivations & Knowledge Graph

The derivation pipeline maps PROV-O lineage DAG edges (`prov:wasDerivedFrom`):

```bash
# 1. Deterministic Grouped Extractor (same-doc - (G) suffixes)
pnpm --filter @mobilesurvey/statcan-corpus corpus:grouped

# 2. Deterministic Counterpart Extractor (cross-doc PUMF <-> Master links)
pnpm --filter @mobilesurvey/statcan-corpus corpus:counterpart

# 3. Run Reviewer Agent forensic audit against extraction queue
pnpm --filter @mobilesurvey/statcan-corpus corpus:review audit

# 4. Export verified derivation edges to idempotent SQL
pnpm --filter @mobilesurvey/statcan-corpus corpus:review export

# 5. Apply verified edges to live Supabase database
supabase db query --linked -f tools/metadata/statcan-corpus/out/verified_edges.sql
```

---

## 4. Qdrant Cloud Vector Pipeline

The vector sidecar indexes substantive English variables with boilerplate stripping:

```bash
# 1. Verify Qdrant collection schema (384-d Cosine with payload indexes)
pnpm --filter @mobilesurvey/statcan-corpus corpus:vector:setup

# 2. Run full corpus vector ingestion (179k variables, batch size 1000)
# Uses Xenova/all-MiniLM-L6-v2 on-device; takes ~10-12 minutes
pnpm --filter @mobilesurvey/statcan-corpus corpus:vector:full

# 3. Synchronize GSIM taxonomy roles to ensure 0 mismatches with Supabase
pnpm --filter @mobilesurvey/statcan-corpus corpus:vector:sync-roles -- --apply

# 4. Run dry run verification (must output: "found 0 role mismatches")
pnpm --filter @mobilesurvey/statcan-corpus corpus:vector:sync-roles
```

---

## 5. AI Concept Synthesis Pipeline (Missing Records)

For variables with substantive question text but NULL concepts:

```bash
# 1. Run unit test suite for concept synthesis
pnpm --filter @mobilesurvey/statcan-corpus test stageAiConcepts.test.ts

# 2. Execute staging script (outputs out/staged_ai_concepts.json and .sql)
npx tsx tools/metadata/statcan-corpus/src/concept/stage-ai-concepts.ts

# 3. Review staged output before applying
head -n 30 tools/metadata/statcan-corpus/out/staged_ai_concepts.json

# 4. Apply staged updates to Supabase (idempotent, safe)
supabase db query --linked -f tools/metadata/statcan-corpus/out/staged_ai_concepts.sql
```

---

## 6. Verification & Benchmark Test Suite

Run these commands to verify search performance and precision:

```bash
# 1. Run full 112-query search benchmark suite
pnpm --filter @mobilesurvey/statcan-corpus corpus:benchmark

# 2. Run vitest test suite across entire monorepo (553+ tests)
pnpm test

# 3. Strict typecheck across all 16 workspace packages
pnpm typecheck

# 4. Verify live production site status
curl -sI https://msurvey.peji.ca/ | head -n 5
```
