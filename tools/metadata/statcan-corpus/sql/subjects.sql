-- =============================================================================================
-- StatCan metadata repository — subject facet (docs/metadata-repo-plan.md, M5)
--
-- Apply after schema.sql. Idempotent; safe to re-run.
--
-- THE TAXONOMY IS THEIRS, THE ASSIGNMENT IS OURS
--   The 31 subject names are captured verbatim from the facet on www150.statcan.gc.ca, so a
--   reader filters by the vocabulary Statistics Canada publishes. Which of our 186 survey groups
--   belongs to which subject is not published anywhere fetchable — the portal's facet counts are
--   not subject-conditional, and the IMDB survey pages do not carry it — so it is inference,
--   maintained by hand in docs/statcan-survey-subjects.tsv.
--
--   `source` records which kind of claim a row is. `confirmed` came from a person editing that
--   file; `suggested` was derived from the survey's official title. The distinction is kept in the
--   data rather than lost at load time, because a reader deserves to know which they are looking
--   at, and because a later correction should be able to find every guess it supersedes.
--
--   Subject is assigned per *survey*, not per record: a survey is about something, a variable
--   within it need not be. Filtering therefore joins through this table rather than storing a
--   subject on 194,507 rows that would all have to be rewritten when one assignment changes (D3).
-- =============================================================================================

create table if not exists corpus_survey_subject (
  survey_group text not null,
  subject      text not null,
  -- 'confirmed' — a person assigned it. 'suggested' — derived from the official survey title.
  source       text not null default 'suggested',
  primary key (survey_group, subject)
);

create index if not exists corpus_survey_subject_subject_idx on corpus_survey_subject (subject);

alter table corpus_survey_subject enable row level security;
drop policy if exists "anon select" on corpus_survey_subject;
create policy "anon select" on corpus_survey_subject for select to anon using (true);
grant select on corpus_survey_subject to anon;
grant select, insert, update, delete on corpus_survey_subject to service_role;

-- ---------------------------------------------------------------------------------------------
-- corpus_subjects — the facet list, with the counts a reader needs to judge it
--
-- Counts variables rather than surveys, because "Health (14,651)" tells a reader how much they
-- are about to filter down to, where "Health (3 surveys)" does not.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_subjects()
returns table (
  subject   text,
  variables bigint,
  surveys   bigint,
  confirmed bigint
)
language sql
stable
parallel safe
as $$
  select s.subject,
         count(v.record_id)                                          as variables,
         count(distinct s.survey_group)                              as surveys,
         count(distinct s.survey_group) filter (where s.source = 'confirmed') as confirmed
    from corpus_survey_subject s
    left join corpus_variable v on v.survey_group = s.survey_group
   group by s.subject
   order by count(v.record_id) desc, s.subject asc;
$$;

grant execute on function corpus_subjects() to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_unclassified — how much of the corpus the facet cannot reach
--
-- Exists so the UI can say so out loud. A facet list that silently omits a third of the corpus
-- reads as a complete index of it, which would be the most misleading thing on the page.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_unclassified()
returns table (
  variables       bigint,
  surveys         bigint,
  total_variables bigint,
  total_surveys   bigint
)
language sql
stable
parallel safe
as $$
  select count(*) filter (where s.survey_group is null),
         count(distinct v.survey_group) filter (where s.survey_group is null),
         count(*),
         count(distinct v.survey_group)
    from corpus_variable v
    left join (select distinct survey_group from corpus_survey_subject) s
           on s.survey_group = v.survey_group;
$$;

grant execute on function corpus_unclassified() to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_search — replaced to accept a subject filter
--
-- The RETURNS TABLE is unchanged, so `CorpusSearchRow` in metadata-registry needs no edit; only
-- a new optional parameter is added, and PostgREST tolerates callers that omit it.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_search(
  q               text,
  lang_filter     text    default null,
  survey_filter   text    default null,
  year_min        integer default null,
  year_max        integer default null,
  require_codes   boolean default null,
  max_rows        integer default 50,
  row_offset      integer default 0,
  subject_filter  text    default null
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
as $$
  with matched as (
         select v.*,
                greatest(
                  ts_rank_cd(v.fts, websearch_to_tsquery('english', coalesce(q, ''))),
                  ts_rank_cd(v.fts, websearch_to_tsquery('french',  coalesce(q, '')))
                )
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
       ),
       counted as (select count(*) as n from matched)
  select m.record_id, m.name, m.position, m.length, m.concept, m.question_text, m.universe,
         m.note, m.codes, m.code_count, m.bundle, m.path, m.page, m.tcode, m.survey_group,
         m.survey_acronym, m.cycle, m.year, m.lang, m.rank::real,
         (select n from counted) as total_count
    from matched m
   order by m.rank desc, m.name asc, m.record_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

grant execute on function corpus_search(text, text, text, integer, integer, boolean, integer, integer, text) to anon;
