# Hermes Instruction: Phase 19 (Step 1) - Scale Computational Derivation Extraction & Reviewer Audit (English Only)

You are executing Step 1 of Phase 19 (Scale Computational Derivation Extraction & Reviewer Audit) for the Statistics Canada metadata knowledge graph.

### Target Workspace
`/Users/pushp/Documents/Projects/mobilesurvey`

### Scope & Language Mandate: English-Only
- **Free-Tier Constraint**: In alignment with the repository's single-language Supabase load decision (`src/load.ts` default: `languages: ['en']`), derivation extraction is **strictly English-only** (`lang = 'en'`).
- The live `corpus_variable` table in Supabase contains only English occurrences to prevent exceeding the 500 MB free-tier storage ceiling.
- Across the 438k total occurrences, exactly **32,702 variables** are English derived metrics.
- The queue runner and seeder now filter strictly to English (`v.source.lang === 'en'`), ensuring every extracted lineage edge resolves cleanly against Supabase without foreign key violations.

### Hard Operational Constraints
1. Zero Cloud Leakage: Do NOT call cloud models or send survey metadata off-device. All LLM calls must go to the local endpoint at `http://127.0.0.1:1234/v1` running `qwen3.8-27b`.
2. Memory Safety: Do NOT launch `qwen3.8-flash-next` or other heavy models in parallel; keep system RAM clear for the extraction worker.
3. Execution Runner: Run all scripts using `./node_modules/.bin/tsx` from the repo root.
4. Process Isolation: Run the worker as a background detached process redirecting all output to `tools/metadata/statcan-corpus/out/worker.log`.

---

### Step-by-Step Execution Plan

#### 1. Pre-Flight Health Check
Verify the local LLM server is active and serving `qwen3.8-27b`:
```bash
curl -s http://127.0.0.1:1234/v1/models | grep -i qwen
```

Check current queue status (verifying the current English jobs and completed edges):
```bash
./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts status
```

#### 2. Seed Derivable Variables into the Queue (English-Only)
The queue currently has ~2,345 pending English jobs. You can run those, or seed more from `corpus.jsonl`.
Seeding is idempotent (`INSERT OR IGNORE`) and defaults to English (`lang=en`):

- To seed up to a specific limit (e.g. 5,000 English variables):
  ```bash
  ./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts seed 5000
  ```
- Or to seed all ~32,702 English derivable variables for an unattended run:
  ```bash
  ./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts seed all
  ```

Check the updated pending count:
```bash
./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts status
```

#### 3. Launch Extractor Worker (Detached Background)
Launch the worker in the background:
```bash
nohup ./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts run > tools/metadata/statcan-corpus/out/worker.log 2>&1 &
echo "Worker PID: $!"
```

To monitor progress:
```bash
# View live extraction logs:
tail -f tools/metadata/statcan-corpus/out/worker.log

# Or check aggregate status counts:
./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/queue.ts status
```

#### 4. Run Forensic Reviewer Agent (Audit)
When the worker completes or once your target batch finishes:
```bash
./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/reviewer.ts audit
```
This automatically:
- Expands alphanumeric range patterns (e.g. `C13A to C13X`, `E14A to E28A`, `ADL_01 through ADL_05`).
- Checks verbatim textual evidence against the original StatCan notes.
- Verifies column existence against the same-cycle 153k-key corpus index.
- Emits a fresh 10-item stratified sample to `tools/metadata/statcan-corpus/out/human_review_sample_10.md` for human sign-off.

#### 5. Export Verified Supabase Migration
Generate the idempotent SQL migration file containing all verified English edges with two-compartment epistemic attribution:
```bash
./node_modules/.bin/tsx tools/metadata/statcan-corpus/src/graph/reviewer.ts export
```

#### 6. Summary Report
Report back:
- Total jobs processed in this run.
- Total candidate edges extracted.
- Breakdown from Reviewer Agent:
  - Verified (Clean & Resolved)
  - Needs Review (Master file / Interview code)
  - Rejected (Hallucinations or Self-loops)
- Location and line count of `tools/metadata/statcan-corpus/out/verified_edges.sql`.
