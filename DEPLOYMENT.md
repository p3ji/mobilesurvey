# mobilesurvey — On-premises / Air-gapped Deployment

This guide explains how to run the full mobilesurvey stack locally or in an air-gapped environment **without Supabase**. The local backend is a lightweight Hono + Node.js server backed by SQLite (`node:sqlite`, no native binaries required).

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20 LTS or 22+ |
| pnpm | 9.x (`npm i -g pnpm@9`) |

No Docker required for a single-machine setup. A Docker Compose option is provided at the end for containerised deployments.

---

## 1. Clone & install

```bash
git clone https://github.com/p3ji/mobilesurvey.git
cd mobilesurvey
pnpm install
```

---

## 2. Start the local API (SQLite backend)

```bash
pnpm --filter @mobilesurvey/api dev
# Listens on http://localhost:8787
```

The API auto-creates a SQLite database at `apps/api/data/survey.db` on first run. It seeds demo access codes (ABC123 / DEF456) and serves all four REST resources: `/surveys`, `/sessions`, `/paradata`, `/responses`.

**Schema tables created automatically:**
- `surveys` — instrument JSON + config
- `cases` / `access_codes` — respondent case list + authentication
- `sessions` — resumable runtime state
- `paradata` — append-only respondent behaviour log
- `audit_log` — hub action trail (create/publish/delete/export)

---

## 3. Configure the apps to use the local API

By default each app auto-detects localhost and falls back to the local API when `VITE_SUPABASE_URL` is unset. No configuration is needed if you are running on `localhost`.

For a non-localhost server (e.g. a VM at `192.168.1.100`), create `.env.local` files:

**`apps/hub/.env.local`**
```
VITE_DESIGNER_URL=http://192.168.1.100:5173
VITE_RUNTIME_URL=http://192.168.1.100:5174
# Leave VITE_SUPABASE_URL unset to force the local API
```

**`apps/runtime/.env.local`** and **`apps/designer/.env.local`**
```
# No Supabase vars → runtime falls back to http://localhost:8787
```

---

## 4. Start the apps

In separate terminals (or use a process manager):

```bash
# Hub (survey management) — http://localhost:5175
pnpm --filter @mobilesurvey/hub dev

# Designer (questionnaire authoring) — http://localhost:5173
pnpm --filter @mobilesurvey/designer dev

# Runtime (respondent app) — http://localhost:5174
pnpm --filter @mobilesurvey/runtime dev
```

---

## 5. Production build (self-hosted static)

```bash
pnpm build
```

Outputs:
- `apps/hub/dist/` — hub SPA
- `apps/designer/dist/` — designer SPA
- `apps/runtime/dist/` — runtime SPA

Serve the three `dist/` directories with any static file server (nginx, Caddy, `serve`). The API must be accessible at the configured URL.

**nginx example** (single host, `/mobilesurvey/` base):

```nginx
server {
  listen 80;
  server_name survey.internal;

  location /mobilesurvey/ {
    root /var/www/hub/dist;
    try_files $uri $uri/ /index.html;
  }
  location /mobilesurvey/designer/ {
    root /var/www/designer/dist;
    try_files $uri $uri/ /index.html;
  }
  location /mobilesurvey/respondent/ {
    root /var/www/runtime/dist;
    try_files $uri $uri/ /index.html;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:8787/;
  }
}
```

---

## 6. PII & data isolation

Variables tagged `isPII: true` in the instrument schema are redacted in the **Redacted CSV** export (hub Analyzer → "↓ Redacted CSV"). Raw exports include all values.

To permanently strip PII from a SQLite database before sharing:

```bash
sqlite3 apps/api/data/survey.db \
  "UPDATE responses SET answers_json = json_patch(answers_json, '{}')"
```

(Replace with a targeted SQL update for specific variable keys in production.)

---

## 7. Audit trail

Every hub action (survey create / publish / unpublish / delete, responses export) writes a row to `audit_log`. Query it:

```bash
sqlite3 apps/api/data/survey.db \
  "SELECT datetime(ts/1000,'unixepoch'), actor, action, entity_id FROM audit_log ORDER BY ts DESC LIMIT 50"
```

---

## 8. Docker Compose (optional)

```yaml
# docker-compose.yml
services:
  api:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - .:/app
      - survey-data:/app/apps/api/data
    command: sh -c "npm i -g pnpm@9 && pnpm install && pnpm --filter @mobilesurvey/api dev"
    ports:
      - "8787:8787"

  hub:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - .:/app
    command: sh -c "pnpm --filter @mobilesurvey/hub dev --host"
    ports:
      - "5175:5175"
    depends_on: [api]

  designer:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - .:/app
    command: sh -c "pnpm --filter @mobilesurvey/designer dev --host"
    ports:
      - "5173:5173"

  runtime:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - .:/app
    command: sh -c "pnpm --filter @mobilesurvey/runtime dev --host"
    ports:
      - "5174:5174"

volumes:
  survey-data:
```

```bash
docker compose up
```

---

## 9. Supabase setup (production only)

When running against Supabase instead of the local SQLite API, apply the following policies once in the Supabase SQL editor (Dashboard → SQL Editor → New query):

```sql
-- surveys: public read so respondents can load the instrument; authenticated hub writes via RLS
alter table if exists surveys enable row level security;
create policy "anon select" on surveys for select to anon using (true);

-- responses: anonymous respondents can insert their own row
alter table if exists responses enable row level security;
create policy "anon insert" on responses for insert to anon with check (true);
create policy "anon select" on responses for select to anon using (true);

-- paradata: anonymous respondents can append events (was blocked — apply this to fix Phase 7 bug)
alter table if exists paradata enable row level security;
create policy "anon insert" on paradata for insert to anon with check (true);
create policy "anon select" on paradata for select to anon using (true);
-- Also grant sequence usage so anon INSERT can generate the auto-increment id:
grant usage, select on sequence paradata_id_seq to anon;

-- sessions: respondents read/write their own session by key
alter table if exists sessions enable row level security;
create policy "anon insert" on sessions for insert to anon with check (true);
create policy "anon update" on sessions for update to anon using (true);
create policy "anon select" on sessions for select to anon using (true);

-- audit_log: hub writes; anyone can read (non-sensitive action trail)
alter table if exists audit_log enable row level security;
create policy "anon insert" on audit_log for insert to anon with check (true);
create policy "anon select" on audit_log for select to anon using (true);
```

> **Paradata note (Phase 7 bug):** The `paradata` anon-insert policy was the missing piece causing
> `POST /paradata` → 401 in production. Applying the block above resolves it.

### 9b. Validator tables (required before using the Validator module)

The Validator hub tile (`apps/hub/src/ValidatorView.tsx` / `validatorApi.ts`) persists runs,
flags, dispositions, corrections, and analyst-authored rules to Supabase. These tables don't
exist yet in a fresh Supabase project — apply this once (Dashboard → SQL Editor → New query)
before running validation from the hub, or `executeValidationRun` will fail with a
"relation does not exist" error.

```sql
create table if not exists validation_runs (
  id text primary key,
  survey_id text not null,
  started_at timestamptz not null,
  config_json jsonb not null,
  summary_json jsonb not null
);
alter table if exists validation_runs enable row level security;
create policy "anon insert" on validation_runs for insert to anon with check (true);
create policy "anon select" on validation_runs for select to anon using (true);

create table if not exists validation_flags (
  id text primary key,
  run_id text not null,
  survey_id text not null,
  response_id text not null,
  respondent_id text not null,
  variable_name text,
  instance_key text,
  check_kind text not null,
  check_id text not null,
  severity text not null,
  message text not null,
  observed_json jsonb,
  expected text,
  suspicion double precision not null,
  impact double precision not null,
  score double precision not null,
  status text not null default 'open',
  disposition_json jsonb
);
alter table if exists validation_flags enable row level security;
create policy "anon insert" on validation_flags for insert to anon with check (true);
create policy "anon select" on validation_flags for select to anon using (true);
create policy "anon update" on validation_flags for update to anon using (true);

create table if not exists validation_corrections (
  id text primary key,
  survey_id text not null,
  response_id text not null,
  instance_key text not null,
  old_value_json jsonb,
  new_value_json jsonb,
  reason text not null,
  flag_id text,
  decided_by text not null,
  decided_at timestamptz not null
);
alter table if exists validation_corrections enable row level security;
create policy "anon insert" on validation_corrections for insert to anon with check (true);
create policy "anon select" on validation_corrections for select to anon using (true);

create table if not exists validator_rules (
  id text primary key,
  survey_id text not null,
  name text not null,
  when_expr text not null,
  message text not null,
  severity text not null,
  variable_name text,
  source text not null,
  source_flag_id text,
  active boolean not null default true,
  created_at timestamptz not null
);
alter table if exists validator_rules enable row level security;
create policy "anon insert" on validator_rules for insert to anon with check (true);
create policy "anon select" on validator_rules for select to anon using (true);
create policy "anon update" on validator_rules for update to anon using (true);

-- Suppression memory (accepted/suppressed flags shouldn't resurrect next run unless the
-- value changed). No composite primary key -- instance_key is nullable for record-level
-- flags, and Postgres disallows NULL in primary-key columns; a plain identity id plus a
-- lookup index is simpler and sufficient (duplicate rows here are harmless).
create table if not exists validation_suppressions (
  id bigint generated always as identity primary key,
  survey_id text not null,
  response_id text not null,
  check_id text not null,
  instance_key text,
  accepted_value_json jsonb,
  flag_id text not null,
  created_at timestamptz not null
);
create index if not exists validation_suppressions_lookup
  on validation_suppressions (survey_id, response_id, check_id, instance_key);
alter table if exists validation_suppressions enable row level security;
create policy "anon insert" on validation_suppressions for insert to anon with check (true);
create policy "anon select" on validation_suppressions for select to anon using (true);
```

---

## Security notes

- The public Supabase `anon` key in the bundle is a **publishable key** — it is safe to expose but grants only the permissions defined by Row Level Security (RLS) policies.
- For air-gapped deployments the local SQLite backend uses no network calls. All data stays on-disk in `apps/api/data/`.
- Never set `VITE_SUPABASE_URL` and point it to a `service_role` key.
- The `audit_log` table records who did what but does not enforce authentication — add network-level access controls (VPN, firewall rules) for sensitive deployments.
