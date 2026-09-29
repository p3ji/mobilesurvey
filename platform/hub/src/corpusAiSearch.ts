/** Optional query expansion. The browser only sends a public Supabase key, never GROQ_API_KEY. */
const CORPUS_URL = (import.meta.env.VITE_CORPUS_URL as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const CORPUS_KEY = (import.meta.env.VITE_CORPUS_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export async function expandCorpusQuery(query: string, signal?: AbortSignal): Promise<string[]> {
  if (!CORPUS_URL || !CORPUS_KEY) throw new Error('AI search needs the corpus Supabase project.');
  const response = await fetch(`${CORPUS_URL.replace(/\/$/, '')}/functions/v1/corpus-ai-expand`, {
    method: 'POST',
    headers: {
      apikey: CORPUS_KEY,
      Authorization: `Bearer ${CORPUS_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
    ...(signal === undefined ? {} : { signal }),
  });
  const body = await response.json().catch(() => ({})) as { queries?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'AI search is temporarily unavailable.');
  }
  return Array.isArray(body.queries)
    ? body.queries.filter((value): value is string => typeof value === 'string').slice(0, 3)
    : [];
}
