# mobilesurvey — Load Test Plan (10k Concurrent Respondents)

> Documents *how* to run the load test committed in `docs/enterprise-adoption-plan.md` Phase 8 —
> not a report of results. No load test has been run against production. This doc exists so the
> work is scoped and repeatable, not ad hoc, when someone with access to a non-prod Supabase
> project picks it up.

## Why this can't be done from a coding session alone

The respondent write path in production is **browser → Supabase REST**, not our code — there's no
server-side handler in this repo to benchmark. A real 10k-concurrent test has to point traffic at
an actual Supabase project and observe how *Supabase's* managed Postgres, connection pooler, and
RLS policy evaluation hold up. Two things block running that from here:

1. **No non-prod Supabase project.** Load-testing the real `VITE_SUPABASE_URL` would write ~10k
   synthetic sessions/responses/paradata rows into the same project the public demo uses, and can
   trip Supabase-side rate limiting or resource caps that affect real visitors mid-test. This needs
   a dedicated staging project (or a temporarily-provisioned one) with its own anon key — a
   provisioning decision, not a code change.
2. **Local `apps/api` (`node:sqlite`) is a different system.** It's a single-process dev fallback
   with no connection pool, no RLS, no network hop to a managed DB. Load-testing it tells you the
   ceiling of a single Node process on `node:sqlite`, not how Supabase's REST layer + RLS + pooler
   behaves under load — the two have different bottleneck shapes, so local numbers wouldn't answer
   the client's actual question.

Both are within reach given a staging project, and the harness below is designed to hit either
target unchanged (just swap `BASE_URL` / `SUPABASE_URL`).

## Target scenario

Model **10,000 concurrent respondents** taking the `demo` survey simultaneously, exercising the
same write path a real deployment would see:

| Step | Endpoint / call | Frequency |
|---|---|---|
| Load survey definition | `GET` survey row (Supabase REST) or CDN-cached static bundle | 1× per respondent |
| Create session | `POST` to `sessions` (upsert on `(survey_id, respondent_id)`) | 1× per respondent |
| Submit each answer | `POST`/`PATCH` to `responses` | ~15–20× per respondent (per question) |
| Emit paradata events | `POST` to `paradata` | ~30–50× per respondent (page view, focus, blur, submit) |
| Resume (subset) | `GET` session + responses by respondent id | ~10% of respondents, simulating reload |

Ramp profile: 0 → 10,000 virtual users over 5 minutes, hold for 10 minutes, ramp down — rather than
an instant spike, to match how real fielding traffic actually arrives (a distributed link send, not
a synchronized burst).

## Tooling

**k6** (as named in the Phase 8 plan) — scriptable in JS, has a Supabase-friendly HTTP client, and
its ramping-VUs executor matches the ramp profile above. Sketch:

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    respondents: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 10000 },
        { duration: '10m', target: 10000 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const respondentId = `loadtest-${__VU}-${__ITER}`;
  const session = http.post(`${SUPABASE_URL}/rest/v1/sessions`, JSON.stringify({
    survey_id: 'demo', respondent_id: respondentId,
  }), { headers });
  check(session, { 'session created': (r) => r.status === 201 || r.status === 200 });

  for (let q = 0; q < 18; q++) {
    http.post(`${SUPABASE_URL}/rest/v1/responses`, JSON.stringify({
      survey_id: 'demo', respondent_id: respondentId, variable: `q${q}`, value: 'sample',
    }), { headers });
    http.post(`${SUPABASE_URL}/rest/v1/paradata`, JSON.stringify({
      survey_id: 'demo', respondent_id: respondentId, type: 'answer', payload: { q },
    }), { headers });
    sleep(Math.random() * 2); // simulate reading/answering time, not a hammer test
  }
}
```

This is a starting sketch, not a finished script — it needs real variable names/value shapes pulled
from the `demo` instrument (`packages/instrument-schema`) and a teardown step that deletes the
synthetic rows (`respondent_id` prefix `loadtest-`) after each run so staging doesn't accumulate
junk.

## What to capture

- **Throughput** at each ramp stage (requests/sec actually sustained vs. offered).
- **Latency** p50/p95/p99 per endpoint (`sessions`, `responses`, `paradata` — they likely have very
  different profiles; `paradata` is highest-volume and RLS-gated).
- **Error rate** and error *type* (timeout vs. 429 rate-limit vs. 5xx vs. RLS-denied 401/403).
- **Where it breaks first** — the honest deliverable. Candidates worth watching specifically:
  - Supabase connection-pooler saturation (PgBouncer transaction-mode limits).
  - `paradata_id_seq` contention (a single auto-increment sequence under heavy concurrent INSERT —
    already a known friction point from the earlier RLS/sequence-permission bug in `AGENTS.md`).
  - Anon-key rate limiting at the Supabase project tier.
  - Client-side: nothing, since this targets the API directly and bypasses the SPA — a *separate*
    front-end load test (e.g. against the GitHub Pages CDN) would be a different, much less
    interesting test, since static asset serving scales trivially via CDN.

## Prerequisites before this can run

1. A Supabase project to target that is **not** the public demo project — either a dedicated
   staging project or a time-boxed clone, with its own `SUPABASE_URL`/anon key supplied via env
   var, never committed.
2. A k6 install (or k6 Cloud account) with enough egress capacity to actually generate 10k
   concurrent VUs — a laptop/CI runner may itself be the bottleneck before Supabase is, so the load
   generator should run from a cloud VM or k6 Cloud, not a local machine.
3. Agreement on acceptable synthetic-data pollution and a cleanup step (see teardown note above).

## Status

Not run. This plan is what Phase 8 of `docs/enterprise-adoption-plan.md` refers to as "a k6 harness
modelling 10k concurrent respondents against the prod write path; published numbers with the
bottleneck analysis" — the harness sketch and prerequisites are documented here; execution needs a
staging Supabase project, which is a provisioning/credentials decision outside this session's scope.
