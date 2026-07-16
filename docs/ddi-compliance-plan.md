# DDI-Lifecycle 3.3 compliance — schema-valid XML, canonical identity, ddigraph interop

*Design document. Status: **P1 DONE (2026-07-09)** — the XSD gate is live and every bundled
instrument's export validates against the official 3.3 schemas. P2–P4 not started.*

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
