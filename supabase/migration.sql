-- mobilesurvey — Supabase schema migration
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run)

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists public.surveys (
  id                   text        primary key,
  title                text        not null,
  instrument_json      jsonb       not null,
  requires_access_code boolean     not null default true,
  status               text        not null default 'draft'
                         check (status in ('draft', 'published')),
  question_count       integer     not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Submitted survey responses (one row per completed submission)
create table if not exists public.responses (
  id                   text        primary key default gen_random_uuid()::text,
  survey_id            text        not null references public.surveys(id) on delete cascade,
  respondent_id        text        not null,
  submitted_at         timestamptz not null default now(),
  started_at           timestamptz,
  duration_ms          integer,
  answers_json         jsonb       not null default '{}',
  page_count_reached   integer     not null default 0,
  total_pages          integer     not null default 0,
  completed            boolean     not null default true
);

-- Resumable in-progress sessions
create table if not exists public.sessions (
  key                  text        primary key,   -- "<survey_id>::<respondent_id>"
  survey_id            text        references public.surveys(id) on delete cascade,
  state_json           jsonb       not null,
  updated_at           timestamptz not null default now()
);

-- Append-only respondent behaviour audit trail
create table if not exists public.paradata (
  id                   bigserial   primary key,
  session_key          text,
  survey_id            text        references public.surveys(id) on delete set null,
  respondent_id        text,
  ts                   timestamptz not null,
  type                 text        not null,
  payload_json         jsonb
);

-- Access codes for code-gated surveys
create table if not exists public.access_codes (
  code                 text        primary key,
  survey_id            text        not null references public.surveys(id) on delete cascade,
  respondent_name      text,
  respondent_fields_json jsonb     not null default '{}',
  used_at              timestamptz
);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Prototype: anon key has full access. Tighten with Auth in production.

alter table public.surveys       enable row level security;
alter table public.responses     enable row level security;
alter table public.sessions      enable row level security;
alter table public.paradata      enable row level security;
alter table public.access_codes  enable row level security;

-- surveys: public read/write (prototype)
create policy "surveys_select" on public.surveys for select using (true);
create policy "surveys_insert" on public.surveys for insert with check (true);
create policy "surveys_update" on public.surveys for update using (true);
create policy "surveys_delete" on public.surveys for delete using (true);

-- responses: anyone can insert; anyone can read (tighten to auth'd users in prod)
create policy "responses_insert" on public.responses for insert with check (true);
create policy "responses_select" on public.responses for select using (true);

-- sessions: open (keyed by unguessable session key)
create policy "sessions_all"    on public.sessions    for all    using (true);

-- paradata: append-only for respondents; readable for admin
create policy "paradata_insert" on public.paradata    for insert with check (true);
create policy "paradata_select" on public.paradata    for select using (true);

-- access codes: read + update (mark used) + insert
create policy "access_codes_select" on public.access_codes for select using (true);
create policy "access_codes_update" on public.access_codes for update using (true);
create policy "access_codes_insert" on public.access_codes for insert with check (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists responses_survey_id_idx  on public.responses (survey_id);
create index if not exists responses_submitted_idx  on public.responses (submitted_at desc);
create index if not exists paradata_session_key_idx on public.paradata  (session_key);
create index if not exists paradata_survey_id_idx   on public.paradata  (survey_id);
