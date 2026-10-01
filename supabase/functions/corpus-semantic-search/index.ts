/**
 * Server-side semantic search proxy using Qdrant Cloud.
 * Keeps QDRANT_API_KEY secure in edge function environment.
 * Uses Qdrant Cloud server-side inference (sentence-transformers/all-minilm-l6-v2).
 */

const DEFAULT_COLLECTION = 'modularsurvey';
const DEFAULT_MODEL = 'sentence-transformers/all-minilm-l6-v2';
const DEFAULT_THRESHOLD = 0.55;

function allowedOrigin(origin: string | null): boolean {
  return (
    origin === null ||
    origin === 'https://p3ji.github.io' ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  );
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
  } catch {
    /* ignore parse errors */
  }
  return keys.filter((key): key is string => Boolean(key));
}

interface FilterRequest {
  survey_group?: string;
  year_min?: number;
  year_max?: number;
  subject?: string;
  role?: string;
  hide_process?: boolean;
  require_codes?: boolean;
  lang?: string;
}

interface SearchRequestBody {
  query?: string;
  limit?: number;
  score_threshold?: number;
  filters?: FilterRequest;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) {
    return json({ error: 'Origin is not allowed.' }, 403, null);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405, origin);
  }

  // Validate anon/publishable key if present in deployment
  const apiKey = request.headers.get('apikey');
  const allowedKeys = publishableKeys();
  if (allowedKeys.length > 0 && (!apiKey || !allowedKeys.includes(apiKey))) {
    return json({ error: 'Invalid project key.' }, 401, origin);
  }

  const qdrantUrl = (Deno.env.get('QDRANT_URL') || Deno.env.get('QDRANT_ENDPOINT'))?.replace(/\/+$/, '');
  const qdrantKey = Deno.env.get('QDRANT_API_KEY');
  const collection = Deno.env.get('QDRANT_COLLECTION') || DEFAULT_COLLECTION;

  if (!qdrantUrl || !qdrantKey) {
    return json({ points: [], error: 'Semantic search is not configured on this instance.' }, 200, origin);
  }

  let body: SearchRequestBody;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 2048) {
      throw new Error('Payload too large');
    }
    body = (await request.json()) as SearchRequestBody;
    if (typeof body.query !== 'string') {
      throw new Error('Missing query');
    }
    body.query = body.query.replace(/\s+/g, ' ').trim();
    if (body.query.length < 2 || body.query.length > 300) {
      throw new Error('Invalid query length');
    }
  } catch (err) {
    return json({ points: [], error: 'Enter a search phrase of 2–300 characters.' }, 400, origin);
  }

  const limit = Math.min(Math.max(body.limit ?? 10, 1), 50);
  const threshold = typeof body.score_threshold === 'number' ? body.score_threshold : DEFAULT_THRESHOLD;

  // Build Qdrant filter
  const must: unknown[] = [];
  const mustNot: unknown[] = [];

  const filters = body.filters;
  if (filters) {
    if (filters.survey_group) {
      must.push({ key: 'survey_group', match: { value: filters.survey_group } });
    }
    if (filters.subject) {
      must.push({ key: 'subject', match: { value: filters.subject } });
    }
    if (filters.role) {
      must.push({ key: 'role', match: { value: filters.role } });
    }
    if (filters.hide_process) {
      mustNot.push({ key: 'role', match: { value: 'process' } });
    }
    if (filters.require_codes) {
      must.push({ key: 'has_codes', match: { value: true } });
    }
    if (filters.lang) {
      must.push({ key: 'lang', match: { value: filters.lang } });
    }
    if (typeof filters.year_min === 'number' || typeof filters.year_max === 'number') {
      const range: Record<string, number> = {};
      if (typeof filters.year_min === 'number') range.gte = filters.year_min;
      if (typeof filters.year_max === 'number') range.lte = filters.year_max;
      must.push({ key: 'year', range });
    }
  }

  const filterClause: Record<string, unknown> = {};
  if (must.length > 0) filterClause.must = must;
  if (mustNot.length > 0) filterClause.must_not = mustNot;

  const t0 = performance.now();
  try {
    const qdrantRes = await fetch(`${qdrantUrl}/collections/${collection}/points/query`, {
      method: 'POST',
      headers: {
        'api-key': qdrantKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          text: body.query,
          model: DEFAULT_MODEL,
        },
        limit,
        score_threshold: threshold,
        ...(Object.keys(filterClause).length > 0 ? { filter: filterClause } : {}),
        with_payload: true,
      }),
      signal: AbortSignal.timeout(4000), // Strict 4s timeout to never hang
    });

    const elapsedMs = Math.round(performance.now() - t0);

    if (!qdrantRes.ok) {
      const errText = await qdrantRes.text().catch(() => '');
      console.warn(`Qdrant query failed (${qdrantRes.status}):`, errText);
      return json({ points: [], latency_ms: elapsedMs, error: 'Semantic retrieval failed.' }, 200, origin);
    }

    const data = (await qdrantRes.json()) as {
      result?: {
        points?: Array<{
          id: string;
          score: number;
          payload?: {
            record_id?: string;
            survey_group?: string;
            year?: number;
            role?: string;
            subject?: string[];
            has_codes?: boolean;
          };
        }>;
      };
    };

    const points = (data.result?.points ?? []).map((p) => ({
      record_id: p.payload?.record_id ?? p.id,
      score: p.score,
      survey_group: p.payload?.survey_group,
      year: p.payload?.year,
      role: p.payload?.role,
      subject: p.payload?.subject,
      has_codes: p.payload?.has_codes,
    }));

    return json({ points, latency_ms: elapsedMs }, 200, origin);
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - t0);
    console.warn('Semantic search error/timeout:', err);
    return json({ points: [], latency_ms: elapsedMs, error: 'Semantic retrieval timed out or failed.' }, 200, origin);
  }
});
