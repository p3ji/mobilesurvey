# Eurostat Assistant to StatCan Assistant: Transition Plan

This plan documents how components from [eurostat-assistant](https://github.com/ainergy-hub/eurostat-assistant) are applied and adapted to create the Statistics Canada Assistant (`@mobilesurvey/statcan-assistant`).

---

## 1. Component Transition Mapping

| Eurostat Assistant Component | StatCan Assistant Equivalent | Porting Strategy | Status |
| :--- | :--- | :--- | :--- |
| **Frontend UI Layout & Panels** (`frontend/static/`) | `platform/statcan-assistant/index.html` + `src/main.ts` | Direct port from vanilla JS/CSS to Vite/TypeScript in `mobilesurvey`. | **Scaffolded** |
| **Vega-Lite Specification Generator** (`backend/app/agent_results.py`) | `src/charts/chart-spec.ts` | Ported the exact chart matrix (`trend`, `comparison`, `scatter`, `composition`) and zero-eval Vega rules to TypeScript. | **Ported** |
| **Catalogue Search** (`eurostat_api.py: search`) | `src/engine/statcan-wds.ts: search` | Replaced Eurostat TOC TSV with StatCan WDS `getAllCubesListLite`, matching titles and product IDs with token stemming. | **Ported** |
| **Dimension Introspection** (`eurostat_api.py: dimensions`) | `src/engine/statcan-wds.ts: inspectDimensions` | Replaced SDMX Dataflow/Constraint XML with StatCan WDS `getCubeMetadata` (`dimensionId`, `memberId`, position). | **Ported** |
| **Observation Fetching & Slicing** (`eurostat_api.py: fetch`) | `src/engine/statcan-wds.ts: fetchSlice` | Replaced Eurostat Statistics API / JSON-stat with StatCan `getDataFromCubePidCoordAndLatestNPeriods`. | **Ported** |
| **Pre-Flight Cell Estimation** (`agent_tools.py: validate_fetch_arguments`) | `src/agent/agent-tools.ts: validateCellEstimate` | Same Cartesian product formula $\prod \text{cardinality}(\text{dim}_i) \le 50,000$. | **Ported** |
| **Table Projection & CSV Export** (`frontend/static/csv.js`) | `src/main.ts: downloadBtn` | Clean CSV serialization with escaped headers and missing-value (`null`/`—`) handling. | **Ported** |
| **Local Session State** (`chat_state.js`, `chat_store.js`) | Client-side IndexedDB persistence | Can reuse the exact schema (investigations, messages, results). | **Roadmap** |
| **ReAct Streaming Engine** (`backend/app/sandbox_agent.py`) | TypeScript Agent Runner | Event-streamed tool calls with LLM function calling. | **Roadmap** |

---

## 2. Structural & Architectural Comparison

### Eurostat (SDMX / JSON-stat)
* Datasets are identified by alphanumeric codes (e.g. `demo_pjan`, `prc_hicp_midx`).
* Querying uses repeated key-value query parameters (e.g. `geo=DE,FR&sex=T&age=TOTAL`).
* Responses return multi-dimensional arrays unrolled by linear index modulo arithmetic.

### Statistics Canada (WDS / CANSIM)
* Datasets are identified by 8-digit or 10-digit Product IDs (e.g. `14100287` for Labour Force Characteristics).
* Querying uses **dot-separated coordinate strings** matching dimension sequence numbers (e.g. `1.1.1.1.0.0.0.0.0.0`), where `0` means all members in that dimension.
* Responses return vector observation arrays (`vectorDataPoint`) containing reference period (`refPer`), numeric value, and quality symbols (`A`, `B`, `E`, `F`).

---

## 3. Key Safeguards Retained

1. **Deterministic Coordinate Compilation**: The LLM specifies dimension member names; the engine resolves them to exact member IDs and compiles the coordinate string. The LLM never hallucinates raw coordinate numbers.
2. **Strict Cell Caps**: Slices exceeding 50,000 cells are rejected before network requests are dispatched, preventing WDS 504 timeouts.
3. **Zero-Eval Rendering**: Visualizations use declarative Vega-Lite JSON specs evaluated without dynamic `eval()`, adhering to strict Content Security Policies.
