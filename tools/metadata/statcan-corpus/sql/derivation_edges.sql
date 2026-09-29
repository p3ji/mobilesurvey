-- =============================================================================================
-- StatCan metadata repository — Derivation Lineage Schema (docs/METADATA_ARCHITECTURE_PLAN.md)
--
-- Apply after schema.sql and clusters.sql. Idempotent; safe to re-run.
--
-- WHAT THIS ADDS
--   Models computational provenance between variables:
--     W3C PROV-O: wasDerivedFrom
--     GSIM:       Derivation / Transformation
--
--   Stores explicit edges linking derived indices (e.g., BMI) to their source questions
--   (e.g., Height, Weight), supporting bounded recursive lineage traversal with cycle detection.
-- =============================================================================================

create table if not exists corpus_derivation_edge (
  edge_id            uuid primary key default gen_random_uuid(),
  target_record_id   uuid not null references corpus_variable(record_id) on delete cascade,
  -- Nullable: source variable might only exist in confidential master files (not in PUMF)
  source_record_id   uuid references corpus_variable(record_id) on delete set null,
  source_var_name    text not null,
  survey_group       text not null,
  cycle              text not null,
  
  -- Epistemic Authority & Attribution
  data_authority        text not null default 'ai_inferred'
    check (data_authority in ('official_statcan', 'ai_inferred', 'human_verified')),
  ai_model              text default 'qwen3.8-27b',
  ai_auditor            text default 'reviewer_agent_v1',
  confidence            real not null default 1.0,
  review_status         text not null default 'candidate', -- 'candidate', 'verified', 'needs_review', 'rejected'
  
  -- Derivation classification:
  --   'formula'    - Mathematical / logical expression (e.g. BMI = kg / m^2)
  --   'recode'     - Mapping values to new categories
  --   'collapse'   - PUMF categorical reduction
  --   'imputation' - Statistical replacement of missing data
  derivation_type       text not null default 'formula',
  
  -- AI Inferred summaries and AST logic
  ai_expression_summary text,
  ai_logic_ast          jsonb,
  
  -- Official StatCan Source Evidence (Immutable Facts)
  statcan_verbatim_note text not null,
  statcan_citation      jsonb, -- { "doc": "...", "page": 42, "licence": "Statistics Canada Open Licence" }
  
  -- Extraction method / provenance
  extraction_method     text not null default 'llm_qwen3.8',
  
  created_at            timestamptz not null default now()
);

-- Bidirectional indexes for forward (downstream effects) and backward (upstream sources) queries
create index if not exists idx_derivation_target on corpus_derivation_edge (target_record_id, review_status);
create index if not exists idx_derivation_source on corpus_derivation_edge (source_record_id, review_status);
create index if not exists idx_derivation_cycle  on corpus_derivation_edge (survey_group, cycle);
create index if not exists idx_derivation_name   on corpus_derivation_edge (source_var_name);
-- Logical pair identity survives a missing source_record_id and a later re-resolution of it.
-- The random edge_id is only a row identifier; it cannot make repeated imports idempotent.
create unique index if not exists idx_derivation_target_source_name_unique
  on corpus_derivation_edge (target_record_id, (upper(btrim(source_var_name))));

-- Row-level security & permissions
alter table corpus_derivation_edge enable row level security;

drop policy if exists "anon select" on corpus_derivation_edge;
create policy "anon select" on corpus_derivation_edge for select to anon using (review_status = 'verified');

grant select on corpus_derivation_edge to anon;
grant select, insert, update, delete on corpus_derivation_edge to service_role;

-- ---------------------------------------------------------------------------------------------
-- Helper function: Bounded Lineage Traversal
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_get_upstream_lineage(
  p_root_record_id uuid,
  p_max_depth integer default 5
)
returns table (
  edge_id uuid,
  target_record_id uuid,
  source_record_id uuid,
  source_var_name text,
  data_authority text,
  derivation_type text,
  ai_expression_summary text,
  statcan_verbatim_note text,
  logic_ast jsonb,
  depth integer,
  path uuid[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive lineage as (
    -- Anchor: immediate inputs
    select 
      e.edge_id,
      e.target_record_id, 
      e.source_record_id, 
      e.source_var_name,
      e.data_authority,
      e.derivation_type,
      e.ai_expression_summary,
      e.statcan_verbatim_note,
      e.ai_logic_ast,
      1 as depth,
      array[e.target_record_id] as path
    from corpus_derivation_edge e
    where e.target_record_id = p_root_record_id
      and e.review_status = 'verified'

    union all

    -- Recursive: trace upstream
    select 
      e.edge_id,
      e.target_record_id, 
      e.source_record_id, 
      e.source_var_name,
      e.data_authority,
      e.derivation_type,
      e.ai_expression_summary,
      e.statcan_verbatim_note,
      e.ai_logic_ast,
      l.depth + 1,
      l.path || e.target_record_id
    from corpus_derivation_edge e
    join lineage l on e.target_record_id = l.source_record_id
    where l.depth < p_max_depth
      and not (e.target_record_id = any(l.path)) -- Cycle prevention
      and e.review_status = 'verified'
  )
  select * from lineage;
$$;

revoke execute on function corpus_get_upstream_lineage(uuid, integer) from public, authenticated;
grant execute on function corpus_get_upstream_lineage(uuid, integer) to anon;

-- Fetch the immediate verified inputs for one Searcher results page in one request.
-- SECURITY INVOKER keeps the table's verified-only anon RLS policy in force.
create or replace function corpus_get_direct_inputs(p_target_record_ids uuid[])
returns table (
  edge_id uuid,
  target_record_id uuid,
  source_record_id uuid,
  source_var_name text,
  data_authority text,
  derivation_type text,
  ai_expression_summary text,
  statcan_verbatim_note text
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.edge_id, e.target_record_id, e.source_record_id, e.source_var_name,
         e.data_authority, e.derivation_type, e.ai_expression_summary,
         e.statcan_verbatim_note
    from corpus_derivation_edge e
   where e.target_record_id = any(p_target_record_ids)
     and e.review_status = 'verified'
   order by e.target_record_id, e.source_var_name;
$$;

revoke execute on function corpus_get_direct_inputs(uuid[]) from public, authenticated;
grant execute on function corpus_get_direct_inputs(uuid[]) to anon;

-- Browse the verified graph by derived variable. The count is over targets, not
-- individual edges, so pagination never splits one variable's input set.
create or replace function corpus_list_lineage_targets(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  record_id uuid,
  name text,
  label text,
  survey_acronym text,
  cycle text,
  year integer,
  input_count integer,
  total_count bigint,
  edge_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with targets as (
    select e.target_record_id, count(*)::integer as input_count
    from corpus_derivation_edge e
    where e.review_status = 'verified'
    group by e.target_record_id
  ), filtered as (
    select v.record_id, v.name,
           left(coalesce(nullif(btrim(v.concept), ''),
                         nullif(btrim(v.question_text), ''),
                         nullif(btrim(v.collection_name), ''), v.name), 220) as label,
           v.survey_acronym, v.cycle, v.year, t.input_count
    from targets t
    join corpus_variable v on v.record_id = t.target_record_id
    where nullif(btrim(p_query), '') is null
       or v.name ilike '%' || btrim(p_query) || '%'
       or v.concept ilike '%' || btrim(p_query) || '%'
       or v.question_text ilike '%' || btrim(p_query) || '%'
       or v.survey_acronym ilike '%' || btrim(p_query) || '%'
       or v.cycle ilike '%' || btrim(p_query) || '%'
  )
  select f.record_id, f.name, f.label, f.survey_acronym, f.cycle, f.year,
         f.input_count, count(*) over () as total_count,
         sum(f.input_count) over () as edge_count
  from filtered f
  order by f.input_count desc, f.name, f.record_id
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$$;

revoke execute on function corpus_list_lineage_targets(text, integer, integer) from public, authenticated;
grant execute on function corpus_list_lineage_targets(text, integer, integer) to anon;

-- Enrich the existing bounded recursive traversal with the variable labels used
-- by the explorer. SECURITY INVOKER preserves the verified-only edge policy.
create or replace function corpus_get_lineage_graph(
  p_root_record_id uuid,
  p_max_depth integer default 4
)
returns table (
  edge_id uuid,
  target_record_id uuid,
  target_name text,
  source_record_id uuid,
  source_var_name text,
  source_label text,
  data_authority text,
  derivation_type text,
  ai_expression_summary text,
  statcan_verbatim_note text,
  depth integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select l.edge_id, l.target_record_id, target.name,
         l.source_record_id, l.source_var_name,
         left(coalesce(nullif(btrim(source.concept), ''),
                       nullif(btrim(source.question_text), ''),
                       nullif(btrim(source.collection_name), ''),
                       l.source_var_name), 220),
         l.data_authority, l.derivation_type, l.ai_expression_summary,
         l.statcan_verbatim_note, l.depth
  from corpus_get_upstream_lineage(p_root_record_id, least(greatest(p_max_depth, 1), 5)) l
  join corpus_variable target on target.record_id = l.target_record_id
  left join corpus_variable source on source.record_id = l.source_record_id
  order by l.depth, target.name, l.source_var_name;
$$;

revoke execute on function corpus_get_lineage_graph(uuid, integer) from public, authenticated;
grant execute on function corpus_get_lineage_graph(uuid, integer) to anon;
