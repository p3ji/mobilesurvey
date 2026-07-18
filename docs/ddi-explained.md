# The DDI work, in plain language

*Companion to `docs/ddi-compliance-plan.md` (the technical design). This one explains what we
did and why, without assuming you remember any of the jargon.*

## The one-paragraph version

An expert at the organization that might use this tool said: "your survey definitions should be
exportable in DDI format so our tools can read them." We already had a DDI export, but when we
checked it against the official rulebook it turned out to be DDI-*flavoured*, not actually
DDI-*valid* — close enough to fool a human, not close enough for software. So we (1) wired the
official rulebook into our test suite so every export is machine-checked, (2) fixed the export
until it passed, (3) gave every exported item a proper globally-unique name, (4) added the
specific packaging style their tool expects, and (5) proved it all works by running *their own
software* on our files and by importing *real* production files from Ireland's national
statistics office. All of it now runs automatically in `pnpm test`.

## What is DDI, and why does anyone care?

DDI (Data Documentation Initiative) is the international standard for describing surveys and
statistical data — the common language national statistics agencies (Statistics Canada,
Eurostat, Ireland's CSO…) use so that a questionnaire built in one tool can be read, archived,
compared, and reused by another. Think of it like PDF for documents: nobody loves it, everybody
speaks it.

Our tool has its own internal format (clean, JSON, easy to work with). DDI support is the
bridge that makes our surveys *portable* into the wider statistical world — and lets us pull
real questionnaires *in* from that world.

## Why did we suddenly do five phases of work on it?

The expert reviewer pointed us at two things:

1. The **official schema files** (XSDs) — the machine-readable rulebook that defines exactly
   what valid DDI 3.3 XML looks like.
2. Their tool, **ddigraph**, which eats DDI files and turns them into a knowledge graph
   (a network of "this question uses that code list" relationships in a graph database).
   The remark "outputs should be RDF compatible" turned out to mean: *ddigraph does that
   conversion itself — your job is just to hand it files it can digest.*

That reframed everything. We didn't need to build any RDF/semantic-web machinery; we needed our
XML to be (a) valid by the official rulebook and (b) packaged the way their tool expects.

## What we actually did, step by step

### P1 — Install the rulebook, then fix the export until it passes

We vendored the official schema files into the repo and hooked a validator into the normal test
suite. Now **every test run checks our exports against the official rules** — nobody has to
remember to do it, and a change that breaks compliance fails CI immediately.

The first run produced a punch-list of eleven kinds of violations (wrong root element, wrong
element order, missing required fields, home-made ID formats…). We fixed the exporter until all
five bundled example surveys validated — while keeping the existing guarantee that exporting
and re-importing gives back exactly the same survey.

Two discoveries worth knowing about:

- **The official rulebook itself has a bug.** Its pattern for legal IDs accidentally omits the
  letters a–y after a dot, so even IDs the *specification text* allows (like `c.experience`)
  fail the *machine check*. Since our internal IDs are full of dots, we escape every dot as `@`
  on the way out and reverse it on the way in. Worth telling the expert — it's an erratum in
  the standard's published schemas.
- **Grids don't fit.** DDI 3.3 models grid questions as a separate element type that doesn't
  slot into where our questions go, so grid/table questions are exported as plain-text
  questions *plus* a faithful copy of the full definition in an extension field our own
  importer prefers. A native grid mapping is logged as future work.

### P2 — Give our surveys a proper "return address"

Every item in DDI carries a globally unique name (a URN) of the form
`urn:ddi:AGENCY:id:version` — where AGENCY identifies *who published this*, like a domain name
(Statistics Canada's registered one is `ca.statcan`). Two rules we set:

- **We never publish under `ca.statcan`**, because we don't act for the agency — publishing
  under someone else's registered name is impersonation, even accidentally. Our default is a
  placeholder we genuinely control: `io.github.p3ji`.
- The agency is now a **setting on the survey** (editable in the designer when you select the
  survey root), so if the agency ever adopts the tool, one field changes and every URN follows.
  A test proves that flipping the setting changes every URN and nothing else.

This matters more than it looks: ddigraph uses these URNs verbatim as the keys of its graph
database. Whatever we mint becomes *their* permanent record keys.

### P3 — Package it the way repositories actually want it

DDI files come in two shapes:

- **DDIInstance** — one big nested document, everything inside everything. Nice for humans.
- **FragmentInstance** — a flat bag of small self-contained "fragments" (one per question, per
  code list, per variable…) that point at each other by URN. This is what repository software
  (Colectica, and ddigraph's loader) actually consumes — like shipping furniture flat-packed
  with part numbers instead of pre-assembled.

We added FragmentInstance as a second export mode (new entry in the designer's Export menu).
The subtle part: fragment consumers look only at each fragment's top-level item and **never
look inside** — so anything left nested would silently vanish from their graph. That forced the
flat-packed style: every item its own fragment, schemes just hold lists of references.

Both packagings are checked against the official rulebook on every test run.

### P3b — Prove it with their own tool

Schema-validity is a proxy; the real requirement is "their pipeline builds the right graph."
So `scripts/ddigraph-interop/` feeds our exports to ddigraph's own unmodified parser and
asserts the result: right number of nodes of each type (counted independently from our survey
model, so the check can't fool itself), every node keyed by a proper URN under our agency, and
the important relationships present (question→answer-list→categories, instrument→flow).
Current result: all checks pass.

### P4 — Eat real food, not just our own cooking

Until now every import test used files *we* exported — a closed loop. ddigraph's repo includes
real, production-scale DDI files: Ireland's national Labour Force Survey, exported from
Colectica by the Irish statistics office (14.5–66 MB, thousands of fragments). We wrote a
download script (files are too big to commit; tests skip politely when they're absent) and made
our importer digest them.

Real files broke our assumptions in instructive ways — references written in a different but
legal style, files with *no* study-unit wrapper at all, the same variable repeated once per
collection wave, references to code lists that live in a different file entirely. The importer
now handles all of that, and — importantly — **everything it skips or approximates is itemized
in the import's fidelity report**, so nothing disappears silently. The imported Irish LFS passes
the same validation gate the designer uses to load a survey: 676 flow constructs, 636 variables,
235 answer lists, imported in about 2.5 seconds.

## What this buys the project

- **Credibility with the target org:** their expert can validate our files against the official
  schemas and load them with their own tooling, today, without us in the room.
- **A regression net:** DDI compliance is now enforced by `pnpm test`, not by memory.
- **A two-way door:** we can hand surveys to the statistical world *and* pull real agency
  questionnaires into the designer.
- **Honest limits, written down:** grids export as text-plus-extension (native mapping is
  future work), and external imports are best-effort-with-receipts (the fidelity report says
  exactly what was approximated).
