# StatCan Assistant: Architecture Audit & Design Decisions

This document records the four-perspective audit (Architecture, UX, Subject Matter, Researcher) and the design choices integrating the proven patterns of [eurostat-assistant](https://github.com/ainergy-hub/eurostat-assistant) and [WatSPEED Remine](../../../watspeed/WatSPEED-Project-Concept-Remine.md).

---

## 1. Monorepo Integration Choice

* **Chosen Location**: `platform/statcan-assistant` in `@mobilesurvey`.
* **Rationale**:
  * Inherits the monorepo's shared TypeScript setup, package manager (`pnpm`), Vite ecosystem, and Vitest test runners.
  * Direct adjacency to `@mobilesurvey/statcan-corpus` (~195,000 normalized Statistics Canada survey variables and data dictionaries).
  * Avoids repository proliferation while keeping the tool decoupled from survey authoring internals (`designer`).
  * Conforms to `platform/` status alongside `platform/hub` and `platform/api`.

---

## 2. Technology Stack Selection: Node/TypeScript vs. Python vs. Raw MCP

* **Chosen Engine**: Node/TypeScript-native WDS API client and agent runtime.
* **Why not Python / FastAPI?**:
  * Avoids multi-runtime container complexity (`pnpm` + `uv`/Python).
  * Direct asynchronous streaming via standard Fetch and Server-Sent Events (SSE).
* **Why not pure `statcan_mcp`?**:
  * `mcp-statcan` bulk vector endpoints suffer from documented HTTP 404/406 failures.
  * Unbounded tool outputs flood the LLM context window with 10,000+ line codelists.
  * Raw MCP tools lack pre-flight Cartesian product estimation ($\le 50,000$ cells).
  * Terminal approval prompts stall in embedded web environments.

---

## 3. Four-Perspective Audit Findings

### Architecture
* **Challenge**: LLMs generating prose freehand hallucinate numbers and confuse growth rates with percentage points.
* **Solution**: Transfuse Eurostat Assistant's shell with **Remine's Zero-Numeral Contract** (`checkBareNumerals`) and **Gate 0 Code Bouncer** (`gateZeroFilter`).

### UX (User Experience)
* **Challenge**: General chat interfaces bury data provenance and hide critical statistical units.
* **Solution**: Split-pane layout with an interactive Vega-Lite visualizer, sortable table, CSV export, and a dedicated **Academic Citation & Provenance Card** displaying exact Table PIDs, Coordinates, Vector IDs, and extraction timestamps.

### Subject Matter (Statistics Canada Specifics)
* **Challenge**: StatCan data contains subtle traps: suppressed cells (`F`), high sampling variability (`E`), and seasonal adjustment mismatches (`Seasonally adjusted` vs `Unadjusted`).
* **Solution**: Gate 0 pre-filter intercepts `F` and `x` symbols, prevents corrupted chart spikes, humanizes scalar factors (e.g., Code `3` = Thousands), and badges data quality symbols (`A`–`F`) in the UI.

### User (Researcher) Perspective
* **Challenge**: Researchers need defensible ground truth, auditability, and speed to analysis.
* **Solution**: Clean unformatted numerical exports for pandas/R/DuckDB, automated survey universe documentation, and token-bound verifiable fact references.
