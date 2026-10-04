-- Public, append-only expression of consent for Modular Survey Tools updates.
-- Subscriber addresses are never readable through the public Data API.
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  language text not null default 'en' check (language in ('en', 'fr')),
  consented_at timestamptz not null default now(),
  consent_version text not null default '2026-10-04',
  source text not null default 'hub_footer',
  constraint newsletter_email_format check (
    email = lower(btrim(email))
    and length(email) between 5 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint newsletter_consent_version check (consent_version = '2026-10-04'),
  constraint newsletter_source check (source = 'hub_footer')
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists newsletter_public_signup on public.newsletter_subscribers;
create policy newsletter_public_signup
  on public.newsletter_subscribers
  for insert to anon
  with check (true);

revoke all on public.newsletter_subscribers from anon, authenticated;
grant insert (email, language) on public.newsletter_subscribers to anon;
