# DV Lineage Verification & Adversarial Orchestration Architecture

**Target:** Autonomous, adversarial verification and resolution of Statistics Canada Derived Variable (DV) computational lineage edges (`tools/metadata/statcan-corpus`), adapting the dual-tier cloud orchestrator + local worker + adversarial critic pattern from [`docs/researcher-orchestration-plan.md`](file:///Users/pushp/Documents/Projects/mobilesurvey/docs/researcher-orchestration-plan.md).

---

## 1. System Topology & Dual-Tier Execution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Antigravity Orchestrator (Subagent Session)              │
│       • Tracks batch leases, stratified sampling, and verification metrics  │
│       • Dispatches worker batches and manages adversarial dispute loops     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
     ┌──────────────────────────────┐      ┌──────────────────────────────┐
     │ Stream A: Verified Audit     │      │ Stream B: Needs_Review       │
     │ Sample (30,314 edges)        │      │ Adjudication (11,216 edges)  │
     │ Stratified random checks     │      │ Resolution & classification  │
     └──────────────┬───────────────┘      └──────────────┬───────────────┘
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │ Proposer (Local M5 Ultra LLM)       │
                    │ • Fast extraction / candidate parse │
                    │ • Uses Qwen3.8-27b on port 1234     │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │ Adversarial Critic Subagent         │
                    │ • Counter-hypothesis testing        │
                    │ • Background text vs dependency     │
                    │ • Master file vs question item      │
                    └──────────────────┬──────────────────┘
                                       │
                           [Consensus Reached?]
                              /            \
                           [YES]           [NO]
                            /                \
            ┌──────────────▼──────┐   ┌───────▼──────────────────────────┐
            │ Deterministic Gate  │   │ Escalation to Gemini Subagent    │
            │ • Whole-word regex  │   │ • Deep contextual adjudication   │
            │ • Same-cycle UUID   │   │ • Final authority resolution     │
            └──────────────┬──────┘   └───────┬──────────────────────────┘
                           │                  │
                           └─────────┬────────┘
                                     │
                    ┌────────────────▼──────────────────┐
                    │ SQLite State Store                │
                    │ `out/derivation_queue.db`         │
                    │ • Updates review_status & notes   │
                    │ • Sets data_authority & confidence│
                    └───────────────────────────────────┘
```

---

## 2. Adversarial Counter-Hypotheses for DV Lineage

The Critic Subagent must challenge candidate edges across four concrete adversarial checks:

1. **Background Mention vs. Computational Input:**
   * *Hypothesis:* The note mentions variable `X` as a condition or routing instruction (e.g. `"Questions were not asked when PMK was answered"` or `"See notes on SAMFSIS"`).
   * *Counter-Test:* Did `X` actually contribute data values/records to the formula, or was it merely an interview administration filter?
2. **Confidential Master File vs. Unlinked Public Column:**
   * *Hypothesis:* The token is an internal processing variable or confidential master file item explicitly declared not on public file (e.g. `"STATHO2 (on internal processing file; not on master file)"`).
   * *Action:* Mark with `unresolvable_reason = 'internal_processing_file'` / `'confidential_master_file'`. Prevent spurious fuzz-matching to unrelated public columns.
3. **Standard Administrative Classification vs. Survey Dependency:**
   * *Hypothesis:* A census geography code (e.g. `RUINDFG`, `CMA`, `PRV`) or standard coding index (e.g. `SIC`, `NOC`) is referenced.
   * *Counter-Test:* Is this an external register variable joined during survey processing rather than a question in this questionnaire?
4. **Formula Distortion & Dropped Multi-Inputs:**
   * *Hypothesis:* A calculation requires `A + B + C`, but the candidate edge only captured `A`.
   * *Counter-Test:* Does the note require all components of an arithmetic or conditional formula? Assert completeness.

---

## 3. Stratified Rollout Pilot

The orchestrator will execute against a three-survey stratified pilot before draining all 11,216 records:

1. **`CCHS_ESCC` (Health & Population):** 269 needs_review edges. Features complex multi-item screener indices, PMK household flags, and confidential master-file health inputs.
2. **`GSS_ESG_12-32` (Social & Caregiving):** 343 needs_review edges. Features complex relationship matrices, time-use recodes, and roster dependencies.
3. **`SHS_EDM` (Household Spending):** 952 needs_review edges. Features financial aggregation formulas, tax linkages, and dwelling cost subtotals.

---

## 4. Verification & Publishing Gates

1. **Integrity Guard:** No edge may be marked `verified` unless it has a valid, non-null `source_record_id` resolved against an official published data dictionary record.
2. **Attribution:** Verified edges retain epistemic provenance (`data_authority = 'ai_inferred'`, `ai_auditor = 'adversarial_critic_v1'`).
3. **Export Check:** `pnpm test` and `npm run corpus:review audit` must pass with 0 schema violations before generating `out/verified_edges.sql`.
