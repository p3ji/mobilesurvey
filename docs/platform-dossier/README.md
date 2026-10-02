# mobilesurvey Platform Dossier & Evidence Compendium

> **Comprehensive documentation, design decisions, audit evidence, reproducible pipelines, and presentation assets for the modularsurvey platform.**  
> *Last updated: October 2026*

---

## 1. Executive Overview

**mobilesurvey** (`msurvey.peji.ca`) is an end-to-end, standards-compliant, modular survey and metadata infrastructure engineered for official statistics agencies, survey methodologists, and empirical social researchers.

Rather than building a monolithic questionnaire web application, mobilesurvey is decomposed into **six decoupled, interoperable capabilities**:

```mermaid
flowchart TD
    subgraph Authoring["1. Authoring"]
        A1[Designer App] --> A2[Questionnaire Migrator]
        A2 --> A3[StatCan EQ Dialect Parser]
    end

    subgraph Collection["2. Collection Engine"]
        C1[Runtime Engine XState v5] --> C2[Respondent View WCAG 2.1 AA]
        C1 --> C3[Sensor Module GPS/Camera/ML]
    end

    subgraph Testing["3. Autonomous Testing"]
        T1[Questionnaire Bot] --> T2[Path Enumeration 3 Strategies]
        T1 --> T3[Headless Chromium Runner]
    end

    subgraph Validation["4. Multi-Method Validation"]
        V1[Deterministic Confrontation] --> V2[Statistical Rule Engine]
        V2 --> V3[LLM-Assisted Resolution]
    end

    subgraph Metadata["5. Metadata & Knowledge Graph"]
        M1[438k Variable Census] --> M2[GSIM 2D Taxonomy]
        M1 --> M3[Lineage DAG & Provenance]
        M1 --> M4[Hybrid Search Lexical + Qdrant Vector]
    end

    subgraph Research["6. Empirical Research Discovery"]
        R1[Researcher Discovery Engine] --> R2[326 Canadian Microdata Publications]
        R1 --> R3[Searcher Deep-Link Mesh]
    end

    Authoring --> Collection
    Collection --> Testing
    Collection --> Validation
    Authoring <--> Metadata
    Metadata <--> Research
```

---

## 2. Dossier Structure

This dossier contains detailed architectural rationales, audit reports, reproducible CLI runbooks, and presentation materials:

1. **[`01-MODULAR-TOOLS-ARCHITECTURE.md`](./01-MODULAR-TOOLS-ARCHITECTURE.md)**  
   *Deep dive into each of the 6 core pillars, boundary contracts, DDI-Lifecycle alignment, state machine architectures, and runtime engine isolation.*
2. **[`02-DESIGN-DECISIONS-AND-EVALUATION.md`](./02-DESIGN-DECISIONS-AND-EVALUATION.md)**  
   *The "Why" behind every major technical trade-off: Relational DAG vs Graph DBs, Lexical baseline vs Vector sidecar, survey boilerplate stripping (+27% similarity gain), acronym guardrails, and smart battery stitching.*
3. **[`03-TRI-LENS-AUDIT-AND-REMEDIATION-LOG.md`](./03-TRI-LENS-AUDIT-AND-REMEDIATION-LOG.md)**  
   *Forensic reports from the Content SME, Metadata Standards Expert, and External Researcher multi-agent audit team. Details the 497 unsuppressed variables, leaking weight suppression, 28 academic search aliases, and before/after verification.*
4. **[`04-REPRODUCIBLE-PIPELINE-RUNBOOK.md`](./04-REPRODUCIBLE-PIPELINE-RUNBOOK.md)**  
   *Complete CLI instructions to reproduce the entire data pipeline: dictionary ingestion, classification, vector embedding in Qdrant Cloud, role synchronization, AI concept staging, and benchmark test suites.*
5. **[`05-EXECUTIVE-PRESENTATION-DECK.md`](./05-EXECUTIVE-PRESENTATION-DECK.md)**  
   *A 10-slide executive presentation deck with slide layouts, speaking notes, architecture callouts, and key empirical metrics for briefings with statistical agencies, academic departments, or technology stakeholders.*

---

## 3. Core Vital Statistics

* **Variables Indexed**: 438,931 variable entries classified across 113 survey programs and 260 cycles.
* **Vector Index**: 179,592 substantive English variable occurrences in Qdrant Cloud (`modularsurvey`), 384-d Cosine embeddings with 0 role mismatches.
* **Search Performance**: Sub-second full-text & semantic retrieval (P50: 308 ms lexical, 189 ms vector sidecar).
* **Research Mesh**: 326 catalogued outside peer-reviewed articles and Canadian policy reports mapped to 8 major StatCan microdata programs (CCHS, GSS, LFS, CHMS, SHS, CSD, CIS, CIUS).
* **Code Standards**: Strict TypeScript across 16 workspace packages, 0 `eval()` calls, WCAG 2.1 AA accessibility, and DDI-CDI cross-cycle variable continuity.
