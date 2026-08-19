-- =============================================================================================
-- StatCan metadata repository — DDI variable cascade (docs/metadata-repo-plan.md, D3/M3)
--
-- Apply after schema.sql. Idempotent; safe to re-run.
--
-- WHAT THIS ADDS
--   DDI-Lifecycle models "the same question across cycles" as three objects, not one:
--
--     c:Concept              a unit of meaning                      "marital status"
--     l:ConceptualVariable   a Concept applied to a Universe        "…of all respondents 15+"
--     l:RepresentedVariable  a ConceptualVariable given a coding    "…coded 1–6, these categories"
--     l:Variable             the variable in one dataset            a corpus_variable row
--
--   Keeping the levels apart is what makes the interesting question answerable without writing a
--   query for it: "which cycles changed the coding?" is a ConceptualVariable whose
--   `representations` is greater than one.
--
-- WHY MEMBERSHIP IS ITS OWN TABLE
--   Occurrences are what a document said. Clusters are our inference about what several documents
--   meant, and that inference will sometimes be wrong. Membership therefore lives beside the
--   facts rather than on them: re-clustering truncates these four tables and touches
--   `corpus_variable` not at all (D3).
-- =============================================================================================

create table if not exists corpus_concept (
  concept_id   uuid primary key,
  label        text not null,
  occurrences  integer not null,
  surveys      integer not null,
  year_min     integer,
  year_max     integer
);

create table if not exists corpus_conceptual_variable (
  conceptual_variable_id uuid primary key,
  concept_id             uuid not null,
  label                  text not null,
  universe               text,
  occurrences            integer not null,
  surveys                integer not null,
  -- Distinct codings across the members. > 1 means the coding changed between cycles, which is
  -- the signal the whole cascade exists to expose.
  representations        integer not null,
  years                  integer not null,
  year_min               integer,
  year_max               integer
);

create table if not exists corpus_represented_variable (
  represented_variable_id uuid primary key,
  conceptual_variable_id  uuid not null,
  code_count              integer not null,
  occurrences             integer not null,
  year_min                integer,
  year_max                integer
);

create table if not exists corpus_variable_cluster (
  record_id               uuid primary key,
  concept_id              uuid not null,
  conceptual_variable_id  uuid not null,
  represented_variable_id uuid not null
);

create index if not exists corpus_cv_concept_idx  on corpus_conceptual_variable (concept_id);
create index if not exists corpus_cv_span_idx     on corpus_conceptual_variable (years desc, occurrences desc);
create index if not exists corpus_rv_parent_idx   on corpus_represented_variable (conceptual_variable_id);
create index if not exists corpus_cluster_cv_idx  on corpus_variable_cluster (conceptual_variable_id);
-- Label search over the cascade. English only: the loaded corpus is English, and a language-aware
-- vector here would need the same per-row config plumbing for no present gain.
create index if not exists corpus_cv_label_fts    on corpus_conceptual_variable
  using gin (to_tsvector('english', label));

alter table corpus_concept              enable row level security;
alter table corpus_conceptual_variable  enable row level security;
alter table corpus_represented_variable enable row level security;
alter table corpus_variable_cluster     enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'corpus_concept', 'corpus_conceptual_variable',
    'corpus_represented_variable', 'corpus_variable_cluster'
  ] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'anon select') then
      execute format('create policy "anon select" on %I for select to anon using (true)', t);
    end if;
    execute format('grant select on %I to anon', t);
    -- The loader's role needs its own privileges: bypassing RLS is a policy exemption, not a
    -- privilege, and a new table grants nothing to anyone.
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- corpus_timeline — one conceptual variable, as it was asked across cycles
--
-- The object the plan set out to build in §2: every way a concept has been measured over time,
-- with the wording and coding used in each, and which cycles changed.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_timeline(cv_id uuid)
returns table (
  record_id               uuid,
  represented_variable_id uuid,
  name                    text,
  question_text           text,
  universe                text,
  codes                   jsonb,
  code_count              integer,
  survey_group            text,
  survey_acronym          text,
  cycle                   text,
  year                    integer,
  path                    text,
  page                    integer,
  lang                    text
)
language sql
stable
parallel safe
as $$
  select v.record_id, m.represented_variable_id, v.name, v.question_text, v.universe,
         v.codes, v.code_count, v.survey_group, v.survey_acronym, v.cycle, v.year,
         v.path, v.page, v.lang
    from corpus_variable_cluster m
    join corpus_variable v on v.record_id = m.record_id
   where m.conceptual_variable_id = cv_id
   -- Chronological, which is what a timeline is; name and id break ties so the order is stable.
   order by v.year nulls last, v.survey_group, v.name, v.record_id;
$$;

grant execute on function corpus_timeline(uuid) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_concepts — search and browse the cascade rather than the occurrences
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_concepts(
  q               text    default null,
  min_years       integer default 2,
  changed_only    boolean default false,
  max_rows        integer default 50,
  row_offset      integer default 0
)
returns table (
  conceptual_variable_id uuid,
  concept_id             uuid,
  label                  text,
  universe               text,
  occurrences            integer,
  surveys                integer,
  representations        integer,
  years                  integer,
  year_min               integer,
  year_max               integer,
  total_count            bigint
)
language sql
stable
parallel safe
as $$
  with matched as (
    select cv.*
      from corpus_conceptual_variable cv
     where (
             q is null or trim(q) = ''
             or to_tsvector('english', cv.label) @@ websearch_to_tsquery('english', q)
           )
       and cv.years >= coalesce(min_years, 1)
       and (not coalesce(changed_only, false) or cv.representations > 1)
  ),
  counted as (select count(*) as n from matched)
  select m.conceptual_variable_id, m.concept_id, m.label, m.universe, m.occurrences, m.surveys,
         m.representations, m.years, m.year_min, m.year_max, (select n from counted)
    from matched m
   -- Longest-running first: a concept traced across twenty years is the point of the corpus, and
   -- a concept seen twice in one survey is not.
   order by m.years desc, m.occurrences desc, m.label asc, m.conceptual_variable_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

grant execute on function corpus_concepts(text, integer, boolean, integer, integer) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_cluster_of — the cascade ids for a page of search results
--
-- Kept out of `corpus_search` deliberately. Joining there would put a lookup on the hot path of
-- every search to serve a link the reader may never follow; a page of 25 ids is one extra call
-- against a primary key.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_cluster_of(record_ids uuid[])
returns table (
  record_id               uuid,
  concept_id              uuid,
  conceptual_variable_id  uuid,
  represented_variable_id uuid,
  years                   integer,
  representations         integer
)
language sql
stable
parallel safe
as $$
  select m.record_id, m.concept_id, m.conceptual_variable_id, m.represented_variable_id,
         cv.years, cv.representations
    from corpus_variable_cluster m
    join corpus_conceptual_variable cv on cv.conceptual_variable_id = m.conceptual_variable_id
   where m.record_id = any(record_ids);
$$;

grant execute on function corpus_cluster_of(uuid[]) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_cluster_stats — what the concept view says before anything is typed
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_cluster_stats()
returns table (
  concepts              bigint,
  conceptual_variables  bigint,
  represented_variables bigint,
  spanning_years        bigint,
  coding_changed        bigint,
  cross_survey          bigint
)
language sql
stable
parallel safe
as $$
  select (select count(*) from corpus_concept),
         (select count(*) from corpus_conceptual_variable),
         (select count(*) from corpus_represented_variable),
         (select count(*) from corpus_conceptual_variable where years > 1),
         (select count(*) from corpus_conceptual_variable where representations > 1),
         (select count(*) from corpus_conceptual_variable where surveys > 1);
$$;

grant execute on function corpus_cluster_stats() to anon;
