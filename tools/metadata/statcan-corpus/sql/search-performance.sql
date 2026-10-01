-- Apply after schema.sql and subjects.sql. Repeatable search and facet improvements.
-- Explicit synonyms are reviewed equivalences, never guesses about a survey's meaning.
create table if not exists corpus_search_alias (
  query text primary key,
  expansion text not null,
  constraint corpus_search_alias_query_lower check (query = lower(btrim(query)))
);
alter table corpus_search_alias enable row level security;
drop policy if exists "anon select" on corpus_search_alias;
create policy "anon select" on corpus_search_alias for select to anon using (true);
grant select on corpus_search_alias to anon;
grant select, insert, update, delete on corpus_search_alias to service_role;
insert into corpus_search_alias (query, expansion) values
  ('ai', 'artificial intelligence'),
  ('artificial intelligence', 'AI'),
  ('remote work', 'telework'),
  ('crypto', 'cryptocurrency'),
  ('cryptocurrency', 'crypto'),
  ('cryptocurrencies', 'crypto'),
  ('crypto currency', 'cryptocurrency'),
  ('crypto-currency', 'cryptocurrency'),
  ('crypto payment', 'cryptocurrency payment'),
  ('cryptocurrency payment', 'crypto payment'),
  ('crypto payments', 'cryptocurrency payments'),
  ('cryptocurrency payments', 'crypto payments'),
  ('crypto ransom', 'cryptocurrency ransom'),
  ('cryptocurrency ransom', 'crypto ransom'),
  ('bitcoin', 'cryptocurrency'),
  ('indigenous', 'aboriginal'),
  ('aboriginal', 'indigenous'),
  ('coronavirus', 'covid'),
  ('cannabis', 'marijuana'),
  ('marijuana', 'cannabis'),
  ('elderly', 'senior'),
  ('salary', 'wages'),
  ('wages', 'salary'),
  ('wfh', 'telework'),
  ('work from home', 'telework'),
  ('vaping', 'e-cigarette'),
  ('e-cigarette', 'vaping'),
  ('e-cigarettes', 'vaping')
on conflict (query) do update set expansion = excluded.expansion;

-- -- 1. Classifier helper function for GSIM roles and process/weight detection
create or replace function corpus_variable_role(
  p_name text,
  p_concept text,
  p_note text,
  p_survey_group text
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    -- 1. Origin: process / paradata / weights / system identifiers / imputation flags
    when p_name ~* '^(WTS?_|WTM_|WT_|WGHT|BOOT|BSW|FWT|REPWT|FWEIGHT|HWEIGHT|WT[0-9]+|WTBS|WTPS|WVCBS|SPFWT|BWT|SAMPLEID|PERSONID|MASTERID|HHID|RECID|VERDATE|REFPER|RECORDID|CASEID|USERID|FORMID|PUMFID|BATCHID|STRAT|FRAME|SEQNUM|IDENT|DO[A-Z]{3}|ADM_|SAM_|INT_|COL_|MET_|SURV|DOF|FLG_|FLAG_|IF_|IMP_|QFLG_)'
      or p_name ~* '^I[0-9]{4,}$'
      or p_name ~* '(_F|_FLG)$'
      or coalesce(p_concept, '') ~* '(^|\y)(sampling weight|sample weight|bootstrap|poids [eé]chantillon|share weight|master weight|survey weight|final weight|replicate weights?|poids r[eé]plique|inclusion flag|imputation flag|imputation|allocation flag|quality flag|data quality flag|status flag|edit flag|indicateur d[\''’]imputation|drapeau d[\''’]imputation|indicateur)(\y|$)|[-–—]\s*\(F\)|\(F\)$'
      or coalesce(p_concept, '') ~* '^imputation\b'
      or coalesce(p_note, '') ~* '\b(imputation flag|indicateur d[\''’]imputation)\b'
      then 'process'

    -- 2. Derivation: derived / recoded / PUMF grouped
    when coalesce(p_concept, '') ~* '(^|\y)(DV\s*[-–—:]|derived variable|\(D\)|\(G\)|grouped|group[eé]e?s?)|[-–—]\s*(derived|\(D\)|\(G\)|grouped|group[eé]e?s?)|\(D\)$'
      or p_name ~* '^[A-Z]{2,4}G[A-Z0-9]+$'
      or p_name ~* 'DV'
      or p_name ~* '^[A-Z]{2,4}D[A-Z0-9]{2,}$'
      or coalesce(p_note, '') ~* '^(based on|derived from|calcul[eé]|selon|compos[eé])|see documentation on derived variables'
      then 'derived'

    -- 3. Origin: administrative
    when coalesce(p_concept, '') ~* '\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b'
      or coalesce(p_note, '') ~* '\b(T1FF|CRA|IMDB|vital statistics|health administrative|hospital discharge|tax data|administrative file|donn[eé]es fiscales|registre)\b'
      or coalesce(p_survey_group, '') ~* '(VITAL|TAX|T1FF)'
      or p_name ~* '^GEO'
      or coalesce(p_concept, '') ~* '\b(province|postal code)\b'
      then 'administrative'

    -- 4. Default: collected
    else 'collected'
  end;
$$;
grant execute on function corpus_variable_role(text, text, text, text) to anon;

-- The original RPC remains the client contract. Exact wording outranks a synonym.
-- Cap whole-record FTS rank so long code lists cannot dominate. A name, concept, or question
-- match gets a field bonus; category-only matches remain findable via the existing GIN index.
-- Role filtering and paradata suppression apply before count, rank, and pagination.
drop function if exists corpus_search(text, text, text, integer, integer, boolean, integer, integer);
drop function if exists corpus_search(text, text, text, integer, integer, boolean, integer, integer, text);
drop function if exists corpus_search(text, text, text, integer, integer, boolean, integer, integer, text, text, boolean);

create or replace function corpus_search(
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
   order by m.rank desc, m.name asc, m.record_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

grant execute on function corpus_search(text, text, text, integer, integer, boolean, integer, integer, text, text, boolean) to anon;

-- One small row per survey, refreshed after corpus loads. A reader never scans the corpus
-- just to paint a sidebar. Refresh is atomic in one transaction and service-role-only.
create table if not exists corpus_survey_counts (
  survey_group text primary key,
  survey_acronym text,
  variables bigint not null,
  documents bigint not null,
  year_min integer,
  year_max integer,
  with_codes bigint not null,
  with_question bigint not null
);
alter table corpus_survey_counts enable row level security;
drop policy if exists "anon select" on corpus_survey_counts;
create policy "anon select" on corpus_survey_counts for select to anon using (true);
grant select on corpus_survey_counts to anon;
grant select, insert, update, delete on corpus_survey_counts to service_role;

create or replace function corpus_refresh_facets()
returns void language plpgsql volatile security invoker set search_path = public as $$
begin
  delete from corpus_survey_counts where true;
  insert into corpus_survey_counts
    (survey_group, survey_acronym, variables, documents, year_min, year_max, with_codes, with_question)
  select survey_group, mode() within group (order by survey_acronym), count(*),
         count(distinct path), min(year), max(year),
         count(*) filter (where code_count > 0),
         count(*) filter (where question_text is not null)
    from corpus_variable
   group by survey_group;
end;
$$;
revoke execute on function corpus_refresh_facets() from public, anon, authenticated;
grant execute on function corpus_refresh_facets() to service_role;

create or replace function corpus_stats()
returns table (variables bigint, surveys bigint, documents bigint, year_min integer,
               year_max integer, with_codes bigint, with_question bigint)
language sql stable parallel safe set search_path = public as $$
  select coalesce(sum(c.variables), 0), count(*), coalesce(sum(c.documents), 0),
         min(c.year_min), max(c.year_max), coalesce(sum(c.with_codes), 0),
         coalesce(sum(c.with_question), 0)
    from corpus_survey_counts c;
$$;

create or replace function corpus_surveys()
returns table (survey_group text, survey_acronym text, variables bigint, documents bigint,
               year_min integer, year_max integer)
language sql stable parallel safe set search_path = public as $$
  select c.survey_group, c.survey_acronym, c.variables, c.documents, c.year_min, c.year_max
    from corpus_survey_counts c order by c.variables desc, c.survey_group;
$$;

create or replace function corpus_subjects()
returns table (subject text, variables bigint, surveys bigint, confirmed bigint)
language sql stable parallel safe set search_path = public as $$
  select s.subject, coalesce(sum(c.variables), 0), count(distinct s.survey_group),
         count(distinct s.survey_group) filter (where s.source = 'confirmed')
    from corpus_survey_subject s
    left join corpus_survey_counts c on c.survey_group = s.survey_group
   group by s.subject order by coalesce(sum(c.variables), 0) desc, s.subject;
$$;

create or replace function corpus_unclassified()
returns table (variables bigint, surveys bigint, total_variables bigint, total_surveys bigint)
language sql stable parallel safe set search_path = public as $$
  select coalesce(sum(c.variables) filter (where s.survey_group is null), 0),
         count(*) filter (where s.survey_group is null),
         coalesce(sum(c.variables), 0), count(*)
    from corpus_survey_counts c
    left join (select distinct survey_group from corpus_survey_subject) s
           on s.survey_group = c.survey_group;
$$;

-- Run once on install; the loader calls the same function after later imports.
select corpus_refresh_facets();
