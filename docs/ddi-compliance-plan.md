# DDI-Lifecycle 3.3 compliance — schema-valid XML, canonical identity, ddigraph interop

*Design document. Status: **ALL PHASES DONE (2026-07-17)** — P1 XSD gate (2026-07-09);
P2 `agencyId` identity model; P3 FragmentInstance packaging, both packagings green in the XSD
gate, ddigraph interop harness passing; P4 real Ireland-LFS files import clean. Results below.
**P5 added 2026-07-20** after reviewer feedback: UUIDv5 identity + a JSON-LD serialization — §P5.*

## P5 results (2026-07-20) — FAIR feedback from the standards reviewer

Reviewer comment: *"for json to be F.A.I.R, should use json-LD and generate ids for the items.
we mostly use UUID4 or 5 for DDI URNs."* Two changes, both additive:

- **UUIDv5 identity is now the default** (`exportDdiXml(inst, { idScheme })`, `'uuid' | 'readable'`).
  The ID component of every URN is an RFC 4122 v5 UUID derived from the internal id via a
  project namespace (`packages/ddi-xml/src/uuid.ts` — hand-rolled SHA-1 so the package stays
  zero-dependency and synchronous; Web Crypto's digest is async and would have forced
  `exportDdiXml` to become async).
  - **v5, not v4, is load-bearing:** a URN is a *persistent* identifier, so the same question
    must mint the same UUID on every export. v4 would require persisting a UUID next to every
    item in the instrument JSON; v5 derives it deterministically and keeps the file clean.
  - Derived from the internal id **alone** — not the agency, not the version. DDI identity is
    already the triple (Agency, ID, Version), so folding either into the ID would be redundant
    *and* would make an item lose identity when versioned or when maintainership transferred.
  - **This retires the dot-escaping workaround** for the defective `BaseIDType` post-dot
    character class: a UUID has no dots, so the broken branch is never reached. The escaping
    survives only under `idScheme: 'readable'` (kept for debuggability and for reproducing
    pre-UUID exports).
  - Round-trip is unaffected because the verbatim internal id already travelled in `mst:id`;
    the importer now builds a UUID→internal-id alias map from those extensions in one pass
    (`buildIdAliases`). Aliasing is scoped to UUID-shaped ids, so `readable` exports and real
    Colectica files (UUIDs, but no `mst:id`) behave exactly as before.
- **JSON-LD serialization** (`exportJsonLd` / `toJsonLd`, `packages/ddi-xml/src/jsonld.ts`;
  designer Export menu → "JSON-LD (linked data, FAIR)"). A flat `@graph` of nodes
  cross-referenced by `@id`, mirroring FragmentInstance packaging.
  - **The `@id`s are the same canonical URNs the XML mints** — an XML fragment and a JSON-LD
    node describing the same question are the same resource to a consuming graph. Asserted by
    test, for both id schemes.
  - Vocabulary: `disco` (DDI-RDF Discovery) for Questionnaire/Question/Variable/Universe,
    SKOS for code lists (`ConceptScheme`/`Concept`/`notation`/`inScheme`/`hasTopConcept`),
    DCTerms for descriptive metadata, and an explicit `mst:` namespace for everything DDI-RDF
    has no term for (questionnaire flow, edit rules, sensor config). Where a standard term
    would be a *misuse* it is deliberately not used — e.g. the variable→concept edge is
    `mst:concept`, not `skos:related` (SKOS scopes that to concept-to-concept links).
    **The disco mapping is our reading of the vocabulary, not a certified crosswalk** — the
    reviewer is better placed than we are to correct it.
  - `InternationalString` maps straight onto JSON-LD language maps (`@container: "@language"`),
    so `{en, fr}` needs no transformation.
  - Our working `Instrument` JSON is deliberately NOT replaced: it is what the designer edits
    and the runtime executes, and linked-data ceremony in that hot path buys nothing. JSON-LD
    is a projection, exactly as DDI-XML is.
  - Tests assert structural validity the way a consumer would experience it: every `@id` is a
    canonical URN, and **no reference is dangling** (checked across demo/fsep/census).
- **Re-verified against ddigraph 0.4.2 with UUID identity** (`scripts/ddigraph-interop/`):
  demo 128 nodes / 224 edges, fsep 131 / 221, all node keys canonical URNs with a UUIDv5
  identity component (the harness now asserts the UUID shape explicitly, not incidentally).

## P2–P4 results (2026-07-17)

- **P2 (identity model):** `agencyId` is an optional `InstrumentMetadata` field (Zod-validated
  against the DDI agency pattern), edited in the designer's root-sequence Inspector, consumed
  by both codecs. Unset ≡ the `io.github.p3ji` placeholder (the importer normalizes the
  placeholder back to unset so round-trips stay deep-equal). Acceptance test proves changing
  `agencyId` changes every URN/Agency and *nothing else* (string-substitution identity).
- **P3 (FragmentInstance):** `exportDdiXml(instrument, { packaging: 'fragment' })` emits
  Colectica-style flat packaging — TopLevelReference → StudyUnit, one `i:Fragment` per
  maintainable/versionable, schemes hold children BY REFERENCE (a fragment consumer treats each
  Fragment's single child as one node and never recurses into inline children, so anything
  inline would vanish from the consumer's graph; only `l:Code` stays inline — it's Identifiable,
  not Versionable, and ddigraph special-cases CodeList→Category edges). Both packagings pass the
  XSD gate for all 5 bundled instruments; fragment exports round-trip deep-equal (the importer
  re-inflates containment references). Designer Export menu gained the second entry.
- **P3b (ddigraph interop, `scripts/ddigraph-interop/`):** ddigraph 0.4.2 (PyPI) ingests our
  fragment exports with its unmodified `DDIFragmentParser`: **demo 121 nodes / 212 edges, fsep
  131 nodes / 221 edges**, every node keyed by a canonical `urn:ddi:io.github.p3ji:…` URN,
  entity counts matching a manifest derived from the instrument model, structural edges
  (Instrument→Sequence, QuestionConstruct→QuestionItem, QuestionItem→CodeList→Category) intact.
- **P4 (real files, `packages/ddi-xml/fixtures/external/` + `external-import.test.ts`, suite
  skips when fixtures absent):** Colectica-produced Ireland LFS files from ddigraph `demo/`
  (Git LFS via media.githubusercontent.com; `fetch.mjs` downloads, never committed).
  - `LFS.xml` (14.5 MB, 5,200 fragments, agency `ie.cso`): imports in **~2.4 s / 160 MB heap**
    → 676 constructs, 636 unique variables (1,609 raw across 4 collection waves, deduped with
    a note), 235 category schemes, 54 fidelity notes, and the result passes
    `validateInstrument` (the designer's own load gate).
  - `Ireland_LabourSurvey.xml` (6.8 MB, **no StudyUnit at all** — instrument-only): imports via
    synthesized StudyUnit/schemes → 766 constructs, 195 category schemes, Zod-valid.
  - `Ireland_LFS_Series.xml` (66 MB): imports in ~5.5 s / 475 MB heap without crashing.
  - What external-file hardening required (all with legacy behaviour preserved for our own
    exports): references resolved by Agency/ID/Version when no `r:URN` child exists; loose
    fragments grafted into synthesized schemes (real repositories keep items flat and
    scheme-less); a synthetic CategoryScheme per CodeList (scheme id = CodeList id, code values
    stamped from `l:Code`); aggregation across multiple DataCollections/schemes; multi-
    Instrument root selection; synthesized variables for question/computation bindings;
    wave-duplicate variable names deduped; dangling code-list references downgraded to text.
    Everything skipped or approximated lands in the FidelityReport — no silent drops.

## P1 findings (what the gate actually surfaced — supplements §2's predictions)

- **D4 resolved, worse than predicted:** the official 3.3 `BaseIDType` pattern is *defective* —
  its post-dot character class reads `[A-Zz-z0-9*@$-_]` (omitting lowercase `a–y`), so even
  spec-legal one-dot ids like `c.experience` fail validation. Consequence: the ID mapping
  replaces **every** dot with `@` (dotless ids sidestep the broken branch entirely); `urn.ts`
  implements the bijection (`@` ↔ `.`, `@` asserted absent from inputs).
- **GridDomain was never legal in QuestionItem** — it is not in QuestionItemType's
  response-domain choice (3.3 models grids as a separate `d:QuestionGrid` item). The `table`/
  `grid` domains now project to `d:TextDomain` natively while the full definition round-trips
  via a `mst:rd` JSON extension at the QuestionItem level (which is now the authoritative
  domain representation for ALL domain types, since RepresentationType-based domains admit no
  `UserID` children at all). A faithful `d:QuestionGrid` mapping is future work.
- **`d:InstructionText` doesn't exist in 3.3** (instructions are a separate
  InterviewerInstruction scheme) — carried as an `mst:instruction` extension instead.
- Other fixes the gate forced: root `i:DDIInstance` + its own maintainable identity;
  `r:UserID`'s required attribute is `typeOfUserID` (not `type`); `r:Citation` (not `s:`) with
  `Creator > CreatorName` and `PublicationDate > SimpleDate`; `r:Abstract` is a StudyUnit
  sibling, not a Citation child; StudyUnit module order is ConceptualComponent →
  DataCollection → LogicalProduct; `TypeOfObject` is REQUIRED in every ReferenceType;
  QuestionConstruct references questions via `r:QuestionReference` (not `d:`); one
  `d:LiteralText` per language (each holds exactly one `d:Text`); `l:Code` needs identity +
  `r:CategoryReference` + required `r:Value`; Variable uses `l:VariableRepresentation` with
  the `r:` ValueRepresentation substitution group; `DateTimeRepresentation`/`DateTimeDomain`
  require `r:DateTypeCode`.
- Pre-compliance XML remains importable: the importer keeps legacy fallbacks for every
  changed shape (`!`-suffix URNs, `type` attribute, Citation-child Abstract, flat Creator,
  `r:Date`, single-LiteralText multi-Text, element-level domain extensions).

## 1. Problem statement

An expert standards person at the organization that would use this tool reviewed it and pointed
at the official DDI-Lifecycle XSD schemas (https://ddialliance.org/ddi-lifecycle, current
version 3.3, 2020) with the guidance: *"They will be helpful for generating the xml or json-LD
(you want the outputs to be RDF compatible)."*

Investigation of the expert's own tooling — **ddigraph** (https://github.com/pbisson44/ddigraph,
MIT-licensed Python toolkit) — resolved what "RDF compatible" concretely means here. ddigraph
ingests DDI XML (Codebook 2.x, **Lifecycle 3.x as FragmentInstance**, DDI-CDI 1.0) and writes
knowledge graphs to Neo4j / RDF-SPARQL / Gremlin / NetworkX backends. The XML→RDF conversion is
*their* pipeline's job. Therefore:

> **The compliance target is: schema-valid, canonically-identified DDI-Lifecycle 3.3 XML
> (FragmentInstance packaging) that ddigraph ingests into a correct knowledge graph.**
> A native JSON-LD exporter is NOT required (dropped to optional — see §8).

This also finally closes the item AGENTS.md has carried since 2026-07-02: *"DDI-XML validation
against a real external agency file — skipped; no real external file available."* ddigraph's
`demo/` directory contains three real production-scale DDI instances (`Ireland_LabourSurvey.xml`,
`Ireland_LFS_Series.xml`, `LFS.xml` — 14.5 MB, ~388 Sequences / ~373 QuestionItems, Git
LFS-stored), which become our import fixtures.

### Where the codec stands today

`packages/ddi-xml` (1,349 lines, zero deps: `export.ts`, `import.ts`, `xml.ts`, `types.ts`) was
built for **round-trip fidelity with itself** — its own output re-imports losslessly (21 tests) —
but has never been validated against the official XSDs. It emits "DDI-shaped" XML. The internal
architecture is right (DDI-aligned model in `instrument-schema`, codecs at the boundary, nothing
else touches XML), so compliance work stays confined to the codec plus one identity change in
`instrument-schema`. The importer matches on `localName` and ignores namespaces entirely, which
incidentally makes it packaging-tolerant (DDIInstance vs FragmentInstance) — a property to keep.

## 2. Known defects (found by inspection; the P1 validation gate will find the rest)

| # | Defect | Where | XSD consequence |
|---|---|---|---|
| D1 | Root element `<DDIInstance>` is in **no namespace** — prefixes (`xmlns:i="ddi:instance:3_3"` etc.) are declared but the root is unprefixed; no `xsi:schemaLocation` | `export.ts` document assembly | Instant validation failure; must be `i:DDIInstance` (or `i:FragmentInstance`) |
| D2 | URNs are non-canonical: `fullUrn()` mints `urn:ddi:mobilesurvey:fsep:1.0!cs.perfCols` | `export.ts` `fullUrn()` | 3.3 enforces `urn:ddi:{agency}:{id}:{version}` via regex on `r:URN` — fails on every element. Worse: ddigraph's `make_node_key()` **prefers the verbatim URN when present**, so these malformed URNs would become the expert org's graph keys |
| D3 | Agency derived by splitting the instrument id (`instrument.id.split(':')[2] ?? 'unknown'`) | `export.ts` `exportDdiXml()` | User-created surveys (`s-abc123`) get agency `'unknown'`; bundled `fsep` gets `mobilesurvey`; `r:Agency` has its own pattern (dot-separated lowercase segments) that arbitrary values violate |
| D4 | Item IDs contain dots (`cs.perfCols`, `v.revGross`, `edit.funds.balance`) | every instrument + fixtures | The 3.2+ ID character pattern likely disallows `.` (reserved as the agency-segment separator). **To be confirmed by the P1 gate** — if confirmed, fix via an ID-mapping layer in the codec (e.g. `.` → `-`), NOT a repo-wide rename |
| D5 | Element ordering and required children unverified | throughout `export.ts` | XSD sequences are strict; `<r:UserID type="mst:…">` placement, `r:Citation` composition, required children of `d:Instrument` etc. will surface as gate failures |
| D6 | One instrument-level version stamped onto every item | `identity()` | Passable syntax, wrong semantics — DDI versions maintainables/versionables independently. V1 of this plan keeps the single version (documented simplification); per-item versioning is future work |
| D7 | Only hierarchical `DDIInstance` packaging exists | `export.ts` | ddigraph's Lifecycle loader is a **FragmentInstance** loader (flat, Colectica-style, one self-contained `<Fragment>` per item). Our primary consumer can't cleanly ingest our only packaging |

## 3. Design decisions

### 3.1 Agency identifier: configurable, placeholder by default, never `ca.statcan`

The registered DDI agency for Statistics Canada is `ca.statcan`, and the canonical minting
pattern would be `urn:ddi:ca.statcan:{unique-id}:{version}`. **We must not publish under it** —
this project is not acting on behalf of the agency, and minting identifiers under a registered
agency you don't represent is namespace pollution (same reasoning as the FSEP demo's "not an
official government collection" disclaimer).

- `agencyId` becomes a **configuration value** (new optional field in `InstrumentMetadata`,
  app-level default), threaded through one URN-minting utility shared by export and import.
- Default: **`io.github.p3ji`** — reverse-DNS of a domain this project actually controls
  (`p3ji.github.io`), per DDI convention, and pattern-valid.
- `ca.statcan` is documented as the swap-in value if the agency ever adopts the tool. The swap
  intentionally creates **new identities for every item** — that is correct DDI semantics, not
  migration debt: a URN under `ca.statcan` is an assertion by Statistics Canada, and the agency
  would mint fresh identities at intake rather than inherit third-party-stamped ones. ddigraph
  handles the coexistence fine (its keys are the agency/id/version triple, so demo-agency and
  official items are properly distinct nodes).

### 3.2 One URN-minting utility, used by both directions

`packages/ddi-xml/src/urn.ts` (new): `mintUrn(agency, itemId, version)` → canonical URN;
`mapId(itemId)` → XSD-legal ID (the D4 dot-mapping, if confirmed); `parseUrn(urn)` → triple.
Export uses it everywhere `identity()` is emitted; import uses `parseUrn` to recover local ids.
The mapping must be **bijective** (e.g. `.` → `-` only if `-` never appears in our ids — verify;
otherwise use an escaping scheme) so round-trip fidelity is preserved.

### 3.3 FragmentInstance packaging as a first-class export mode

`exportDdiXml(instrument, { packaging: 'fragment' | 'instance' })` — default stays `'instance'`
(hierarchical `i:DDIInstance`, human-readable, what the designer's Export menu produces today);
`'fragment'` emits `i:FragmentInstance` with a `ddi:TopLevelReference` to the root Sequence and
one `<ddi:Fragment>` per identifiable item (each fragment self-contained with full identity +
references by URN). The designer Export menu gains a second entry ("DDI-XML (FragmentInstance,
for repositories)"). The fragment set is derivable from the same accumulation pass the exporter
already does (`ctx.qi`, `ctx.cc`, schemes) — this is a re-packaging of existing pieces, not a
second serializer. Both modes must pass the same XSD gate.

### 3.4 XSD validation is a CI gate, not a runtime feature

XSD 1.0 validation in the browser is effectively impossible (no viable pure-JS validator). It is
also not a runtime need — analysts don't validate, CI does. So:

- Vendor the official schema bundle (`DDI_3_3_2020-04-15_Documentation_XMLSchema.zip` →
  `packages/ddi-xml/schemas/3.3/`, XSDs only, with a `SOURCE.md` recording origin + date).
  License note: DDI Alliance schemas are freely redistributable; record the license text.
- New dev-dependency **`xmllint-wasm`** (libxml2 compiled to WASM — runs in Node/Vitest, no
  native binary, keeps the package's zero-*runtime*-deps property).
- New test file `xsd-validation.test.ts`: every bundled instrument × both packagings must
  validate against the vendored XSDs. This is the enumerator of remaining defects: build the
  gate FIRST, then fix `export.ts` until it is green.

### 3.5 The acceptance criterion is ddigraph ingestion, not just XSD validity

"Schema-valid" is necessary but weak — the real question is whether the expert org's pipeline
builds the right graph. Add `scripts/ddigraph-interop/` (Python, run on demand, not in CI):
`pip install` ddigraph (or clone), feed it our FragmentInstance export of `fsep` and `demo`,
assert entity counts (Instrument: 1, expected Sequence/QuestionItem/Category counts) and spot-
check node keys are the canonical URNs. Document the run in the plan's acceptance section. CI
stays pure-JS; this harness is the periodic end-to-end proof.

### 3.6 Real-file import fixtures from ddigraph's demo/

Pull `LFS.xml` / `Ireland_LabourSurvey.xml` (Git LFS — fetch via `media.githubusercontent.com`)
into `packages/ddi-xml/src/__tests__/fixtures/external/` (or keep out-of-repo + download script
if size is a concern; 14.5 MB in-repo is borderline — **decide at P4 start**, default to a
download script + `.gitignore` to respect the repo's no-large-artifacts rule). Import must
produce a usable Instrument + FidelityReport with **zero crashes and explicit fidelity notes**
for every unmapped construct. This is also a scale test: 14.5 MB through the zero-dep string
parser in Node — measure, and if it chokes, that's a P4 finding, not a P1 blocker.

## 4. What does NOT change

- The internal `instrument-schema` model stays the source of truth; runtime, designer preview,
  respondent view, Validator: untouched.
- The `mst:` extension mechanism (`<r:UserID type="mst:KEY">`) stays — `r:UserID` is legal on
  identifiable objects; P1 only fixes its *placement* per XSD order and may relocate specific
  uses to `r:UserAttributePair` where the gate demands it.
- Round-trip tests remain the fidelity contract; XSD + interop are added on top.

## 5. Phasing & acceptance criteria

**P1 — XSD gate + exporter fixes (bulk of the work).**
Vendor schemas; add `xmllint-wasm` + `xsd-validation.test.ts`; fix D1/D2/D3/D5 (and D4 if the
gate confirms it) until every bundled instrument validates in `'instance'` packaging.
*Accept when:* the XSD gate is green for all bundled instruments; existing 21 round-trip tests
still pass; `pnpm test` runs the gate by default (no separate opt-in step).

**P2 — identity model.**
`agencyId` in `InstrumentMetadata` (+ Zod, default `io.github.p3ji`), `urn.ts` minting/mapping
utility, designer settings field, both codecs consume it; `ca.statcan` swap documented.
*Accept when:* exported URNs match `urn:ddi:io\.github\.p3ji:[A-Za-z0-9\-_]+:[0-9.]+` for every
element; changing `agencyId` changes every URN and nothing else; round-trip preserves local ids
through the ID-mapping bijection.

**P3 — FragmentInstance packaging + ddigraph interop harness.**
*Accept when:* `'fragment'` output passes the XSD gate; the interop script ingests `fsep` and
`demo` exports with expected entity counts and canonical-URN node keys; result recorded in this
doc.

**P4 — real-file import.**
Download-script fixtures from ddigraph `demo/`; import runs clean with a complete
FidelityReport; parse time/memory measured and recorded.
*Accept when:* `LFS.xml` imports without crashing, every skipped construct appears as a fidelity
note (no silent drops), and at least one imported external instrument renders in the designer.

## 6. Effort notes

P1 dominates and is discovery-driven — the gate will produce the definitive punch-list within
the first hour, and the fix loop touches most emit sites in `export.ts` (625 lines). P2 is
additive with defaults (nothing existing breaks). P3 is a re-packaging of P1's pieces plus a
small Python harness. P4 depends on what the real files contain.

## 7. Questions already answered (so nobody re-asks them)

- *Disco or DDI-CDI as RDF target?* → Neither is ours to build; ddigraph converts XML→RDF. If a
  native serialization is ever wanted, DDI-CDI is their supported path (it has a `cdi_loader.py`),
  not Disco.
- *Sample agency file?* → ddigraph `demo/` (Ireland LFS instances, production scale).
- *Agency ID?* → `ca.statcan` is the real one; we use placeholder `io.github.p3ji` by config
  (§3.1) because this project does not act for the agency.

## 8. Explicit non-goals

Native JSON-LD/RDF exporter (superseded by §3.5 unless the expert later asks for DDI-CDI
output specifically); per-item independent versioning (D6 — single instrument version stamped
uniformly for now, documented); DDI-Codebook 2.x export; registering an agency with the DDI
Alliance; validating DDI *content* rules beyond XSD (e.g. controlled-vocabulary conformance).

## 9. Decision log

| Decision | Why (short) |
|---|---|
| Target = XSD-valid FragmentInstance XML, not JSON-LD | The consumer (ddigraph) does XML→RDF itself; its Lifecycle loader expects FragmentInstance |
| XSD gate in CI via xmllint-wasm, never in browser | No viable browser XSD validator; validation is a build-time concern |
| Build the gate before fixing the exporter | The gate enumerates defects definitively; fixing blind wastes effort |
| Placeholder agency `io.github.p3ji`, configurable | Not acting for StatCan; reverse-DNS of a controlled domain is the DDI convention |
| Agency swap mints new identities — by design | DDI identity is an assertion of authority; the adopting agency re-mints at intake |
| ID dot-mapping in the codec, not a repo rename | Ids are load-bearing across the whole platform; the codec boundary absorbs the difference bijectively |
| ddigraph ingestion as the acceptance test | "Their pipeline builds the correct graph" is the actual requirement; XSD validity is only a proxy |
| Real-file fixtures via download script, not committed | 14.5 MB files vs the repo's no-large-artifacts rule |
