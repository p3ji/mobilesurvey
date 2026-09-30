-- AI-assisted Searcher results. Apply after search-performance.sql and subjects.sql.
-- The LLM supplies alternative phrases only. This RPC retrieves and counts distinct variable
-- records, requiring each phrase to match a short metadata field or ONE response-category label.
-- Words scattered across hundreds of unrelated classification categories cannot form a match.
create or replace function corpus_search_ai(
  search_terms   text[],
  lang_filter    text default null,
  survey_filter  text default null,
  year_min       integer default null,
  year_max       integer default null,
  require_codes  boolean default null,
  subject_filter text default null,
  sort_mode      text default 'relevance',
  max_rows       integer default 25,
  row_offset     integer default 0
)
returns table (
  record_id uuid, name text, "position" text, "length" text,
  concept text, question_text text, universe text, note text,
  codes jsonb, code_count integer, bundle text, path text, page integer,
  tcode text, survey_group text, survey_acronym text, cycle text,
  year integer, lang text, rank real, total_count bigint
)
language sql stable parallel safe security invoker set search_path = public
as $$
  with terms as materialized (
    select distinct btrim(t.term) as phrase,
           websearch_to_tsquery('english', btrim(t.term)) as en_query,
           websearch_to_tsquery('french', btrim(t.term)) as fr_query
      from unnest(search_terms[1:3]) as t(term)
     where length(btrim(t.term)) between 2 and 80
  ), candidates as materialized (
    select v.record_id,
           case when field_match.title_match then 4.0
                when field_match.detail_match then 2.0
                else 1.0 end
           + greatest(ts_rank_cd(v.fts, t.en_query), ts_rank_cd(v.fts, t.fr_query)) as score
      from terms t
      join corpus_variable v on v.fts @@ t.en_query or v.fts @@ t.fr_query
      cross join lateral (
        select case when v.lang = 'fr' then t.fr_query else t.en_query end as phrase_query
      ) language_query
      cross join lateral (
        select corpus_tsv(v.lang, concat_ws(' ', v.name, v.concept, v.question_text))
                 @@ language_query.phrase_query as title_match,
               corpus_tsv(v.lang, concat_ws(' ', v.universe, v.note, v.collection_name))
                 @@ language_query.phrase_query as detail_match,
               exists (
                 select 1 from jsonb_array_elements(v.codes) as category(item)
                  where corpus_tsv(v.lang, category.item ->> 'l') @@ language_query.phrase_query
               ) as category_match
      ) field_match
     where (field_match.title_match or field_match.detail_match or field_match.category_match)
       and (lang_filter is null or v.lang = lang_filter)
       and (survey_filter is null or v.survey_acronym = survey_filter or v.survey_group = survey_filter)
       and (year_min is null or v.year >= year_min)
       and (year_max is null or v.year <= year_max)
       and (require_codes is null or (v.code_count > 0) = require_codes)
       and (subject_filter is null or exists (
         select 1 from corpus_survey_subject s
          where s.survey_group = v.survey_group and s.subject = subject_filter
       ))
  ), best as (
    select c.record_id, max(c.score) as score from candidates c group by c.record_id
  ), counted as (select count(*) as n from best)
  select v.record_id, v.name, v.position, v.length, v.concept, v.question_text,
         v.universe, v.note, v.codes, v.code_count, v.bundle, v.path, v.page,
         v.tcode, v.survey_group, v.survey_acronym, v.cycle, v.year, v.lang,
         b.score::real, (select n from counted)
    from best b join corpus_variable v on v.record_id = b.record_id
   order by case when sort_mode = 'recent' then v.year end desc nulls last,
            b.score desc, v.name, v.record_id
   limit greatest(1, least(coalesce(max_rows, 25), 100))
  offset greatest(0, coalesce(row_offset, 0));
$$;
grant execute on function corpus_search_ai(text[], text, text, integer, integer, boolean, text, text, integer, integer) to anon;
