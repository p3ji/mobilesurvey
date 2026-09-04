# Knowledge Graph Batch 3 Report: Top 8 Specialized Surveys

> **Generated:** 2026-09-04  
> **Standard Ontology:** UNECE/StatCan GSIM (2D Variable Taxonomy), DDI-Lifecycle 3.3, DDI-RDF Discovery (`disco`), W3C PROV-O (`wasDerivedFrom`, `hadPrimarySource`)  
> **Surveys Covered:** CSD, APS, LSIC, CHMS, LISA, SHS, CHSCY, SFS  
> **Execution Mode:** 100% Offline Analysis against `corpus.jsonl` (**0 database writes**)

---

## 1. Executive Summary

Batch 3 scales the Knowledge Graph across Statistics Canada's **8 primary specialized longitudinal, health measurement, and socioeconomic surveys**:

| Survey Program | Acronym | Domain / Substantive Scope | Variables Extracted | Cycles Analyzed | Derivations Extracted |
|---|---|---|---|---|---|
| **Canadian Survey on Disability** | **CSD** | Disability types, severity, workplace accommodations | **23,768** | 4 cycles | **28** |
| **Aboriginal Peoples Survey** | **APS** | First Nations, Métis, Inuit identity, culture, languages | **17,044** | 4 cycles | **212** |
| **Longitudinal Survey of Immigrants to Canada** | **LSIC** | Settlement, credential recognition, language acquisition | **13,992** | 3 waves | **859** |
| **Canadian Health Measures Survey** | **CHMS** | Direct physical measures, laboratory tests, biobank | **13,560** | 11 cycles | **32** |
| **Longitudinal & Int'l Study of Adults** | **LISA** | Work, education, skill development over life course | **13,035** | 6 waves | **180** |
| **Survey of Household Spending** | **SHS** | Detailed expenditures, dwelling costs, household goods | **12,124** | 2 cycles | **1,392** |
| **Canadian Health Survey on Children & Youth** | **CHSCY** | Pediatric development, mental health, school experiences | **11,086** | 3 cycles | **5** |
| **Survey of Financial Security** | **SFS** | Net worth, real estate, debts, pensions, assets | **11,046** | 4 cycles | **8** |
| **Total Batch 3** | — | — | **115,655** | **37 distinct cycles** | **2,716** |

### Cumulative Corpus Coverage
- **Batch 1 (CCHS Health):** 25,906 variables
- **Batch 2 (GSS Social + CIS Income):** 129,431 variables
- **Batch 3 (8 Specialized Surveys):** 115,655 variables
- **Cumulative Total:** **270,992 variables** (**62.0%** of entire 436,962-variable repository)

---

## 2. GSIM 2D Variable Matrix: Data Origin × Computation

| Survey | Collected (Questions) | Administrative (Tax/Registers) | Process (Weights/Paradata) | Base / Primary | Derived / Synthesized | PUMF Grouped `-(G)` |
|---|---|---|---|---|---|---|
| **CSD** | 21,878 (92.0%) | 177 (0.7%) | 1,713 (7.2%) | 21,074 (88.7%) | 2,694 (11.3%) | 671 |
| **APS** | 16,896 (99.1%) | 48 (0.3%) | 100 (0.6%) | 15,742 (92.4%) | 1,302 (7.6%) | 712 |
| **LSIC** | 13,968 (99.8%) | 8 (0.1%) | 16 (0.1%) | 13,091 (93.6%) | 901 (6.4%) | 0 |
| **CHMS** | 13,486 (99.5%) | 16 (0.1%) | 58 (0.4%) | 10,697 (78.9%) | 2,863 (21.1%) | 140 |
| **LISA** | 12,577 (96.5%) | 216 (1.7%) | 242 (1.9%) | 11,825 (90.7%) | 1,210 (9.3%) | 286 |
| **SHS** | 12,052 (99.4%) | 16 (0.1%) | 56 (0.5%) | 10,460 (86.3%) | 1,664 (13.7%) | 72 |
| **CHSCY** | 10,677 (96.3%) | 233 (2.1%) | 176 (1.6%) | 8,612 (77.7%) | 2,474 (22.3%) | 93 |
| **SFS** | 9,731 (88.1%) | 19 (0.2%) | 1,296 (11.7%) | 9,419 (85.3%) | 1,627 (14.7%) | 552 |
| **Combined Batch 3** | **111,265** (96.2%) | **733** (0.6%) | **3,657** (3.2%) | **100,920** (87.3%) | **14,735** (12.7%) | **2,526** |

---

## 3. Multi-Survey Concept Harmonization Mesh

The Knowledge Graph connects specialized content to StatCan's core harmonized sociodemographic concepts:

| Substantive Concept (`skos:Concept`) | CSD | APS | LSIC | CHMS | LISA | SHS | CHSCY | SFS | Total Harmonized Variables |
|---|---|---|---|---|---|---|---|---|---|
| **Age & Age Groupings** | 427 | 242 | 43 | 361 | 177 | 72 | 306 | 221 | **1,849** |
| **Sex & Gender** | 91 | 247 | 109 | 54 | 117 | 48 | 181 | 38 | **885** |
| **Indigenous Identity & Band Status** | 286 | 3,037 | 0 | 40 | 42 | 24 | 188 | 42 | **3,659** |
| **Disability & Activity Limitations** | 2,514 | 344 | 30 | 123 | 375 | 72 | 216 | 39 | **3,713** |
| **Immigrant Status, Landing & Credentials** | 165 | 0 | 393 | 38 | 80 | 0 | 231 | 55 | **962** |
| **Income, Assets, Debts & Wealth** | 2,395 | 806 | 350 | 43 | 1,183 | 792 | 219 | 1,811 | **7,599** |
| **Education & Qualifications** | 839 | 1,512 | 926 | 134 | 522 | 92 | 245 | 18 | **4,288** |
| **Health Status, Conditions & Biomarkers** | 442 | 571 | 260 | 492 | 170 | 146 | 570 | 5 | **2,656** |

---

## 4. Key Substantive Modules Discovered by Survey

| Survey | Top Content Modules Detected | Dominant Domain Profile |
|---|---|---|
| **CSD** | `AAD` (3,004), `ADM` (1,458), `DSQ` (1,146), `EMO` (960), `AADA` (854) | Module AAD |
| **APS** | `MOB` (536), `ED1` (448), `DFL` (436), `TA` (376), `GH2` (348) | Module MOB |
| **LSIC** | `EM1` (1,318), `ED1` (914), `EM3` (794), `EM2` (758), `HL1` (650) | Module EM1 |
| **CHMS** | `FSF` (1,144), `FRH` (870), `AMM` (636), `FDT` (612), `PHR` (456) | Module FSF |
| **LISA** | `FCP` (504), `CHC` (460), `FI` (297), `CHI` (276), `REL` (240) | Module FCP |
| **SHS** | `INC` (768), `PIN` (768), `SH0` (624), `FD8` (624), `TR0` (596) | Income |
| **CHSCY** | `LTC` (1,054), `PAI` (854), `AHC` (714), `WSH` (574), `IMM` (408) | Module LTC |
| **SFS** | `ASR` (1,102), `ASS` (928), `BUS` (680), `DBT` (604), `DV` (338) | Module ASR |

---

## 5. Sample Derivation Lineage Links Extracted in Batch 3

| Target Derived Variable | Survey | Extracted Inputs (`wasDerivedFrom`) | Source Evidence from Notes |
|---|---|---|---|
| **`DANCES`** | 2006 | `Q01` | *question 1(Q01)* |
| **`DANCESG`** | 2006 | `Q01` | *question 1(Q01)* |
| **`DIDENT`** | 2006 | `Q02`, `Q03`, `Q05` | *questions 2(Q02), 3(Q03) and 5(Q05)* |
| **`DIDENTGM`** | 2006 | `Q02`, `Q03`, `Q05` | *questions 2(Q02), 3(Q03) and 5(Q05)* |
| **`DIDENT91`** | 2006 | `Q01`, `Q02`, `Q03` | *questions 1(Q01),2(Q02) and 3(Q03)* |
| **`DIDGM91`** | 2006 | `Q01`, `Q02`, `Q03` | *questions 1(Q01),2(Q02) and 3(Q03)* |
| **`DHLOSP`** | 2006 | `A01`, `A02`, `A03`, `A23`, `A24`, `A25`, `A29` | *questions A01, A02, A03, A23, A24, A25, and A29* |
| **`DHLOSGP`** | 2006 | `DHLOSP` | *variable DHLOSP* |
| **`DSATTEND`** | 2006 | `A01`, `A04`, `A05`, `A23`, `A25`, `A26`, `A31`, `A32`, `A33` | *questions A01, A04, A05, A23, A25, A26, A31, A32 and A33* |
| **`DLANGS`** | 2006 | `B02`, `B03` | *B02 and B03* |
| **`DLNGFAMS`** | 2006 | `DLANGS` | *DLANGS* |
| **`DLNGGRPS`** | 2006 | `DLANGS` | *DLANGS* |
| **`DLANG`** | 2006 | `B01`, `B05` | *questions B01 and B05* |
| **`DLANGU`** | 2006 | `B02`, `B03`, `B06`, `B07` | *questions B02, B03, B06 and B07* |
| **`DLNGFAMU`** | 2006 | `DLANGU` | *DLANGU* |

---

## 6. Batch 3 Architectural & Methodological Conclusions

1. **High Longitudinal & Cross-Wave Fidelity**:
   - In longitudinal surveys like **LSIC** and **LISA**, wave-to-wave variable identifiers follow stable prefixes, allowing cross-wave panel linkages without manual lookup.
2. **Biological & Physical Measures in CHMS**:
   - In **CHMS**, direct physical measurements (accelerometry, spirometry, blood/urine laboratory values) are cleanly distinguished from interview questions and replicate weights.
3. **PUMF Grouped Recode Expansion**:
   - Identified **2,526** grouped analytical variables across the 8 surveys, confirming that the `- (G)` classification rule generalizes across all StatCan divisions.
4. **Overall Status**:
   - With **270,992 variables (62.0% of the repository)** now mapped into the Knowledge Graph ontology, the metadata foundation is prepared for full corpus completion (Batch 4) and Hub Searcher integration (Batch 5).
