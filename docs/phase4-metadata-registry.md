# Phase 4 — Metadata Registry & Semantic Search

> **Status:** design (not yet built). Scheduled after the Phase 2 runtime app and Phase 3 backend.
> This document captures the data model and search architecture so that components authored from
> now on can be tagged for discovery.

## Goal

A **metadata registry** that catalogs reusable survey components — whole instruments down to
individual code lists — and makes them **discoverable** and **re-usable** across surveys and
organizations. Discovery must tolerate non-exact queries (searching "job" should surface
"employment", "occupation", "labour force status"), so the registry includes **semantic search**.

Two hard constraints shape the design:

1. **No external API** (for now). Search must run with no API key and no server round-trip. An
   optional LLM-assisted layer is a *later* addition that reuses the same index.
2. **Portable / self-hostable.** GitHub hosts the prototype registry, but the entire registry —
   catalog + search index + UI — must be downloadable as a self-contained bundle an organization
   can drop onto its own static hosting (cloud bucket, intranet, air-gapped environment).

## What gets cataloged — the *Component* abstraction

Every reusable unit becomes a registry **entry**, at several granularities. Not every source will
populate every field; the indexer captures as much DDI metadata as is present and leaves the rest
empty.

| Component type | DDI element | Typical reuse |
| --- | --- | --- |
| Instrument | StudyUnit / Instrument | Fork a whole survey |
| Section / Sequence | Sequence (ControlConstruct) | Reuse a question block |
| Page / EQ screen | *(non-DDI)* | Reuse a screen + its on-screen flow |
| Question item | QuestionConstruct / QuestionItem | Reuse a vetted question |
| Variable | Variable | Harmonize a measure |
| ResponseDomain / CategoryScheme | CodeList / CategoryScheme | **Highest reuse — shared code lists** |
| Concept | Concept | Conceptual harmonization |
| Universe | Universe | Population definitions |
| EditRule | *(maps to DDI ComputationItem / instructions)* | Reuse validation logic |

## Metadata per entry

Three groups of fields. The DDI group mirrors the standard; the registry and EQ groups are the
**non-DDI** additions you called out.

```ts
interface RegistryEntry {
  // ── identity ──────────────────────────────────────────────
  entryId: string;                 // registry-local id
  componentType: ComponentType;    // 'instrument' | 'section' | 'page' | 'question' | …
  payload: unknown;                // the actual DDI fragment (an Instrument, a QuestionConstruct, a CategoryScheme, …)

  // ── DDI-aligned (capture as much as exists) ───────────────
  ddi: {
    urn?: string;                  // canonical DDI URN
    agency?: string;
    version?: string;
    label?: Record<string, string>;        // multilingual
    description?: Record<string, string>;  // multilingual
    conceptRef?: string;
    universeRef?: string;
    keywords?: string[];
    ddiElementType?: string;       // e.g. 'QuestionItem', 'CodeList'
  };

  // ── registry / discovery (non-DDI) ────────────────────────
  registry: {
    tags: string[];
    provenance?: string;           // source instrument URN this was lifted from
    usageCount: number;            // how many instruments reference it
    license?: string;
    usageRights?: string;
    deprecated?: boolean;
    lastUpdated: string;           // ISO date
    embedding?: Int8Array;         // precomputed, quantized — see Semantic search
  };

  // ── EQ-specific (non-DDI) ─────────────────────────────────
  eq?: {
    flowTarget: 'question' | 'screen';   // routes to a construct vs. a page-screen
    screenRouting?: ScreenRoute[];       // page-level next/skip logic
    deviceHints?: string[];              // mobile/desktop layout notes
    a11yAnnotations?: Record<string, string>;
  };
}
```

### The `flowTarget` distinction (non-DDI, deliberate)

DDI control constructs route between **constructs** (question → question). An electronic
questionnaire routes between **screens/pages** (a page break can group several questions onto one
screen, and "next" advances the *screen*, not the construct). The schema already models this with
`isPage: true` on sequences; the registry promotes screen-level flow to a first-class metadata
field (`eq.flowTarget` + `eq.screenRouting`) so a reused page carries its screen-flow intent, not
just its DDI construct tree.

## Semantic search — no external API

The design that satisfies "no API now, LLM later" is a **small local sentence-embedding model via
[`transformers.js`](https://github.com/xenova/transformers.js)** (e.g. `all-MiniLM-L6-v2`,
~25 MB quantized), running entirely in the browser / Node — no key, no server.

**Build / index time**
1. For each entry, concatenate `label + description + keywords + tags`.
2. Embed it once → a 384-dim vector.
3. Quantize to `int8` (~0.4 KB/entry) and store the vector **inside the catalog JSON**.

**Search time**
1. Embed only the *query* in-browser (the model is downloaded/cached once, lazily).
2. Cosine-similarity the query vector against the stored entry vectors.
3. Rank; fuzzy/conceptual matches surface without exact keyword overlap.

**Instant fallback**
- A lexical index (Fuse.js / BM25) answers immediately while the embedding model lazy-loads, then
  results are re-ranked once the semantic scores are available. Search is never blocked on a model
  download.

**Future LLM layer (deferred)**
- Natural-language query understanding, "find me a question *like* X but for Y population",
  and synthesis of new components — all sit on top of the *same* embeddings, so no rework.

## Portability

The registry ships as a **self-contained static bundle**:

```
registry-bundle/
  catalog.json        # all entries + quantized embeddings
  index.lexical.json  # prebuilt Fuse/BM25 index
  model/              # (optional) cached transformers.js model weights
  ui/                 # client-side search app (static)
```

- **Prototype:** the bundle lives in this GitHub repo and is served via GitHub Pages.
- **Self-host:** an organization downloads the bundle and drops it on any static host — cloud
  bucket, intranet, air-gapped box. No server, no API key. Bundling the model weights makes it
  fully offline.

## Package & UI placement

```
packages/metadata-registry   schema for RegistryEntry + the indexer (embed, quantize, build bundle)
                             + the search runtime (cosine + lexical fallback)
apps/registry  (or a tab)    static search/browse UI; "Insert into current instrument" hands a
                             payload back to the designer
```

The indexer reuses `instrument-schema` to walk instruments and extract DDI fields, so the registry
never re-implements the schema — it indexes it.

## How this touches earlier phases

- **Now (no build yet):** keep authoring components with rich `label`, `description`, `keywords`,
  and `concept` references — these become the embedding text. Good metadata hygiene during Phases
  2–3 makes Phase 4 indexing high-quality for free.
- **Designer integration:** an "Add from registry" action in the Structure tree, and a "Publish to
  registry" action that lifts a selected construct into a `RegistryEntry`.

## What is deferred within Phase 4

- LLM-assisted query understanding and component synthesis (reuses the embeddings).
- Cross-organization federation / shared remote registries.
- Provenance/lineage graph visualization and harmonization tooling.
