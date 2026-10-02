-- ============================================================================
-- Patch 2026-10-02: Mnemonic & Acronym Guardrail
--
-- Restricts the name match bonus for short queries (e.g. K10, K6) when
-- an academic alias or semantic construct exists, preventing unrelated
-- variables (e.g. general question 10 in Section K) from outranking
-- genuine psychometric / construct scales (K10 Distress Scale, etc.).
-- ============================================================================

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
                -- Substantive topical text match on question_text or concept
                + case when corpus_tsv(v.lang, concat_ws(' ', v.concept, v.question_text))
                     @@ case when v.lang = 'fr'
                          then websearch_to_tsquery('french', coalesce(q, ''))
                          else websearch_to_tsquery('english', coalesce(q, '')) end
                    then 4 else 0 end
                -- Combined field text match (fallback when concept/question_text is null)
                + case when corpus_tsv(v.lang, concat_ws(' ', v.name, v.concept, v.question_text))
                     @@ case when v.lang = 'fr'
                          then websearch_to_tsquery('french', coalesce(q, ''))
                          else websearch_to_tsquery('english', coalesce(q, '')) end
                    then 1 else 0 end
                + 0.25 * least(0.5, greatest(
                  ts_rank_cd(v.fts, websearch_to_tsquery('english', coalesce((select expansion from alias), ''))),
                  ts_rank_cd(v.fts, websearch_to_tsquery('french', coalesce((select expansion from alias), '')))
                ))
                + case when corpus_tsv(v.lang, concat_ws(' ', v.concept, v.question_text))
                     @@ case when v.lang = 'fr'
                          then websearch_to_tsquery('french', coalesce((select expansion from alias), ''))
                          else websearch_to_tsquery('english', coalesce((select expansion from alias), '')) end
                    then 1.5 else 0 end
                + case
                    when corpus_mnemonic(q) is null then 0
                    when upper(v.name) = corpus_mnemonic(q) then
                      case when (select expansion from alias) is not null then 1 else 10 end
                    when v.name ilike corpus_mnemonic(q) || '%' then
                      case when (select expansion from alias) is not null then 0.5 else 5 end
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
                      then corpus_variable_role(v.name, v.concept, v.note, v.survey_group, v.question_text) = role_filter
                    when coalesce(hide_process, false)
                      then corpus_variable_role(v.name, v.concept, v.note, v.survey_group, v.question_text) <> 'process'
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
   order by
     case when sort_mode = 'relevance'  then m.rank end desc,
     case when sort_mode = 'year_desc'  then m.year end desc nulls last,
     case when sort_mode = 'year_asc'   then m.year end asc nulls last,
     case when sort_mode = 'alpha_asc'  then m.name end asc,
     case when sort_mode = 'alpha_desc' then m.name end desc,
     m.survey_group asc,
     m.page asc
   limit max_rows
  offset row_offset;
$$;

grant execute on function corpus_search_sorted(text, text, text, integer, integer, boolean, integer, integer, text, text, text, boolean) to anon, authenticated;
