-- Cross-cycle continuity suggestions are separate from the DDI cascade. A suggestion must
-- never silently merge conceptual variables or imply that their populations are comparable.
-- Apply after clusters.sql. Safe to re-run.
create table if not exists corpus_concept_continuity (
  earlier_record_id uuid not null references corpus_variable(record_id),
  later_record_id uuid not null references corpus_variable(record_id),
  relation text not null default 'likely_continuation'
    check (relation in ('likely_continuation')),
  review_status text not null default 'ai_suggested'
    check (review_status in ('ai_suggested', 'human_reviewed', 'rejected')),
  suggested_by text not null,
  rationale text not null,
  evidence text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  primary key (earlier_record_id, later_record_id),
  check (earlier_record_id <> later_record_id),
  constraint corpus_continuity_review_check
    check (review_status <> 'human_reviewed' or (reviewed_at is not null and nullif(trim(reviewed_by), '') is not null))
);

alter table corpus_concept_continuity add column if not exists reviewed_by text;
alter table corpus_concept_continuity drop constraint if exists corpus_continuity_review_check;
alter table corpus_concept_continuity add constraint corpus_continuity_review_check
  check (review_status <> 'human_reviewed' or (reviewed_at is not null and nullif(trim(reviewed_by), '') is not null));

create index if not exists corpus_concept_continuity_later_idx
  on corpus_concept_continuity (later_record_id);
alter table corpus_concept_continuity enable row level security;
drop policy if exists "anon select suggested continuity" on corpus_concept_continuity;
create policy "anon select suggested continuity" on corpus_concept_continuity
  for select to anon using (review_status in ('ai_suggested', 'human_reviewed'));
grant select on corpus_concept_continuity to anon;
grant select, insert, update, delete on corpus_concept_continuity to service_role;

-- The caller sees suggestions touching any member of a conceptual-variable timeline.
-- The source records are returned verbatim so the reader can inspect both sides.
drop function if exists corpus_concept_continuity_for(uuid);
create or replace function corpus_concept_continuity_for(cv_id uuid)
returns table (
  earlier_record_id uuid,
  later_record_id uuid,
  earlier_conceptual_variable_id uuid,
  later_conceptual_variable_id uuid,
  earlier_name text,
  later_name text,
  earlier_concept text,
  later_concept text,
  earlier_question_text text,
  later_question_text text,
  earlier_universe text,
  later_universe text,
  earlier_year integer,
  later_year integer,
  earlier_survey_acronym text,
  later_survey_acronym text,
  earlier_path text,
  later_path text,
  earlier_page integer,
  later_page integer,
  relation text,
  review_status text,
  suggested_by text,
  reviewed_by text,
  rationale text,
  evidence text
)
language sql stable parallel safe security invoker
as $$
  select e.earlier_record_id, e.later_record_id,
         em.conceptual_variable_id, lm.conceptual_variable_id,
         ev.name, lv.name, ev.concept, lv.concept,
         ev.question_text, lv.question_text, ev.universe, lv.universe,
         ev.year, lv.year, ev.survey_acronym, lv.survey_acronym,
         ev.path, lv.path, ev.page, lv.page,
         e.relation, e.review_status, e.suggested_by, e.reviewed_by, e.rationale, e.evidence
    from corpus_concept_continuity e
    join corpus_variable ev on ev.record_id = e.earlier_record_id
    join corpus_variable lv on lv.record_id = e.later_record_id
    join corpus_variable_cluster em on em.record_id = ev.record_id
    join corpus_variable_cluster lm on lm.record_id = lv.record_id
   where (em.conceptual_variable_id = cv_id or lm.conceptual_variable_id = cv_id)
     and em.conceptual_variable_id <> lm.conceptual_variable_id
     and e.review_status in ('ai_suggested', 'human_reviewed')
   order by ev.year, lv.year, ev.name, lv.name;
$$;
grant execute on function corpus_concept_continuity_for(uuid) to anon;

-- First reviewed example: the same variable name and measure wording appear in CIUS 2022,
-- but the concept label moved to the question-text field and its universe changed. This is
-- a Codex suggestion, not a StatCan assertion or a human comparability assessment.
insert into corpus_concept_continuity
  (earlier_record_id, later_record_id, suggested_by, rationale, evidence)
select 'fa523937-a14b-5400-83ab-ff48e992c3f0',
       'a85b4f54-bc28-5fca-a546-ec142a53a779',
       'OpenAI Codex',
       'Likely continuation of online shoppers: ONL_SHOP is reused in the same survey, and the 2022 question text retains the measure wording. The universe changed, so comparability is not established.',
       'CIUS 2020 concept: Online shoppers - Derived variable; universe: All respondents. CIUS 2022 concept: Derived variable; question text: Online shoppers; universe: AC_090A=1.'
where exists (select 1 from corpus_variable where record_id = 'fa523937-a14b-5400-83ab-ff48e992c3f0')
  and exists (select 1 from corpus_variable where record_id = 'a85b4f54-bc28-5fca-a546-ec142a53a779')
on conflict (earlier_record_id, later_record_id) do nothing;
