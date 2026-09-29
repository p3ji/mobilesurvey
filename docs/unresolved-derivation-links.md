# Derivation Links Not Made (unresolved sources)

Generated 2026-09-29 from `out/derivation_queue.db` after the full Phase 19 audit pipeline
(Check 2 verbatim → Check 2a range expansion → Check 3b component retarget → Check 3c Question Name alias →
dedup guard → Check 4 suggester + human review). These edges are grounded **verbatim** in the official StatCan
derivation notes but their source token has no resolvable published column. They sit in `needs_review` —
**not rejected**: the lineage claim is real, only the graph endpoint is missing.

Total: 217 rows / **208 unique edges** across 11 surveys.
For comparison: the local queue has 1,472 auto-verified candidate pairs; the publication filter currently exports 1,359 direct-input pairs to `out/verified_edges.sql`, then resolves only same-document English occurrences in Supabase.

## Why these cannot be linked deterministically

### ACS_EEA_2006 (2006) — 87 edges

Raw questionnaire item numbers (e.g. `F31A`, `F32A`) that were **collected but never published** as columns in the ACS analytical file. Corpus check confirms no matching column exists among all 856 published variables, even via Question Name aliases or semantic search — the Check 4 suggester ran over every token and abstained with verified reasoning (e.g. "single words" item F31A: only derived proxies D2WORDYN/D2WORD5 exist; their notes cite F31A but the raw item itself is absent). The edges are true lineage to unpublished inputs.

### CADS_ECAD_2019 (2019) — 47 edges

RDC-documented items with no published column in the ECAD public file, after Check 3c Question Name alias resolution (which already recovered 124+2 edges). Remaining tokens have neither a Variable Name nor a Question Name match anywhere in the dictionary.

### APS_EAPA_2006 (2006) — 20 edges

Bare questionnaire item numbers (B02, K10A…) from the APS/EAPA cycles with no published counterpart — same class as ACS_EEA; Check 4 has not yet been run for this survey.

### CCHS_ESCC (2015_NU) — 17 edges

Long-form / internal CCHS items (AGET1, PMK, DHH_DW1…) that feed derived variables but are not shipped in the public master file.

### BC_CB_K12 (K-12_AllYears) — 16 edges

Administrative-data prose phrases from the BC K-12 dataset documentation (e.g. "provincial registry records"). These are not variable names at all — they describe external data sources outside this corpus, so no in-corpus edge can be formed.

### BC_CB_K12 (K_12_v2) — 10 edges

Administrative-data prose phrases from the BC K-12 dataset documentation (e.g. "provincial registry records"). These are not variable names at all — they describe external data sources outside this corpus, so no in-corpus edge can be formed.

### APS_EAPA_2012 (2012) — 5 edges

Same class as APS_EAPA_2006.

### BC_CB_K12 (K12) — 2 edges

Administrative-data prose phrases from the BC K-12 dataset documentation (e.g. "provincial registry records"). These are not variable names at all — they describe external data sources outside this corpus, so no in-corpus edge can be formed.

### CAFVMHS_ESSMFACM_2018 (2018) — 2 edges

Two tokens with no published counterpart (`CAFVMHS` is a self-reference artifact; `DEP_Q22A_1` an unpublished module item).

### APS_EAPA_2017_NIS_SIN (2017_NIS_SIN) — 1 edges

Single token (`LOC_STUDY`) with no published counterpart.

### CCHS_ESCC (2015) — 1 edges

Long-form / internal CCHS items (AGET1, PMK, DHH_DW1…) that feed derived variables but are not shipped in the public master file.

## How to revisit

1. **Check 4 suggester per survey** (only ACS_EEA_2006 has been swept so far):
   `npx tsx src/graph/suggester.ts suggest --survey <GROUP>` → review `out/suggestions_review.md` →
   `npx tsx src/graph/suggester.ts accept <GROUP> <SOURCE> <NAME>` records a human-approved verified edge @0.95.
2. **Collection instruments**: for the ACS/APS bare-item class, the questionnaire PDFs map item numbers to question
   text; matching instrument text against published `questionText` could recover more edges (same technique as the
   semantic leg of Check 4, but with authoritative numbering).
3. **Accept-as-is**: if we decide lineage-to-unpublished-input is itself valuable, these rows can be exported with
   `source_record_id = NULL` and the raw note as evidence — a future corpus refresh that ingests RDC/master files
   may resolve them retroactively (the dedupe key makes re-audit idempotent).

## Full list

| Survey | Target | Source | Raw note |
|---|---|---|---|
| ACS_EEA_2006 | D2AGWRD5 | `F31A` | Derived based on F31A and F31C. |
| ACS_EEA_2006 | D2AGWRD5 | `F31C` | Derived based on F31A and F31C. |
| ACS_EEA_2006 | D2C10YN | `F32A` | Derived based on F32A and F35. |
| ACS_EEA_2006 | D2C10YN | `F35` | Derived based on F32A and F35. |
| ACS_EEA_2006 | D2C3YN | `F32A` | Derived based on F32A and F36. |
| ACS_EEA_2006 | D2C3YN | `F36` | Derived based on F32A and F36. |
| ACS_EEA_2006 | D2GEST5 | `F28B` | Derived based on F28A and F28B. |
| ACS_EEA_2006 | D2PICTYN | `F32A` | Derived based on F32A, F33 and F34. |
| ACS_EEA_2006 | D2PICTYN | `F33` | Derived based on F32A, F33 and F34. |
| ACS_EEA_2006 | D2PICTYN | `F34` | Derived based on F32A, F33 and F34. |
| ACS_EEA_2006 | D2SENT5 | `F29B` | Derived based on F29A and F29B. |
| ACS_EEA_2006 | D2SOUND5 | `F29B` | Derived based on F29B, F30B, F31B, F32A and F32B. |
| ACS_EEA_2006 | D2SOUND5 | `F30B` | Derived based on F29B, F30B, F31B, F32A and F32B. |
| ACS_EEA_2006 | D2SOUND5 | `F31B` | Derived based on F29B, F30B, F31B, F32A and F32B. |
| ACS_EEA_2006 | D2SOUND5 | `F32A` | Derived based on F29B, F30B, F31B, F32A and F32B. |
| ACS_EEA_2006 | D2SOUND5 | `F32B` | Derived based on F29B, F30B, F31B, F32A and F32B. |
| ACS_EEA_2006 | D2SOUNYN | `F30A` | Derived based on F29A, F30A, F31A and F32A. |
| ACS_EEA_2006 | D2SOUNYN | `F31A` | Derived based on F29A, F30A, F31A and F32A. |
| ACS_EEA_2006 | D2SOUNYN | `F32A` | Derived based on F29A, F30A, F31A and F32A. |
| ACS_EEA_2006 | D2TOLDYN | `F32A` | Derived based on F32A and F33. |
| ACS_EEA_2006 | D2TOLDYN | `F33` | Derived based on F32A and F33. |
| ACS_EEA_2006 | D2UND3YN | `F32A` | Derived based on F32A and F37. |
| ACS_EEA_2006 | D2UND3YN | `F37` | Derived based on F32A and F37. |
| ACS_EEA_2006 | D2WORD5 | `F30A` | Derived based on F29A, F30A, F31A and F31B. |
| ACS_EEA_2006 | D2WORD5 | `F31A` | Derived based on F29A, F30A, F31A and F31B. |
| ACS_EEA_2006 | D2WORD5 | `F31B` | Derived based on F29A, F30A, F31A and F31B. |
| ACS_EEA_2006 | D2WORDS5 | `F30A` | Derived based on F30A and F30B. |
| ACS_EEA_2006 | D2WORDS5 | `F30B` | Derived based on F30A and F30B. |
| ACS_EEA_2006 | D2WORDYN | `F30A` | Derived based on F29A, F30A and F31A. |
| ACS_EEA_2006 | D2WORDYN | `F31A` | Derived based on F29A, F30A and F31A. |
| ACS_EEA_2006 | D2WORSYN | `F30A` | Derived based on F29A and F30A. |
| ACS_EEA_2006 | DAGEWALK | `F04A` | Derived based on F04A and F04B. |
| ACS_EEA_2006 | DAGEWALK | `F04B` | Derived based on F04A and F04B. |
| ACS_EEA_2006 | DAGEWORD | `F15A` | Derived based on F14A, F15A and F15C. |
| ACS_EEA_2006 | DAGEWORD | `F15C` | Derived based on F14A, F15A and F15C. |
| ACS_EEA_2006 | DBOTM | `D02BA` | Derived from D02BA and D02BB; converted to months. |
| ACS_EEA_2006 | DBOTM | `D02BB` | Derived from D02BA and D02BB; converted to months. |
| ACS_EEA_2006 | DBREASTM | `D01BA` | Derived from D01BA and D01BB; converted to months. |
| ACS_EEA_2006 | DBREASTM | `D01BB` | Derived from D01BA and D01BB; converted to months. |
| ACS_EEA_2006 | DBWGTGM | `C02` | Derived based on C02. |
| ACS_EEA_2006 | DC3YN | `F15A` | Derived based on F14A, F15A, F17, F18A and F19. |
| ACS_EEA_2006 | DC3YN | `F17` | Derived based on F14A, F15A, F17, F18A and F19. |
| ACS_EEA_2006 | DC3YN | `F18A` | Derived based on F14A, F15A, F17, F18A and F19. |
| ACS_EEA_2006 | DC3YN | `F19` | Derived based on F14A, F15A, F17, F18A and F19. |
| ACS_EEA_2006 | DCAREDOL | `I15A` | Derived based on I15A and I15B; converted to dollars per week. |
| ACS_EEA_2006 | DCAREDOL | `I15B` | Derived based on I15A and I15B; converted to dollars per week. |
| ACS_EEA_2006 | DCAREHRS | `I09A` | Derived based on I09A and I09B; converted to hours per week. |
| ACS_EEA_2006 | DCAREHRS | `I09B` | Derived based on I09A and I09B; converted to hours per week. |
| ACS_EEA_2006 | DCR2HR | `I19A` | Derived based on I19A and I19B; converted to hours per week. |
| ACS_EEA_2006 | DCR2HR | `I19B` | Derived based on I19A and I19B; converted to hours per week. |
| ACS_EEA_2006 | DLINEYN | `F06` | Derived based on F03A and F06. |
| ACS_EEA_2006 | DNAMEYN | `F15A` | Derived based on F14A, F15A and F17. |
| ACS_EEA_2006 | DNAMEYN | `F17` | Derived based on F14A, F15A and F17. |
| ACS_EEA_2006 | DOFFERYN | `F08` | Derived based on F03A and F08. |
| ACS_EEA_2006 | DPARCHIL | `G03B` | Derived based on G03A and G03B. |
| ACS_EEA_2006 | DRUNYN | `F04A` | Derived based on F03A, F04A and F05A. |
| ACS_EEA_2006 | DRUNYN | `F05A` | Derived based on F03A, F04A and F05A. |
| ACS_EEA_2006 | DSENTENC | `F15A` | Derived based on F14A, F15A, F17, F18A, F20A and F20B. |
| ACS_EEA_2006 | DSENTENC | `F17` | Derived based on F14A, F15A, F17, F18A, F20A and F20B. |
| ACS_EEA_2006 | DSENTENC | `F18A` | Derived based on F14A, F15A, F17, F18A, F20A and F20B. |
| ACS_EEA_2006 | DSENTENC | `F20B` | Derived based on F14A, F15A, F17, F18A, F20A and F20B. |
| ACS_EEA_2006 | DSENTYN | `F15A` | Derived based on F14A, F15A, F17, F18A and F20A. |
| ACS_EEA_2006 | DSENTYN | `F17` | Derived based on F14A, F15A, F17, F18A and F20A. |
| ACS_EEA_2006 | DSENTYN | `F18A` | Derived based on F14A, F15A, F17, F18A and F20A. |
| ACS_EEA_2006 | DSEPWEEK | `I28A` | Derived based on I28A, I28B and I28C; converted to weeks. |
| ACS_EEA_2006 | DSEPWEEK | `I28B` | Derived based on I28A, I28B and I28C; converted to weeks. |
| ACS_EEA_2006 | DSEPWEEK | `I28C` | Derived based on I28A, I28B and I28C; converted to weeks. |
| ACS_EEA_2006 | DSIZEHH | `A09` | Derived based on Section B (household roster) and A09. |
| ACS_EEA_2006 | DSLEEPAL | `E03A` | Derived based on E03A and E03B. |
| ACS_EEA_2006 | DSLEEPAL | `E03B` | Derived based on E03A and E03B. |
| ACS_EEA_2006 | DSOUNDS | `F14B` | Derived based on F14A and F14B. |
| ACS_EEA_2006 | DTURNSYN | `F07` | Derived based on F03A and F07. |
| ACS_EEA_2006 | DUNDERYN | `F15A` | Derived based on F14A, F15A and F16. |
| ACS_EEA_2006 | DUNDERYN | `F16` | Derived based on F14A, F15A and F16. |
| ACS_EEA_2006 | DURBRUR | `RUINDFG` | Derived based on DIREGION and Census variable RUINDFG. |
| ACS_EEA_2006 | DWALKYN | `F04A` | Derived based on F03A and F04A. |
| ACS_EEA_2006 | DWORD | `F15A` | Derived based on F14A, F15A and F15B. |
| ACS_EEA_2006 | DWORD | `F15B` | Derived based on F14A, F15A and F15B. |
| ACS_EEA_2006 | DWORDS | `F15A` | Derived based on F14A, F15A, F17, F18A and F18B. |
| ACS_EEA_2006 | DWORDS | `F17` | Derived based on F14A, F15A, F17, F18A and F18B. |
| ACS_EEA_2006 | DWORDS | `F18A` | Derived based on F14A, F15A, F17, F18A and F18B. |
| ACS_EEA_2006 | DWORDS | `F18B` | Derived based on F14A, F15A, F17, F18A and F18B. |
| ACS_EEA_2006 | DWORDSYN | `F15A` | Derived based on F14A, F15A, F17 and F18A. |
| ACS_EEA_2006 | DWORDSYN | `F17` | Derived based on F14A, F15A, F17 and F18A. |
| ACS_EEA_2006 | DWORDSYN | `F18A` | Derived based on F14A, F15A, F17 and F18A. |
| ACS_EEA_2006 | DWORDYN | `F15A` | Derived based on F14A and F15A. |
| ACS_EEA_2006 | HHLDSIZE | `A09` | Derived based on Section B (household roster) and A09. |
| APS_EAPA_2006 | DBREASTM | `B05A` | DBREASTM was derived from question B05A. |
| APS_EAPA_2006 | DCOURT | `K12A` | Derived from questions K12 and K12A. |
| APS_EAPA_2006 | DFAMSIZE | `I08A` | Derived from I08 and I08A. |
| APS_EAPA_2006 | DFISHCAR | `K13A` | Derived from questions K13 and K13A. |
| APS_EAPA_2006 | DGOVT | `K10A` | Derived from questions K10 and K10A. |
| APS_EAPA_2006 | DHEALTH | `K04A` | Derived from questions K04 and K04A. |
| APS_EAPA_2006 | DHEIGHCM | `B02` | Derived from question B02. |
| APS_EAPA_2006 | DHEIGHCM | `E31` | Derived from question E31. |
| APS_EAPA_2006 | DJOBOPP | `K01A` | Derived from questions K01 and K01A. |
| APS_EAPA_2006 | DLANGS | `B02` | Derived from B02 and B03. |
| APS_EAPA_2006 | DLANGS | `B03` | Derived from B02 and B03. |
| APS_EAPA_2006 | DLANGU | `B02` | Derived from questions B02, B03, B06 and B07. |
| APS_EAPA_2006 | DLANGU | `B03` | Derived from questions B02, B03, B06 and B07. |
| APS_EAPA_2006 | DLANGU | `B06` | Derived from questions B02, B03, B06 and B07. |
| APS_EAPA_2006 | DLANGU | `B07` | Derived from questions B02, B03, B06 and B07. |
| APS_EAPA_2006 | DQHOUSE | `K05A` | Derived from questions K05 and K05A. |
| APS_EAPA_2006 | DSW_CDC | `DAGEINTM` | Derived from the variables DAGEINTM, Q06, DHEIGHCM and DWGTKG . |
| APS_EAPA_2006 | DSW_COLE | `DAGEINTY` | Derived from the variables DAGEINTY, Q06, DHEIGHCM and DWGTKG. |
| APS_EAPA_2006 | DWGTKG | `B03` | Derived from question B03. |
| APS_EAPA_2006 | DWGTKG | `E32` | Derived from question E32. |
| APS_EAPA_2012 | DSTHGHT | `SELF-REPORTED HEIGHT` | This derived variable indicates a person’s self-reported height in inches. |
| APS_EAPA_2012 | DWSUB | `HOU_N06` | This derived variable combines responses from HOU_Q06 and HOU_N06 and indicates the |
| APS_EAPA_2012 | DWSUB | `HOU_Q06` | This derived variable combines responses from HOU_Q06 and HOU_N06 and indicates the |
| APS_EAPA_2012 | ED3GFQ49 | `ED3G_Q49` | This variable is an indicator of whether a valid response was given to Question ED3G_Q49. See |
| APS_EAPA_2012 | ED4FQ14 | `ED4_Q14` | This variable is an indicator of whether a valid response was given to Question ED4_Q14. See |
| APS_EAPA_2017_NIS_SIN | DLSNUNFL | `LOC_STUDY` | This variable is derived from the variable LOC_STUDY from the 2016 Census. It in- |
| BC_CB_K12 | AGE_IN_YEARS | `STUDENT'S AGE IN DAYS` | Student's age in years, calculated as the student's age in days divided by 365.25 and rounded down to the nearest integer Derived from: Sept |
| BC_CB_K12 | AMA10_EXAM_PCT | `FINAL MARK DATA` | The provincial exam percentage mark achieved by the student in Applications of Mathematics 10 Derived from: Final mark data |
| BC_CB_K12 | AMA10_FINAL_PCT | `FINAL MARK DATA` | The final, transcript percentage mark achieved by the student in Applications of Mathematics 10 Derived from: Final mark data |
| BC_CB_K12 | BEHAV_DIS_EVER_FLAG | `SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student (cohort member) was ever identified in the Special Needs Categories H or R (formerly Categories M and  |
| BC_CB_K12 | DISTRICT_NAME_ATTRIB | `MINCODE_DELIVERY` | The district name or school authority, based on the school of authority for the student. There is also a value 'UNKNOWN School Authority'. T |
| BC_CB_K12 | DISTRICT_NUMBER_ATTRIB | `MINCODE_DELIVERY` | The three-digit identifier (for example, '005') assigned to the school district of the school of authority for the student. This field is al |
| BC_CB_K12 | EMA10_ATTEMPTS | `COURSE MARK DATA` | A count of the number of times a student attempted Essentials of Mathematics 10 and received any letter grade (including a failing grade or  |
| BC_CB_K12 | ENG10_FINAL_LETTER | `COURSE MARK DATA` | The final, transcript course letter grade achieved by the student in English 10 Response categories: • A • B • C • C+ • C- • F Derived from: |
| BC_CB_K12 | FACILITY_TYPE_ATTRIB | `MINCODE_DELIVERY` | The school facility type based on the school of authority for the student. The facility type is based upon the type of program offered and t |
| BC_CB_K12 | GEOL12_FINAL_PCT | `FINAL MARK DATA` | The final, transcript percentage mark achieved by the student in Geology 12 Derived from: Final mark data |
| BC_CB_K12 | GIFTED_EVER_FLAG | `SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student (cohort member) was ever identified in the Special Needs Category P on any September authority school  |
| BC_CB_K12 | GRADE_THIS_ENROL | `SEPTEMBER ENROLLMENT DATA` | The grade of the student in the school of this enrolment. If the student is not in a specific grade, the student is labelled as ungraded, ei |
| BC_CB_K12 | LEARNING_DIS_EVER_FLAG | `SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student (cohort member) was ever identified in the Special Needs Category Q (formerly Category J) on any Septe |
| BC_CB_K12 | MFPC10_FINAL_PCT | `FINAL MARK DATA` | The final, transcript percentage mark achieved by the student in Maths: Fondements et Pre-Calcul 10 Derived from: Final mark data |
| BC_CB_K12 | MILD_INTELL_DIS_EVER_FLAG | `SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student (cohort member) was ever identified in the Special Needs Category K on any September authority school  |
| BC_CB_K12 | MINCODE_ATTRIB | `MINCODE_DELIVERY` | The eight-digit identifier assigned to the school of authority for the student. This is also known as the MINCODE ("Ministry Code"). The fir |
| BC_CB_K12 | PCT_TRADES_CERTIFICATE | `PUBLIC 2016 CENSUS DATA` | Percentage from 2016 Census data linked by student postal code. Response categories: 2,325 variations from 0 to 72.7273 Derived from: Public |
| BC_CB_K12 | POPULATION_DENSITY | `PUBLIC 2016 CENSUS DATA` | Population Density grouped by student postal code for students enrolled in the same school in the same year Derived from: Public 2016 Census |
| BC_CB_K12 | RECORD_CNT | `COHORT_START_YEAR` | A measure whose value is set to '1' for every record in this table. A record is the occurrence of a cohort member in a particular model. Stu |
| BC_CB_K12 | SCHOOL_NAME_ATTRIB | `MINCODE_DELIVERY` | The name of the school of authority for the student. The calculation for this attribution is as follows. For this student, for the TRAX scho |
| BC_CB_K12 | SCHOOL_YEAR | `SEPTEMBER ENROLLMENT DATA` | The school year in which the row's information corresponds. Data is in the format 'XXXX/YYYY' where the school year begins on July 1, XXXX a |
| BC_CB_K12 | SENSORY_DIS_EVER_FLAG | `SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student was ever identified in the Special Needs Categories E or F on any September authority school enrolment |
| BC_CB_K12 | SENSORY_DIS_EVER_FLAG | `STUDENT CHARACTERISTICS FLAG CALLED SPECIAL NEED CATEGORY THIS ENROLMENT COLLECTION` | A flag indicating whether the student was ever identified in the Special Needs Categories E or F on any September authority school enrolment |
| BC_CB_K12 | STUDENT_POSTAL_CODE | `POSTAL_CODE` | The student's home postal code as reported on their 1701 form. This is identical to the field POSTAL_CODE (field number 20). Derived from: S |
| BC_CB_K12 | TOP_LEVEL_ORG_ATTRIB | `MINCODE_DELIVERY` | The top level organization, based on the school of authority for the student. Values: 'EXTERNAL SCHOOLS ASSOCIATION' 'INDEPENDENT SCHOOLS AS |
| BC_CB_K12 | TRAX_FACILITY_TYPE | `DELIVERY` | The school facility type, based upon the Delivery (school). In this table, this refers to the school that issued the credential to the stude |
| BC_CB_K12 | WRITE_NOT_YET | `FOUNDATION SKILLS ASSESSMENT DATA` | A binary flag which equals 1 if a student wrote the Writing FSA exam and received a score of 'Not Yet Meeting Expectations', 0 otherwise. Th |
| BC_CB_K12 | WRITE_PCNT | `FOUNDATION SKILLS ASSESSMENT DATA` | The percentage score (/100) that the student achieved in the Writing FSA exam written during the school year and at the school represented i |
| CADS_ECAD_2019 | ALC7D | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALC7D | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT |
| CADS_ECAD_2019 | ALCLEV4D | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ALCLEV4D | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT and AGS_Q05 |
| CADS_ECAD_2019 | ASSISTOD | `OD_Q10A` | Based on OD_Q10A-G |
| CADS_ECAD_2019 | CANPRED | `CAN_Q25_7` | Based on CAN_Q25_7 and CAN_Q25_8 |
| CADS_ECAD_2019 | CANPRED | `CAN_Q25_8` | Based on CAN_Q25_7 and CAN_Q25_8 |
| CADS_ECAD_2019 | DKDYSTRF | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRF | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DKDYSTRM | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCF | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `FRI` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `MON` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `SAT` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `SUN` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `THURS` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `TUES` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | DRNKDYCM | `WED` | Based on SUN, MON, TUES, WED, THURS, FRI, SAT, SEX |
| CADS_ECAD_2019 | GENDER_R | `AGS_Q10` | Based on AGS_Q10 |
| CADS_ECAD_2019 | SEDHIGH | `SED_Q12M` | Based on SED_Q12M, SED_Q30 |
| CAFVMHS_ESSMFACM_2018 | DEP_22A | `DEP_Q22A_1` | Based on DEP_Q22A_1 |
| CAFVMHS_ESSMFACM_2018 | PADDYA | `CAFVMHS` | This variable identifies respondent who meet the CAFVMHS Since 2002 criteria for |
| CCHS_ESCC | ADMFSID | `STATHO2` | Based on SAMFSIS, STATHO2 (on internal processing file; not on master file). See |
| CCHS_ESCC | DHHD611 | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01. See documentation on derived variables. |
| CCHS_ESCC | DHHDDWE | `DHH_DW1` | Based on DHH_DW1, DHH_DW2 (both variables are on the internal processing file; not |
| CCHS_ESCC | DHHDDWE | `DHH_DW2` | Based on DHH_DW1, DHH_DW2 (both variables are on the internal processing file; not |
| CCHS_ESCC | DHHDECF | `ANDB_01` | Based on DHH_REL for all PERSONID in SAMPLEID, ANDB_01, DHH_SEX, DHHDHSZ. |
| CCHS_ESCC | DHHDECF | `DHH_REL` | Based on DHH_REL for all PERSONID in SAMPLEID, ANDB_01, DHH_SEX, DHHDHSZ. |
| CCHS_ESCC | DHHDL12 | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01. See documentation on derived variables. |
| CCHS_ESCC | DHHDL18 | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01. See documentation on derived variables. |
| CCHS_ESCC | DHHDLE5 | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01. See documentation on derived variables. |
| CCHS_ESCC | DHHDLVG | `DHH_REL` | Based on DHH_REL of selected respondent, DHHDHSZ. See documentation on de- |
| CCHS_ESCC | DHHDOKD | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01, RELATIONSHIP. See documentation on |
| CCHS_ESCC | DHHDOKD | `RELATIONSHIP` | Based on SAMPLEID, PERSONID, ANDB_01, RELATIONSHIP. See documentation on |
| CCHS_ESCC | DHHDYKD | `ANDB_01` | Based on SAMPLEID, PERSONID, ANDB_01. See documentation on derived variables. |
| CCHS_ESCC | DOINS | `PMK` | Questions for this module were not asked when a person most knowledgeable (PMK) |
| CCHS_ESCC | MHWDCOL | `AGET1` | Based on AGET1, DHH_AGE, DHH_SEX, DHHDAGM, MHWDBMI, WHC_03. Users |
| CCHS_ESCC | MHWDWHOP | `AGET1` | Based on AGET1, DHH_SEX, DHHDAGM, MHWDBMI. The cut-off points are specified |
| CCHS_ESCC | MHWDWHOY | `AGET1` | Based on AGET1, DHH_AGE, DHH_SEX, DHHDAGM, MHWDBMI, WHC_03. The cut- |
| CCHS_ESCC | VSDFNI | `VDCFNI` | Based on NSP_01, VDCFNI for each supplement taken by the respondent, SAMPLEID, |
