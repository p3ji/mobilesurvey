# StatCan metadata repository — corpus ingest, longitudinal question bank, search at scale

*Design document. Status: **M1 BUILT AND RUN (2026-08-18)**; M2–M5 planned. Architecture agreed
from a measured survey of the corpus (§1 numbers are counted, not estimated, except where marked).
`packages/statcan-corpus` classifies all 3,006 files in 4.9 s and extracts row-reconstructed text
with zero failures — real results, corrections, and the settled D5 size verdict are in
**§M1 results** at the end. Feeds the hub's existing **Searcher** tile, which today indexes only
bundled demo instruments.*

> **§1's per-T-code file counts are the filename-regex survey done before the classifier existed.**
> The shipped classifier also recovers dictionaries whose filenames carry no T-code, and finds
> **1,919** data dictionaries rather than the ~1,193 counted here. See §M1 results.

## 1. What we actually have (measured, 2026-08-18)

`docs/metadatarepo/CRSB_ADHOC_CENTRAL_002_FromStatCan_…zip` — 2.4 GB, containing 7 nested
zips ("RDC Nonconfidential Documentation 1–7"), which hold:

| | |
|---|---|
| Files | **3,006** (3.56 GB uncompressed) |
| PDFs | **2,248** (3.19 GB) · plus 339 `.doc`, 265 `.docx`, 91 `.xlsx`, 23 `.xls`, 9 `.csv`, 8 `.pptx`, 7 `.html`, 6 `.txt`, 6 `.wpd`, 4 `.ppt` |
| Survey/dataset groups | **318** top-level folders (CCHS, CHMS, Census, LFS, LSIC, Vital Statistics, UCR, …) |
| Temporal span | **1980–2026**, 40 distinct years |
| Languages | Bilingual throughout — 297 of 318 folders use StatCan's `EN_FR` acronym pairing (`CCHS_ESCC`, `APS_EAPA`), and documents come in EN/FR pairs |
| Text-extractable | **~99%** — 2 of 174 sampled PDFs were image-only scans (both `T7`) |

**Document taxonomy.** Filenames carry StatCan's `T##.#` document-type code, which turns out to
be the whole key to machine-processing this corpus:

| Code | Files | What it is | Value to us |
|---|---|---|---|
| **T15.2** | **1,110** | **Data dictionary** (label-style: `Variable Name:` / `Position:` / `Length:` / `Collection Name:` / code table / `Coverage:`) | **Primary source** |
| **T15.6** | 83 | **Data dictionary** (CCHS style: `Variable Name` / `Length` / `Position` / `Question Name` / `Concept` / `Question` / `Universe` / `Note` + code table) | **Primary source** |
| T15.4 / T15.1 / T15.3 / T15 | 111 | Data-dictionary variants | Primary source |
| T1.1 | 256 | User guides | Survey-level context |
| T11.1 | 50 | Alphabetic index (variable → page, description, section) | Free concept grouping |
| T11.2 | 46 | Topical index (theme → variables) | Free thematic taxonomy |
| T3 | 38 | Record layout (variable, length, position) | Position/format backfill |
| T7, T9.x, T24, T4.x | ~100 | Reference papers, methodology, misc. | Out of scope for v1 |

**Scale of the prize.** Extrapolating measured variable-block density across the dictionary
families: **~177,000 variable definitions**, roughly **~88,500 after EN/FR pairing**. For
comparison, the entire current registry indexes a handful of demo instruments.

**Parse feasibility is proven, not assumed.** A throwaway prototype (≈60 lines) already pulls
structured records out of both dominant layouts:

```
T15.2  LSIC Wave 3 → 25 variables, 20 with code lists
  {"name":"LD3Q005","position":"35","length":"1","collection":"LD_Q04I",
   "codes":[{"code":"1","label":"Yes"},{"code":"5","label":"Not applicable"},…],
   "coverage":"Asked for all language courses … and that LR is no longer attending."}

T15.6  CCHS 2013 Rapid Response → 463 variables, 445 with code lists
```

The prototype also surfaced the real work: **field order and code-column order differ between
variants** (T15.6 puts the label *before* the code and interleaves frequency columns, so a naive
parser mislabels `1 → "10,137"`). Per-variant tuning with golden-file tests is the actual effort,
not the parsing concept.

**Sharing status.** `CCHS_ESCC_2014/Read_me.txt` states: *"Subject Matter confirmed that these
rounded data dictionaries are non-confidential and can be shared outside the RDC."* Frequencies
are rounded precisely so they can leave the RDC. See D8 — this still needs an attribution/licence
decision before anything goes public.

## 2. Why this is more than a search index

The corpus contains the *same survey asked across decades* — CCHS alone spans 2001→2024 with 258
files. So the interesting object is not a variable, it's a **concept traced through time**:

> "Show me every way StatCan has asked about *smoking frequency* since 2001, with the exact
> wording, code list, and universe used in each cycle — and which cycles changed the wording."

That is the thing a questionnaire designer actually wants, and no public StatCan tool offers it.
It is also directly actionable in *this* product: the Searcher already exists to "find and reuse
questions", and the designer's Library panel already inserts registry entries into an instrument.
This corpus turns those features from a demo into something with real professional value —
validated, field-tested question wording with 20+ years of provenance.

That reframing drives D3 (concept grouping) and D5 (occurrence vs. concept), which are the two
decisions that would be hardest to retrofit later.

## 3. Architecture at a glance

```
docs/metadatarepo/*.zip          ← 2.4 GB, NEVER committed, never in the app bundle
        │
        │  packages/statcan-corpus   (Node-only ETL — runs offline, on demand)
        ▼
  [1] unpack → [2] classify (T-code, survey, year, lang) → [3] extract text (PyMuPDF-equiv)
        → [4] parse per-variant → [5] normalize to CorpusRecord → [6] pair EN/FR
        → [7] cluster into concepts → [8] emit artifacts + a fidelity report
        │
        ├──────────────► corpus.jsonl        (canonical, ~90k records — gitignored)
        ├──────────────► fidelity-report.md  (what failed to parse, per file — COMMITTED)
        └──────────────► seed SQL / COPY
                              │
                              ▼
                    Supabase: corpus_variable, corpus_concept, corpus_source
                    Postgres FTS (english + french configs) + trigram
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
  apps/hub SearcherView                    apps/designer LibraryPanel
  (facets, concept timeline)               (insert a real StatCan question)
        │                                           │
        └──────────► packages/metadata-registry ◄────┘
                     (existing RegistryEntry model + a new remote query path)
```

## 4. Design decisions

### D1 — The corpus is a build input, never a repo artifact

The 2.4 GB zip and every derived bulk artifact stay **out of git** (`docs/metadatarepo/*.zip`,
`corpus.jsonl`, extracted text caches → `.gitignore`). This follows the existing rule for the
Ireland-LFS DDI fixtures (`packages/ddi-xml/fixtures/external/`): a fetch/unpack script is
committed, the payload is not. Consequences:

- CI and a fresh clone must work **without** the corpus present — corpus-dependent tests
  `skipIf` the artifacts are absent, exactly as `external-import.test.ts` already does.
- What *is* committed: the ETL code, the per-variant golden fixtures (a handful of small
  extracted-text snippets, not whole PDFs), and the **fidelity report** — so the quality of the
  ingest is reviewable in git history even though the inputs aren't.

### D2 — A dedicated `packages/statcan-corpus` for ETL, kept out of the browser

The parsing pipeline is Node-only (filesystem, zip streaming, PDF text extraction, hundreds of MB
of intermediate state). It must never be reachable from an app bundle. A separate package makes
that boundary structural rather than a matter of discipline — `apps/*` never depend on it; they
depend on `metadata-registry`, which stays browser-safe.

**PDF text extraction — SETTLED (2026-08-18), and the answer inverted the assumption.**
`pdfjs-dist` (already a workspace dependency at v6.1.200) is not merely an acceptable
TypeScript-native alternative to PyMuPDF; for *this* corpus it is **materially more correct**.

These dictionaries are laid out as visual tables. PyMuPDF's default text order flattens each cell
onto its own line, destroying row association; pdfjs exposes per-item geometry, so grouping items
into lines by y-coordinate and sorting by x **reconstructs the original rows**:

```
PyMuPDF                       pdfjs (y-grouped, x-sorted)
  Variable Name:              Variable Name:  HHLDID  Position:  1  Length:  14
  HHLDID                      Collection Name:  ID
  Position:                   99999995  Not applicable  0  0
  1                           99999996  Valid skip      0  0
  Length:
  14                          ← code │ label │ freq │ wtd survives as one row
```

Measured on the same two files, with parsers written against each engine's output:

| | PyMuPDF | pdfjs (row-reconstructed) |
|---|---|---|
| T15.2 (LSIC W3) | 25 vars, 20 coded | **25 vars, 22 coded** |
| T15.6 (CCHS RR 2013) | 463 vars, 445 coded | **463 vars, 424 coded** |
| Code-label correctness | ✗ **wrong** — `1 → "10,137"` (frequency read as label) | ✓ `70 → "COMPLETE"`, `99999995 → "Not applicable"` |

The correctness row is what decides it: under PyMuPDF the *code lists* — the single most valuable
part of the data — silently mis-associate labels with frequency counts. That is a data-integrity
failure that would have been laborious to detect downstream. **Decision: `pdfjs-dist`, with a
documented y-bucket/x-sort row reconstruction that is itself covered by golden tests** (the bucket
tolerance is a real parameter; too coarse merges adjacent rows, too fine splits them).

PyMuPDF is retained only as an **independent cross-check** in the fidelity harness — where the two
engines disagree on variable count for a file, that file is flagged for review. Two engines
disagreeing is a much better error detector than either alone.

Non-PDF inputs (`.doc`, `.docx`, `.xlsx`) are **deferred to M4** — 727 files, ~24% of the corpus,
but a long tail of formats. `.wpd` (WordPerfect, 6 files) is explicitly out of scope.

### D3 — Model occurrences and concepts as separate entities

The single most important modelling decision.

- **`CorpusVariable` (an occurrence)** — one variable as it appeared in one file, in one language:
  name, question text, concept label, universe, code list, position/length, and full provenance
  (survey, cycle, year, file, page, T-code). ~177k of these.
- **`CorpusConcept` (a cluster)** — a group of occurrences judged to be "the same question across
  time/cycles/languages", carrying a canonical label and the ordered timeline of its occurrences.

Occurrences are **immutable facts** derived from the source; concepts are **our inference** and
will be imperfect. Keeping them separate means a clustering improvement never corrupts the
extracted facts, and the UI can always show "here is what the document literally said". Merging
them (one row per variable, best-effort deduplicated) would be smaller and much harder to fix.

### D4 — Bilingual pairing is a first-class relation, not a language column

EN and FR are *separate documents* (`CCHS_…_v1.pdf` / `ESCC_…_v1.pdf`), so a variable's English
and French renderings are two occurrences that must be linked. Pairing signals, in confidence
order: (1) same folder + acronym swap via the `EN_FR` folder name; (2) identical variable name and
position within paired files; (3) filename language tags (`_E`/`_F`, `_eng`/`_fra`).

Pairing is recorded with its evidence and confidence, and unpaired occurrences remain fully
usable — a French-only variable is still a valid, searchable record. This matters because
Postgres FTS needs the *right* language configuration per text (`to_tsvector('french', …)`) to
stem correctly; guessing is worse than knowing.

### D5 — Search runs server-side on Supabase Postgres FTS

The current Searcher builds a TF-IDF index **in the browser** over bundled instruments. That does
not survive a 4-order-of-magnitude scale increase — ~90k records with question text is roughly
50–120 MB, which cannot ship in a page load.

**Recommendation: Postgres full-text search on Supabase**, the existing production backend.

- Native `english`/`french` text-search configurations — real stemming per language, which the
  current hand-rolled stemmer + synonym list can't match.
- `tsvector` GIN index for ranked search; `pg_trgm` for fuzzy variable-name lookup.
- 90k rows is small for Postgres; query latency should be single-digit ms.
- Reuses the established anon-key + RLS pattern (this data is read-only and public, so the RLS
  story is simple: `select` to `anon`, no writes).
- **Size risk to measure in M1:** Supabase's free tier caps at 500 MB. Estimated 50–120 MB of rows
  plus indexes is a large fraction of that. If it doesn't fit, the fallback is to store the
  searchable projection in Postgres and keep bulky payloads (full code lists, notes) in Storage,
  fetched on demand.

Rejected alternatives: **client-side shards** (works on GitHub Pages with no backend, but a ~20 MB
compressed index and no cross-shard ranking); **SQLite + sql.js WASM** (elegant offline story, but
downloads the whole DB to the browser — same size wall).

`metadata-registry` gains a `RegistrySource` abstraction so `search()` can be backed either by the
existing in-memory index (bundled instruments, offline, unchanged) or by a remote Supabase query.
Callers keep the same API.

### D6 — Corpus records are `RegistryEntry`-compatible from day one

The corpus projects onto the **existing** `RegistryEntry` model (`componentType: 'question' |
'variable' | 'codeList'`, `ddi`, `registry.provenance`, `searchText`) rather than inventing a
parallel one. Practical payoff: the designer's Library panel can insert a StatCan question into an
instrument **with no changes to the designer**, because it already consumes `RegistryEntry`.

Corpus-specific fields (survey acronym, cycle, year, T-code, source page, pairing, concept id)
live in an additive `corpus?: CorpusMeta` block — same pattern as the existing optional `eq?`
block. Nothing about the current bundled-instrument path changes.

A corpus question inserted into a designer instrument becomes a normal `QuestionConstruct` with a
`responseDomain` derived from the code table — meaning **DDI-XML export, JSON-LD export, and the
validator all work on it for free** (Phase 15 machinery).

### D7 — Everything the parser can't handle is reported, never silently dropped

Same posture as the DDI importer's fidelity report, which proved its worth on the Colectica files.
Every file gets an outcome: parsed cleanly / parsed with warnings / skipped (with reason —
scanned, unknown layout, unreadable). The report is committed and diffable, so a parser change
shows up as a measurable delta in coverage rather than a vibe. **Target for M2: ≥95% of T15.2 and
T15.6 files parsed with zero warnings**, with the remainder itemized.

### D8 — Provenance and attribution travel with every record

Every record carries survey acronym, cycle/year, source filename, page number, T-code, and
language. This is non-negotiable for three reasons: a designer reusing wording needs to cite it;
extraction errors need to be traceable to a source page to be fixable; and the data is
**Statistics Canada's**, not ours.

**Licence — SETTLED (2026-08-18): Statistics Canada Open Licence.** Confirmed by the project
owner. This unblocks public deployment (M5) and imposes concrete, non-optional obligations that
the UI must satisfy:

- **Attribution** naming Statistics Canada as the source, the product/document title, and the
  reference date — carried per record (we already keep survey, cycle, year, file, page).
- **No endorsement**: the UI must not state or imply that Statistics Canada endorses this tool.
- The adaptation must be identifiable as such — search results and anything inserted into an
  instrument are *adapted* metadata (re-parsed, re-structured), not the official publication, and
  must say so.

Implemented as: a persistent attribution + disclaimer in the Searcher UI, per-record source
citation in the provenance panel, and the same attribution carried into anything exported from a
corpus-derived question. Tracked in M5.

### D9 — Ingest is deterministic and re-runnable

Given the same zip, the ETL produces byte-identical artifacts (stable record ids derived from
survey + file + variable name + position, sorted output, no timestamps in the payload). This makes
parser changes reviewable as diffs and lets M2 iterate on quality with confidence. Record ids use
the same **UUIDv5-from-stable-string** approach adopted for DDI URNs in Phase 15 P5, so corpus
records can be addressed in the JSON-LD/DDI graph later without re-minting identity.

## 5. What does NOT change

- The bundled-instrument path: `buildCatalog`/`buildSearchIndex` over demo instruments keeps
  working offline and unchanged; the corpus is an *additional* source.
- The designer, runtime, validator, DDI codec, and sensor module — untouched.
- `RegistryEntry`'s existing fields, so `LibraryPanel` needs no rework.
- The no-backend guarantee for exploration-only surveys.

## 6. Phasing & acceptance criteria

**M1 — Inventory, extraction spine, and the size answer** *(no parsing yet)*
Unpack/stream the nested zips; classify every file (T-code, survey, cycle, year, language);
extract text for the dictionary families; emit an inventory + coverage report. Validate
`pdfjs-dist` against the PyMuPDF baseline on golden files (D2). Load a **10-survey slice**
end-to-end into Supabase to measure real bytes/row and settle D5's size risk.
✅ Accept: every one of the 3,006 files is classified or explicitly listed as unclassified;
extraction succeeds on ≥95% of dictionary PDFs; a measured projection of full-corpus DB size.

**M2 — Parsers for the dictionary families + fidelity report**
`T15.2` and `T15.6` first (1,193 files, the bulk of the value), then `T15.4/.1/.3`. Golden-file
tests per variant, including the known code-column-order trap. Normalize to `CorpusVariable`,
including code lists, universe, position/length.
✅ Accept: ≥95% of T15.2 + T15.6 files parse with zero warnings; every failure itemized in the
committed fidelity report; golden tests cover each variant; parse of the full corpus is
deterministic (D9) and completes in a documented, tolerable wall-clock time.

**M3 — Pairing, concept clustering, and search**
EN/FR pairing with evidence + confidence (D4). Concept clustering across cycles (start with exact
variable-name match within a survey, then normalized-question-text similarity; T11.1/T11.2 indexes
give thematic grouping for free). Supabase schema + FTS indexes + seed loader. `RegistrySource`
abstraction in `metadata-registry`.
✅ Accept: searching "smoking" returns CCHS occurrences across multiple cycles, ranked, in both
languages; a concept page shows one question's wording changing over 20+ years; pairing precision
spot-checked against a hand-labelled sample; **stated recall/precision numbers, not vibes**.

**M4 — Hub Searcher at scale + designer insertion**
Facets (survey, year, theme, language, has-code-list); concept timeline view; provenance panel
with source citation; "insert into instrument" through the existing Library path. Non-PDF formats
(`.docx`/`.xlsx`) if they prove to carry unique content.
✅ Accept: a designer can search StatCan wording, see its full provenance and cycle history, and
insert it into an instrument that then exports as valid DDI-XML.

**M5 — Deployment** *(unblocked — StatCan Open Licence confirmed 2026-08-18)*
Attribution + no-endorsement disclaimer in the Searcher UI, per-record source citation, RLS
policies (read-only `select` to `anon`), seed automation, DEPLOYMENT.md section.
✅ Accept: every corpus surface shows StatCan attribution and identifies the data as an adaptation;
no endorsement is stated or implied; DEPLOYMENT.md documents the seeding path end to end.

## 7. Open questions — yours to answer

1. ~~**Licensing.**~~ **ANSWERED (2026-08-18): Statistics Canada Open Licence.** Obligations
   folded into D8 and M5; no longer blocking.
2. **Audience.** Is this a personal/demo capability, or aimed at the target organization? If the
   latter, they may already have a metadata repository this should complement rather than
   duplicate — worth asking your standards contact, who would know.
3. **Scope of ingest.** Dictionaries only (the ~1,200 files carrying ~95% of the structured value),
   or the full 3,006 including user guides and methodology papers as full-text search?
   Recommendation: dictionaries for M1–M3, decide on the rest with real usage data.

## 8. Explicit non-goals

- **No microdata.** This is documentation *about* surveys. No confidential data is involved, and
  nothing in this plan should ever touch RDC microdata.
- No OCR for the ~1% scanned files (itemized in the fidelity report instead).
- No attempt to reconstruct full runnable instruments from dictionaries — a data dictionary
  describes an output file, not a questionnaire's routing. Individual questions are reusable;
  whole-questionnaire reconstruction is not a goal.
- No `.wpd` support.
- No claim of being an authoritative StatCan metadata service. This is a research/design aid built
  from published documentation, and the UI must say so.

## 9. Decision log

- **(2026-08-18)** Corpus stays out of git; ETL code + fidelity report committed instead (D1) —
  same pattern as the Ireland-LFS DDI fixtures.
- **(2026-08-18)** Occurrences and concepts modelled separately (D3/D5) — clustering is inference
  and must never corrupt extracted facts.
- **(2026-08-18)** Search moves server-side to Supabase Postgres FTS (D5); client-side TF-IDF is
  retained for the offline bundled-instrument path. Rejected: static shards, SQLite WASM.
- **(2026-08-18)** Corpus records project onto the existing `RegistryEntry` model (D6), so designer
  insertion and the whole DDI/JSON-LD export chain work with no changes.
- **(2026-08-18)** Licence confirmed as the **Statistics Canada Open Licence** — deployment
  unblocked; attribution, no-endorsement, and identify-as-adaptation obligations are now
  acceptance criteria for M5, not open questions (D8).
- **(2026-08-18)** `pdfjs-dist` chosen over PyMuPDF on **correctness**, not convenience: PyMuPDF's
  default text order destroys table-row association and silently mis-labels code lists
  (`1 → "10,137"`). PyMuPDF is kept as an independent cross-check in the fidelity harness (D2).

---

## M1 results (measured, 2026-08-18)

M1 is built and run against the real delivery. Package: `packages/statcan-corpus`
(zip reader → classifier → pdfjs extractor → ingest → reporter → CLI). 297 tests, typecheck clean.
Committed artifact: `docs/statcan-corpus-report.md`, from the plain
`pnpm --filter @mobilesurvey/statcan-corpus corpus:inventory` — classification over all 3,006
files, no extraction, and verified byte-identical across runs so a diff there is always a real
change in coverage. Extraction figures live in this document rather than in the report, because an
extraction pass is a *sample* and its stats would otherwise churn the committed file on every run.

### Classification — full pass over all 3,006 files, 4.9 s

| | |
|---|---|
| Classified | **2,910 / 3,006 (96.8%)** — bar was ≥95% |
| Document kinds | data-dictionary **1,919** · reference 358 · user-guide 331 · record-layout 104 · alphabetic-index 102 · topical-index 96 · unknown 96 |
| Languages | en 1,375 · fr 1,205 · unknown 426 |
| Survey groups / acronyms | 319 groups · 177 acronyms |
| Years | 2,189 files dated **1981–2026**, zero outside the plausible range |

**The dictionary count went UP against the plan's estimate: 1,919, not the ~1,193 §1 projected.**
§1 counted T-codes by filename regex; the classifier also recovers dictionaries whose filenames
carry no T-code, via a keyword path that reads folder context and splits camelCase
(`LFS_RV2021_RecordLayout_RDC_ENG`, `ZeroFreqCdbk`, files filed under `Questionnaires/`). That
single fix moved the untyped tail from 11.0% to 3.2%.

### Extraction — 160-document sample, 1:37

23,128 pages, 50.8 M characters, **0 failures**, ~1.8 docs/s (so a full ~1,900-file dictionary pass
is roughly 18 minutes — comfortably a background job, not an overnight one). Peak RSS stayed near
550 MB: exactly one inflated bundle is held at a time, which is what makes a 2.4 GB archive
tractable at all.

### The y-tolerance, settled empirically (D2)

Row counts alone cannot decide this — a tolerance change moves them in both directions without
saying which move was right. So adjacent baseline pairs were classified by whether their glyph runs
**physically overlap in x**; overlapping runs cannot be one visual line, so a row containing one is
a definitely-wrong merge. Over 47 dictionary PDFs (1,950 pages, 286,619 items, seven T-code
families, both languages, four decades):

| yTolerance | rows | rows containing an x-collision |
|---|---:|---:|
| 0.4 – 3.0 | 73,579 → 73,003 | **4** |
| 4.0 – 6.5 | 72,868 → 72,712 | 12 |
| 7.0 – 7.5 | 72,680 | 14 |
| **8.0** | 72,176 | **270** |
| 10.0 | 71,595 | 956 |

The 4 collisions across the whole 0.4–3.0 plateau are `®` superscripts over the word they annotate —
overlays, not merged rows. The cliff is between 7.5 and 8.0, where the tightest real line pitch
(7.97 pt, a two-line footer) starts being swallowed. The floor is 0.8: below it real rows shatter,
because dictionaries do not typeset a row on one exact baseline (`CCHS_ESCC_RR_2012` offsets its
labels 0.09 pt from their values; `brm_2017_f1_T15.3` puts a column ~2.4 pt off its row). Safe band
**[0.8, 7.5]**, default **2.0** — 2.5× above the floor, 3.75× below the ceiling. Both cliffs are
pinned to named corpus files in `pdf.test.ts`, so the band is re-checked rather than remembered.

A **second parameter had to be added** that the plan never anticipated: a horizontal cell-gap
threshold (2.5 pt). Without it, joining every item in a row with the separator shreds any label
pdfjs emits as multiple items — and 86.6% of adjacent pairs are continuous text, not cell
boundaries. The gap distribution is sharply bimodal (86.6% under 1 pt, 13.3% at or above 2.5 pt,
0.07% in the trough between), so 2.5 separates the modes cleanly — but asymmetrically: lowering it
to 1.0 would invent 149 false boundaries, while raising it to 3.0 would erase 832 real ones. Treat
2.5 as a ceiling, not a midpoint.

### D5 — SETTLED: it fits, with room to spare

Measured on a 120-document representative slice (deterministic seed), parsed prototype-grade into
`CorpusVariable` records — 11,602 variables, 96.7 per document, **99.1% carrying a code list**:

| | |
|---|---|
| Bytes per record | mean **762**, p50 734, p95 939 |
| Composition | questionText 25.9% · codes 24.2% · source 21.8% · universe 8.6% · name 2.2% · concept 0.5% |
| Projected records (× 1,919 dictionary files) | **~185,500 occurrences** |
| Raw JSON | **141 MB** |
| Searchable text | 54 MB |
| **Postgres incl. tsvector GIN** (index at 30–60% of indexed text; rows at 1.25× JSON for tuple overhead) | **~193–209 MB** |

**Verdict: M1's dictionary occurrences fit — but "40% of the cap" is not the comfortable result
it first sounds like, and the earlier claim that the Storage fallback "should not be built" was
overstated.** Three things that arithmetic leaves out:

1. **It measures M1's scope only.** ~185k occurrence rows from *dictionaries*. M3 adds a concepts
   table plus the pairing edges; M4 may add the 727 non-PDF files and the user-guide/reference
   full text (another ~1,000 documents). Facet queries want btree indexes on survey/year/kind, and
   the plan also calls for a **`pg_trgm` index for fuzzy variable-name lookup — omitted from the
   arithmetic entirely**, and trigram GIN indexes routinely run 1–3× the indexed column.
2. **The index ratio is an assumption, not a measurement.** 30–60% of indexed text is a
   rule-of-thumb; it was not verified against a real `tsvector` on this data.
3. **The 500 MB is shared** with everything the app already stores, and Postgres does not shrink
   on delete without a vacuum — a re-ingest that replaces rows leaves bloat until then.

Put together, a plausible loaded figure is **~250–400 MB before M4**, which is not "fits with room
to spare" — it is "fits, with the ceiling in sight". So the honest position: **build M1–M3 directly
in Postgres and do not pre-build the Storage fallback, but keep it in the design and re-measure
against a real table before M4.** The concrete trigger: if a real loaded table exceeds ~300 MB, move
the bulky payload (full code lists, notes, raw extracted text) to Storage and keep only the
searchable projection — name, question text, concept, universe, and facet columns — in Postgres.
That split is cheap to do later precisely because D3 already separates occurrences from concepts.

The measurement that would settle this properly is loading the real ~185k rows into an actual
Postgres and reading `pg_total_relation_size`; that needs DDL rights the anon key does not have, so
it is M3's first task rather than something M1 could close.

Cross-check on the extrapolation: 185,500 records derived from measured variables-per-document is
within 5% of §1's independent ~177,000 estimate, which was derived from PyMuPDF block counts by a
completely different method. Two methods agreeing that closely is the reason to trust the number.

### Corrected along the way

- **`forEachCorpusFile` silently dropped delivery-level files.** It filtered the outer archive to
  nested zips, so a file sitting beside the bundles vanished — precisely the failure D7 exists to
  prevent. Today's delivery has nothing there, so the real corpus was unaffected, but a future
  README would have disappeared without trace. Now surfaced under the archive's own name.
- **pdfjs v6 `destroy()` is on the loading task, not the document proxy.** Called on the wrong
  object it would have leaked page caches across a 1,900-file run.
- Two tests asserted the strict cell separator against a hand-built fixture whose gaps are an
  artifact of pdfjs bridging hand-placed runs rather than of real table geometry. The strict
  assertion belongs — and passes — against a **real** corpus file in `pdf.test.ts`; the
  pipeline-level tests now assert the property they can actually guarantee (row association).

### Still unproven

- **Parsing is prototype-grade.** The sizing slice used throwaway parsers; M2 owns real per-variant
  parsers with golden files, and the ≥95%-clean-parse bar is not yet tested.
- **426 files (14%) have `lang: 'unknown'`.** Acceptable for M1 inventory, but EN/FR pairing (M3)
  needs better coverage; the acronym signal should resolve most of them.
- The 96 unclassified files are itemized in the ingest report and have not been triaged.
- **Parsing is still prototype-grade** (repeated here because it is the biggest open risk): the
  sizing slice used throwaway parsers, and M2's ≥95%-clean-parse bar is untested.

### Accuracy review (66-file stratified hand-check, 2026-08-19)

Coverage (96.8%) says how many files got a label; it says nothing about whether the labels are
*right*. So a stratified sample — every `docKind` represented, rare kinds deliberately
over-sampled so a systematic error in a small class could not hide behind the T15.2 bulk — was
drawn with a deterministic hash and checked by hand, field by field, against the paths.

**Zero wrong values in 66 files.** Specifically none of the failure modes the plan was worried
about: no year taken from a catalogue number or a survey id, no acronym that was a fragment or a
doc code, no `T1FF`-style false T-code, no language asserted backwards. The design bet — *prefer
`undefined` over a confident guess* — held, and the wrong-year failure that would silently corrupt
the concept timeline did not occur once.

What the sample found instead was **abstention where a signal existed**: ~12% of files carried
`lang: 'unknown'` that a reader could resolve from the filename. Tracing it produced one clean
systematic cause and one fix:

- **Two-letter acronym pairs were unreachable.** `detectLang` required both halves of the group's
  `EN_FR` pair to be 3+ letters, on the stated theory that `AG`/`BC`/`SA` would collide with
  ordinary words. That theory was wrong — `tokenPresent` anchors on letter boundaries, so `AG`
  cannot match inside `agriculture` — but the guard's cost was total: **every file in `BC_CB_K12`,
  `ROE_RE`, `AG_SA_AllYears` and `HS_EH` came out `unknown`** (91 files).
  Lowering the minimum to 2 resolved **64 files with no observed error**, and the corpus
  corroborates every one in its own words: `RE_…_code_de_semaines` → fr against
  `ROE_…_week_codes` → en; `BC_K_12_ELMLP` pairs with `CB_K_12_PLEMT` (the EN/FR names of the same
  platform) and `bc_k12` with `cb_m12` (*maternelle*–12). Corpus-wide, `lang: 'unknown'` fell from
  **426 (14.2%) to 362 (12.0%)**.
  The genuinely dangerous two-letter cases — `CHS_T4_T1FF_…`, `T1FF_pi_for_PSIS_…`, where the
  second token is a tax form rather than a French acronym — stay excluded, because `acronymPair`
  already refuses any group carrying a third acronym token. Both behaviours are now pinned by
  tests, including the linkage-chain case that makes the looser bound safe.
- Two existing tests had encoded the old behaviour, asserting `unknown` for `CB_K_12_*`. They were
  not "fixed to pass": the corpus holds 17 `BC_*` and 15 `CB_*` files with otherwise identical
  stems, which settles that `CB_` is the French half. The file-number test that used that path was
  re-pointed at a group with no acronym pair, where a file number really is the only candidate
  signal — so it now tests its stated intent instead of an accident.

Residual, not fixed: ~288 files remain genuinely ambiguous from the path alone (no tag, no usable
acronym pair, no language-bearing words) — resolving those needs document *content*, which is M2/M3
territory. Cycle extraction is also noticeably noisy on deeply nested groups (`NPHS_ENSP/…/Cycle 3
(1998-1999)/` yields the folder-2 string, not `Cycle 3`); `cycle` is a best-effort facet and no
downstream decision depends on it yet, but it should be tightened before it becomes a search facet.

**Not our bug, worth knowing:** 4 files (all NHS, all French) carry mojibake *in the source
delivery* — `Enqu+¬te nationale aupr+¿s des m+¬nages`. The zip entries are correctly UTF-8 flagged
and correctly decoded; StatCan's own export mangled the names before zipping. They are unresolvable
by filename and are among the 362 unknowns.
