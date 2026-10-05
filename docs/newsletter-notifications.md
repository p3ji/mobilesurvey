# Updates signup notifications

The Hub footer inserts consented addresses into `public.newsletter_subscribers`. An `AFTER INSERT` trigger calls `private.notify_newsletter_signup()`, which queues an authenticated `pg_net` request to the `newsletter-signup-notify` Edge Function. The function sends one Resend notification to `contact@peji.ca`. Duplicate signups do not insert a second row, so they do not trigger another alert.

## Configuration

- Edge Function secrets: `RESEND_API_KEY`, `NEWSLETTER_WEBHOOK_TOKEN`, `NEWSLETTER_FROM_EMAIL`, and `NEWSLETTER_NOTIFY_TO`. The production sender and recipient are `contact@peji.ca`.
- Vault secrets: `newsletter_webhook_token` (same random value as the Edge Function secret) and `newsletter_notification_url` (the function URL). The webhook token and API key must never be in browser `VITE_*` variables or Git.
- The `peji.ca` sending domain must stay verified in Resend. If it becomes unverified, signups still save, but email delivery fails.

## Verification and operations

On 2026-10-04, a synthetic insert reached the function and Resend accepted the message (HTTP 204 returned by the function). All synthetic subscriber rows were then deleted. This confirms provider acceptance; it does not prove final inbox placement.

Check `net._http_response` for webhook HTTP status and the Edge Function logs for Resend failures. A `502` means Resend rejected the notification; a `503` means a required Edge Function secret is missing. The function uses a Resend idempotency key based on subscriber ID, so a prompt retry within Resend's retention window cannot duplicate the message.
