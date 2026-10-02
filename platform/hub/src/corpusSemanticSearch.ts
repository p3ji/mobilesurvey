/**
 * Client service for calling the server-side semantic search proxy.
 * Does not expose Qdrant API keys to the browser bundle.
 * Falls back silently to empty results if the edge function is unavailable.
 */

const CORPUS_URL = (import.meta.env.VITE_CORPUS_URL as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const CORPUS_KEY = (import.meta.env.VITE_CORPUS_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export interface SemanticHitPoint {
  record_id: string;
  score: number;
  survey_group?: string;
  year?: number;
  role?: string;
  subject?: string[];
  has_codes?: boolean;
}

export interface SemanticSearchOptions {
  limit?: number;
  score_threshold?: number;
  filters?: {
    survey_group?: string;
    survey_groups?: string[];
    year_min?: number;
    year_max?: number;
    subject?: string;
    role?: string;
    hide_process?: boolean;
    require_codes?: boolean;
    lang?: string;
  };
}

export async function searchCorpusSemantic(
  query: string,
  options: SemanticSearchOptions = {},
  signal?: AbortSignal
): Promise<SemanticHitPoint[]> {
  if (!CORPUS_URL || !CORPUS_KEY) return [];

  const trimmed = query.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2) return [];

  try {
    const response = await fetch(`${CORPUS_URL.replace(/\/$/, '')}/functions/v1/corpus-semantic-search`, {
      method: 'POST',
      headers: {
        apikey: CORPUS_KEY,
        Authorization: `Bearer ${CORPUS_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: trimmed,
        limit: options.limit ?? 5,
        score_threshold: options.score_threshold ?? 0.55,
        filters: options.filters,
      }),
      signal: signal ?? AbortSignal.timeout(2500), // Max 2.5s client-side timeout
    });

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as { points?: SemanticHitPoint[]; error?: string };
    if (!Array.isArray(body.points)) {
      return [];
    }

    return body.points;
  } catch (err) {
    // Fail silently so lexical search is never disrupted
    return [];
  }
}
