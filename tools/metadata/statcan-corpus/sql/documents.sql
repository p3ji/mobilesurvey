-- =============================================================================================
-- StatCan metadata repository — source documents (docs/metadata-repo-plan.md, M4)
--
-- Apply after schema.sql. Idempotent; safe to re-run.
--
-- WHAT THIS ADDS
--   A record cites `CCHS · 2015 · cchs_2015_f1_T15.6_v1.pdf · p. 176`, which identifies a document
--   and resolves to nothing. The dictionary around a variable carries context its own block does
--   not — derivation notes, universe definitions, the appendices that explain a code — and
--   sometimes that is the only place it exists.
--
--   Linking out to Statistics Canada was measured and rejected: 26 of 581 documents (4.5%) carry
--   an SDDS number in their filename, and even those resolve to a survey landing page rather than
--   to the dictionary.
--
-- THE DDI CONSTRUCT
--   A data dictionary is not a `pi:PhysicalInstance` — we hold the documentation, not the
--   microdata it documents. It is `r:OtherMaterial`: material related to a study, carrying an
--   `r:Citation` and an `r:ExternalURLReference`. This table is that, flattened.
--
-- WHERE THE TEXT LIVES
--   Not here. Postgres keeps identity and citation — 581 small rows — and the reconstructed text
--   goes to Supabase Storage, a separate 1 GB quota, because ~184 MB of text would otherwise
--   compete with the records for the database's 500 MB. See DEPLOYMENT.md §9f.
--
--   Nothing in this file touches `corpus_variable`. The join is on `(bundle, path)`, which every
--   search result and timeline entry already returns, so linking documents costs the occurrence
--   table no schema change at all (D3).
-- =============================================================================================

create table if not exists corpus_document (
  -- UUIDv5 of (bundle, path), the same identity the ETL has minted since M1.
  document_id    uuid primary key,
  bundle         text not null,
  path           text not null,
  -- The filename. These documents carry no title page we can rely on, and a title assembled from
  -- survey and year would read as authoritative while being ours.
  title          text not null,
  survey_group   text not null,
  survey_acronym text,
  cycle          text,
  year           integer,
  lang           text not null,
  tcode          text,
  doc_kind       text not null,
  pages          integer not null default 0,
  characters     integer not null default 0,
  -- Records loaded from this document: what makes it worth having fetched.
  records        integer not null default 0,
  -- False when the row exists but the text did not upload, so a reader can be told "no text
  -- available" instead of meeting a 404 at the bottom of a panel.
  has_text       boolean not null default false
);

-- The lookup the client actually performs. Unique because one path is one document, and a
-- duplicate here would make "open the source" ambiguous.
create unique index if not exists corpus_document_path_idx on corpus_document (bundle, path);
create index if not exists corpus_document_survey_idx on corpus_document (survey_group);

alter table corpus_document enable row level security;

drop policy if exists "anon select" on corpus_document;
create policy "anon select" on corpus_document for select to anon using (true);

grant select on corpus_document to anon;
grant select, insert, update, delete on corpus_document to service_role;

-- ---------------------------------------------------------------------------------------------
-- corpus_document_at — the document behind a record, by the path the record already carries
--
-- Takes `(bundle, path)` rather than a document id so the client needs no id-minting: UUIDv5
-- would mean shipping a SHA-1 implementation to the browser to reconstruct something the server
-- already knows.
--
-- `p_bundle` is nullable and then matches on path alone. `corpus_search` returns both columns,
-- but `corpus_timeline` returns only the path — and adding a column to a function that is already
-- deployed costs a round trip through the SQL editor, where accepting null here costs nothing.
-- Path collisions across bundles are possible in principle; `limit 1` makes the outcome defined
-- rather than dependent on scan order if one ever occurs.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_document_at(p_bundle text, p_path text)
returns table (
  document_id    uuid,
  title          text,
  survey_group   text,
  survey_acronym text,
  cycle          text,
  year           integer,
  lang           text,
  tcode          text,
  doc_kind       text,
  pages          integer,
  characters     integer,
  records        integer,
  has_text       boolean
)
language sql
stable
parallel safe
as $$
  select d.document_id, d.title, d.survey_group, d.survey_acronym, d.cycle, d.year, d.lang,
         d.tcode, d.doc_kind, d.pages, d.characters, d.records, d.has_text
    from corpus_document d
   where d.path = p_path
     and (p_bundle is null or p_bundle = '' or d.bundle = p_bundle)
   limit 1;
$$;

grant execute on function corpus_document_at(text, text) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_documents — browse what has been ingested, largest first
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_documents(
  q          text    default null,
  max_rows   integer default 50,
  row_offset integer default 0
)
returns table (
  document_id    uuid,
  title          text,
  survey_group   text,
  survey_acronym text,
  year           integer,
  lang           text,
  pages          integer,
  records        integer,
  has_text       boolean,
  total_count    bigint
)
language sql
stable
parallel safe
as $$
  with matched as (
    select d.*
      from corpus_document d
     where q is null or trim(q) = ''
        or d.title ilike '%' || q || '%'
        or d.survey_group ilike '%' || q || '%'
        or coalesce(d.survey_acronym, '') ilike '%' || q || '%'
  ),
  counted as (select count(*) as n from matched)
  select m.document_id, m.title, m.survey_group, m.survey_acronym, m.year, m.lang, m.pages,
         m.records, m.has_text, (select n from counted)
    from matched m
   order by m.records desc, m.title asc, m.document_id asc
   limit greatest(1, least(coalesce(max_rows, 50), 200))
  offset greatest(0, coalesce(row_offset, 0));
$$;

grant execute on function corpus_documents(text, integer, integer) to anon;
