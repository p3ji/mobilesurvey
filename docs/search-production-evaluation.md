# Production semantic search check

**Run:** 2026-10-01T19:11:32.633Z · **Endpoint:** `corpus-semantic-search` · **Score threshold:** 0.55 · **Hide process:** on · **Queries:** 10

Grades are **assistant provisional review; human researcher sign-off pending**. 0 = unrelated; 1 = related context but not a direct answer; 2 = directly relevant variable. A returned point is not automatically a relevant result. This sample is too small and lacks human sign-off, so it cannot support a claim that semantic search improves overall ranking.

The panel column removes any semantic record already on the first 25-row lexical page, matching the Searcher display.

| Query | Strict lexical total | Raw semantic | Panel after duplicates | Best panel score | Provisional direct grades | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `mental health depression anxiety` | 51 | 5 | 5 | 0.682 | 2/5 | 2/5 directly relevant in provisional review |
| `hourly wage usual earnings` | 10 | 5 | 5 | 0.858 | 5/5 | 5/5 directly relevant in provisional review |
| `household total income` | 974 | 5 | 5 | 0.986 | 5/5 | 5/5 directly relevant in provisional review |
| `artificial intelligence adoption business` | 1 | 5 | 5 | 0.724 | 0/5 | 0/5 directly relevant in provisional review |
| `GEO_PRV` | 34 | 0 | 0 | — | — | No semantic hit at the production threshold |
| `santé mentale` | 0 | 0 | 0 | — | — | No semantic hit at the production threshold |
| `revenu du ménage` | 0 | 0 | 0 | — | — | No semantic hit at the production threshold |
| `garde d'enfants` | 0 | 0 | 0 | — | — | No semantic hit at the production threshold |
| `situation d'emploi` | 0 | 0 | 0 | — | — | No semantic hit at the production threshold |
| `quantum blockchain surgery` | 0 | 0 | 0 | — | — | No semantic hit at the production threshold |

## Candidate details

### hlt-03: mental health depression anxiety

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `CCC_166B` | Mental health condition - anxiety | 0.682 | 2 |
| 2 | `CCCDFEMH` | Diagnosed chronic mental health conditions incl. mood, anxiety, PTSD | 0.679 | 2 |
| 3 | `MHDVMHI` | Perceived mental health | 0.668 | 1 |
| 4 | `GEND04` | Perceived mental health | 0.668 | 1 |
| 5 | `GEND04` | Perceived mental health | 0.668 | 1 |

### lab-02: hourly wage usual earnings

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `HRLYEARN` | Usual hourly earnings | 0.858 | 2 |
| 2 | `HRLYEARN` | Usual hourly earnings | 0.857 | 2 |
| 3 | `HRLYEARN` | Usual hourly earnings | 0.857 | 2 |
| 4 | `HRLYEARN` | Usual hourly earnings. | 0.792 | 2 |
| 5 | `HRLYEARN` | Usual hourly earnings. | 0.792 | 2 |

### inc-01: household total income

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `THIDVTOT` | Total Household Income | 0.986 | 2 |
| 2 | `HHINC` | Total household income | 0.986 | 2 |
| 3 | `DEM_D04` | Total household income | 0.986 | 2 |
| 4 | `DEM_D04` | Total household income | 0.984 | 2 |
| 5 | `THID01` | Total household income | 0.984 | 2 |

### dig-02: artificial intelligence adoption business

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `AI05009` | Artificial Intelligence technologies (AI) | 0.724 | 1 |
| 2 | `AI05008` | Artificial Intelligence technologies (AI) | 0.724 | 1 |
| 3 | `AI05004` | Artificial Intelligence technologies (AI) | 0.724 | 1 |
| 4 | `AI05001` | Artificial Intelligence technologies (AI) | 0.724 | 1 |
| 5 | `AI05002` | Artificial Intelligence technologies (AI) | 0.724 | 1 |
