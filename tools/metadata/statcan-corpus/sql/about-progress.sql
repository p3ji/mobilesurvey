-- A small public readout for the About page. Count survey programs, not delivery groups or
-- document copies; the full local inventory contains 113 programs. Only published, verified
-- links count. Re-running this function is safe as the background reviewer publishes more links.
create or replace function corpus_about_progress()
returns table (verified_links bigint, linked_programs bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::bigint,
         count(distinct coalesce(nullif(v.survey_acronym, ''), split_part(e.survey_group, '_', 1)))::bigint
    from corpus_derivation_edge e
    join corpus_variable v on v.record_id = e.target_record_id
   where e.review_status = 'verified';
$$;

revoke execute on function corpus_about_progress() from public, authenticated;
grant execute on function corpus_about_progress() to anon;
