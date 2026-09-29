-- =============================================================================================
-- StatCan metadata repository — hybrid search: vocabulary and typo tolerance
-- (docs/metadata-repo-plan.md, M5)
--
-- Apply after schema.sql. Idempotent; safe to re-run.
--
-- THE PROBLEM
--   Postgres full-text search matches lexemes exactly. `opioid` returns 96 records; `opiod`
--   returns nothing. A metadata repository that answers a one-letter typo with an empty page
--   reads as "we do not have this", which is the opposite of true.
--
-- WHY A VOCABULARY TABLE RATHER THAN A TRIGRAM INDEX ON THE TEXT
--   A `gin_trgm_ops` index over `search_text` would work and would cost tens of megabytes against
--   a tier that is already the binding constraint. The vocabulary is 27,365 distinct words —
--   under a megabyte — because 194,507 records say the same words repeatedly. Correcting a query
--   is a lookup in the vocabulary, not a scan of the corpus.
-- =============================================================================================

create extension if not exists pg_trgm;

create table if not exists corpus_term (
  term    text primary key,
  -- Records the word appears in. This is the disambiguator when similarity ties, and it is
  -- document frequency rather than total occurrences: a word repeated forty times in one long
  -- note is not more central than a word appearing once in each of forty records.
  records integer not null
);

create index if not exists corpus_term_trgm on corpus_term using gin (term gin_trgm_ops);

alter table corpus_term enable row level security;
drop policy if exists "anon select" on corpus_term;
create policy "anon select" on corpus_term for select to anon using (true);
grant select on corpus_term to anon;
grant select, insert, update, delete on corpus_term to service_role;

-- ---------------------------------------------------------------------------------------------
-- corpus_suggest — "did you mean", ranked so the answer is the word the corpus actually uses
--
-- The ranking blends trigram similarity with document frequency, because similarity alone picks
-- the wrong word on exactly the queries people type:
--
--   maritial → `marital` and `martial` tie at 0.55; marital appears in 616 records, martial in 6
--   diabetis → `diabetic` scores 0.64 against `diabetes` 0.50; diabetes appears in 442, diabetic 72
--
-- `similarity × (1 + ln(records))` reverses both without a special case for either: a rare word
-- being lexically closer is normally a coincidence, and a common word being nearly as close is
-- normally the intent.
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_suggest(
  q              text,
  min_similarity real    default 0.3,
  max_rows       integer default 5
)
returns table (
  term       text,
  records    integer,
  similarity real,
  score      real
)
language sql
stable
parallel safe
as $$
  select t.term,
         t.records,
         similarity(t.term, lower(trim(q)))::real,
         (similarity(t.term, lower(trim(q))) * (1 + ln(greatest(1, t.records))))::real as score
    from corpus_term t
   -- `%` is the index-accelerated operator; the explicit threshold below is what actually gates
   -- the result, since `%` uses the session's pg_trgm.similarity_threshold rather than ours.
   where t.term % lower(trim(q))
     and similarity(t.term, lower(trim(q))) >= coalesce(min_similarity, 0.3)
     -- A word cannot be a correction for itself: if the query already matches the corpus, the
     -- caller wants results, not advice.
     and t.term <> lower(trim(q))
   order by score desc, t.term asc
   limit greatest(1, least(coalesce(max_rows, 5), 25));
$$;

grant execute on function corpus_suggest(text, real, integer) to anon;

-- ---------------------------------------------------------------------------------------------
-- corpus_vocabulary_size — so the UI can say whether the vocabulary has been built at all
-- ---------------------------------------------------------------------------------------------
create or replace function corpus_vocabulary_size()
returns bigint
language sql
stable
parallel safe
as $$
  select count(*) from corpus_term;
$$;

grant execute on function corpus_vocabulary_size() to anon;
