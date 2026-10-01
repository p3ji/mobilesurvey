# Production semantic search check

**Run:** 2026-10-01T18:49:17.131Z · **Endpoint:** `corpus-semantic-search` · **Score threshold:** 0.55 · **Queries:** 10

Grades are **assistant provisional review; human researcher sign-off pending**. 0 = unrelated; 1 = related context but not a direct answer; 2 = directly relevant variable. A returned point is not automatically a relevant result. This sample is too small and lacks human sign-off, so it cannot support a claim that semantic search improves overall ranking.

| Query | Strict lexical total | Semantic candidates | Best score | Provisional direct grades | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| `mental health depression anxiety` | 52 | 5 | 0.684 | 2/5 | 2/5 directly relevant in provisional review |
| `hourly wage usual earnings` | 10 | 5 | 0.858 | 5/5 | 5/5 directly relevant in provisional review |
| `household total income` | 991 | 5 | 0.984 | 5/5 | 5/5 directly relevant in provisional review |
| `artificial intelligence adoption business` | 1 | 5 | 0.726 | 0/5 | 0/5 directly relevant in provisional review |
| `GEO_PRV` | 35 | 0 | — | — | No semantic hit at the production threshold |
| `santé mentale` | 0 | 0 | — | — | No semantic hit at the production threshold |
| `revenu du ménage` | 0 | 0 | — | — | No semantic hit at the production threshold |
| `garde d'enfants` | 0 | 0 | — | — | No semantic hit at the production threshold |
| `situation d'emploi` | 0 | 0 | — | — | No semantic hit at the production threshold |
| `quantum blockchain surgery` | 0 | 0 | — | — | No semantic hit at the production threshold |

## Candidate details

### hlt-03: mental health depression anxiety

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `CCC_166B` | Mental health condition - anxiety | 0.684 | 2 |
| 2 | `CCCDFEMH` | Diagnosed chronic mental health conditions incl. mood, anxiety, PTSD | 0.679 | 2 |
| 3 | `GEND04` | Perceived mental health | 0.666 | 1 |
| 4 | `GEND04` | Perceived mental health | 0.666 | 1 |
| 5 | `GEND04` | Perceived mental health | 0.666 | 1 |

### lab-02: hourly wage usual earnings

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `HRLYEARN` | Usual hourly earnings | 0.858 | 2 |
| 2 | `HRLYEARN` | Usual hourly earnings | 0.858 | 2 |
| 3 | `HRLYEARN` | Usual hourly earnings | 0.858 | 2 |
| 4 | `HRLYEARN` | Usual hourly earnings. | 0.795 | 2 |
| 5 | `HRLYEARN` | Usual hourly earnings. | 0.791 | 2 |

### inc-01: household total income

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `THID01` | Total household income | 0.984 | 2 |
| 2 | `THIDVTOT` | Total Household Income | 0.984 | 2 |
| 3 | `DEM_D04` | Total household income | 0.983 | 2 |
| 4 | `DEM_D04` | Total household income | 0.983 | 2 |
| 5 | `HHINC` | Total household income | 0.983 | 2 |

### dig-02: artificial intelligence adoption business

| Rank | Variable | Concept | Similarity | Provisional grade |
| ---: | --- | --- | ---: | ---: |
| 1 | `AI05003` | Artificial Intelligence technologies (AI) | 0.726 | 1 |
| 2 | `AI05007` | Artificial Intelligence technologies (AI) | 0.726 | 1 |
| 3 | `AI05013` | Artificial Intelligence technologies (AI) | 0.726 | 1 |
| 4 | `AI05014` | Artificial Intelligence technologies (AI) | 0.726 | 1 |
| 5 | `AI05010` | Artificial Intelligence technologies (AI) | 0.726 | 1 |
