/** Public Searcher query expansion. The Groq key stays in Supabase Edge Function secrets. */
const MODEL = 'openai/gpt-oss-20b';
const DAILY_LIMIT = 200;

function allowedOrigin(origin: string | null): boolean {
  return origin === null || origin === 'https://p3ji.github.io' ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? 'https://p3ji.github.io',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

function publishableKeys(): string[] {
  const keys = [Deno.env.get('SUPABASE_ANON_KEY')];
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>;
    keys.push(...Object.values(named));
  } catch { /* A malformed injected key list must never allow access. */ }
  return keys.filter((key): key is string => Boolean(key));
}

function secretKey(): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return Object.values(named)[0] ?? null;
  } catch { return null; }
}

function cleanQueries(raw: unknown, original: string): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set([original.toLocaleLowerCase()]);
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.replace(/\s+/g, ' ').trim();
    const key = value.toLocaleLowerCase();
    if (value.length < 2 || value.length > 80 || !/[\p{L}\p{N}]/u.test(value) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
    if (cleaned.length === 3) break;
  }
  return cleaned;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) return json({ error: 'Origin is not allowed.' }, 403, null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);
  if (!publishableKeys().includes(request.headers.get('apikey') ?? '')) {
    return json({ error: 'Invalid project key.' }, 401, origin);
  }

  const groqKey = Deno.env.get('GROQ_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminKey = secretKey();
  if (!groqKey || !supabaseUrl || !adminKey) {
    return json({ error: 'AI search is not configured.' }, 503, origin);
  }

  let query: string;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 1024) throw new Error('Too long');
    const body = await request.json() as { query?: unknown };
    if (typeof body.query !== 'string') throw new Error('Missing query');
    query = body.query.replace(/\s+/g, ' ').trim();
    if (query.length < 3 || query.length > 240) throw new Error('Invalid query length');
  } catch {
    return json({ error: 'Enter a search phrase of 3–240 characters.' }, 400, origin);
  }

  try {
    const claim = await fetch(`${supabaseUrl}/rest/v1/rpc/corpus_claim_ai_search`, {
      method: 'POST',
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_daily_limit: DAILY_LIMIT }),
      signal: AbortSignal.timeout(5000),
    });
    if (!claim.ok) return json({ error: 'AI search quota is unavailable.' }, 503, origin);
    if (await claim.json() !== true) {
      return json({ error: 'The daily AI search limit has been reached. Standard search still works.' }, 429, origin);
    }

    const groq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_completion_tokens: 200,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'survey_search_expansion',
            strict: true,
            schema: {
              type: 'object',
              properties: { queries: { type: 'array', items: { type: 'string' } } },
              required: ['queries'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: 'Expand a search of Statistics Canada survey variable names, labels, question wording, and response categories. Return JSON with 1–3 short alternative search phrases likely to occur in documentation. Preserve the user intent and specificity. Include synonyms or a common technical term when useful. Do not invent survey names, variable names, facts, or citations. Do not add broad categories. If no useful alternative exists, return an empty queries array.',
          },
          { role: 'user', content: query },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!groq.ok) {
      return json({ error: groq.status === 429 ? 'AI search is busy. Try again later.' : 'AI expansion is temporarily unavailable.' }, groq.status === 429 ? 429 : 502, origin);
    }
    const result = await groq.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(result.choices?.[0]?.message?.content ?? '{}') as { queries?: unknown };
    return json({ queries: cleanQueries(parsed.queries, query) }, 200, origin);
  } catch {
    return json({ error: 'AI expansion is temporarily unavailable.' }, 502, origin);
  }
});
