-- Global result ordering. Keep relevance scoring aligned with search-performance.sql.
drop function if exists corpus_search_sorted(text, text, text, integer, integer, boolean, integer, integer, text, text);
drop function if exists corpus_search_sorted(text, text, text, integer, integer, boolean, integer, integer, text, text, text, boolean);

create or replace function corpus_search_sorted(
  q               text,
  lang_filter     text    default null,
  survey_filter   text    default null,
  year_min        integer default null,
  year_max        integer default null,
  require_codes   boolean default null,
  max_rows        integer default 50,
  row_offset      integer default 0,
  subject_filter  text    default null,
  sort_mode       text    default 'relevance',
  role_filter     text    default null,
  hide_process    boolean default false
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
parallel safe
set search_path = public
as $$
  with alias as (
         select expansion from corpus_search_alias
          where query = lower(btrim(q))
       ),
       matched as (
         select v.*,
                least(0.5, greatest(
                  ts_rank_cd(v.fts, websearch_to_tsquery('english', coalesce(q, ''))),
                  ts_rank_cd(v.fts, websearch_to_tsquery('french',  coalesce(q, '')))
                ))
                + case when corpus_tsv(v.lang, concat_ws(' ', v.name, v.concept, v.question_text))
                     @@ case when v.lang = 'fr'
                          then websearch_to_tsquery('french', coalesce(q, ''))
                          else websearch_to_tsquery('english', coalesce(q, '')) end
                    then 3 else 0 end
                + 0.25 * least(0.5, greatest(
                  ts_rank_cd(v.fts, websearch_to_tsquery('english', coalesce((select expansion from alias), ''))),
                  ts_rank_cd(v.fts, websearch_to_tsquery('french', coalesce((select expansion from alias), '')))
                ))
                + case when corpus_tsv(v.lang, concat_ws(' ', v.name, v.concept, v.question_text))
                     @@ case when v.lang = 'fr'
                          then websearch_to_tsquery('french', coalesce((select expansion from alias), ''))
                          else websearch_to_tsquery('english', coalesce((select expansion from alias), '')) end
                    then 0.75 else 0 end
                + case
                    when corpus_mnemonic(q) is null then 0
                    when upper(v.name) = corpus_mnemonic(q) then 10
                    when v.name ilike corpus_mnemonic(q) || '%' then 5
                    else 0
                  end as rank
           from corpus_variable v
          where (
                  v.fts @@ websearch_to_tsquery('english', coalesce(q, ''))
                  or v.fts @@ websearch_to_tsquery('french',  coalesce(q, ''))
                  or v.fts @@ websearch_to_tsquery('english', coalesce((select expansion from alias), ''))
                  or v.fts @@ websearch_to_tsquery('french', coalesce((select expansion from alias), ''))
                  or v.name ilike corpus_mnemonic(q) || '%'
                )
            and (lang_filter   is null or v.lang = lang_filter)
            and (survey_filter is null or v.survey_acronym = survey_filter or v.survey_group = survey_filter)
            and (year_min      is null or v.year >= year_min)
            and (year_max      is null or v.year <= year_max)
            and (require_codes is null or (v.code_count > 0) = require_codes)
            -- EXISTS against a table of a few hundred rows, rather than a subject column on
            -- 194,507 rows that one corrected assignment would force a rewrite of.
            and (
                  subject_filter is null
                  or exists (
                       select 1 from corpus_survey_subject s
                        where s.survey_group = v.survey_group
                          and s.subject = subject_filter
                     )
                )
            and (
                  case
                    when role_filter is not null and role_filter <> 'all'
                      then corpus_variable_role(v.name, v.concept, v.note, v.survey_group) = role_filter
                    when coalesce(hide_process, false)
                      then corpus_variable_role(v.name, v.concept, v.note, v.survey_group) <> 'process'
                    else true
                  end
                )
       ),
       counted as (select count(*) as n from matched)
  select m.record_id, m.name, m.position, m.length, m.concept, m.question_text, m.universe,
         m.note, m.codes, m.code_count, m.bundle, m.path, m.page, m.tcode, m.survey_group,
         m.survey_acronym, m.cycle, m.year, m.lang, m.rank::real,
         (select n from counted) as total_count
    from matched m
   order by case when sort_mode = 'recent' then m.year end desc nulls last,
            m.rank desc, m.year desc nulls last, m.name asc, m.record_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

revoke execute on function corpus_search_sorted(text, text, text, integer, integer, boolean, integer, integer, text, text, text, boolean) from public, authenticated;
grant execute on function corpus_search_sorted(text, text, text, integer, integer, boolean, integer, integer, text, text, text, boolean) to anon;
