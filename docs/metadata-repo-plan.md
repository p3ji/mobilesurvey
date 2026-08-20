# StatCan metadata repository — corpus ingest, longitudinal question bank, search at scale

*Design document. Status: **M1–M2 BUILT AND RUN; M3/M4 MVP shipped (2026-08-19)** — the whole
chain runs, from the 2.4 GB archive to ranked search in the hub. Full-run numbers, the fired D5
size trigger and what is still unverified are in **M2/M3 results** at the end. Architecture agreed
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
2. ~~**Audience.**~~ **ANSWERED (2026-08-19): external, and no internal equivalent exists.** Two
   consequences, both load-bearing:
   - **There is nothing to complement or defer to.** No internal concept vocabulary to align our
     clustering against, no existing variable registry whose ids we should reuse. Our concept
     grouping (D3) is therefore the contribution rather than a lossy mirror of someone's
     authoritative list — which raises its value and also means *we* own the judgement calls, so
     the occurrence/concept split that lets a reader always fall back to "what the document
     literally said" matters more, not less.
   - **The licence obligations become user-visible product requirements, not paperwork.** An
     external audience sees the attribution, the no-endorsement statement, and the
     identify-as-adaptation notice; they are UI, and they are how the tool stays honest about
     being a re-parse of StatCan's documents rather than an official StatCan service. M5 is a
     real milestone, not a formality.
   - Design consequence for M3/M4: optimize for a reader who does **not** already know StatCan's
     internal naming. Search must work from plain concepts ("smoking", "housing tenure"), not
     from variable mnemonics, and every result must carry enough provenance to be citable.
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

---

## The dictionary field schema (measured, 2026-08-19)

The question this answers: *what is the full set of fields a dictionary can give us, and what is
the mandatory minimum?* It had been answered by inspection — `CorpusVariable`'s fields came from
eyeballing four layouts — which is backwards. These numbers come from harvesting every field label
printed across a 150-document sample (**38,413 variable blocks**) and measuring, per field, how
often it is *populated* rather than merely printed.

The distinction matters: the dominant layout prints a **fixed template**, so a label like
`Question Text:` appears on ~100% of blocks and is *empty* on half of them. Label presence says
what the format allows; fill rate says what we actually get.

### The canonical field set

| Field | labelled (37,326 rec) | collection (1,044) | field (29) | Verdict |
|---|---:|---:|---:|---|
| `name` | 100% | 100% | 100% | **mandatory** |
| `position` | 99.9% | 100% | 100% | **mandatory** |
| `length` | 100% | 100% | 100% | **mandatory** |
| *meaning* (`concept` / `questionText`) | 99.4% | 100% | 100% | **mandatory** |
| `universe` | 88.0% | 84.1% | 100% | expected |
| `note` | 54.4% | 24.0% | 100% | optional |
| `questionText` (as distinct from concept) | 48.9% | 100% | 100% | optional |
| `codes[]` | 33.9% | 98.6% | 0% | conditional |
| `collectionName` | 0% | 2.4% | 0% | rare |

**The mandatory minimum is four fields: `name`, `position`, `length`, and one meaning-bearing
field.** Every record in every layout has them, which makes them the right basis for identity,
for the M3 concept clustering, and for the minimum a search result must be able to show.

**The fourth one is the subtle part.** Its *name* differs by layout — the labelled family calls it
`Concept` (a short subject label), the collection and field families give prose under
`DESCRIPTION` or unlabelled. They are the same slot filled from different vocabularies, which is
exactly why `concept` reads 0% in the collection layout and `questionText` reads 0% in neither:
the canonical schema needs **one meaning slot with a recorded provenance label**, not two fields
that each look half-empty. Today the parser writes them to different properties, so a naive query
for "the description" misses one layout entirely. That is a schema fix for M3, not a parse fix.

**`questionText` at 48.9% is correct, not a failure.** The labelled template prints
`Question Text:` for every variable including derived and administrative ones, which have no
question — an ID variable was never asked. An empty value there is the document being accurate.

### Fields the corpus has that our schema does not

Harvesting turned up labels with no home in `CorpusVariable`: `Source` (99.5% of labelled blocks —
which survey/file the variable was taken from, distinct from our `source` provenance block),
`Question Name` (99.5% — the questionnaire-side item name, which is what `collectionName` was meant
to hold and why that field reads ~0%), `Based on` (derived-variable inputs), `Valid values`,
`Blanks allowed`, and `Security level`. **`Question Name` and `Source` should be added**: the first
is the join key between a dictionary variable and the questionnaire that asked it — precisely the
link that makes the longitudinal question bank work — and it is being thrown away today.

### The open defect this exposed

Separating "the document prints no category table" from "we failed to read one":

| | blocks | |
|---|---:|---|
| print an answer-category table | 14,224 | 94.9% |
| print none (numeric, identifier, date) | 760 | 5.1% |
| **had a table, we extracted nothing** | **11,008** | **77.4% of tabled blocks** |

So the 33.9% code-list fill rate is **not** a ceiling imposed by the documents — it is our parser
reading roughly a quarter of the code tables that are there. The code lists we do extract are
clean (100% carry labels, 87% carry a frequency), so this is a recall problem, not a correctness
one, and it is the single largest open item in M2. The misses cluster in the French labelled
documents, whose category rows the single-space reader is not matching.

---

## M2/M3 results — the full corpus parsed, and a searchable MVP end to end (2026-08-19)

The pipeline now runs the whole distance: **archive → classify → extract → parse → project →
Supabase → ranked search in the hub**. Committed artifact: `docs/statcan-corpus-parse-report.md`,
from `pnpm --filter @mobilesurvey/statcan-corpus corpus:parse -- --kinds data-dictionary
--tcodes all`.

### The full parse — 1,368 documents, 24 minutes

| | |
|---|---:|
| Dictionary PDFs parsed | **1,368** (of 1,810 dictionary files; the rest are `.doc`/`.docx`, still M4) |
| Produced ≥1 variable | **1,157 (84.6%)** |
| **Variable occurrences** | **436,962** |
| Response-category entries | **850,912** |
| `corpus.jsonl` | **284.3 MB**, mean 682 B/record |
| Wall clock | 24:00, peak RSS ~1.1 GB |

**The count came in at 2.4× the M1 projection — 437k, not 185k.** M1 extrapolated from a
120-document hash sample parsed with throwaway parsers at 96.7 variables/document; the real
parsers over the real selection average 377.7 per productive document. Two causes, and the
second one is the interesting one: the prototype parsers were reading a fraction of each
document, and the delivery ships some dictionaries more than once, so a straight
occurrences-per-document extrapolation was measuring the wrong population. The M1 figure was not
a bad estimate of what it measured; it measured something narrower than it claimed.

**The `--tcodes` default was a trap worth recording.** `corpus:parse` inherits `--tcodes T15`
from the inventory command, and `matchesTcodeFamily` returns false for a file with no T-code at
all — so the default silently excludes every dictionary the M1 keyword classifier recovered,
which is roughly a third of them. The full run must pass `--tcodes all` and let `docKind` do the
selecting. This is now stated in DEPLOYMENT.md §9e rather than left to be rediscovered.

### Layout, and the one real coverage gap

| Layout | Documents | Share |
|---|---:|---:|
| `labelled` | 1,078 | 78.8% |
| `collection` | 58 | 4.2% |
| `field` | 22 | 1.6% |
| **no recognized layout** | **210** | **15.4%** |

Content detection held up: three layouts cover 84.6% of documents, and the 210 failures are
itemized per file in `out/parse-notes.jsonl` rather than absorbed (D7). They are not scattered —
they cluster by survey group, `BC_CB_K12` alone accounting for dozens, which is the signature of
**a fourth layout** rather than of 210 irregular documents. That makes it a bounded, tractable
piece of work rather than a long tail, and it is the largest single item left in M2.

**The `≥95% of T15.2 + T15.6 files parse with zero warnings` bar is NOT met.** 84.6% produce
records at all. Stating it plainly because the acceptance criterion was written before the corpus
was understood and the honest position is that it was optimistic, not that it was nearly reached.

### Field completion at full scale

| Field | Populated | Share |
|---|---:|---:|
| `position` / `length` | 431,548 / 432,921 | 98.8% / 99.1% |
| `concept` | 384,943 | 88.1% |
| `universe` | 357,365 | 81.8% |
| `questionText` | 249,969 | 57.2% |
| `note` | 189,249 | 43.3% |
| `codes` | 171,143 | 39.2% |

Code-list recall improved against the 150-document sample's 33.9%, to 39.2% — and splitting by
language shows why that number is worth splitting: **en 42.9%, fr 37.3%**, against
**`unknown` 1.7%**. That last figure is the finding. Documents whose language could not be
determined from the path are also the documents whose category rows are not being read, which
says the two problems share a cause — an unrecognized document family — rather than being a
language-stemming issue as previously assumed. 13,211 occurrences sit in that bucket.

### D5 — RE-MEASURED, and the trigger has fired

M1 projected ~193–209 MB and set an explicit trigger: **if a real loaded table would exceed
~300 MB, move the bulky payload out.** Measured against all 436,962 real records:

| | all occurrences | deduplicated | deduplicated, `codes` moved to Storage |
|---|---:|---:|---:|
| Table (JSON × 1.25 for tuple overhead) | 355 MB | 299 MB | 239 MB |
| `tsvector` GIN | 36 MB | 30 MB | 30 MB |
| trigram + btree | 8 MB | 7 MB | 7 MB |
| **Total** | **~399 MB** | **~337 MB** | **~283 MB** |

**Every column of that table is over the 300 MB trigger except the last, and the 500 MB free tier
is shared with every table the app already has.** So the M1 verdict ("fits, with the ceiling in
sight") is superseded: at 437k occurrences it does not comfortably fit, and the decision deferred
in M1 is now due. Three options, and they compose:

1. **A separate Supabase project for the corpus.** Implemented and the recommended default:
   `VITE_CORPUS_URL` / `VITE_CORPUS_ANON_KEY` override the app's project and fall back to it when
   unset. The corpus is read-only reference data with a completely different lifecycle from
   survey responses, and giving it its own 500 MB is the cheapest fix that changes no data model.
2. **`corpus:load --dedupe`.** Implemented, off by default. Saves **15.7%** — 436,962 occurrences
   collapse to 368,297 distinct facts. Note this is *lower* than the 28–35% measured on the first
   128k records: the repeated deliveries cluster in the first bundle, so the early figure was a
   sampling artifact. Re-measuring on the full set rather than trusting the extrapolation is the
   only reason the number in this table is right.
3. **Move `codes` to Storage** — 51 MB of the 284 MB. The largest single win and the most work,
   which is why it stays designed-not-built until 1 and 2 are exhausted.

The measurement that would settle this exactly is still `pg_total_relation_size` on a real loaded
table; the arithmetic above is honest about being arithmetic.

### What was built to make it searchable

- **`project.ts`** — `CorpusVariable` → `CorpusRow`, the flat row Postgres stores. Field names
  *are* the column names, so the loader needs no mapping layer to drift. `search_text` folds in
  the response-category labels, which is what makes plain-language search work at all: "never
  married" appears nowhere else in a record.
- **`sql/schema.sql`** — table, language-aware generated `tsvector` (an `IMMUTABLE` wrapper, since
  Postgres will not take a non-constant regconfig in a generated column), GIN + trigram + facet
  indexes, RLS with `select` to `anon`, and three RPCs: `corpus_search` (ranked, filtered, paged,
  with an exact/prefix rank boost so pasting a mnemonic behaves like a lookup), `corpus_stats`,
  `corpus_surveys`.
- **`load.ts` / `corpus:load`** — streaming upsert on `record_id` over PostgREST, service-role
  credential read from the environment and refused if it looks publishable.
- **`metadata-registry/corpus.ts`** — browser-safe read path. `SupabaseCorpusSource` calls the
  RPCs with `fetch` (the package still has zero external dependencies) and projects rows onto the
  existing `RegistryEntry`, so D6 holds: the designer's Library panel can consume these unchanged.
  Licence obligations are attached at projection time, where a UI cannot forget them.
- **`apps/hub/CorpusSearch.tsx`** — the Searcher's second scope. Debounced query, language /
  survey / has-categories facets, paging, per-card citation, and the attribution notice above the
  results.

### Verified, and how

The SQL is applied by hand in the Supabase editor, so nothing in the repo executes it — which
means a syntax error would sit in a committed file until someone pasted it into a browser.
`schema.test.ts` closes that with libpg_query (the real Postgres parser) compiled to wasm, over
the file *and* over each dollar-quoted function body, which the statement-level parse skips.

It earned its place on the first run: `returns table (… position text, length text …)` is a
syntax error, because `position` and `length` are `col_name_keyword`s — legal as table column
names, rejected as *function parameter* names, which is what a RETURNS TABLE entry is. Quoting
them fixes it and keeps the JSON keys identical to the column names.

The read path was verified end to end against 60,000 real parsed records served through a
stand-in that speaks the same RPC contract, because the Supabase host is unreachable from the
build environment. Searching `smoking` returned 522 results and put `CIH_010` — *"What is the
single most important change you have made?"* — at the top across **CCHS 2015, 2016, 2017, 2018,
2019 and 2020**, each with its own rounded frequencies and its own page citation. That is the
longitudinal question bank from §2, working, and it matched on a *category label* rather than on
the concept, which is the case `search_text` was designed for.

**What that does not verify: the SQL itself.** It parses, and its contract is pinned by tests,
but no statement in `schema.sql` has been executed against a Postgres. There is no database
available here — no Docker, no local server, and the project host does not resolve from this
environment (the hub's pre-existing `surveys` endpoint fails identically). Applying §9e is the
step that proves it.

---

## Live in Supabase — English corpus loaded and searched (2026-08-19)

The repository is running against the project's real Supabase. What follows is measured on the
loaded table, not projected.

| | |
|---|---:|
| Rows | **193,152** (English, deduplicated) |
| Surveys / documents | 183 / 531 |
| Reference years | 1982–2025 |
| Table size | **213 MB**, 1,153.8 B/row |
| Free-tier headroom | ~287 MB of 500 MB |
| With a response-category list | 89,824 (46.5%) |
| With question wording | 108,759 (56.3%) |

### Scope: English only, and it costs less than it sounds

Excluding French keeps the load inside the free tier without a schema change. The cost was
measured before the decision rather than assumed: **99.8% of French records are translations of
English records in the same survey** — only 232 French-only (survey, variable) pairs out of
110,392, and 2 survey groups (`DCNPB_DCOBS_2020_v1`, `SELCCA_EMAGJE_2020`) that exist in French
alone. So what is given up is the French *wording*, not coverage: every survey, variable, cycle,
universe and code list on the English side is retained, and the longitudinal question bank is
untouched.

French is also the half parsed worst — 37.3% category coverage against English's 42.9%,
frequencies deliberately omitted from French rows, and the open category-row recall defect — so
the eventual French load gets a better parser. `corpus:load --lang fr --dedupe` upserts it on top;
that is also the point at which the derived-column slimming becomes necessary (both languages
deduplicated: 620 MB as-is against ~413 MB slim).

### D5, finally settled by measurement rather than arithmetic

Three estimates, two of them wrong, in both directions:

| | Bytes/row | Basis |
|---|---:|---|
| M1 projection | ~800 | JSON bytes × assumed index ratio |
| M2 projection | ~910 | same method, more records |
| 25,000-row measurement | **1,764.6** | real table |
| 193,152-row measurement | **1,153.8** | real table |

The first two under-counted because the `fts` tsvector is a **stored generated column** and was
priced as index cost only — it is 27.2% of the table, the single largest column. The third
over-counted by 53% because GIN dedupes lexemes across rows and fixed index overhead amortizes:
indexes were 484 B/row at 25k and 181 B/row at 193k. **A small sample cannot predict index size at
scale, and neither can arithmetic.** `corpus_size()` exists so this is never estimated again.

Composition, per row, measured with `pg_column_size`:

| Column | B/row | | |
|---|---:|---:|---|
| `fts` | 342 | 27.2% | derived — the stored tsvector |
| `search_text` | 246 | 19.6% | derived — duplicates the columns below |
| `codes` | 194 | 15.5% | content |
| `question_text` | 94 | 7.5% | content |
| `path` / `bundle` | 91 | 7.2% | repeated (531 and 7 distinct values) |
| `concept` / `universe` / `note` | 101 | 8.0% | content |

**A third of the table is derived data carrying no information.** Dropping `search_text` and
replacing the stored `fts` with an expression index is a pure storage optimization with no
semantic effect. Not done yet — it is not needed at 213 MB, and it is what pays for French.

### Two defects the live data exposed, both fixed

**Code-list bleed.** Dictionaries print appendices tabulating other variables, and those rows are
shaped exactly like category rows: an integer, a label, an integer. The parser read them as
categories, so `VERDATE` — "Date of file creation" — acquired fourteen tobacco variables as its
response categories and ranked *first* for "smoking" out of 1,667 results. Only 647 records were
affected (0.15%), but the stolen labels are rich text and therefore outrank real questions. Fixed
by rejecting labels that begin with an underscore-bearing mnemonic (`TBC_30A`, `LAN_B02A`);
requiring the underscore is what keeps genuine labels like `NO - skip to Q5` intact. **10,816
spurious categories removed**, variable count unchanged, zero listing-shaped labels remain.

The first attempt at this fix was worthless, and the D9 determinism guarantee is the only reason
it was caught: the guard went into `readCodeRow`, passed its tests, and a full re-parse produced
**byte-identical output** — 850,912 categories before and after. Those rows are label-first and
single-spaced, so they take the `cellFreeCodeRow` path. The tests passed because the row shape in
them was invented rather than lifted from the corpus; they now use the real one.

**Search latency, entirely self-inflicted.** `corpus_search` took ~1.5 s where the GIN index alone
answers in ~50 ms. The mnemonic branch was written `upper(v.name) like …`, which wraps the column
in a function no index can serve, and OR-ing it against the tsvector match cost the GIN index for
the whole predicate — a sequential scan, which is why a 19-hit query cost as much as a 31,000-hit
one. Rewritten as `v.name ilike corpus_mnemonic(q) || '%'`, leaving the column bare so the trigram
index serves it, with the mnemonic test extracted into an `IMMUTABLE` function so the planner sees
it as constant.

| Query | Hits | Before | After |
|---|---:|---:|---:|
| `smoking` | 1,667 | 1,508 ms | **189 ms** |
| `housing tenure` | 19 | 1,067 ms | **112 ms** |
| `marital status` | 439 | 947 ms | **122 ms** |
| `CIH_005` | 12 | 504 ms | **127 ms** |
| `age` | 31,224 | 1,159 ms | 1,014 ms |

`age` is the remaining cost and it is inherent: the exact `total_count` requires counting every
match. Capping the count ("1,000+") would fix it whenever that becomes worth the imprecision.

Result quality moved further than latency did. `smoking` now returns `SMK_53`, "Number of
cigarettes usually smoked per day", with its wording, its routing universe, and its rounded
frequencies; `housing tenure` returns `TENUR`; `CIH_005` returns itself.

### Also fixed: an error that erased itself

The stats and survey-facet calls scan the whole table, so they are the first thing to time out
while a load is in flight — which happened. They shared one error slot with the search, and a
successful search cleared it, leaving a page with no totals, an empty survey picker, and no
explanation. They now have independent error state and a retry, and the notice says search still
works, because it does.

### Operational notes

- `service_role` needs its **own** table grants. Bypassing RLS is a policy exemption, not a
  privilege, and a new table grants nothing to anyone — without them every call returns 42501,
  including the read-only RPCs, which are `SECURITY INVOKER` and run as their caller.
- A whole-table `DELETE` exceeds the statement timeout at this size. Partition it — deleting by
  `survey_group` clears 193k rows in 183 requests without trouble.
- Deleted rows do not return their space until vacuum, so the table read 210 MB with zero rows in
  it. A re-load reuses the space rather than adding to it.

### Still not done

- **French** (`--lang fr`), which needs the slimming above and the category-row fix first.
- The **fourth dictionary layout** — 210 documents (15.4%) still produce no records, clustered by
  survey group rather than scattered.
- **EN↔FR pairing and concept clustering** (the rest of M3): search finds occurrences, not
  concepts, and the cycle-to-cycle grouping in §2 is still done by the reader's eye.
- **Designer insertion** of a corpus record has not been exercised end to end.
- `.doc`/`.docx` (M4) — 604 files unread.

---

## The fourth layout, and what the other unparsed documents actually are (2026-08-19)

`definition` is now parsed, and the investigation reframed the problem it was meant to solve.

### The layout

```
Variable name: COHORT_GROUP_ID
Short Description: Variable for linking records within the BC file
Column number: 1
Data type: Number
Derived from: Statistics Canada
Long Description: The Cohort_Group_Id is a unique number used to identify unique
individuals within the B.C. data file which can be used to follow the student …
```

One field per row, values wrapping across rows, and the header carrying nothing beside it — which
is precisely why the `labelled` and `collection` headers miss it, both requiring `Length:` or
`Position:` on the same row.

It documents **linked administrative files rather than questionnaires**, so it has no question
wording at all and calls position a column number. That is a property of the source, not a gap:
nothing in these files was ever asked of a respondent. It maps onto the existing schema unchanged —
`Short Description` → `concept`, `Column number` → `position`, `Long Description` + `Derived from`
→ `note`.

| | before | after |
|---|---:|---:|
| Documents producing records | 1,157 (84.6%) | **1,183 (86.5%)** |
| Variable occurrences | 436,962 | **438,931** |
| Documents with no recognized layout | 210 | **184** |

### The reframing: "a fourth layout" was the wrong model

Probing the clusters found at least three different things among the 210, and the largest is not a
parser gap at all:

| Cluster | | What it is |
|---|---:|---|
| `IMDB_BDIM` | 52 | **Annexes** — standalone classification tables (census divisions, country codes). No variable entries exist to find. |
| `BC_CB_K12` | 27 | The `definition` layout. Now parsed. |
| `CEN_REC` | 21 | 1,753-page census dictionaries; entries exist but are buried in prose sections. |
| `CCR_RCC` | 15 | A **wrapped header** — `Variable` and `Name` split across two rows, fields written without colons (`Concept Underlying cause of death`). |

So the residual 184 is a mix of *documents that will never yield records* and *layouts not yet
written*, and reporting them under one heading overstates the parser's shortfall. Separating the
two is the next useful step, ahead of writing another parser.

A scan to characterize all 210 mechanically was abandoned: it ran slower than the 20-minute
full re-parse it was meant to inform, because the census files are 1,753 pages each. The re-parse
*is* the measurement.

### Two implementation notes worth keeping

**Layout detection nearly became a coin flip.** The first `DEFINITION_HEADER` was a
case-insensitive `Variable name:` with no end anchor, which also matches the `labelled` family's
`Variable Name:  DHHGAGE  Length: 2  Position: 31`. Both layouts would have counted the same rows
and the winner would have come down to a sort's tie-break — deciding how ~37,000 records parse.
Anchoring the name to end-of-row separates them, and a test asserts a labelled document is not
stolen.

**Page numbers are interleaved with the prose.** These documents print the page number between
wrapped rows, so a continuation reader glues it into whatever field is open
(`…education path 5 from Early Learning…`). Bare short integers are dropped; no field in this
layout is one.

### Operational: vacuum after a full re-load

Upserting 193,152 existing rows writes a new tuple version for each and leaves the old one dead.
The table went from 213 MB to **333 MB** for 0.7% more rows (1,153.8 → 1,792.7 B/row), and the
cost is not only storage: `corpus_stats` went from 1.6 s to exceeding the 8 s statement timeout,
and `smoking` from 189 ms to 1.5 s, because every scan now walks the dead tuples too.

`vacuum (full, analyze) corpus_variable;` reclaims it. Deleting has the same effect — space is not
returned until vacuum, which is why the table read 210 MB with zero rows in it earlier. **Any full
refresh of this table should be followed by a vacuum**, and the D5 headroom figures assume a
vacuumed table.

---

## M3 concept clustering — DDI's variable cascade, live (2026-08-19)

D3 planned one `CorpusConcept`: a bag of occurrences judged to be "the same question across
time". DDI-Lifecycle already models this, and models it as **three** objects rather than one.
Adhering to the standard turned out to be the better engineering answer, not a compliance tax.

| DDI | | Ours |
|---|---|---|
| `c:Concept` | a unit of meaning | 70,750 |
| `l:ConceptualVariable` | a Concept applied to a Universe | 85,363 |
| `l:RepresentedVariable` | a ConceptualVariable given one coding | 94,901 |
| `l:Variable` | the variable in one dataset | the occurrence |

### Why the split earns its keep

**It makes the interesting question a property rather than a query.** "Which cycles changed the
wording or the coding?" — the question §2 was written around — is a ConceptualVariable whose
`representations` exceeds one. Collapsed into a single cluster, that has to be reconstructed by
comparing members pairwise, every time anyone asks.

**It measures better than the plan's own fallback.** Against grouping by survey plus variable
name:

| | Cross-cycle groups | Cross-survey |
|---|---:|---:|
| DDI cascade | **13,466** | **9,841** |
| survey + variable name | 4,759 | 0 — impossible by construction |

Name matching cannot cross surveys at all, because the mnemonic is what changes when a question
moves between programmes. The cascade keys on meaning, so it can.

**The universe is load-bearing.** Marital status of everyone 15 and over is not the same measure
as marital status of lone parents, and DDI is explicit that the pair (Concept, Universe) is what
constitutes a ConceptualVariable. Keying on the concept label alone would have merged them.

### Deliberate exclusions

**Frequencies are not part of a representation signature.** Every cycle of an identically-coded
question carries different counts, so including them would make each cycle its own representation
and fire the "coding changed" signal on all 13,466 groups — noise indistinguishable from signal.

**Normalization is shallow** — case, punctuation, whitespace, and nothing else. No stemming, no
synonyms. A looser key merges genuinely different measures with no way for a reader to notice,
while a stricter key leaves two groups that are visibly the same thing side by side. Only the
second failure is self-correcting, so the bias is toward splitting.

**8.8% of occurrences are left unplaced** — 17,037 records carrying no concept and no question
wording. Grouping them by variable name would put unrelated administrative fields from different
surveys together: a confident answer with no evidence behind it.

### D3 is respected strictly

Membership lives in `corpus_variable_cluster`, keyed by `record_id`. Nothing in the clustering
path writes to `corpus_variable`. Occurrences are what a document said; clusters are our inference
about what several documents meant, and that inference will sometimes be wrong — so re-clustering
is a truncate of four small tables, and a clustering bug cannot reach an extracted fact. The
schema test asserts the absence of any `alter table corpus_variable` in `clusters.sql`.

### One inconsistency caught before it shipped

Clustering initially ran over all 230,034 English occurrences while the load had deduplicated to
194,507 — so ~17k memberships would have pointed at rows that do not exist, and every occurrence
count in the concept view would have been inflated. A group claiming 66 members that can only show
54 is worse than one that never claimed them. `cluster` now takes the same `--lang` and `--dedupe`
filters as `load`: 177,470 memberships + 17,037 unplaced = exactly 194,507.

### Verified live

`SMKDVSTY` — "Smoking status (type 2), traditional definition" — renders as **2015–2025, 11 years,
16 occurrences, 2 surveys, 2 codings**, with the single coding change flagged at the year it
happens. `corpus_concepts` answers in 380 ms, `corpus_timeline` in 210 ms.

### A stat label to fix

`corpus_cluster_stats` reports `coding_changed` over *all* conceptual variables (7,850), while the
meaningful figure is over those spanning more than one year (2,807). Both are true; the names do
not distinguish them, and a reader comparing the two would be misled. The UI avoids the ambiguity
by asking `corpus_concepts(changed_only, min_years:2)` for the number it displays, but the function
should be renamed or re-scoped the next time the SQL is touched.

### Operational note

The `do $$ … foreach … $$` block that created the policies and grants in six lines **failed in the
Supabase SQL editor with no actionable message**, and plpgsql is the one construct the parse test
cannot verify. It is now sixteen plain statements. Repetition that applies beats concision that has
to be debugged through a browser.
