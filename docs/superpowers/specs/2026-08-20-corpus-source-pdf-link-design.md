# Design — link the original PDF beside the reconstructed-text reader

*Status: approved 2026-08-20. Phase 17 (StatCan metadata repository), follow-on to M4 source documents.*
*Revised 2026-08-20 after review: the bespoke upload pipeline was cut in favour of `rclone`. See*
*"Why there is no upload pipeline".*

## The problem

A corpus record cites `CCHS · 2015 · cchs_2015_f1_T15.6_v1.pdf · p. 176`, and **Open source ↗**
opens the *reconstructed* text of that dictionary at page 176. That reader is the right primary
path and stays exactly as it is — it lands you on the relevant page, which is the point.

What it cannot do is show the original. The reconstruction rebuilds rows from glyph geometry, so
tables lose their alignment, and anything carried by layout rather than by text — a bracketed
grouping, a footnote's attachment to a column — is degraded or gone. For a reader checking a
derivation note against the published document, the PDF is the artifact of record.

So: **add a link to the original PDF. Do not replace the text reader.**

The whole user-visible feature is one link in one header. The design below is mostly about not
letting the plumbing outgrow it.

## Why the PDFs are hosted at all, and why on R2

Linking out to Statistics Canada was measured and rejected during M4: 26 of 581 documents (4.5%)
carry an SDDS number, and those resolve to a survey landing page, not the dictionary. For the other
95.5% there is no derivable public URL, so reaching the original means serving it.

Measured size of the population (`out/inventory.jsonl` joined to `out/corpus.jsonl`, English
records only):

| Documents | PDF bytes | Share of records |
|---:|---:|---:|
| 100 | 301 MB | 54.3% |
| 200 | 503 MB | 77.1% |
| 300 | 678 MB | 92.3% |
| **581** | **1,035 MB** | **100%** |

Hosts considered:

| Host | Verdict |
|---|---|
| **Cloudflare R2** | **Chosen.** 10 GB free, so all 581 fit with room. Serves `application/pdf` inline, so `#page=N` works. URLs constructible. |
| Supabase Storage | Rejected — 1 GB quota with ~257 MB already spent on the reconstructed text; 1,035 MB does not fit. |
| GitHub Pages | Rejected — 1 GB published-site limit, and serving from Pages means committing ~1 GB of binaries to git history permanently, against AGENTS.md's "never commit the corpus". Git LFS does not rescue it (Pages serves LFS pointer files, and free LFS is 1 GB anyway). |
| Google Drive | Rejected — its viewer ignores `#page=N`, so the page anchor is lost; needs a 581-entry file-ID manifest; throttles hotlinked files. |
| GitHub Releases | Rejected — serves `Content-Disposition: attachment`, so it downloads rather than previews, losing the page anchor. |

The page anchor is the deciding criterion. Browsers' built-in PDF viewers (Chrome/PDFium,
Firefox/pdf.js) honour `#page=N` on a directly-served file, which preserves the "lands where the
citation points" property the existing feature is built around.

Public access is via the free **`r2.dev`** subdomain. Cloudflare rate-limits it and says it is not
for production traffic, which is acceptable for a portfolio demo. Moving to a custom domain later
costs one environment variable.

## What the user sees

The reader header gains one link, beside `Close`:

```
┌─────────────────────────────────────────────────────────────┐
│ cchs_2015_f1_T15.6_v1.pdf                                   │
│ CCHS · 2015 · 3,567 pages · 1,204 variables extracted       │
│ CCHS_2015/cchs_2015_f1_T15.6_v1.pdf                         │
│                              [ Original PDF ↗ ]  [ Close ]  │
└─────────────────────────────────────────────────────────────┘
  Reconstructed text, not the published PDF — rows are rebuilt
  from the document's layout, so spacing and table alignment
  differ from the original. Adapted from Statistics Canada…
  The original PDF is available unmodified.
```

**Reader header only.** Search result cards keep their single `Open source ↗` button. Two competing
affordances per card would invite treating the PDF as the default, when the text reader is the
better first stop — it is searchable, it is a tenth the bytes, and it opens on the page you asked
for.

**The anchor follows the page you are on, not the page you arrived at.** The link carries
`#page=<current page>`, i.e. the reader's `at` state, not the original citation's `page`. Land on
p. 176, flip to p. 180 hunting the appendix, and the PDF opens at 180.

**The link appears only when there is something behind it** — driven by `has_pdf`. No link rather
than a dead link. Both existing empty states (`meta === null`, `!meta.hasText`) are unchanged, and
a document with no recoverable text but a published PDF becomes newly useful: the link renders even
though the text panel cannot.

**Attribution.** `CORPUS_ATTRIBUTION` remains the single carrier of the Open Licence obligations and
is not paraphrased (AGENTS.md rule). The notice gains only the descriptive clause *"The original PDF
is available unmodified."* The licence distinction genuinely flips here: the reconstructed text is
an adaptation and must be identifiable as one, while the PDF is the unmodified original and is not
an adaptation at all.

## URL resolution

**Recipe plus checklist**, chosen over storing 581 absolute URLs. The database records only whether
a PDF exists; the address is built client-side from a setting. Switching hosts is then one
environment variable rather than 581 rows.

```
`${VITE_CORPUS_PDF_BASE}/${encodePath(path)}#page=${page}`
```

- `path` is `corpus_document.path`, already stored and already returned by every search result and
  timeline entry.
- **`encodePath` encodes each segment separately** — `path.split('/').map(encodeURIComponent).join('/')`.
  A plain `encodeURIComponent` on the whole path would turn the separators into `%2F` and break
  every URL. This is the one genuinely easy mistake in the change, and it has a test.
- `VITE_CORPUS_PDF_BASE` unset → no link renders anywhere. Feature absence is graceful, as the
  Statistics Canada tab already hides itself when no corpus is configured.
- The builder lives in `packages/metadata-registry` (browser-safe, zero external deps, as that
  package already is) and normalises a trailing slash on the base.

### Object key: the corpus path, verbatim

`CCHS_2015/cchs_2015_f1_T15.6_v1.pdf`

An earlier draft prefixed each key with the document's UUID to guarantee uniqueness. **Measured
against the actual data, that was defending a hazard that does not exist:** of the 581 published
documents, **0 paths appear under more than one bundle, and 0 filenames are duplicated.** The
`limit 1` in `corpus_document_at` guards the same theoretical case and can stay as cheap insurance,
but the key does not need to.

Dropping the prefix is what makes the upload a plain directory copy — the bucket mirrors the
archive's tree, so the tool that puts files there needs to know nothing about our identity scheme.
It also means a downloaded file keeps its real name.

## Schema change

```sql
alter table corpus_document
  add column if not exists has_pdf boolean not null default false;
```

**`corpus_document_at()` must be dropped before it is recreated.** It uses `RETURNS TABLE (...)`,
and Postgres refuses to change an existing function's return type via `create or replace`, erroring
with *"cannot change return type of existing function"*. So `documents.sql` needs:

```sql
drop function if exists corpus_document_at(text, text);
create or replace function corpus_document_at(...) -- now returning has_pdf
```

This keeps the file idempotent and re-runnable, which is the property its header promises.

`CorpusDocument` in `metadata-registry` gains `hasPdf: boolean`, mapped from `has_pdf` in
`document()`.

**On the value of this column:** `corpus_document` holds exactly 581 rows and all 581 have a PDF, so
after a complete upload `has_pdf` is `true` everywhere and carries no information. Its only real job
is representing a *partial* upload honestly. Kept because it costs one column and one `UPDATE` and
is the difference between knowing and assuming — but it is a safety valve, not a feature, and should
not be allowed to grow one.

## Publishing: extract, then `rclone`

Two steps, neither of which is a bespoke pipeline.

**1. Extract** — `corpus:pdfs --out ./pdfs` reads the delivery zip and writes the 581 published PDFs
into a directory tree mirroring their corpus paths. No network, no credentials, no upload. It gets
its work list from `corpus_document` (a plain `anon` read — the table already grants `select`), so
there is no second population rule to keep in sync with the text publish.

**2. Upload** — one command:

```bash
rclone copy ./pdfs r2:corpus-pdfs --progress
```

**3. Flip the flag** — one statement in the SQL editor:

```sql
update corpus_document set has_pdf = true;
```

### Why there is no upload pipeline

The first draft of this design specified a `corpus:pdfs` command that authenticated to R2, signed
requests with a hand-rolled AWS SigV4 implementation (~70 lines, plus AWS test vectors), listed the
bucket to compute a resume skip-set, streamed uploads from the zip, and wrote `has_pdf` back in
batches.

That is a deployment tool for a one-time copy of 581 static files, and `rclone` is already a
deployment tool for one-time copies of static files. It handles auth, retries, resume, parallelism,
and integrity checks, and it is not our code to test or maintain. The signer and the resume logic
were the bulk of the original estimate and none of it was the feature.

The cost of this trade is one manual step that a script could have done, run once. That is the right
side of the trade.

## Testing

- **`schema.test.ts` extended to parse `documents.sql`** with the real Postgres parser. It currently
  covers `schema.sql` and `clusters.sql` only, and this change edits `documents.sql` — a gap worth
  closing in the file being touched.
- **URL builder** — per-segment encoding (a path with a space or `#` survives; separators are *not*
  encoded), page anchor appended, unset base → null, trailing slash on base normalised.
- **Extractor** — writes the expected tree for a fixture zip; skips documents not in the work list.
- **Reader rendering** — link present when `hasPdf`, absent when not, present even when `!hasText`,
  and carries the *current* page rather than the cited one.

No SigV4 or resume tests, because there is no signer and no resume logic.

## Documentation

- **DEPLOYMENT.md §9g** — bucket creation, `r2.dev` enablement, the rclone remote, the SQL, the two
  commands, and the measured results.
- **AGENTS.md** — one line in the Phase 17 bullet; a gotcha entry for the `drop function` requirement
  on `RETURNS TABLE` changes.
- **`CorpusDocument.tsx` header comment** — it currently asserts *"there is no public URL to link out
  to"*, which stays true of StatCan's site but is no longer the whole story once we serve one.

## Out of scope

- French documents (the corpus is English-only by an existing measured decision).
- The 184 barren documents that produced no records — they are not in `corpus_document`.
- Any change to `corpus_variable`, `corpus_search`, or the result cards.
- Replacing or de-emphasising the reconstructed-text reader.

## Manual steps required (no code can do these)

Recorded here and in DEPLOYMENT.md §9g. **None of the code paths activate until these are done**;
until then `VITE_CORPUS_PDF_BASE` stays unset and the reader renders exactly as it does today, so
the code can land and sit dormant safely.

**Cloudflare**
1. Create an R2 bucket, e.g. `corpus-pdfs`.
2. Enable public access via the **r2.dev** subdomain; note the `https://pub-<hash>.r2.dev` URL.
3. Create an R2 API token with **Object Read & Write** scoped to that bucket; note the account id,
   access key id, and secret.

**Supabase**
4. SQL Editor → run the `alter table` plus the `drop function` / `create function` block, then
   `update corpus_document set has_pdf = true;` after the upload succeeds.

**Local**
5. `rclone config` → an S3 remote named `r2`, provider Cloudflare, endpoint
   `https://<account-id>.r2.cloudflarestorage.com`, with the token from step 3.
6. `VITE_CORPUS_PDF_BASE=https://pub-<hash>.r2.dev` in the hub's env, and in `deploy.yml`'s build
   step for production.
