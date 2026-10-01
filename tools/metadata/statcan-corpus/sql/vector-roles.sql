-- Keep Qdrant role payloads identical to the Searcher's SQL role filter.
-- Apply after search-performance.sql. The vector importer requests batches of IDs.
create or replace function corpus_vector_roles(p_record_ids uuid[])
returns table (record_id uuid, role text)
language sql
stable
security invoker
set search_path = public
as $$
  select v.record_id,
         corpus_variable_role(v.name, v.concept, v.note, v.survey_group) as role
    from corpus_variable v
   where v.record_id = any(p_record_ids);
$$;

revoke execute on function corpus_vector_roles(uuid[]) from public, authenticated;
grant execute on function corpus_vector_roles(uuid[]) to anon;
