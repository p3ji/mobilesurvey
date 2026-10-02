# 02 — Design Decisions & Empirical Evaluation

> **Evidence-grounded rationale for architectural trade-offs across search, classification, lineage modeling, and runtime evaluation.**

---

## 1. Decision: Lexical-First Baseline with Vector Sidecar (Not Vector-Only)

### Context & Problem
Many contemporary search architectures replace SQL/keyword indexing entirely with dense vector embeddings. In statistical metadata, this leads to catastrophic precision failures:
1. **Exact Mnemonics Fail**: Methodologists search for exact variable codes (`LFSSTAT`, `PRV`, `WTM_070C`). Vector embeddings map these short alphanumeric strings to random points in embedding space, completely missing exact hits.
2. **False Generalization**: Vector models often map technical statistical terms to broad thematic synonyms (e.g. querying a specific price index maps to general retail articles).

### Architectural Decision
* Retain **PostgreSQL Full-Text Search (tsvector/tsquery)** as the authoritative lexical baseline with field-weighted ranking (Concepts = $+4$, Questions = $+1$, Code Lists = $+0.25$, Exact Mnemonics = $+10$).
* Deploy **Qdrant Cloud** as an asynchronous **semantic sidecar** (`"Related by meaning"` panel) rather than a replacement.
* Supabase hydrates all Qdrant vector hits by ID, ensuring PostgreSQL Row-Level Security and live taxonomy roles remain authoritative.

---

## 2. Decision: Survey Procedural Boilerplate Stripping (+27% Cosine Gain)

### Context & Problem
Bi-encoder sentence transformers (such as `sentence-transformers/all-MiniLM-L6-v2`) average token embeddings across the entire text string. In survey questionnaires, interviewer prompts are dominated by procedural boilerplate:
* *"In the past 12 months..."*
* *"Which of the following did you..."*
* *"Please select all that apply..."*

When entire survey batteries repeat this preamble, the background procedural noise establishes a false similarity baseline (0.35–0.50), diluting substantive keywords (*"food insecurity"*, *"cryptocurrency"*, *"wait times"*) and causing canonical questions to fall below search thresholds.

### Architectural Decision
Created [`cleanSemanticQuestion.ts`](file:///Users/pushp/Documents/Projects/mobilesurvey/tools/metadata/statcan-corpus/src/vector/cleanSemanticQuestion.ts) to strip recall periods and interviewing scaffolding before generating dense vectors.

### Empirical Evidence & Benchmark Results

```mermaid
xychart-beta
    title "Vector Cosine Similarity Before vs After Boilerplate Stripping"
    x-axis ["Food Insecurity", "Psychological Distress", "Fintech / Online Banking"]
    y-axis "Cosine Similarity" 0.0 --> 1.0
    bar [0.3769, 0.2894, 0.2369]
    bar [0.6499, 0.5250, 0.3318]
```

| Search Construct | Raw Full Question Text | Cleaned Semantic Text | Raw Similarity | Cleaned Similarity | Net Gain |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Food Insecurity** | *"In the past 12 months, did you or any members of your household worry that food would run out before you got money to buy more?"* | *"Worry food would run out before getting money to buy more"* | `0.3769` | `0.6499` | **+27.3%** |
| **Psychological Distress** | *"During the past 1 month, how often did you feel so sad that nothing could cheer you up?"* | *"Feel so sad that nothing could cheer you up"* | `0.2894` | `0.5250` | **+23.6%** |
| **Fintech** | *"In the past 12 months, which of the following online activities did you engage in for personal use? Conducted online banking activities"* | *"Conducted online banking activities"* | `0.2369` | `0.3318` | **+9.5%** |

---

## 3. Decision: GSIM 2D Taxonomy with Server-Side Suppression

### Context & Problem
In large statistical surveys (e.g. Labour Force Survey, CCHS), operational paradata (interviewer IDs, interview start times, bootstrap replicate weights `W001–W500`, data imputation flags) outnumber substantive questions 3-to-1.
In early versions, paradata filtering happened client-side after paginated SQL queries. This caused **slot starvation**: a search for a common term would return 50 rows from the database, 48 of which were internal weights, leaving the user with only 2 visible cards on the page.

### Architectural Decision
1. Implemented formal **GSIM 2D Taxonomy** in PostgreSQL (`corpus_variable_role`):
   - `collected`: Direct respondent questionnaire items.
   - `derived`: Computed constructs, indices, and recodes.
   - `process`: Weights, imputation flags, sample IDs, admin flags.
   - `admin`: Administrative linkage pointers.
2. Filter `role <> 'process'` **server-side inside the SQL query before counting and pagination**.
3. **Impact**: Page count accuracy is 100%, and search card starvation dropped to zero.

---

## 4. Decision: Relational Lineage DAG over Dedicated Graph DBs

### Context & Problem
Evaluating dedicated graph databases (Neo4j, Memgraph) for variable derivations vs. a relational graph DAG.

### Architectural Decision (OpenAI Codex Second Opinion Consensus)
* StatCan variable lineage is fundamentally an **acyclic directed graph (DAG)** with shallow path depths (rarely exceeding 3 hops from raw variable $\rightarrow$ intermediate recode $\rightarrow$ public master variable).
* Dedicated graph databases introduce operational latency, network serialization overhead, and synchronization lag with the primary relational store.
* **Adopted Architecture**: Relational PostgreSQL edge store (`corpus_variable_derivation`) with recursive Common Table Expressions (`WITH RECURSIVE`) and on-device SQLite WAL queue runner (`derivation_queue.db`) with atomic lease locks.

---

## 5. Decision: Acronym Guardrail for Short Queries (`K10`, `K6`)

### Context & Problem
The global search ranking gave a $+10$ bonus for exact variable name matches. When researchers searched for short acronyms like `K10` (the internationally recognized Kessler 10 Psychological Distress Scale), unrelated surveys with generic question numbers (e.g., Section K Question 10: *"Is this a one or two parent household?"*) occupied the top 5 results, pushing genuine distress scale variables to rank 6.

### Architectural Decision
Refined the ranking function in [`search-sort.sql`](file:///Users/pushp/Documents/Projects/mobilesurvey/tools/metadata/statcan-corpus/sql/search-sort.sql):
1. Substantive matches in `concept` or `question_text` receive $+4$ weighting.
2. When a query matches an academic search alias (e.g. `K10` $\rightarrow$ `distress scale`), the raw name bonus is restrained (from $+10$ to $+1$) so construct-matching items outrank accidental name collisions.
3. **Result**: `K10` returns `DDISTK10` (*"DV - Distress Scale - K10"*, Rank 7.04) and `DISDVDSX` (*"Distress Scale - K10"*, Rank 6.85) at **Rank 1 and 2**.

---

## 6. Decision: Smart Battery Stitching vs Raw Database Duplication

### Context & Problem
Multi-item batteries frequently share an introductory stem (*"Which of the following online payment options are accepted...?"*) while the specific category item (*"Cryptocurrency"*) was split into a separate column. If a questionnaire had 20 sub-items, raw database storage had NULL concepts, rendering 20 identical question stems on the screen.
Duplicating text into the `concept` column in the database was rejected because:
- It corrupts official StatCan data dictionary fidelity.
- It causes redundant, visually repetitive rendering when viewing individual variable records.

### Architectural Decision
Created pure UI helper [`renderHitQuestion.ts`](file:///Users/pushp/Documents/Projects/mobilesurvey/platform/hub/src/renderHitQuestion.ts):
- Dynamically stitches stems ending in `:`, `-`, `—`, or `?` with option labels.
- Shields uninformative placeholders (`Question 14`, `Q32`, `Yes/No`).
- Preserves database integrity with zero destructive writes.
