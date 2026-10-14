-- ============================================================================
-- Patch 2026-10-14: Canonical Empirical Search Aliases
--
-- Maps standard modern Canadian empirical research terminology, academic constructs,
-- and vocabulary-gap queries directly to StatCan's canonical nomenclature.
-- Prevents 0-hit false dropouts and eliminates misleading spellcheck suggestions.
-- ============================================================================

insert into corpus_search_alias (query, expansion) values
  ('unhoused', 'homelessness'),
  ('opioid crisis', 'opioid'),
  ('opioids', 'opioid'),
  ('substance abuse', 'substance use'),
  ('drug addiction', 'substance use'),
  ('childcare', 'child care'),
  ('childcare subsidy', 'child care subsidy'),
  ('daycare', 'child care'),
  ('fake news', 'misinformation'),
  ('cyberbullying', 'cyber-bullying'),
  ('cyber bullying', 'cyber-bullying'),
  ('cyberattack', 'cyber security'),
  ('cyber attacks', 'cyber security'),
  ('cyber incident', 'cyber security'),
  ('gig economy', 'platform work'),
  ('gig work', 'platform work'),
  ('platform workers', 'platform work'),
  ('hybrid work', 'telework'),
  ('carbon tax', 'carbon pricing'),
  ('racialized', 'visible minority'),
  ('racialized groups', 'visible minority'),
  ('bipoc', 'visible minority'),
  ('lgbt', 'sexual orientation'),
  ('lgbtq', 'sexual orientation'),
  ('lgbtq2s', 'sexual orientation'),
  ('transgender', 'gender'),
  ('wellbeing', 'well-being'),
  ('burnout', 'work stress'),
  ('chronic illness', 'chronic condition'),
  ('student debt', 'student loan'),
  ('student loans', 'student loan')
on conflict (query) do update
  set expansion = excluded.expansion;
