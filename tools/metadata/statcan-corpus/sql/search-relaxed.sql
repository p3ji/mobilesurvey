-- A bounded two-term fallback for plain multiword queries that have zero strict hits.
-- Apply after search-performance.sql. The client calls this only after corpus_search returns zero.
create or replace function corpus_search_relaxed(
  q               text,
  lang_filter     text    default null,
  survey_filter   text    default null,
  year_min        integer default null,
  year_max        integer default null,
  require_codes   boolean default null,
  max_rows        integer default 50,
  row_offset      integer default 0,
  subject_filter  text    default null,
  role_filter     text    default null,
  hide_process    boolean default false,
  sort_mode       text    default 'relevance'
)
returns table (
  record_id       uuid,
  name            text,
  "position"      text,
  "length"        text,
  concept         text,
  question_text   text,
  universe        text,
  note            text,
  codes           jsonb,
  code_count      integer,
  bundle          text,
  path            text,
  page            integer,
  tcode           text,
  survey_group    text,
  survey_acronym  text,
  cycle           text,
  year            integer,
  lang            text,
  rank            real,
  total_count     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with tokens as (
    select distinct plainto_tsquery('english', token) as term
      from regexp_split_to_table(lower(btrim(q)), '[[:space:]]+') as token
     where length(q) <= 120
       and q ~ '^[[:alnum:] ]+$'
       and length(token) >= 2
       and numnode(plainto_tsquery('english', token)) = 1
  ),
  pair_query as (
    select case when count(distinct term) between 3 and 6
           then (select string_agg('(' || a.term::text || ' & ' || b.term::text || ')', ' | ')::tsquery
                   from tokens a join tokens b on a.term::text < b.term::text)
           else null::tsquery end as query
      from tokens
  ),
  matched as (
    select v.*,
           (select count(*) from tokens t where v.fts @@ t.term) as token_hits,
           (select count(*) from tokens t
             where corpus_tsv(v.lang, concat_ws(' ', v.name, v.concept, v.question_text)) @@ t.term
           ) as field_hits
      from corpus_variable v cross join pair_query p
     where p.query is not null and v.fts @@ p.query
       and (lang_filter   is null or v.lang = lang_filter)
       and (survey_filter is null or v.survey_acronym = survey_filter or v.survey_group = survey_filter)
       and (year_min      is null or v.year >= year_min)
       and (year_max      is null or v.year <= year_max)
       and (require_codes is null or (v.code_count > 0) = require_codes)
       and (subject_filter is null or exists (
         select 1 from corpus_survey_subject s
          where s.survey_group = v.survey_group and s.subject = subject_filter
       ))
       and (case
         when role_filter is not null and role_filter <> 'all'
           then corpus_variable_role(v.name, v.concept, v.note, v.survey_group) = role_filter
         when coalesce(hide_process, false)
           then corpus_variable_role(v.name, v.concept, v.note, v.survey_group) <> 'process'
         else true end)
  ),
  ranked as (
    select m.*,
           (10 * m.field_hits + m.token_hits
             + 40.0 * m.field_hits / greatest(30, length(concat_ws(' ', m.name, m.concept, m.question_text))))::real
             as fallback_rank,
           count(*) over() as result_count
      from matched m
  )
  select r.record_id, r.name, r.position, r.length, r.concept, r.question_text, r.universe,
         r.note, r.codes, r.code_count, r.bundle, r.path, r.page, r.tcode, r.survey_group,
         r.survey_acronym, r.cycle, r.year, r.lang, r.fallback_rank, r.result_count
    from ranked r
   order by case when sort_mode = 'recent' then r.year end desc nulls last,
            r.fallback_rank desc, r.name asc, r.record_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

revoke execute on function corpus_search_relaxed(text, text, text, integer, integer, boolean, integer, integer, text, text, boolean, text) from public, authenticated;
grant execute on function corpus_search_relaxed(text, text, text, integer, integer, boolean, integer, integer, text, text, boolean, text) to anon;
