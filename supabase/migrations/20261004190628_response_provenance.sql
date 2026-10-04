-- Nullable so submissions written before this rollout remain readable.
alter table public.responses
  add column if not exists instrument_version text,
  add column if not exists instrument_sha256 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.responses'::regclass
      and conname = 'responses_instrument_sha256_format'
  ) then
    alter table public.responses
      add constraint responses_instrument_sha256_format
      check (instrument_sha256 is null or instrument_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end
$$;
