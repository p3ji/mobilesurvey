# StatCan metadata repository — corpus ingest, longitudinal question bank, search at scale

*Design document. Status: **PLANNED (2026-08-18)** — architecture agreed from a measured survey
of the corpus (§1 numbers are counted, not estimated, except where marked); nothing built.
Feeds the hub's existing **Searcher** tile, which today indexes only bundled demo instruments.*

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

**PDF text extraction is the one dependency question.** The measurement above used Python's
PyMuPDF. Options, in preference order:
1. **`pdfjs-dist`** (Mozilla) in Node — already the ecosystem the designer's PDF upload uses; keeps
   the pipeline in TypeScript with the rest of the monorepo. **Recommended**; must be validated
   against PyMuPDF's output on the golden files before committing to it (text-ordering differences
   are the risk — these layouts are position-sensitive).
2. A committed Python ETL step under `scripts/`, precedent being `scripts/ddigraph-interop/`.
   Acceptable, but splits the pipeline across two languages.

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

**CRITICAL — open question for you (§7):** the read-me confirms these dictionaries are
*non-confidential and shareable*, which settles confidentiality but **not licensing**. Before any
public deployment we need to confirm the terms (presumably the Statistics Canada Open Licence,
which requires attribution and a no-endorsement statement) and add the required attribution to the
UI. I have not assumed a licence. Until that's settled, the corpus should be treated as
**local-only** — ingest and search work fully offline; deployment waits.

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

**M5 — Deployment** *(blocked on D8's licence question)*
Attribution UI, RLS policies, seed automation, docs.
✅ Accept: licence confirmed and attribution shown; DEPLOYMENT.md documents the seeding path.

## 7. Open questions — yours to answer

1. **Licensing (blocking for M5, not for M1–M4).** Confirmed non-confidential, but under what
   terms may it be *republished*? StatCan Open Licence with attribution is the likely answer, but
   I won't assume it. Until confirmed, plan is local-only.
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
- **(2026-08-18)** Public deployment is gated on an explicit licensing answer (D8).
