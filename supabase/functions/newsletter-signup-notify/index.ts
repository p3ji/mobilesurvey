/** Database-only notification endpoint. Neither secret is included in the browser bundle. */
interface SignupPayload {
  type: string;
  table: string;
  schema: string;
  record?: {
    id?: string;
    email?: string;
    language?: string;
    consented_at?: string;
  };
}

const reply = (status: number) => new Response(null, { status });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405);

  const webhookToken = Deno.env.get('NEWSLETTER_WEBHOOK_TOKEN');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NEWSLETTER_FROM_EMAIL');
  const notifyTo = Deno.env.get('NEWSLETTER_NOTIFY_TO');
  if (!webhookToken || !resendKey || !from || !notifyTo) return reply(503);
  if (request.headers.get('x-newsletter-webhook-token') !== webhookToken) return reply(401);
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return reply(413);

  let payload: SignupPayload;
  try {
    payload = await request.json() as SignupPayload;
  } catch {
    return reply(400);
  }
  const row = payload.record;
  if (
    payload.type !== 'INSERT' || payload.schema !== 'public' ||
    payload.table !== 'newsletter_subscribers' || !row ||
    !/^[a-f0-9-]{36}$/i.test(row.id ?? '') ||
    typeof row.email !== 'string' || row.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
    (row.language !== 'en' && row.language !== 'fr')
  ) return reply(400);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `newsletter-signup/${row.id}`,
    },
    body: JSON.stringify({
      from,
      to: [notifyTo],
      subject: 'New Modular Survey Tools updates signup',
      text: `A new person signed up for updates.\n\nEmail: ${row.email}\nLanguage: ${row.language}\nSigned up: ${row.consented_at ?? 'unknown'}\n\nSubscriber ID: ${row.id}`,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { name?: string; message?: string };
    console.error('Newsletter notification delivery failed', response.status, detail.name, detail.message);
    return Response.json({ providerStatus: response.status, code: detail.name ?? 'unknown' }, { status: 502 });
  }
  return reply(204);
});
