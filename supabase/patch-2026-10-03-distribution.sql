-- Migration Patch: Survey Distribution, Email Lists & Disposition Tracking (2026-10-03)
-- Safe to run repeatedly (idempotent).

-- 1. Add anonymized setting to surveys table
alter table public.surveys
  add column if not exists anonymized boolean not null default false;

-- 2. Add email list and disposition fields to access_codes table
alter table public.access_codes
  add column if not exists email text,
  add column if not exists status text not null default 'ready',
  add column if not exists sent_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Add check constraint for status if not exists
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'access_codes_status_check'
  ) then
    alter table public.access_codes
      add constraint access_codes_status_check
      check (status in ('ready', 'sent', 'started', 'completed'));
  end if;
end $$;

-- 3. Ensure DELETE policy on access_codes for anon role
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'access_codes' and policyname = 'access_codes_delete'
  ) then
    create policy "access_codes_delete" on public.access_codes for delete using (true);
  end if;
end $$;

-- 4. Explicit grants for anon role
grant select, insert, update, delete on public.access_codes to anon;
grant select, insert, update on public.surveys to anon;

-- 5. Helpful indexes for disposition queries
create index if not exists access_codes_survey_id_idx on public.access_codes (survey_id);
create index if not exists access_codes_survey_status_idx on public.access_codes (survey_id, status);
create index if not exists access_codes_email_idx on public.access_codes (survey_id, email);
