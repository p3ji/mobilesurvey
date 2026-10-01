-- Hydrate full variable records by record_id in one batched call.
-- Used by semantic search ("Related by meaning") to hydrate Qdrant vector results from Supabase.
drop function if exists corpus_get_variables(uuid[]);

create or replace function corpus_get_variables(p_record_ids uuid[])
returns table (
  record_id uuid,
  name text,
  "position" text,
  "length" text,
  concept text,
  question_text text,
  universe text,
  note text,
  codes jsonb,
  code_count integer,
  bundle text,
  path text,
  page integer,
  tcode text,
  survey_group text,
  survey_acronym text,
  cycle text,
  year integer,
  lang text,
  rank real,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select v.record_id,
         v.name,
         v.position,
         v.length,
         v.concept,
         v.question_text,
         v.universe,
         v.note,
         v.codes,
         v.code_count,
         v.bundle,
         v.path,
         v.page,
         v.tcode,
         v.survey_group,
         v.survey_acronym,
         v.cycle,
         v.year,
         v.lang,
         1.0::real as rank,
         count(*) over() as total_count
    from corpus_variable v
   where v.record_id = any(p_record_ids);
$$;

revoke execute on function corpus_get_variables(uuid[]) from public, authenticated;
grant execute on function corpus_get_variables(uuid[]) to anon;
