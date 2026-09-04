---
name: ddi-lifecycle
description: Use when editing DDI XML, URNs, or JSON-LD.
user-invocable: false
metadata:
  internal: true
---

- **Phase 15 DONE (2026-07-17, +P5 2026-07-20): DDI-Lifecycle 3.3 compliance** (`packages/ddi-xml`; full design, P1 findings and P2–P5 results in `docs/ddi-compliance-plan.md`). XSD gate against vendored official 3.3 schemas runs in `pnpm test`; canonical URNs under configurable `agencyId` (`InstrumentMetadata`, designer root-sequence Inspector; unset ≡ placeholder `io.github.p3ji` — **never hardcode `ca.statcan`**); `exportDdiXml(instrument, {packaging: 'fragment'|'instance'})` both schema-valid, fragment mode is Colectica-style (schemes reference children — fragment consumers never recurse into inline children); ddigraph 0.4.2 ingests our exports with correct graphs (`scripts/ddigraph-interop/`, on-demand, results in its README); real Colectica Ireland-LFS files (14.5–66 MB) import clean with complete fidelity notes (`fixtures/external/fetch.mjs` downloads them; never committed; `external-import.test.ts` skips when absent).
  - **P5 (reviewer feedback):** URN identity defaults to **UUIDv5** derived from the internal id (`idScheme: 'uuid' | 'readable'`) — matches the Colectica/DDI-repository convention and retires the dot-escaping workaround (UUIDs have no dots, so the defective `BaseIDType` post-dot class is never hit). Round-trip relies on the `mst:id` extension + a UUID→id alias map, not on the URN being invertible. **`exportJsonLd`** emits a FAIR JSON-LD `@graph` (disco/SKOS/DCTerms + explicit `mst:` for un-standardized terms) whose `@id`s are the *same* URNs as the XML.
  - Still open (future work): faithful `d:QuestionGrid` mapping for the establishment `table` domain (currently projects to TextDomain natively + authoritative `mst:rd` JSON).
