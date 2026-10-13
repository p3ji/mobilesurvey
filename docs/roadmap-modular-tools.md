# Modular Survey Tools — Extended Roadmap

*Documented 2026-10-03.*

This roadmap integrates three major capabilities into the Modular Survey Tools platform, extending its reach across the statistical lifecycle (authoring, testing, validation, and post-collection dissemination).

---

## 1. Phase 21: Remine — Automated Tabular Mining & Dissemination Engine

- **Workspace package:** `tools/analysis/remine` (`@mobilesurvey/remine`)
- **Survey Step:** Dissemination & Secondary Analysis / Tabular Data Mining
- **Primary Interfaces:** Upgraded Hub `Analyzer` screen (`#analyzer` / `#remine`) and CLI runner
- **Input → Output:** Multi-dimensional cubes (StatCan WDS bulk cubes) or Survey Cross-tabs (`Instrument` + collected responses) → Audited fact briefs, scored findings, and bound narrative articles.

### Core Concept & Problem Solved
Official statistical releases (e.g., Statistics Canada Daily releases) narrate only a fraction of the data contained in published tables. A Labour Force Survey cube with 8,000 subgroup series may have only 12 series mentioned in the headline release prose. Remine systematically mines what the underlying data supports saying, uncovering persistent subgroup disparities, longitudinal trend widenings/narrowings, threshold crossings, rank order reversals, and disproportionate contributions.

### 6-Stage Pipeline
1. **Discover:** Scrapes or indexes release dates and resolves cited table product IDs (e.g., StatCan WDS API / CANSIM tables) or loads an `Instrument` and its response dataset.
2. **Mentions:** Scans the release narrative text to map which dimension members were already reported. Demotes (without filtering) already-narrated cuts to prioritize unexplored findings.
3. **Cube / Cross-Tab Ingest:** Loads multidimensional data cubes via the StatCan WDS bulk API or aggregates raw responses from `@mobilesurvey/runtime-engine` across demographic subgroups into typed n-dimensional arrays.
4. **Deterministic Probe Library:**
   - *Persistent Gaps:* Subgroup disparity across time intervals that remains statistically stable.
   - *Trajectory:* Gaps widening or narrowing significantly between baseline and reference periods.
   - *Thresholds & Streaks:* Crossings of critical benchmarks or directional run lengths.
   - *Rank Reversals:* Swaps in rank ordering among categories.
   - *Disproportionate Shares:* Demographic slices accounting for outsized shares of a total.
5. **Reliability & Salience Gating:**
   - Gated on StatCan quality flags (suppressing high-CV / flag `F` / flag `E` estimates).
   - Enforces cell count floors on survey microdata cross-tabs.
   - Multi-factor salience score: $\text{Salience} = \text{Magnitude} \times \text{Persistence} \times \text{Legibility} \times (1 - \text{MentionPenalty})$.
6. **Zero-Hallucination Number Contract & Editorial Binding:**
   - Fact briefs assembled with exact computed figures tied to immutable vector IDs.
   - Editorial drafting uses structured tokens: `{{fact_14.human}}`, `{{fact_14.gap}}`.
   - Strict compiler checks: unmapped tokens, raw digits outside allowlist (years/ordinals), or written number words ("one in three", "double") fail the build.

---

## 2. Phase 22: Accessibility Testing Tool (WCAG 2.2 Compliant Test)

- **Workspace package:** `tools/testing/a11y-auditor` (`@mobilesurvey/a11y-auditor` or integrated into `@mobilesurvey/questionnaire-bot`)
- **Survey Step:** Questionnaire Quality Assurance & Accessibility Compliance
- **Primary Interfaces:** Standalone CLI (`pnpm a11y:audit`), CI audit gate, Hub Validator/Designer audit panel
- **Input → Output:** Rendered survey URL / `Instrument` + DOM state → WCAG 2.2 Level AA / AAA violation reports, remediation snippets, and exportable VPAT / compliance certifications.

### Core Concept & Problem Solved
Government statistical agencies are legally mandated to meet rigorous accessibility standards (Standard on Web Accessibility, European EN 301 549, US Section 508, Accessible Canada Act). While previous phases implemented WCAG 2.1 AA basics in `@mobilesurvey/runtime-engine` and ran static `axe-core` sweeps, modern responsive surveys require specialized **WCAG 2.2 Level AA / AAA automated and heuristic auditing** targeted at dynamic questionnaire UX.

### Key WCAG 2.2 Criteria for Survey Questionnaires
1. **Target Size (Minimum) (SC 2.5.8 - Level AA):**
   - Asserts all mobile radio tap cards, checkbox hitboxes, grid matrix buttons, scale points, and table inputs have a minimum target size of $24 \times 24$ CSS px (or sufficient spacing perimeter), preventing mistaps on touchscreens.
2. **Focus Appearance (SC 2.4.11 - Level AA) & Focus Not Obscured (SC 2.4.12 - Level AA / SC 2.4.13 - Level AAA):**
   - Validates that when navigating questionnaires via keyboard, active elements have a high-contrast outline ($\ge 3:1$) with minimum 2px thickness.
   - Verifies sticky headers (e.g., survey progress bar, section title) or sticky bottom navigation bars (Next/Previous buttons) never obscure focused inputs or error messages.
3. **Redundant Entry (SC 3.3.7 - Level A):**
   - In longitudinal surveys or multi-roster instruments (e.g. household members, employer histories), asserts that previously entered respondent data (e.g. name, birthdate, address) is either auto-populated or available for confirmation rather than re-typed.
4. **Accessible Authentication (SC 3.3.8 - Level AA / SC 3.3.9 - Level AAA):**
   - Validates that survey respondent access gates (access codes, passphrases) do not rely on cognitive function tests (memorization, transcription of CAPTCHAs) and fully support password managers, browser autofill, and copy-paste.
5. **Dragging Movements (SC 2.5.7 - Level AA):**
   - Ensures drag-and-drop ranking or sorting questions provide single-pointer keyboard-accessible alternatives (e.g., Up/Down arrow buttons).
6. **Consistent Help (SC 3.2.6 - Level A):**
   - Verifies interviewer contact info, help links, glossary tooltips, and accessibility accommodations hotlines remain located at consistent relative positions across all pages.

---

## 3. Phase 23: LoRA Fine-Tuned Translation Model for Statistics Canada Survey Language

- **Workspace package:** `tools/authoring/survey-translator` (`@mobilesurvey/survey-translator`)
- **Survey Step:** Questionnaire Authoring & Multilingual Harmonization
- **Primary Interfaces:** Designer Translation Workspace (`@mobilesurvey/designer`) and Batch Harmonization CLI
- **Input → Output:** Monolingual English or French questions/labels $\rightarrow$ StatCan-standard bilingual translations, category alignment, and translation memory verification.

### Core Concept & Problem Solved
Generic commercial machine translation (DeepL, Google Translate, base LLMs) frequently fails on official Canadian statistical surveys. It misinterprets standard question stems ("Thinking about...", "During the past 12 months..."), mistranslates dichotomous scale conventions ("Mark all that apply" $\rightarrow$ "Cochez toutes les réponses qui s'appliquent"), alters legal/confidentiality preambles, and misses official classification names (NAICS/SCIAN, NOC/CNP, CIP/CPE).

### Grounding & Fine-Tuning Strategy
1. **Training Dataset Extraction:**
   - Grounded directly on `statcan-corpus`: 438,931 variable occurrences across 113 survey programs and 260 cycles.
   - Pairs official English and French documentation into high-fidelity parallel corpora:
     - Question text: `(question_en, question_fr)`
     - Response categories: `(code_value, label_en, label_fr)`
     - Interviewer instructions: `(instruction_en, instruction_fr)`
     - Conceptual notes and universe definitions.
2. **Model Architecture & Fine-Tuning:**
   - Parameter-Efficient Fine-Tuning (PEFT) using **LoRA / QLoRA** on an open-weights foundation model (e.g. Qwen2.5-Coder / Llama-3 / Mistral-Small or bilingual sequence-to-sequence base like NLLB-200).
   - Low-rank adapters fine-tuned specifically on Canadian official statistical terminology, tone, and grammatical conventions.
3. **Deterministic Constraint Guardrails:**
   - Post-generation term validator enforcing exact matches for canonical StatCan standard classifications (e.g. standard demographic groupings, "Don't know" $\rightarrow$ "Ne sait pas", "Refusal" $\rightarrow$ "Refus").
4. **Integration with Modular Survey Suite:**
   - Local on-device inference via GGUF/Ollama or lightweight Node/Python runner.
   - Direct integration into `@mobilesurvey/designer`: authors drafting in English click "Generate Official French Translation" to immediately populate the bilingual DDI `label.fr` and `instruction.fr` fields with certified agency phrasing.

---

## 4. Related Data Searcher (added 2026-10-06)

- **Scope:** Extend the Searcher database beyond Statistics Canada to surveys and other data sources catalogued on open.canada.ca (e.g. non-StatCan surveys).
- **Goal:** Identify synergies and opportunities for data combination across sources.
- **Experiment:** Testing whether Jev AI models (a new classification model) improve search efficiency (compare against the lexical baseline and the Qdrant vector sidecar per `docs/search-evaluation.md`).
- **Hub:** roadmap tile `related-data`.

## 5. Open Stats Lab (added 2026-10-06)

- **Scope:** Experiments on how official statistics surface online.
- **First result:** Search visibility experiment report: https://civik.peji.ca/stats/report/
- **Hub:** roadmap tile `open-stats-lab` links to the report. Separate from the AI-visibility study code in the `stats` repo; no shared code is implied.

---

## 6. Phase 25: T15.4 Derived Variable Specification Ingestion Engine *(DONE — 2026-10-12)*

- **Workspace package:** `tools/metadata/statcan-corpus` (`src/graph/derived-specs.ts` / `@mobilesurvey/statcan-corpus`)
- **Survey Step:** Post-collection Documentation & Computational Lineage Extraction
- **Primary Interfaces:** CLI pipeline (`pnpm corpus:derived-specs`), Supabase `corpus_derivation_edge`, Hub Graph Explorer
- **Input → Output:** 44 English `T15.4` Derived Variable Specification PDF manuals (`CCHS_ESCC`, `CHMS_ECMS`, `CCAHS_ECSAC`, `SAHCPDP_EASSPPP`, `SCMH_ECSM`, `SLCDC_EPMCC`) → 6,013 parsed DV blocks and **10,948 verified DAG edges** across 28 `(surveyGroup, cycle)` pairs.

### Core Concept & Problem Solved
Previously, the derivation extraction queue mined only `T15.2`/`T15.6` data dictionaries. Statistics Canada also publishes dedicated **Derived Variable Specification Books (`T15.4`)** containing multi-page tables, SAS/SPSS algorithms, and `Temporary Reformat` blocks for clinical and socioeconomic indices. Phase 25 extracts all 44 English `T15.4` PDFs into `out/documents/`, parses standard (`Variable name:` / `Based on:`), numbered CCAHS, and `Temporary Reformat` layouts, resolves CCHS 2022–2024 3-digit $\rightarrow$ 2-digit question renumberings with a $\ge 0.70$ semantic concept guard, and enforces the Two-Clause Epistemic Transparency Contract (`Evidence from data dictionary: "..."; AI interpretation and action: ...`).

---

## 7. Phase 26: Questionnaire-to-Dataset Variable Concordance Resolver *(DONE — 2026-10-12)*

- **Workspace package:** `tools/metadata/statcan-corpus` (`src/graph/concordance.ts` / `@mobilesurvey/statcan-corpus`)
- **Survey Step:** Data Dictionary Harmonization & Questionnaire Concordance
- **Primary Interfaces:** CLI pipeline (`pnpm corpus:concordance`), SQLite `derivation_queue.db`, Supabase `corpus_derivation_edge`
- **Input → Output:** Dictionary `Question Name:` headers, explicit `"corresponds to question X"` notes, and structural CAPI/CATI code transforms → **832 newly verified concordance edges** across 47 survey groups + **387 quarantined self-referential/routing false positives**.

### Core Concept & Problem Solved
In many surveys, derivation notes cite CAPI/CATI collection question codes (`SED_Q12M`, `RRS_Q12`, `C19_Q18B`, `LTC_Q05_01`, `ED_Q01A`) rather than the published analytical column names (`SED12M`, `RRS_12`, `C19_18B`, `LTC05_01`, `ED1Q001`). Phase 26 resolves these across 47 survey groups while quarantining 320 self-referential question codes (e.g. `ME_25D <- ME_Q25` where `ME_25D` is option D of battery `ME_Q25`) and 67 routing notes. Combined with Phase 25, live verified derivation lineage in Supabase `corpus_derivation_edge` expanded from 14,233 to **26,680 verified links across 131 survey cycles (+87.5%)**.

---

## 8. Phase 27: Cross-Cycle Concept Continuity & Longitudinal Lineage Mesh *(DONE — 2026-10-12)*

- **Workspace package:** `tools/metadata/statcan-corpus` (`src/graph/continuity.ts`), `platform/hub` (`src/CorpusConcepts.tsx`)
- **Survey Step:** Longitudinal Harmonization & Multi-Cycle Comparability
- **Primary Interfaces:** CLI pipeline (`pnpm corpus:continuity`), Hub Knowledge Graph Explorer (`#searcher?scope=concepts`), Supabase `sql/concept_continuity.sql` & `sql/concept_continuity_mesh.sql`
- **Input → Output:** 230,034 English variable occurrences across multi-cycle programs → **2,086 cross-cycle continuity bridges** across 32 survey programs (**1,759 live links** in Supabase `corpus_concept_continuity`).

### Core Concept & Problem Solved
While exact DDI cascade clustering (`cluster.ts`) places identical `(meaning, universe)` occurrences onto a single timeline, any shift in universe (`universe_shift`: 1,464), wording/universe evolution (`wording_and_universe_evolution`: 598), concept relabeling (`concept_relabel`: 18), or CCHS 3-digit to 2-digit renumbering (`cycle_renumbering`: 6) creates a separate `l:ConceptualVariable` group so populations are never silently merged. Phase 27 connects consecutive distinct `conceptual_variable_id` epochs along each longitudinal series with full Two-Clause attribution (`Evidence from data dictionary: "..."; AI interpretation and action: ...`).

