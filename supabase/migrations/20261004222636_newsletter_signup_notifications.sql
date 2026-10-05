-- Send an asynchronous, authenticated webhook for each newly stored signup.
-- Provision the Vault secrets newsletter_webhook_token and newsletter_notification_url
-- before enabling this trigger in production. No email API key is stored in Postgres.
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.notify_newsletter_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_token text;
  notification_url text;
begin
  select decrypted_secret into webhook_token
  from vault.decrypted_secrets where name = 'newsletter_webhook_token';
  select decrypted_secret into notification_url
  from vault.decrypted_secrets where name = 'newsletter_notification_url';

  if webhook_token is null or notification_url is null then
    raise warning 'Newsletter notification is not configured';
    return new;
  end if;

  perform net.http_post(
    url := notification_url,
    body := jsonb_build_object(
      'type', 'INSERT',
      'schema', 'public',
      'table', 'newsletter_subscribers',
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-newsletter-webhook-token', webhook_token
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

revoke all on function private.notify_newsletter_signup() from public, anon, authenticated;
drop trigger if exists newsletter_signup_notify on public.newsletter_subscribers;
create trigger newsletter_signup_notify
after insert on public.newsletter_subscribers
for each row execute function private.notify_newsletter_signup();
