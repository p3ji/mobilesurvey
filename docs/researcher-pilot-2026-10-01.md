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
- **10,000-record projection**: ~980 KB gzipped client bundle; ~15–20 MB clean SQLite database; ~20–25 MB in Supabase; ~4–8 MB RAM in Qdrant Cloud.
- **Qdrant sidecar decision**: A dedicated `researcher_publications` collection in Qdrant Cloud (~5.6% of existing 177k variable collection) is documented in `docs/researcher-plan.md` for dual semantic topic retrieval and hard metadata faceting at scale.
