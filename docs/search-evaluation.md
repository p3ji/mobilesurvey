# Searcher evaluation (2026-09-29)

The live Supabase search index contains **194,507 English variable records**, a subset of the
438,931 bilingual occurrences in the local source corpus. These measurements compare the old
`corpus_search` predicate (full-text plus variable-name prefix) with the same predicate plus
reviewed aliases. Counts are raw variable records; the UI groups repeated question columns on
each result page without changing paging or citations.

| Query | Previous search | With aliases | Added records |
| --- | ---: | ---: | ---: |
| `AI` | 158 | 221 | 63 |
| `artificial intelligence` | 142 | 149 | 7 |
| `remote work` | 2 | 69 | 67 |

`AI` is expanded to `artificial intelligence`; the reverse alias is also present. `remote work`
expands to `telework`. Exact-term matches keep full rank; alias matches get one quarter of the
rank. Search still uses the existing GIN full-text index. The first 15 newly found `AI` records
were inspected and included CIUS artificial-intelligence application columns and SAT/SDTIU
technology variables. The first telework records included location and use questions. This is a
small, inspectable meaning layer, not general semantic search. Add aliases only after checking
examples and measuring recall and false matches against the same baseline. Vector search remains
deferred until a broader bilingual query set shows that it adds useful results beyond these rules.

The old subject facet took about **5.0 s** and the survey facet about **3.45 s** in PostgreSQL.
After moving them to the 186-row `corpus_survey_counts` snapshot, `EXPLAIN ANALYZE` reported
**0.82 ms** for subjects and **0.26 ms** for surveys. The snapshot totals agree with the corpus:
194,507 variables, 186 survey groups, 549 source paths, and 58,719 variables in 91 unclassified
survey groups. The snapshot refreshes after `corpus:load`; direct SQL edits require a manual
`select corpus_refresh_facets();`.

Grouping is deliberately page-local. A question spread across two 25-record pages can still
appear once on each page; results and total counts remain auditable variable occurrences.
