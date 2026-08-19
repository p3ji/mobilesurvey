-- =============================================================================================
-- StatCan metadata repository — Supabase schema (docs/metadata-repo-plan.md, D5/D6/D8)
--
-- Apply once per Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Re-running is safe; every statement is idempotent.
--
-- WHAT THIS STORES
--   One row per *variable occurrence*: one variable, as one document described it, in one
--   language (D3). Occurrences are immutable facts lifted from published documentation. Concept
--   clustering — our inference, and the part that will be wrong sometimes — is deliberately NOT
--   in this table, so improving it can never corrupt what the documents actually said.
--
-- WHO CAN DO WHAT
--   `anon` gets SELECT and nothing else. This is published, non-confidential documentation
--   (Statistics Canada Open Licence), so reads are open by design; writes come from the loader
--   running under the service-role key, which bypasses RLS and never reaches a browser.
--   New tables do NOT inherit the default privileges older tables in this project got, so the
--   GRANTs below are load-bearing — RLS policies alone will still yield "permission denied".
-- =============================================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------------------------
-- Language-aware tsvector
--
-- Stemming has to match the text's language or it is worse than useless: the English stemmer
-- turns "logements" into "logement" only by accident and misses "logés" entirely. Postgres will
-- not accept a non-constant regconfig inside a generated column, hence this wrapper.
--
-- Declaring it IMMUTABLE is the standard practice for this pattern and is true in every way that
-- matters here: the mapping from (lang, text) to tsvector changes only if someone redefines the
-- `english` or `french` search configurations, which nothing in this project does. If that ever
-- happens, the stored vectors must be rebuilt — that is the cost of the declaration, and it is
-- the reason it is written down rather than assumed.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_tsv(p_lang text, p_text text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select to_tsvector(
    case when p_lang = 'fr' then 'french'::regconfig else 'english'::regconfig end,
    coalesce(p_text, '')
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- corpus_variable
-- ---------------------------------------------------------------------------------------------
create table if not exists corpus_variable (
  -- UUIDv5 of (survey, file, variable name, position) — stable across re-ingests (D9), so a
  -- re-run upserts rather than duplicating, and an id printed in a citation stays valid.
  record_id       uuid primary key,

  name            text not null,
  position        text,
  length          text,
  collection_name text,
  concept         text,
  question_text   text,
  universe        text,
  note            text,

  -- The code list, whole. Not a child table: a code list is only ever read with its variable, and
  -- ~2 M child rows would cost far more than the join returns. This is also the column that moves
  -- to Storage first if the D5 size trigger (~300 MB loaded) ever fires.
  codes           jsonb not null default '[]'::jsonb,
  code_count      integer not null default 0,

  -- Provenance (D8). Every one of these is needed to cite a record under the Open Licence, so
  -- they are columns rather than a JSON blob: a citation field that cannot be filtered or
  -- validated is a field that quietly goes missing.
  bundle          text not null,
  path            text not null,
  page            integer not null,
  tcode           text,
  doc_kind        text not null,
  survey_group    text not null,
  survey_acronym  text,
  cycle           text,
  year            integer,
  lang            text not null,

  -- Everything findable, flattened: name, concept, question wording, universe, note, and the
  -- response-category labels. The labels matter more than they look — "never married" is often
  -- the only place a searchable concept appears in plain language.
  search_text     text not null,

  fts tsvector generated always as (corpus_tsv(lang, search_text)) stored
);

create index if not exists corpus_variable_fts_idx    on corpus_variable using gin (fts);
-- Fuzzy lookup of a mnemonic someone copied out of a paper (`DHHGAGE`, `dhhgage`, `DHHGAGE_1`).
create index if not exists corpus_variable_name_trgm  on corpus_variable using gin (name gin_trgm_ops);
create index if not exists corpus_variable_facets_idx on corpus_variable (survey_acronym, year, lang);
create index if not exists corpus_variable_group_idx  on corpus_variable (survey_group);

alter table corpus_variable enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'corpus_variable' and policyname = 'anon select'
  ) then
    create policy "anon select" on corpus_variable for select to anon using (true);
  end if;
end
$$;

grant select on corpus_variable to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_search — ranked search, called over PostgREST RPC
--
-- A function rather than a PostgREST filter because ranking is the whole point: `?fts=...` can
-- tell you a row matched but not how well, and an unranked result set over 185k rows is a list,
-- not a search.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_search(
  q               text,
  lang_filter     text    default null,
  survey_filter   text    default null,
  year_min        integer default null,
  year_max        integer default null,
  require_codes   boolean default null,
  max_rows        integer default 50,
  row_offset      integer default 0
)
returns table (
  record_id       uuid,
  name            text,
  -- Quoted because `position` and `length` are col_name_keywords: legal as table column names,
  -- but rejected as *function parameter* names, which is what a RETURNS TABLE entry is. Quoting
  -- keeps the JSON keys identical to the column names so the client needs no aliasing.
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
  with q_en as (select websearch_to_tsquery('english', coalesce(q, '')) as tsq),
       q_fr as (select websearch_to_tsquery('french',  coalesce(q, '')) as tsq),
       -- A bare mnemonic is a lookup, not a search. Detected rather than offered as a mode
       -- toggle: someone pasting `DHHGAGE` should not have to know which box to paste it into.
       needle as (select case
                    when q ~ '^[A-Za-z][A-Za-z0-9_]{1,31}$' then upper(q)
                    else null
                  end as mnemonic),
       matched as (
         select v.*,
                greatest(
                  ts_rank_cd(v.fts, (select tsq from q_en)),
                  ts_rank_cd(v.fts, (select tsq from q_fr))
                )
                -- An exact name hit outranks any amount of prose relevance, and a prefix hit
                -- outranks ordinary text. Additive so a record that is both still wins.
                + case
                    when (select mnemonic from needle) is null then 0
                    when upper(v.name) = (select mnemonic from needle) then 10
                    when upper(v.name) like (select mnemonic from needle) || '%' then 5
                    else 0
                  end as rank
           from corpus_variable v
          where (
                  v.fts @@ (select tsq from q_en)
                  or v.fts @@ (select tsq from q_fr)
                  or (
                    (select mnemonic from needle) is not null
                    and upper(v.name) like (select mnemonic from needle) || '%'
                  )
                )
            and (lang_filter   is null or v.lang = lang_filter)
            and (survey_filter is null or v.survey_acronym = survey_filter or v.survey_group = survey_filter)
            and (year_min      is null or v.year >= year_min)
            and (year_max      is null or v.year <= year_max)
            and (require_codes is null or (v.code_count > 0) = require_codes)
       ),
       counted as (select count(*) as n from matched)
  select m.record_id, m.name, m.position, m.length, m.concept, m.question_text, m.universe,
         m.note, m.codes, m.code_count, m.bundle, m.path, m.page, m.tcode, m.survey_group,
         m.survey_acronym, m.cycle, m.year, m.lang, m.rank::real,
         (select n from counted) as total_count
    from matched m
   -- name/record_id break rank ties so paging is stable; without it the same row can appear on
   -- two consecutive pages and another never appear at all.
   order by m.rank desc, m.name asc, m.record_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

grant execute on function corpus_search(text, text, text, integer, integer, boolean, integer, integer) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_stats — what the search screen says before anyone has typed anything
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_stats()
returns table (
  variables      bigint,
  surveys        bigint,
  documents      bigint,
  year_min       integer,
  year_max       integer,
  with_codes     bigint,
  with_question  bigint
)
language sql
stable
parallel safe
as $$
  select count(*)                                          as variables,
         count(distinct survey_group)                      as surveys,
         count(distinct path)                              as documents,
         min(year)                                         as year_min,
         max(year)                                         as year_max,
         count(*) filter (where code_count > 0)            as with_codes,
         count(*) filter (where question_text is not null) as with_question
    from corpus_variable;
$$;

grant execute on function corpus_stats() to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_surveys — the survey facet, with enough shape to render a picker
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_surveys()
returns table (
  survey_group   text,
  survey_acronym text,
  variables      bigint,
  documents      bigint,
  year_min       integer,
  year_max       integer
)
language sql
stable
parallel safe
as $$
  select survey_group,
         -- One acronym per group; mode() rather than an arbitrary pick so a stray misclassified
         -- file cannot rename a survey in the UI.
         mode() within group (order by survey_acronym) as survey_acronym,
         count(*)              as variables,
         count(distinct path)  as documents,
         min(year)             as year_min,
         max(year)             as year_max
    from corpus_variable
   group by survey_group
   order by count(*) desc;
$$;

grant execute on function corpus_surveys() to anon;
