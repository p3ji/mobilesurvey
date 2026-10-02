# Researcher local pilot — 2026-10-01

This was a bounded pipeline and UI exercise, not a coverage study. Six source passages from four public works were seeded into the local Researcher queue and extracted with the loopback LM Studio `qwen3.8-27b` endpoint. All six jobs completed. A human checked each claim against the linked source before approval. Researcher now focuses on works issued outside Statistics Canada, so the browser preview contains three external works and no abstract or evidence quote text. The StatCan-issued report remains in local pilot history as a calibration case, not a public Researcher record.

| Work and source | Reviewed use | Review nuance |
| --- | --- | --- |
| [Statistics Canada internet-use report](https://www150.statcan.gc.ca/n1/pub/36-28-0001/2022004/article/00004-eng.htm) | CIUS, exact 2018 and 2020 cycles | The Data section names both cycles. |
| [ESDC digital-divide research summary](https://www.canada.ca/en/employment-social-development/corporate/reports/research/typology-internet-users-canada.html) | CIUS, exact 2022 cycle | The “What we did” section explicitly says the report used the data. |
| [CRDCN dietary-sources article](https://crdcn.ca/publication/top-dietary-sources-of-energy-sodium-sugars-and-saturated-fats-among-canadians-insights-from-the-2015-canadian-community-health-survey/) | CCHS, exact 2015 cycle | The abstract explicitly says the authors drew on the survey data; the catalogue's broader Data Used label was not used to infer cycles. |
| [PLOS CHMS trend-analysis article](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0200127) | CHMS, stated range “cycle 1 to 4” | Its CCHS reference proposes a future extension, so it is a reviewed background mention and excluded from use counts. An initial CHMS passage supported program-level use; a second methods passage supplied the cycle range. |

The model produced one unsupported CHMS claim by quoting the work's title instead of the supplied evidence passage. The automatic quote check flagged it, and the reviewer rejected it. Another issue surfaced when job-level evidence issues initially blocked a valid CCHS background mention; issues now attach to the specific claim, and `researcher audit` repairs existing results. A short mention-only passage twice exhausted the model's output budget without a final answer; 6,000 output tokens allowed it to finish. The local LM Studio server required `json_schema` response format rather than `json_object`. These failure cases are covered by package tests where deterministic.

Final review across the full local pilot: four reviewed works; five approved survey claims (four analyzed, one background mention), one rejected survey claim, four approved themes, and two rejected themes. The three-work external preview has two exact-cycle analyzed works and one CHMS range claim. It collapses an earlier program-only CHMS claim behind its more precise range claim, covers three survey programs, and leaves exact CHMS cycle members unresolved. These numbers measure only this selected pilot sample.

The reviewed JSONL remains in ignored `tools/research/researcher/out/reviewed.jsonl`. The rights-safe static snapshot at `platform/hub/src/researcherPilot.json` is generated with `pnpm --filter @mobilesurvey/researcher researcher preview ../../../platform/hub/src/researcherPilot.json`; it excludes Statistics Canada-issued works and includes outside titles, source links, reviewed relationships and evidence locations, while omitting abstract and evidence quote text. Issuing organization is stored separately from discovery source for new intake; older pilot records are also checked by publication URL. A durable Researcher database, automated source acquisition, larger gold set, and public coverage metrics remain outstanding. The Hub preview does not imply full coverage or an impact measure.

## Expansion: 2025–2026 full cohort, CSD/SHS intake, and grey literature database (2026-10-01)

The pilot was expanded from 4 initial works to a production cohort of **257 outside verified works** analyzing Statistics Canada survey microdata:
- **131 works published in the last year (2025–2026)** discovered via OpenAlex.
- **27 Canadian policy and NGO reports** across municipal and provincial public health bodies (*Toronto Public Health, Public Health Ontario, BC Centre for Disease Control, Ottawa Public Health, INSPQ*) and policy non-profits (*PROOF, Food Banks Canada, CCPA, Wellesley Institute, Maytree, C.D. Howe Institute, Fraser Institute, CMHA, IRPP*).
- **8 Canonical Survey Programs Classified**:
  - CCHS: 91 publications
  - CHMS: 36 publications
  - LFS: 35 publications
  - SHS: 28 publications
  - CSD: 25 publications
  - CIS: 22 publications
  - GSS: 18 publications
  - CIUS: 16 publications
- **100% verified evidence grounding**: 456 survey claims audited with zero evidence issues.
- **Interactive UI**: `#researcher` screen augmented with document type filters (all / reports / articles / preprints), 2025–2026 year window toggle, and an interactive survey quick stats panel featuring clickable spark-histograms for analyzed survey cycles and publication release years.

### Measured storage and 10,000-record sizing

- `researcherPilot.json`: 172 KB raw (669 bytes/record), **24.8 KB gzipped (96 bytes/record)**.
- `reviewed.jsonl`: 279 KB (1.08 KB/record).
- SQLite DB (`researcher.db`): ~2.5 MB clean core relational data; 16 MB with full raw HTTP response cache for offline replay.
### Foreign survey disambiguation and geographic precision guardrails

A user audit discovered a citation to the *Australian Bureau of Statistics Labour Force Survey* (`doi:10.48550/arxiv.2607.17226`) mistakenly classified under Statistics Canada's LFS program. A systematic investigation identified 7 foreign false positives arising from generic international survey names (*Labour Force Survey*, *General Social Survey*, *Survey of Household Spending*, and the Spanish/French acronym *EPA*), non-Unicode word boundaries (French `précisément` splitting on accented `é` to match `cis`), and biological acronym collisions.

To guarantee epistemic precision:
1. **Positive Canadian Grounding**: For generic survey names (`LFS`, `GSS`, `SHS`, and non-explicit acronyms), the work's title, passage, or quote must match positive Canadian terms (`canada`, `canadian`, `statistics canada`, provinces, territories, CMAs, CRDCN, CIHR).
2. **Foreign Disqualification**: Explicit foreign statistical agencies (`Australian Bureau of Statistics`, `Office for National Statistics`, `INSEE`, `INE`, `BLS`, `NORC`) or jurisdictions (`Australia`, `UK`, `France`, `Spain`, `Korea`, `Beirut`) disqualify the claim unless overridden by explicit Canadian grounding in the claim quote itself. Canadian place names like *British Columbia* are protected against UK regexes.
3. **Unicode Word Boundaries (`\p{L}`) & Case Sensitivity**: Short acronyms (`length <= 4`) require uppercase matching and surrounding statistical/survey context keywords (`survey`, `data`, `microdata`, `sample`, `cycle`, `pumf`, `rdc`, `enquête`, `données`, `échantillon`), preventing common words like `cis` from matching inside French text.
4. **Catalogue Recalibration**: 7 foreign false positives were purged. The current verified outside cohort stands at **250 verified works** across 8 canonical programs (CCHS: 92, CHMS: 36, LFS: 28, SHS: 27, CSD: 25, CIS: 21, GSS: 18, CIUS: 16) with 0 evidence issues.

