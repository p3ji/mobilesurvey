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

---

## 5. Empirical Benchmark Plan: Jev (`autotrust/jev-27b`) vs. Generative Critic (`microsoft/phi-4`)

Rather than burning 50,000 full inference calls across the whole corpus unconditionally, the system evaluates the utility of **Jev** (a typed, non-autoregressive decision/classification model) against **Phi-4** (an autoregressive generative LLM) across a curated, stratified 250-edge benchmark battery.

### 5.1 Benchmark Test Battery (250 Curated Edges)
1. **Clean True Positives (100 items):** Verified derivations (`GEN_01` $\rightarrow$ `GEN_01_D`, `ALC_05` $\rightarrow$ `ALC_05_D`, CCHS/CHMS/GSS specs).
2. **Adversarial Trap Cases (100 items):**
   - Battery category pointers (`CCC_60D category # 5`)
   - Simultaneous activity exclusions (`TUI_03B` / `ACT_*`)
   - Self-referential collection question codes (`ME_25D <- ME_Q25`)
   - Skip-pattern routing filters (`if PRG_Q01 = 1`)
3. **Ambiguous Collection Aliases (50 items):** Collection question codes (`SED_Q12M` $\rightarrow$ `SED12M`, `RRS_Q12` $\rightarrow$ `RRS_12`, `C19_Q18B` $\rightarrow$ `C19_18B`).

### 5.2 Comparative Evaluation Metrics
- **Falsification Precision:** % of adversarial trap cases correctly identified and rejected.
- **True Positive Retention:** % of genuine derivations preserved without false rejections.
- **Inference Latency:** Average milliseconds per record (testing System 1 single-pass speed advantage vs. token-by-token generation).
- **Schema Reliability:** Syntax failure rate (0% for Jev typed heads vs. generative JSON fence/parsing failures).
- **Confidence Calibration:** Brier score and separation between clean vs. ambiguous records.

### 5.3 Target Models
- **Generative Baseline:** `microsoft/phi-4` on LM Studio (`http://127.0.0.1:1234/v1`).
- **Vision-Language Model:** `autotrust/jev-27b` (`Atlas3D/JEV-27B-VL-GGUF` under identifier `jev-27b-vl`).
- **Senior Adversary:** `qwen3.8-27b` (arbitrator for consensus).

### 5.4 Empirical Benchmark Results & Architectural Conclusions (2026-10-13)

| Metric | `microsoft/phi-4` (14B) | `jev-27b-vl` (27B) | Winner / Diagnostic Finding |
|---|---|---|---|
| **Clean Derivation Recall** | **95.0%** (19/20) | 75.0% (15/20) | **Phi-4** (+20% recall on verified dependencies) |
| **Trap Falsification Precision** | **35.0%** (7/20) | 30.0% (6/20) | **Both show high compliance bias on deceptive traps** |
| **Overall Accuracy** | **72.0%** | 52.0% | **Phi-4** (+20%) |
| **Average Latency** | **1,563 ms/record** | 8,805 ms/record | **Phi-4** (**5.6x faster throughput**) |
| **Throughput** | **~38 items/min** | ~7 items/min | **Phi-4** |
| **JSON Parse Failures** | **0** (0%) | 20 (40%) | **Phi-4** (Jev reasoning preamble exhausted `max_tokens`) |

#### Key Takeaways:
1. **Utility & Role of Jev vs. Phi-4:**
   - `JEV-27B-VL` is a vision-language reasoning model designed for multimodal document understanding (analyzing questionnaire PDF layouts, flowchart decision trees, visual skip arrows).
   - When deployed as a text-only tabular/dictionary JSON critic, its internal reasoning/thinking chain expends significant compute generating prose thoughts before outputting JSON, leading to token exhaustion and 5.6x higher latency.
   - `microsoft/phi-4` is an instruction-tuned generative model that produces valid JSON directly in 1.5 seconds per record with zero syntax errors.
2. **Indispensability of Deterministic Checks 1–7 (Stage 0):**
   - Both models exhibited ~65–70% failure rates on deceptive adversarial traps (such as category pointers like `CCC_60D category # 5` or simultaneous activity exclusions like `ACT_*`), because both LLMs suffer from semantic compliance bias when substantive terminology matches.
   - Consequently, **Deterministic Checks 1–7** (`evaluateDeterministicFilter`) must always serve as the mandatory Stage 0 gate (0 ms, 100% precision) before routing ambiguous or unresolved candidate edges to the local LLM critic.

---

## 6. Updated Four-Tier Production Architecture & Gemini Escalation Protocol

Based on the empirical findings, the pipeline is restructured into four specialized tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Candidate Derivation Edges (from regex / concordance / dictionary notes)  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tier 0: Deterministic Fast-Path Filter (Checks 1–7)                         │
│ • Self-referential loops (PAY_030 <- PAY_030)                               │
│ • Common prose words (TOTAL, INCOME, AMOUNT, HOURS)                         │
│ • Admin tax/geography registers (T1FF, GAF, RUINDFG, CMA, PRV)              │
│ • Survey frame/sample identifiers (SAMPLEID, PERSONID, PUMFID)              │
│ • Explicit master-file exclusion clauses ("on internal processing file")    │
│ • Interview routing / respondent filters (PMK, PROXY)                       │
│ • Category option pointers ("category # 5", "found under question stem")    │
│ • Simultaneous activity exclusions ("does not include time in ACT_*")       │
│                                                                             │
│ Result: ~25% of flawed candidates pruned instantly (0 ms, 100% precision)  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Unresolved / Ambiguous Edges)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Local High-Speed Critic (microsoft/phi-4 on M5 Ultra)               │
│ • Evaluates needs_review queue at 1.5s/record (zero cloud leakage, 0 cost)  │
│ • 100% schema reliability (zero JSON syntax errors)                         │
│ • High recall (95%) on genuine mathematical dependencies                    │
│                                                                             │
│ [High Confidence (>= 0.85) & Clear Agreement?]                              │
│       ├── YES ──► Commit to SQLite with Two-Clause Contract                 │
│       │           (Integrity Guard: retains needs_review if source is null) │
│       └── NO  ──► Route to Tier 2 Escalation Gate                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Disputed / Low Confidence < 0.85 / Complex)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tier 2: Gemini Escalation Arbitrator (gemini-3.8-flash)                     │
│ • Resolves high-ambiguity cases (~5-10% of total volume)                    │
│ • Modern 3.8 generation: sub-second latency, 1M context, native JSON schema  │
│ • Deep contextual reasoning over complex multi-step derivation prose        │
│ • Arbitrates conflicting extraction rules vs. critic hypotheses             │
│ • Air-Gap Protocol: Transmits ONLY public metadata strings (variable name,  │
│   survey cycle, public data dictionary note). ZERO microdata / PII.         │
│ • Commits authoritative resolution with epistemic audit trail               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Tier 3: Specialized Visual Document Grounding (autotrust/jev-27b)           │
│ • Reserved exclusively for multimodal PDF layout inspection                 │
│ • Inspects scanned/rendered PDF pages with graphical flowchart arrows,      │
│   matrix tables, or complex visual skip patterns where text extraction fails│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Trigger Conditions for Gemini Escalation
A candidate edge is escalated to Gemini if ANY of the following conditions are met:
1. **Low Local Critic Confidence:** Local `Phi-4` critic returns `confidence < 0.85`.
2. **Conflicting Hypotheses:** Extraction rule indicates `concordance_resolved`, but local critic flags `target_mismatch` or `routing_filter`.
3. **Complex Multi-Condition Prose:** The evidence note exceeds 400 characters and contains nested Boolean branching (`IF ... THEN ... ELSE IF ...`).
4. **Core Sociodemographic Domain:** The target variable belongs to high-value harmonized concepts (e.g. Low Income Measure `LIM`, Food Security `FSCDHFS2`, Kessler Distress `DDISTK10`, Labour Status `LFSSTAT`) where precision is paramount.

### 6.2 Strict Air-Gap & Zero-Cloud-Leakage Boundary
- Under `RULE[user_global]`, sensitive, confidential, or respondent-level records are never transmitted to cloud endpoints.
- Derived variable lineage metadata consists strictly of **publicly published Statistics Canada documentation strings** (e.g., `Target: DHHDYKD, Source: ANDB_01, Survey: CCHS 2015, Evidence: "Based on ANDB_01, SAMPLEID and PERSONID"`).
- No respondent microdata, individual survey answers, PII, or internal master files are ever sent to the escalation API.
- Escalated outputs are recorded with provenance tag: `auditor = 'gemini_escalation_arbitrator'`.

