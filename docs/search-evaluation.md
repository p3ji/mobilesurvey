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
| `crypto` | 2 | 7 | 5 |
| `cryptocurrency` | 5 | 7 | 2 |
| `crypto payment` | 2 | 4 | 2 |
| `cryptocurrency payment` | 2 | 4 | 2 |
| `bitcoin` | 1 | 6 | 5 |
| `indigenous` | 886 | 3,617 | 2,731 |
| `aboriginal` | 2,754 | 3,617 | 863 |
| `coronavirus` | 0 | 1,758 | 1,758 |
| `marijuana` | 182 | 1,363 | 1,181 |
| `cannabis` | 1,262 | 1,363 | 101 |
| `elderly` | 219 | 919 | 700 |
| `wfh` | 0 | 81 | 81 |
| `vaping` | 338 | 359 | 21 |

`AI` is expanded to `artificial intelligence`; the reverse alias is also present. `remote work`
expands to `telework`. `crypto` and `cryptocurrency` are cross-aliased alongside hyphenated and payment variants (`bitcoin` also expands to `cryptocurrency`). High-impact historical and terminological shifts are bridged: `indigenous` $\leftrightarrow$ `aboriginal` (StatCan historical terminology shift), `coronavirus` $\rightarrow$ `covid`, `cannabis` $\leftrightarrow$ `marijuana` (pre- vs post-2018 legalization wording), `elderly` $\rightarrow$ `senior`, `wfh` $\rightarrow$ `telework`, and `vaping` $\leftrightarrow$ `e-cigarette`. Exact-term matches keep full rank; alias matches get one quarter of the
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

## AI-suggested phrase retrieval (2026-09-30)

For `online harms`, the AI suggested `cyberbullying`, `online harassment`, and `digital safety`.
The old flow ran three separate top-12 searches and combined only those pages. The long CIP field
of study lists matched `digital safety` because `digital` and `safety` occurred in different
categories (277–350 categories per record). The new `corpus_search_ai` RPC requires the phrase's
terms to match the variable metadata or **one** category label, and counts distinct record IDs
before paging. Against the live English corpus and those same three phrases, it returns three
online-harassment variables; the five field-of-study false matches disappear. The Crime and
justice filter returns those same three records, so its count does not exceed the all-subject
count. The UI reuses the same AI phrases when filters change instead of calling the LLM again.

This is a targeted retrieval fix. Subject labels are assigned to surveys, not individual
variables, and surveys can have more than one subject. Subject counts therefore overlap.

Grouping is deliberately page-local. A question spread across two 25-record pages can still
appear once on each page; results and total counts remain auditable variable occurrences.
