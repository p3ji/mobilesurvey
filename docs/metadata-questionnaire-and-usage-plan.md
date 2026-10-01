# Searcher: questionnaires and research use

**Status:** questionnaire track deferred, 2026-09-30. The first research-use phase is planned in [Researcher](researcher-plan.md); its Hub construction page is available, but no catalogue, ingestion pipeline, or hosting choice has been completed.

## Aim and current baseline

Let a researcher move from a published questionnaire item to its released variables, response coding, derivations, and documented analytical uses. Keep each source statement separate from our inferred links. Searcher should show gaps and ambiguity rather than imply complete coverage.

The live corpus currently has 194,507 English variable occurrences; 85,748 (44.1%) lack question text. It occupies 326,569,107 bytes (311 MiB) of a Supabase Free database that enters read-only mode above 500 MB. Source-document text already uses a separate Storage bucket. These are 2026-09-30 measurements from [the Searcher capacity audit](searcher-vector-audit.md), not an estimate of questionnaire size. The local corpus has 438,931 bilingual occurrences, so local coverage must not be presented as live coverage. The local archive also has some questionnaire files, but its filename inventory identifies only 28 questionnaire/instrument-named files in six survey groups; it is not a substitute for an IMDB discovery audit.

Statistics Canada's [questionnaire index](https://www23.statcan.gc.ca/imdb-bmdi/pub/indexiO-eng.htm) and survey-specific instrument lists expose published instruments. The [2022 CIUS instrument list](https://www23.statcan.gc.ca/imdb/p3Instr.pl?Function=getInstrumentList&Item_Id=1487379&UL=1V) records an effective period and links to an [HTML questionnaire](https://www23.statcan.gc.ca/imdb/p3Instr.pl?Function=assembleInstr&Item_Id=1487379&lang=en). That HTML prints identifiers, text, and response options, but the identifiers are questionnaire items (for example `AGE_Q01`), not automatically the released file's variable names. [CCHS documentation](https://www.statcan.gc.ca/en/statistical-programs/document/3226_D56_T9_V1) explicitly describes a naming convention, including separate columns for multi-response options; the convention is survey-specific evidence, not a universal rule. Some published instruments use only numeric identifiers or blanks, and multiple instrument versions may exist for a survey cycle.

## A. Add questionnaires as a separate source layer

### 1. Inventory before matching

Build a repeatable manifest of candidate IMDB instruments for each *live* corpus survey group and cycle: survey/SDDS identity, IMDB item ID and version, title, language, effective dates, URL, format, and retrieval status. Record `no instrument found`, `multiple candidates`, and `cycle unclear` explicitly. Review the first mapping by hand. A survey title match alone does not establish that the questionnaire and data dictionary describe the same cycle or analytical file.

Start with 2022 CIUS: the local corpus has 840 variable occurrences, 780 with question text, but only 16 with parsed code lists. This makes it a useful test of whether IMDB adds answer options and whether item IDs can be resolved. Add one CCHS cycle to test documented multi-response naming and one roster-heavy instrument (for example the [GSS 2010 instrument](https://www23.statcan.gc.ca/imdb-bmdi/instrument/4503_Q2_V1-eng.htm?wbdisable=true)). Select exact cycles only after the manifest confirms matching dictionaries and questionnaire versions.

Acquisition must be source-agnostic: an IMDB HTML fetcher where allowed, plus an import path for saved HTML/PDF supplied locally. The repo's metadata-corpus operating guide records that direct `statcan.gc.ca` requests from the local runtime have been blocked by the egress proxy, so the pilot must not depend on unattended bulk crawling working there. Store source URL, retrieval time, content hash, and parser version; a re-run should show a diff rather than silently overwrite a changed instrument.

### 2. Model the questionnaire before linking it

- `questionnaire_document`: one published instrument/version/language, with the manifest fields and citation.
- `question_item`: one **occurrence** within that document, keyed by document plus source identifier *and* position/context. Preserve verbatim wording, module, universe/skip notes, instructions, response mode, roster unit, parent item for matrix/roster subitems, and source location. A missing or repeated source identifier must not collapse items.
- `question_option`: ordered code/label as printed, plus whether it is an answer category, a matrix column, a select-all option, or an exclusive option such as “none.” Do not copy these into `corpus_variable.codes`: questionnaire choices and released-file values answer different questions.
- `question_variable_link`: many-to-many edge to a live `corpus_variable.record_id`, with relation (`records_answer`, `option_indicator`, `roster_field`, or `other_documented_mapping`), optional option ID/roster slot, matching method, source evidence, review status, and reviewer. Link to the immutable **occurrence**, not directly to a cross-cycle concept. A separate candidate table or status keeps unverified matches out of public “linked” counts.

For select-one items, one question may map to one released variable, but this is not guaranteed after recoding. For select-all items, one question has several options and may map to one indicator variable per option; each indicator's yes/no/missing codes belong to the *variable*, while the option's label belongs to the *questionnaire*. For rosters, preserve the template item, repeating unit (person/job/etc.), and slot or key; a flattened column is a field of a repeated item, not a new independent question. Derived variables continue to use the existing derivation graph, which can lead back to linked direct inputs. A published questionnaire item is never assumed to be a released variable.

### 3. Match in evidence tiers

1. **Documented:** dictionary `Question Name`/`Collection Name` or a published concordance names the item and the output variable in the same cycle. The existing `src/graph/aliases.ts` provides a local Question Name → Variable Name extractor and already supports one-to-many mappings.
2. **Rule-supported:** a survey's documented naming convention maps an item/option to an existing variable in the same cycle, with question wording, universe, and code meanings checked. Rules are versioned per survey.
3. **Suggested:** text, module, or answer-label similarity proposes candidates for human review. An LLM can help rank candidates but cannot turn similarity into an official mapping.

Reject or queue ambiguous matches; never resolve them by picking the highest score. Preserve the exact instrument and dictionary locations used to approve every link. If questionnaire response categories differ from released coding, show both and label any recode as documented or unknown.

### 4. Publish within measured capacity

Pilot locally in SQLite/JSONL first. Measure raw source bytes, normalized question/option bytes, PostgreSQL table and index bytes per item, query latency, and the current `corpus_size()` before choosing a host. For an initial public browse view, keep the small instrument manifest and reviewed links in Supabase and store normalized per-instrument JSON plus source snapshots in file Storage; resolve question IDs from those documents. Global full-text question search would need a measured search index or database table before release. Do not add full text to `corpus_variable.search_text` or duplicate it for every variable: that would multiply size and obscure source ownership.

| Hosting option | When it fits | Decision point |
| --- | --- | --- |
| Existing Supabase + Storage | Small reviewed link/index tables; documents remain separate from the database | Use if measured growth leaves comfortable vacuum/index headroom under the current 500 MB database and 1 GB Storage limits. |
| Separate corpus database or paid Supabase | Full-text question search needs indexed rows beyond current headroom | Existing `VITE_CORPUS_*` seam helps, but a second Free project has its own limit and organization-level fair-use accounting; paid capacity is operationally simpler if the data justify it. |
| Oracle Always Free | A substantially larger relational question corpus justifies a new read API | [Oracle documents 20 GB storage](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-provision.html) and [ORDS HTTPS access](https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/ords-access.html). It would require a new adapter, public read authorization design, cross-store joins, backup/rebuild, and measured latency. Do not commit to it before sizing the pilot. |

Supabase's current [database-size rule](https://supabase.com/docs/guides/platform/database-size) and [plan limits](https://supabase.com/pricing) should be rechecked when deploying. Storage capacity is not equivalent to a queryable full-text index.

### 5. Searcher presentation

Add a **Questions** result type with separate counts/ranking from variable occurrences. A question card shows wording, response options, cycle/version, source link, and reviewed released-variable links. A variable card shows its linked questionnaire item and any option/roster relationship, with the questionnaire's choices beside—not substituted for—the released codes. Keep unmatched questions discoverable and display the survey/cycle coverage denominator. Keep full question text and attribution on the question detail view; do not suggest that a matched source endorses this adaptation.

## B. Published use of survey data — first phase

The first phase is now [Researcher](researcher-plan.md): public works linked to survey programs and to exact cycles only when the source supports that precision, with a reviewed primary research theme, optional additional themes, and a permitted abstract or explicit availability gap. It will capture variables when a work names them, but its first public catalogue will not require reviewed question or variable links. Researcher keeps publication usage separate from the existing `corpus_derivation_edge` computational lineage.

A later evidence tier can link a work to a specific question or variable. The [2024 Statistics Canada CIUS analysis of fact-checking](https://www150.statcan.gc.ca/n1/en/pub/22-20-0001/222000012024003-eng.pdf), for example, identifies two questionnaire wordings used to construct a dependent variable, but does not by itself establish the released column names. The questionnaire track above can eventually bridge that gap without guessing.

## Order and decision gates for the deferred questionnaire track

After a Researcher survey/cycle release exists, decide whether question-level links would materially improve it or Designer reuse. If so:

1. **Discovery audit:** Map a stratified sample of corpus survey/cycles to IMDB items. Report find rate, format, version ambiguity, and accessibility; do not infer all-survey coverage from the existence of an A–Z index.
2. **CIUS parser and gold set:** Parse one confirmed HTML instrument. Manually compare at least 100 items/options across select-one, select-all, matrix, and routing cases. Report extraction errors and source locations.
3. **Link pilot:** Test documented aliases and survey rules on CIUS, then challenge them with CCHS multi-response and a roster. Blind-review accepted and rejected candidates. Report precision, coverage, unresolved count, and error types separately.
4. **Capacity decision and Searcher UI:** Measure the schema with indexes at pilot scale. Choose the backend, then expose question search and source-linked variable detail without changing existing variable ranking/count semantics.

The two paths reinforce one another: a paper can cite questionnaire wording even when it omits a dataset column, and a verified question → variable link can later complete that path. Neither path requires pretending the graph is exhaustive.

## Open decisions after the pilot

- Which survey/cycles have the best confirmed IMDB-to-dictionary pairing and should be first in the public UI?
- Is the requirement to search *all* questionnaire text globally, or to browse questions within a selected survey and cycle first? The answer materially changes hosting needs.
- Are English questions enough for a first release, or must English/French instrument pairs ship together? Preserve language and version identifiers either way.
- Does Researcher's survey/cycle evidence justify adding question- or variable-level links later?

**Licence:** [Statistics Canada Open Licence](https://www.statcan.gc.ca/en/terms-conditions/open-licence) permits reuse with source acknowledgment, accuracy, and no implied endorsement. Its [FAQ specifically addresses reuse of survey questions](https://www.statcan.gc.ca/en/terms-conditions/open-licence-faq). Keep required attribution, distinguish adaptations, and inspect third-party material separately.
