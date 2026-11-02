# @mobilesurvey/statcan-assistant

> Natural language data assistant for official Statistics Canada data, with sourced answers, charts, filterable tables, and CSV downloads.

Built as a platform tool within `mobilesurvey`, reverse-engineered from the proven architecture of [eurostat-assistant](https://github.com/ainergy-hub/eurostat-assistant).

## Architecture

The assistant implements a deterministic 4-stage bounded workflow:

1. **`search_statcan`**: Fast keyword discovery against cached `getAllCubesListLite` catalogue.
2. **`inspect_dimensions`**: Dimension and codelist introspection via `getCubeMetadata` without fetching observations.
3. **`fetch_statcan`**: Coordinate-sliced table observation retrieval via `getDataFromCubePidCoordAndLatestNPeriods`, with Cartesian cell validation (capped at 50,000 cells).
4. **`publish_result`**: Analytical Vega-Lite chart selection (trend, comparison, scatter, distribution) and table projection with CSV download.

## Quick Start

```bash
# From repository root
pnpm --filter @mobilesurvey/statcan-assistant dev
```

Open `http://localhost:5178`.

## Documentation

All architectural plans, transition specifications, and roadmaps are organized in the [`docs/`](./docs/) subfolder (and mirrored in repository-level [`docs/statcan-assistant/`](../../docs/statcan-assistant/)):

* [**Transition Plan**](./docs/TRANSITION_PLAN.md): Detailed component mapping from Eurostat Assistant to StatCan Assistant.
* [**Roadmap**](./docs/ROADMAP.md): Detailed phases for coordinate compilation, ReAct agent loop, caching, and prompt regression testing.
* [**Audit & Design Decisions**](./docs/AUDIT_AND_DESIGN_DECISIONS.md): Architectural, UX, subject-matter, and researcher audit incorporating WatSPEED Remine innovations (Gate 0, Zero-Numeral Contract).
