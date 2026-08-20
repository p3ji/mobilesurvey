# Design — link the original PDF beside the reconstructed-text reader

*Status: approved 2026-08-20. Phase 17 (StatCan metadata repository), follow-on to M4 source documents.*

## The problem

A corpus record cites `CCHS · 2015 · cchs_2015_f1_T15.6_v1.pdf · p. 176`, and **Open source ↗**
opens the *reconstructed* text of that dictionary at page 176. That reader is the right primary
path and stays exactly as it is — it lands you on the relevant page, which is the whole point.

What it cannot do is show the original. The reconstruction rebuilds rows from glyph geometry, so
tables lose their alignment, and anything carried by layout rather than by text — a bracketed
grouping, a footnote's attachment to a column — is degraded or gone. For a reader checking a
derivation note against the published document, the PDF is the artifact of record.

So: **add a link to the original PDF. Do not replace the text reader.**

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
costs one environment variable (see *URL resolution*).

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

**Reader header only.** Search result cards keep their single `Open source ↗` button. Two
competing affordances per card would invite treating the PDF as the default, when the text reader
is the better first stop — it is searchable, it is a tenth the bytes, and it opens on the page you
asked for.

**The anchor follows the page you are on, not the page you arrived at.** The link carries
`#page=<current page>`, i.e. the reader's `at` state, not the original citation's `page`. Land on
p. 176, flip to p. 180 hunting the appendix, and the PDF opens at 180.

**The link appears only when there is something behind it** — driven by `has_pdf`. No link rather
than a dead link. Both existing empty states (`meta === null`, `!meta.hasText`) are unchanged, and
a document with no recoverable text but a published PDF becomes newly useful: the link renders even
though the text panel cannot.

**Attribution.** `CORPUS_ATTRIBUTION` remains the single carrier of the Open Licence obligations
and is not paraphrased (AGENTS.md rule). The notice gains only the descriptive clause *"The
original PDF is available unmodified."* The licence distinction genuinely flips here: the
reconstructed text is an adaptation and must be identifiable as one, while the PDF is the
unmodified original and is not an adaptation at all.

## URL resolution

**Recipe plus checklist**, chosen over storing 581 absolute URLs. The database records only whether
a PDF exists; the address is built client-side from a setting. Switching hosts is then one
environment variable rather than 581 rows.

This mirrors the existing `has_text` column, whose comment states it exists so a reader can be told
"no text available" instead of meeting a 404. `has_pdf` is that idea applied to the same table
rather than a second pattern beside the first.

```
`${VITE_CORPUS_PDF_BASE}/${documentId}/${encodeURIComponent(title)}#page=${page}`
```

- `title` is already the filename (`corpus_document.title`, per its own schema comment).
- `VITE_CORPUS_PDF_BASE` unset → no link renders anywhere. Feature absence is graceful, as the
  Statistics Canada tab already hides itself when no corpus is configured.
- The builder lives in `packages/metadata-registry` (browser-safe, zero external deps, as that
  package already is) and normalises a trailing slash on the base.

### Object key

`<documentId>/<original filename>` — e.g.
`0046abdc-2559-588f-bb4d-ddaf12994182/cchs_2015_f1_T15.6_v1.pdf`

The id prefix guarantees uniqueness, since paths can collide across bundles — a hazard
`corpus_document_at` already defends against with `limit 1`. The trailing real filename means a
download lands as `cchs_2015_f1_T15.6_v1.pdf` rather than a UUID. It is also the same shape as the
existing text chunks (`<documentId>/<chunkStart>.json`), so the two bucket layouts rhyme.

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

## Publish pipeline

A **separate CLI command, `corpus:pdfs`** — not a flag on `corpus:documents`. Different source (raw
zip bytes vs. pdfjs-reconstructed text), different destination (R2 vs. Supabase Storage), different
credentials. Coupling them would put the 33-minute text extraction at risk of re-running whenever a
1 GB upload fails.

**Work list** comes from `corpus_document` — the authoritative record of what is published, handing
back `document_id` directly so nothing re-mints UUIDs. No separate population rule to keep in sync
with the text publish. The read itself needs no elevation (`anon` already has `select` on the
table); the service-role key is required only for the `has_pdf` write-back below.

**Streaming, not staged.** The text publish stages to `out/documents/` because re-extracting is
expensive; PDF bytes sit in the zip and cost nothing to re-read. Stream zip → R2 and skip staging,
rather than spend 1,035 MB of scratch disk on something we do not need.

**Resume by asking the bucket.** List existing objects once (paginated), skip keys already present
at matching size, `--force` to overwrite. A run interrupted at document 400 resumes at 401 with no
local state that could have gone stale.

**`has_pdf` written back in bulk** after uploads settle — one update per batch of ids, not one
request per file. The failure mode is deliberately one-directional: a crash between upload and
write-back leaves `has_pdf` false, so the link stays hidden and a re-run fixes it. The reverse
would be a dead link.

**Credentials** — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` from the
gitignored `.env.local`, as `corpus:load` already does for the service-role key. Never a `VITE_*`
var, never CI.

The loader's "refuse a key that looks publishable" guard carries over only to the **Supabase** key
used for the `has_pdf` write-back, where the publishable/service-role distinction exists and an
RLS-refused write would otherwise look like success. R2 API tokens carry no such marker, so there
is nothing to inspect; a wrong R2 token fails loudly on the first PUT, which needs no guard.

**SigV4 is hand-rolled on `node:crypto`** (~70 lines for PUT and list) rather than adding
`@aws-sdk/client-s3`. This package carries exactly one runtime dependency today, and only because
pdfjs is unavoidable; `ddi-xml` sets the precedent that a whole codec is worth writing rather than
pulling in a tree. *Reversible:* if the signer proves fiddly, swapping in the SDK changes one module
and no interface.

**Reporting** — stdout summary plus a gitignored `out/pdf-publish.json`. Measured totals go into
DEPLOYMENT.md §9g the way §9f records its 581 documents / 223 MB / 33 minutes. No new committed
report artifact: the ingest reports are committed because they are reviewable *quality* records,
and an upload log is not one.

## Testing

- **`schema.test.ts` extended to parse `documents.sql`** with the real Postgres parser. It currently
  covers `schema.sql` and `clusters.sql` only, and this change edits `documents.sql` — a gap worth
  closing in the file being touched.
- **URL builder** — page anchor appended, filename percent-encoded, unset base → null, trailing
  slash on base normalised.
- **SigV4 signer** — against AWS's published test vectors (canonical request → string to sign →
  signature).
- **Key builder** — `<documentId>/<filename>`.
- **Resume logic** — given a bucket listing, computes the correct skip set.
- **Reader rendering** — link present when `hasPdf`, absent when not, and present even when
  `!hasText`.
- **Not unit-tested against live R2.** `corpus:pdfs --dry-run` lists what would be uploaded and the
  total bytes, mirroring `corpus:load --dry-run`.

## Documentation

- **DEPLOYMENT.md §9g** — bucket creation, `r2.dev` enablement, credentials, the SQL, the publish
  command, and the measured results.
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
until then `VITE_CORPUS_PDF_BASE` stays unset and the reader renders exactly as it does today.

**Cloudflare**
1. Create an R2 bucket (e.g. `corpus-pdfs`).
2. Enable public access via the **r2.dev** subdomain; note the `https://pub-<hash>.r2.dev` URL.
3. Create an R2 API token with **Object Read & Write** scoped to that bucket; note the account id,
   access key id, and secret.

**Supabase**
4. SQL Editor → run the `alter table` plus the `drop function` / `create function` block from
   `documents.sql`.

**Local**
5. Add `R2_*` credentials to `packages/statcan-corpus/.env.local` (gitignored).
6. Add `VITE_CORPUS_PDF_BASE=https://pub-<hash>.r2.dev` to the hub's env, and to the
   `deploy.yml` build step for production.
