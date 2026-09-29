-- A small, global daily ceiling on public AI query expansion calls. Only the Edge Function's
-- server-side key can claim a call; neither the browser nor anon can read or change the counter.
create table if not exists corpus_ai_search_quota (
  day date primary key,
  calls integer not null check (calls >= 0)
);
alter table corpus_ai_search_quota enable row level security;
grant select, insert, update on corpus_ai_search_quota to service_role;

create or replace function corpus_claim_ai_search(p_daily_limit integer default 200)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  claimed boolean;
begin
  if p_daily_limit < 1 or p_daily_limit > 1000 then
    raise exception 'Invalid daily AI search limit';
  end if;

  insert into corpus_ai_search_quota (day, calls)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update
    set calls = corpus_ai_search_quota.calls + 1
    where corpus_ai_search_quota.calls < p_daily_limit
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function corpus_claim_ai_search(integer) from public, anon, authenticated;
grant execute on function corpus_claim_ai_search(integer) to service_role;
