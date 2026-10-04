/**
 * Designer survey client: open a survey by id and save edits.
 * User-created surveys are persisted locally in the browser's localStorage,
 * ensuring zero cloud leakage, full privacy, and zero database quota consumption.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  bundledSurvey,
  surveyCollectsData,
  getLocalSurvey,
  saveLocalSurvey,
  type Instrument,
} from '@mobilesurvey/instrument-schema';

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

export function isLocalSurvey(id: string): boolean {
  return getLocalSurvey(id) !== null || id.startsWith('s-');
}

export async function fetchSurvey(id: string): Promise<Instrument | null> {
  // 1. Check local storage first (user-authored surveys)
  const local = getLocalSurvey(id);
  if (local) return local.instrument;

  // 2. Check bundled surveys (lfs, demo, fsep, etc.)
  const bundled = bundledSurvey(id);
  if (bundled) return bundled.instrument;

  // 3. Fall back to Supabase (if configured)
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

  // 4. Local Hono API fallback
  try {
    const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const survey = (await res.json()) as { instrument: Instrument };
      if (survey.instrument) return survey.instrument;
    }
  } catch { /* fall through */ }

  return null;
}

export async function saveSurvey(id: string, instrument: Instrument): Promise<boolean> {
  // 1. If it's a local survey (or a custom survey id 's-...'), save to localStorage
  if (isLocalSurvey(id)) {
    const existing = getLocalSurvey(id);
    const titleObj = instrument.metadata?.title as Record<string, string> | undefined;
    const title =
      (titleObj && typeof titleObj === 'object'
        ? (titleObj.en ?? Object.values(titleObj)[0])
        : null) || existing?.title || 'Untitled survey';

    saveLocalSurvey({
      id,
      title,
      instrument,
      questionCount: 0,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  }

  // 2. Exploration-only bundled surveys are not persisted — no-op success.
  if (!surveyCollectsData(id)) return true;

  // 3. Try Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { error } = await sb()
        .from('surveys')
        .update({ instrument_json: instrument, updated_at: new Date().toISOString() })
        .eq('id', id);
      return !error;
    } catch { /* fall through */ }
  }

  // 4. Local API fallback
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
