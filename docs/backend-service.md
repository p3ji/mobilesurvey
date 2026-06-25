# Backend Service (`apps/api`)

The backend turns the mocked integration seams into a real service. It implements the four
interfaces from `@mobilesurvey/runtime-engine` (`CmsClient`, `SessionStore`, `ParadataSink`,
`SampleProvider`) as a small HTTP API over SQLite. The respondent runtime app talks to it via
`fetch`; when it's unreachable the app falls back to local mocks, so the static demo still works.

> This is the "real backend" milestone in the product roadmap (authoring tool → runtime app →
> **backend** → metadata registry). It is separate from
> [phase3-components.md](phase3-components.md), which documents the designer's UI component
> framework.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node + TypeScript (`tsx` in dev) | Matches the rest of the monorepo. |
| HTTP framework | [Hono](https://hono.dev) + `@hono/node-server` | Tiny, TS-first, minimal ceremony for a JSON API. |
| Datastore | **SQLite via Node's built-in `node:sqlite`** | File-based, zero-config, real SQL. Chosen over the `better-sqlite3` native addon because it needs no C++ build toolchain (the addon has no prebuilt binary for Node 24, and this box has no MSVC). The API style (`DatabaseSync.prepare/run/get/all`) is close to better-sqlite3, so it can be swapped later. |
| Validation | Zod | Request-body validation. |

## Data model

```
cases        (id, fields_json, status)              -- one row per sample unit / case
access_codes (code, case_id → cases.id)             -- respondent authentication
sessions     (key, state_json, updated_at)          -- resumable runtime state
paradata     (id, session_key, ts, type, payload_json)  -- append-only behaviour trail
```

`session` / `paradata` keys are `${instrumentId}::${caseId}` and contain `:` and `/`, so they are
passed as query params / body fields, never as path segments.

The DB file defaults to `apps/api/data/app.db` (git-ignored) and is **seeded** on first run with
two demo cases and their access codes (`ABC123` → Jordan Lee, `DEF456` → Marie Tremblay).

## Endpoints

| Method & path | Interface method | Notes |
| --- | --- | --- |
| `GET /api/health` | — | Liveness probe used by the client's fallback logic. |
| `POST /api/access/resolve` | `CmsClient.resolveAccessCode` | Body `{ accessCode }` → `{ caseId, sample }` or `404`. Code match is case-insensitive. |
| `POST /api/cases/:caseId/status` | `CmsClient.reportStatus` | Body `{ status }` → `204`. |
| `GET /api/session?key=…` | `SessionStore.load` | → `{ state }` (or `{ state: null }`). |
| `PUT /api/session` | `SessionStore.save` | Body `{ key, state }` → `204`. |
| `DELETE /api/session?key=…` | `SessionStore.clear` | → `204`. |
| `POST /api/paradata` | `ParadataSink.emit` | Body `{ key?, event }` → `204`. |
| `GET /api/paradata?key=…` | — | → `{ events }` (for the demo analytics view). |
| `GET /api/samples`, `GET /api/samples/:id` | `SampleProvider` | Sample units. |

CORS is open in development (no cookies/credentials are used).

## How the runtime app uses it

`apps/runtime/src/integrations/api.ts` provides `fetch`-based implementations of the three
interfaces the app needs, plus `createBackend()`:

1. On startup the app calls `createBackend()`, which probes `GET /api/health` (1.5 s timeout).
2. **Reachable** → API-backed clients; the access screen shows *“● Connected to the survey
   service.”* Sessions and paradata persist server-side, so a respondent can **resume on another
   device/browser**.
3. **Unreachable** (e.g. the GitHub Pages demo, or the server is down) → the local mocks
   (`localStorage` session store, in-memory CMS/paradata); the access screen shows *“● Offline —
   progress saved on this device.”*

The base URL is `http://localhost:8787`, overridable with `VITE_API_URL`.

## Run

```bash
pnpm --filter @mobilesurvey/api dev        # http://localhost:8787   (creates apps/api/data/app.db)
pnpm --filter @mobilesurvey/runtime dev    # http://localhost:5174   (auto-connects if the API is up)
```

## Still owed (production hardening)

- **Encryption at rest** for session state, and **TLS** in transit (the spec's "encrypted
  real-time caching"). The store currently holds plaintext JSON in SQLite.
- **Access-code lifecycle**: single/multi-use enforcement, expiry, rate limiting, audit.
- **AuthN/Z** for the operator/admin endpoints (status, paradata, samples).
- **Sample ingestion** from real files, and a **paradata analytics** view/dashboard.
- **Migrations** and a deployment target (containerised; a managed SQLite/Postgres for scale).
