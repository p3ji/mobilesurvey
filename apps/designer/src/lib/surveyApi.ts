/**
 * Designer ↔ Supabase client: open a survey by id (from a hub link) and save edits back.
 * Falls back to the local Hono API when VITE_SUPABASE_URL is not set.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bundledSurvey, surveyCollectsData, type Instrument } from '@mobilesurvey/instrument-schema';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase not configured');
    _sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _sb;
}

/** The `?survey=<id>` the designer was opened with, if any. */
export function currentSurveyId(): string | null {
  return new URLSearchParams(window.location.search).get('survey');
}

export async function fetchSurvey(id: string): Promise<Instrument | null> {
  // Try Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { data, error } = await sb()
        .from('surveys')
        .select('instrument_json')
        .eq('id', id)
        .single();
      if (!error && data) return (data as { instrument_json: Instrument }).instrument_json;
    } catch { /* fall through */ }
  }
  // Local Hono API fallback
  try {
    const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const survey = (await res.json()) as { instrument: Instrument };
      if (survey.instrument) return survey.instrument;
    }
  } catch { /* fall through */ }
  // Bundled fallback — exploration-only demos (e.g. lfs) are never persisted.
  return bundledSurvey(id)?.instrument ?? null;
}

export async function saveSurvey(id: string, instrument: Instrument): Promise<boolean> {
  // Exploration-only bundled surveys are not persisted — no-op success.
  if (!surveyCollectsData(id)) return true;
  // Try Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { error } = await sb()
        .from('surveys')
        .update({ instrument_json: instrument, updated_at: new Date().toISOString() })
        .eq('id', id);
      return !error;
    } catch { /* fall through */ }
  }
  // Local API fallback
  try {
    const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instrument }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
