# Searcher relevance and vector capacity audit

**2026-09-30 · Recommendation, not a deployed change.** This audit used read-only queries against the live `mobilesurvey` Supabase project, the current Searcher code, and provider documentation. No database or hosting changes were made.

## Decision

Keep Supabase as the source of truth for corpus records, citations, code lists, facets, concepts, and verified lineage. Improve lexical ranking and filtering first. If a judged query set demonstrates a material gain from embeddings, add a **rebuildable Qdrant Cloud vector index** beside Supabase, reached through a rate-limited Supabase Edge Function. Do not migrate the application or copy full records into Qdrant.

**2026-10-01 pilot refinement:** Embed only variables with enough meaningful descriptive text to represent their subject. Treat a useful question or concept as the primary signal; a short, source-checked description can supplement it. A mnemonic alone, a missing description, or a long mixed code list is not semantic evidence. Start with a separate **“Related by meaning”** section alongside lexical results. Add semantic matches to the normal ranked results only if blind judgments on the same query set show a material relevance gain without harming exact-code lookup, citations, filtering, or latency. Embeddings do not repair missing source metadata.

**2026-10-01 infrastructure status:** A Qdrant Cloud cluster has been provisioned and the `modularsurvey` collection reserved for this project. The supplied screenshot shows the collection setup form with an equivalent request containing `"vectors": {}`; it does not verify the live collection's vector configuration or that any points were loaded. Treat this as a pilot destination, not a ready semantic index. Before ingesting, inspect the live collection and choose a named dense vector whose dimensions and distance match the selected embedding model. This is one public corpus with optional survey/year/subject/role filters, so use Qdrant's global-search layout rather than tenant isolation. Keep the Qdrant credential server-side.

The free Qdrant cluster currently offers 4 GB disk, 1 GB RAM, and 0.5 vCPU. Its free hosted inference includes `sentence-transformers/all-minilm-l6-v2` and `intfloat/multilingual-e5-small`, both 384 dimensions; compare them on judged English and French-to-English queries before choosing one. The MiniLM model is an English pilot option, **not a validated bilingual solution**; the multilingual model is available but untested for this corpus. Index and live queries must use the same selected model, and a model change requires re-embedding the pilot. Free clusters suspend after one inactive week and can be deleted after four, so the lexical path must always work and the index must be reproducible. [Qdrant free-cluster limits](https://qdrant.tech/documentation/cloud/create-cluster/), [cloud inference](https://qdrant.tech/documentation/cloud/inference/).

## Evidence

| Live measure, 2026-09-30 | Result |
| --- | ---: |
| Database size, `pg_database_size(current_database())` | 326,569,107 bytes (311 MiB) |
| All `corpus_*` public table and index bytes | 311,656,448 bytes |
| `corpus_variable` table and indexes | 216,809,472 bytes |
| English variable occurrences | 194,507 |
| Distinct nonblank question texts | 40,404 |
| Distinct concept + question pairs | 81,193 |
| Rows without question text | 85,748 (44.1%) |
| Rows with more than 20 code entries, needing review rather than blanket deletion | 1,123 |

Supabase's Free database limit is 500 MB; a project enters read-only mode over that limit. The nominal margin is about **173 MB** before any safety reserve. File Storage has a separate 1 GB allowance and holds the source documents; putting embeddings in Storage does not give SQL/vector search. [Supabase database-size behavior](https://supabase.com/docs/guides/platform/database-size), [pricing](https://supabase.com/pricing).

The existing plan's `halfvec(1024)` proposal is too tight in this project. Even embedding only the **81,193 distinct concept + question pairs** takes at least `81,193 × (2 × 1024 + 8) = 166,932,808` bytes of vector values. That is a *lower bound*: the proposed canonical text also includes category labels, which can increase uniqueness; PostgreSQL rows, hash-to-record mappings, an ANN index, and normal update/vacuum headroom are additional. The prior “over 80%” deduplication estimate is not established for the live English data: concept + question pairing reduces 194,507 rows to 81,193 pairs, or about 58%, before categories are considered. A smaller embedding could fit on paper, but model quality, query inference, index size, and operational headroom remain unproven. The `vector` extension is not currently installed.

### Relevance defects observed

1. `search_text` concatenates name, concept, question, universe, note, and every category label. The SQL ranks the resulting `fts` with `ts_rank_cd` at equal field weight. An `income` query placed two `VERDATE` (“Version date of file”) rows at ranks 3–4 and `REGISTID` (“Variable for linking records”) at rank 5, above many income variables. Their long category lists contain unrelated income terms, inflating rank. One `VERDATE` has 50 apparent category entries that look like other variable names and descriptions. That is a parser/data-quality case to inspect, not evidence that all long legitimate code lists are wrong. The `income` search returns 16,441 occurrence rows, so a few false high scores matter at the top.
2. `roleFilter` and the default-on `hideProcess` switch run **after** the SQL has ranked and paginated 25 rows. Hidden weights/paradata still consume page slots and remain in the server's total and page count. The `mental health` top five contained a survey weight at position 3. Filters must apply before rank, count, and pagination.
3. Repeated question columns are grouped only within the returned page. The same question can appear on adjacent pages and can crowd out distinct questions. The existing search evaluation reports useful alias recall, but it reports record counts and selected examples, not judged precision or recall across queries.
4. The French UI filter is present, but the live corpus is English-only. The 438,931 source occurrences are **not** live searchable records. A vector index cannot recover missing French records or missing/incorrect parsed question text.
5. An optional AI query-expansion path already exists (`corpus-ai-expand`, deployed) and searches up to three alternative phrases after a user click. It is a useful lexical comparator in an embedding evaluation, not vector retrieval.

Relevant code: `tools/metadata/statcan-corpus/src/project.ts`, `tools/metadata/statcan-corpus/sql/search-performance.sql`, `platform/hub/src/CorpusSearch.tsx`, `platform/hub/src/groupCorpusHits.ts`, and `supabase/functions/corpus-ai-expand/index.ts`.

## Options considered

| Option | Fit | Main cost/risk |
| --- | --- | --- |
| Improve existing PostgreSQL FTS and aliases | **Do now** | Cannot cover every paraphrase; requires relevance evaluation. No new vendor. |
| Add deduplicated `halfvec(1024)` to this Supabase project | **Do not deploy now** | Lower-bound vector bytes nearly exhaust current free headroom before mapping/index/bloat. |
| Move only the corpus to a second free Supabase project | Useful later for *relational* headroom; existing `VITE_CORPUS_*` client seam supports it | Roughly the same 312 MB corpus footprint in that project; still insufficient for the proposed 1024-d vectors plus index. Deployment workflow does not yet pass the two corpus env vars. Check account/project and organization-level limits before doing this. [Supabase database-size guidance](https://supabase.com/docs/guides/platform/database-size). |
| Add Qdrant free as a vector sidecar | **Pilot after lexical fixes** | One more service, query proxy, free-cluster inactivity and manual restore. Keeps PostgreSQL/RLS/Storage/lineage intact. |
| Migrate all data to Neon Free | Poor capacity trade | Neon Free still includes 0.5 GB database storage per project; migration does not solve vector headroom and would replace current REST/RLS/Storage integration. [Neon Free announcement](https://neon.com/blog/neon-backend-is-ga). |
| Migrate all data to Turso Free | Large rewrite | 5 GB storage is attractive, but the app's PostgreSQL functions, RLS, JSONB, generated FTS, and Storage flows would need replacement. [Turso pricing](https://turso.tech/pricing). |
| Supabase Pro | Simplest paid capacity route | Current published starting price is $25/month with 8 GB included disk. Recheck before purchase. [Supabase pricing](https://supabase.com/pricing). |

## Rollout plan

### 1. Fix measurable relevance problems in the existing Searcher

- Curate a labeled set of at least 50 queries: exact mnemonics, topic phrases, paraphrases, historical/current terms, and French-to-English discovery cases. Keep expected relevant question groups and source citations, not just expected hit counts. Include `income`, `mental health`, `remote work`, `food insecurity`, and a no-result control. Compare current search, reviewed aliases, and the existing optional AI expansion.
- Inspect the anomalous code lists at their cited source pages and fix the parser/reload only where the source proves them wrong. Downweight category/note matches relative to name, concept, and question in ranking; preserve category-only recall. Prefer an SQL-only scoring change on the existing GIN candidate set initially. Rebuilding the stored `fts` column or its index can temporarily consume too much free-tier space.
- Move role/paradata filtering into the ranked query before `COUNT`, `LIMIT`, and `OFFSET`, using a persisted classification only if a query-time rule is too slow. Produce distinct question groups before pagination, or clearly present occurrences and count them as such. Verify the filtered total and all-page behavior.
- Measure nDCG@10, recall@20, zero-result rate, distinct questions in the first page, and p50/p95 latency. Exact variable-name lookup and citations must not regress.

### 2. Run a bounded vector pilot if gaps remain

- Verify the provisioned `modularsurvey` collection's actual schema and point count. Select the embedding model and query-time inference path, then configure matching vector dimensions, distance, and payload indexes before loading pilot points. Do not infer those settings from the creation-form screenshot or load the full corpus as the first test.
- Use the corpus `record_id` UUID as the Qdrant point ID. Index only fields the semantic pilot filters on: `survey_group` (`keyword`), `year` (`integer`), `subject` (`keyword`, with an array of assigned survey subjects), `role` (`keyword`, including `process` for the hide-paradata switch), `lang` (`keyword`), and `has_codes` (`bool`). Keep these payload names and types identical in the importer and query path; `record_id` needs no separate payload index. Qdrant Cloud's default strict mode rejects filtering on unindexed fields. [Qdrant payload indexing](https://qdrant.tech/documentation/manage-data/indexing/), [Cloud strict mode](https://qdrant.tech/documentation/cloud/configure-cluster/).
- Start with a representative 10–20k English **occurrence** subset and the same judged queries, restricted to rows with a substantive question, concept, or source-checked descriptive note. Record the eligibility rule and what share of the corpus it excludes; improve missing metadata at its source instead of embedding a mnemonic-only row. Generate embeddings offline from clean, versioned semantic text (concept + question where present; cautious category summary where useful; exclude long noisy notes and parser-suspect code lists). Cache computation by normalized text hash, even if one Qdrant point per occurrence is used for simple survey/year/subject/role filtering. Store only `record_id`, filter metadata, text hash/model version, and vector in Qdrant. Supabase remains authoritative for displayed fields.
- Test a free hosted Qdrant model against a locally generated multilingual alternative; choose only after checking relevance, language behavior, exact-code safeguards, query-time inference availability, and actual Qdrant disk/RAM use. The free hosted English model must not be presented as bilingual.
- Fetch lexical and semantic top candidates separately and evaluate reciprocal-rank fusion at the question-group level before changing the default ranking. Reserve exact mnemonic matches, apply filters before candidate ranking, and hydrate the final record IDs from Supabase in one batch. Do not merge a top-k semantic list into the existing exact `total_count` or claim complete pagination from it. Initially display a separate “Related by meaning” section and keep the current lexical list as fallback.
- Treat Qdrant as an eventually consistent copy: reconcile added, changed, and deleted `record_id`s after corpus loads; apply the same survey/year/subject/role/code filters on both sides; drop Qdrant IDs that Supabase no longer returns. Run semantic retrieval independently with a short timeout so an asleep or unavailable free cluster never delays or empties lexical results. Measure combined p95 latency and stale-ID rate during the pilot.
- Expose vector search through a Supabase Edge Function with a server-side Qdrant key, request and daily limits, timeouts, and an allowlisted query shape. A public browser key for the vector service would allow uncontrolled free-tier usage even if read-only. Reuse the site's existing public-key/CORS pattern, not its Groq quota counter. Supabase Free includes 500,000 Edge Function invocations, subject to current limits. [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Qdrant security](https://qdrant.tech/documentation/operations/security/).
- Promote fusion only if a blind judgment shows a meaningful nDCG/recall gain on the gaps lexical fixes did not close, with no mnemonic regression and acceptable p95 latency. Keep a deterministic index rebuild and periodic manual snapshot; Qdrant failure/deletion must degrade to lexical search.

### 3. Separate the corpus database only when relational growth requires it

`VITE_CORPUS_URL` and `VITE_CORPUS_ANON_KEY` already fall back to the main project in `platform/hub/src/api.ts` and `corpusAiSearch.ts`. A future split also needs the deployment workflow to pass those variables, the corpus schema/data/Storage/Edge Function copied, and read-only and write-role grants/RLS checked. Migrate with a full record/citation/lineage comparison and a rollback path. A second free project is a capacity tactic, not the vector solution.

## Limits of this audit

The byte counts and example results above are live measurements. Qdrant index size, embedding quality, inference throughput, result latency, and a bilingual model are **not yet measured**. The proposed service and scoring changes are therefore gated by the pilot rather than assumed to work. Provider quotas can change; verify them again at deployment.
