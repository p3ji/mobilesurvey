# Researcher Pipeline Autonomous Orchestrator Architecture

**Target**: Full-lifecycle autonomous orchestration of the Statistics Canada research literature pipeline (`tools/research/researcher`), backed by hybrid on-device / cloud LLM tiering and quality-gated deployment.

---

## 1. System Architecture & Tiering Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Antigravity Autonomous Orchestrator                   │
│   (Heartbeats via schedule tool, State Tracking, Quality Verification Gates) │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │ Stage 1: Source Discovery &     │  • Deterministic Node adapters
        │ Checkpointed Harvest           │  • OpenAlex (Polite Pool), Crossref, CRDCN
        └────────────────┬────────────────┘  • Checkpointed cursor & SQLite WAL cache
                         │
        ┌────────────────▼────────────────┐
        │ Stage 2: Coarse Filtering &     │  • Whole-word regex boundaries
        │ Disqualification                │  • Foreign statistical agencies (ABS, ONS)
        └────────────────┬────────────────┘  • False-positive acronym exclusions
                         │
     ┌───────────────────┴───────────────────┐
     │                                       │
     ▼                                       ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Tier A: High-Volume Extraction│   │ Tier B: Ambiguity Escalation │
│ (Local Apple Silicon M5 Ultra)│   │ (Cloud Gemini)               │
│ • qwen3.8-27b / deepseek-v4  │   │ • Edge-case resolution       │
│ • Zero API cost, unlimited   │   │ • Multi-section report scan  │
│ • Air-gapped, loopback-only  │   │ • Conflicting cycle disputes │
└──────────────┬───────────────┘   └──────────────┬───────────────┘
               │                                  │
               └─────────────────┬────────────────┘
                                 │
        ┌────────────────────────▼────────────────────────┐
        │ Stage 3a: Adversarial Auditor Subagent          │
        │ • Cross-examines worker extractions             │
        │ • Tests counter-hypotheses (passing citation?)   │
        │ • Audits verbatim grounding & cycle sanity      │
        └────────────────────────┬────────────────────────┘
                                 │
        ┌────────────────────────▼────────┐
        │ Stage 3b: Deterministic Checks  │  • 100% exact substring matching
        │ Engine                          │  • Canonical cycle list matching
        └────────────────┬────────────────┘  • Strict schema adherence
                         │
                 [All Checks Pass?]
                    /          \
                 [YES]         [NO] ──► Isolate in needs_review & alert user
                   │
        ┌──────────▼──────────────────────┐
        │ Stage 4: Automated Publishing   │  • Generate researcherPilot.json
        │ & Deployment Gate               │  • pnpm test & pnpm build verification
        └─────────────────────────────────┘  • Git commit & push to GitHub Pages
```

### LLM Responsibility Matrix
| Stage | Component | Engine / Model | Execution Location |
| :--- | :--- | :--- | :--- |
| **Stage 1: Harvest** | API Discovery | Node.js | Local (Deterministic) |
| **Stage 2: Filter** | Rule Gate | Node.js / Regex | Local (Deterministic) |
| **Stage 3: Extract** | Bulk Disambiguation | `qwen3.8-27b` / `deepseek-v4` | Local M5 Ultra (`http://localhost:1234/v1`) |
| **Stage 3b: Escalate** | Complex / Ambiguous | Cloud Gemini (`gemini-2.5-pro` / `flash`) | Google Cloud API |
| **Stage 3c: Audit** | **Adversarial Review Subagent** | **Dual-Pass Critic Agent (Local / Cloud)** | **Subagent Loop / Orchestrator** |
| **Stage 4: Verify** | Grounding Check | Node.js Test Suite | Local (Deterministic) |
| **Stage 5: Deploy** | Build & Push | Antigravity Git Runner | Local / GitHub |

---

## 2. Autonomous Orchestrator Execution Lifecycle

1. **Trigger & Configuration**:
   - The orchestrator configures the batch target: e.g. **Historical Survey Expansion (2015–2019)** across 54 survey programs.
   - Initialized with batch bounds (query pacing, sleep intervals, API rate limits).
2. **Background Execution**:
   - Spawns background pipeline tasks (`run_scheduled_harvest.ts` or CLI workers).
   - Sets non-blocking `schedule` timers for heartbeats (e.g. 15–30 min intervals).
3. **Heartbeat & Self-Healing**:
   - Upon timer wakeup: inspects SQLite job queue status (`completed`, `in_progress`, `failed`, `needs_review`).
   - If API rate limits (HTTP 429) occur: pauses runner and sets an automatic backoff timer until the reset epoch.
   - If local LLM server halts: checks process health on port 1234.
4. **Adversarial Review Subagent Audit (Dual-Pass Verification)**:
   - Extractor workers run in "optimistic discovery" mode.
   - An independent **Reviewer Subagent** acts as an adversarial critic before any candidate claim reaches the database:
     - **Passing Citation Check**: Tests whether the survey was merely cited for background statistics (`"According to Statistics Canada (2015)..."`) versus genuine microdata modeling.
     - **Phantom Cycle Check**: Asserts that the detected collection cycle actually existed in StatCan history (e.g. flagging a non-existent "2015 CIUS" or bibliographic publication year bleed).
     - **Verbatim Textual Grounding**: Verifies that every extracted quote is a bit-for-bit verbatim substring of the input paper with zero hallucinated paraphrasing.
   - If worker and reviewer disagree, the record is automatically escalated to Cloud Gemini or routed to `needs_review` with structured rationale.
5. **Deterministic Verification Gates (Strict Zero-Hallucination Contract)**:
   - Verification suite executes automatically upon batch completion:
     - `Check 1`: All claims have 100% verbatim passage grounding (`quote` strictly in source passage).
     - `Check 2`: Analyzed cycles match legitimate StatCan survey cycles (no spurious publication year bleed).
     - `Check 3`: Survey aliases resolve to known canonical acronyms.
     - `Check 4`: Role classification correctly distinguishes `analyzed` from `background_mention`.
6. **Quality-Gated Publishing**:
   - If $0$ ungrounded claims and $100\%$ validation pass rate:
     - Generates updated frontend snapshot (`platform/hub/src/researcherPilot.json`).
     - Executes `pnpm --filter @mobilesurvey/hub typecheck`, `pnpm test`, and `pnpm build`.
     - Commits and pushes to `origin/main` for live GitHub Pages deployment.
     - Sends clean completion summary to user.
   - If errors or edge cases exceed threshold:
     - Halts before deployment, isolates candidate works into `needs_review`, and alerts user with exact claim diffs.

---

## 3. Implementation Steps

1. **Escalation Routing in Pipeline (`src/escalation.ts`)**:
   - Connect the local extraction pipeline to fall back to Cloud Gemini when local confidence is low or when JSON schema validation requires multiple retries.
2. **Orchestrator Driver Script (`src/orchestrator.ts`)**:
   - Provide a programmatic coordinator that can run batches, emit machine-readable telemetry (JSON progress), and execute verification gates.
3. **Queue Health & Status RPCs**:
   - Lightweight status checks reporting: `total_candidates`, `processed`, `analyzed_works`, `escalated_to_gemini`, `needs_review`.
4. **First Live Run (Historical Survey Expansion 2015–2019)**:
   - Queue and launch the 2015–2019 historical depth harvest.
