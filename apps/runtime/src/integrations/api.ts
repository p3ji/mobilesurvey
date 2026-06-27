/**
 * Supabase-backed implementations of the runtime integration interfaces.
 * Falls back to local mocks when VITE_SUPABASE_URL is not configured.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CmsClient,
  ParadataEvent,
  ParadataSink,
  SampleUnit,
  SessionStore,
} from '@mobilesurvey/runtime-engine';
import { surveyCollectsData } from '@mobilesurvey/instrument-schema';
import { createMockParadataSink, localSessionStore, mockCmsClient } from './mocks.js';

// ── Supabase client ───────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase not configured');
    _sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _sb;
}

// ── Survey loading ────────────────────────────────────────────────────────────

export interface ServedSurvey {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  status: string;
  instrument: unknown;
}

export async function fetchSurvey(id: string): Promise<ServedSurvey | null> {
  // Try Supabase first
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { data, error } = await sb()
        .from('surveys')
        .select('id, title, requires_access_code, status, instrument_json')
        .eq('id', id)
        .single();
      if (!error && data) {
        const row = data as {
          id: string; title: string; requires_access_code: boolean;
          status: string; instrument_json: unknown;
        };
        return {
          id: row.id,
          title: row.title,
          requiresAccessCode: row.requires_access_code,
          status: row.status,
          instrument: row.instrument_json,
        };
      }
    } catch { /* fall through */ }
  }
  // Local API fallback
  try {
    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';
    const res = await fetch(`${base}/api/surveys/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return (await res.json()) as ServedSurvey;
  } catch { /* not reachable */ }
  return null;
}

// ── Survey row seeding ────────────────────────────────────────────────────────

/**
 * Ensure a survey row exists in Supabase so the FK on responses.survey_id is satisfied.
 * Called when the runtime falls back to a bundled instrument for a known alias (e.g. "demo").
 */
export async function ensureSurveyRow(
  id: string,
  title: string,
  instrument: unknown,
  opts?: { requiresAccessCode?: boolean },
): Promise<void> {
  // Exploration-only bundled surveys must never be written to the backend.
  if (!surveyCollectsData(id)) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await sb().from('surveys').upsert(
      {
        id,
        title,
        instrument_json: instrument,
        requires_access_code: opts?.requiresAccessCode ?? false,
        status: 'published',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  } catch { /* best-effort */ }
}

// ── Response submission ───────────────────────────────────────────────────────

export async function submitResponse(
  surveyId: string,
  respondentId: string,
  answers: Record<string, unknown>,
  opts?: { startedAt?: number; durationMs?: number; pageCountReached?: number; totalPages?: number },
): Promise<{ saved: boolean; errorMsg?: string }> {
  // Exploration-only bundled surveys are not stored — return without writing.
  if (!surveyCollectsData(surveyId)) return { saved: false };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { saved: false, errorMsg: 'Supabase env vars not configured in this build.' };
  try {
    const { error } = await sb().from('responses').insert({
      survey_id: surveyId,
      respondent_id: respondentId,
      answers_json: answers,
      started_at: opts?.startedAt ? new Date(opts.startedAt).toISOString() : null,
      duration_ms: opts?.durationMs ?? null,
      page_count_reached: opts?.pageCountReached ?? 0,
      total_pages: opts?.totalPages ?? 0,
      completed: true,
    });
    if (error) return { saved: false, errorMsg: `${error.code}: ${error.message}` };
    return { saved: true };
  } catch (e) {
    return { saved: false, errorMsg: String(e) };
  }
}

// ── CMS (access codes) ────────────────────────────────────────────────────────

function supabaseCms(): CmsClient {
  return {
    resolveAccessCode: async (code) => {
      const { data, error } = await sb()
        .from('access_codes')
        .select('code, survey_id, respondent_name, respondent_fields_json')
        .eq('code', code)
        .single();
      if (error || !data) return null;
      const row = data as {
        code: string; survey_id: string;
        respondent_name: string | null; respondent_fields_json: Record<string, unknown>;
      };
      const caseId = `case-${row.code}`;
      return {
        caseId,
        sample: {
          id: caseId,
          fields: { name: row.respondent_name ?? '', ...row.respondent_fields_json },
        } as SampleUnit,
      };
    },
    reportStatus: async (_caseId, _status) => {
      /* status tracking not yet in the schema — no-op */
    },
  };
}

// ── Session store ─────────────────────────────────────────────────────────────

function supabaseSessionStore(): SessionStore {
  return {
    save: async (key, state) => {
      const surveyId = key.split('::')[0] ?? null;
      await sb().from('sessions').upsert({
        key,
        survey_id: surveyId,
        state_json: state,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    },
    load: async (key) => {
      const { data, error } = await sb()
        .from('sessions')
        .select('state_json')
        .eq('key', key)
        .single();
      if (error || !data) return null;
      return (data as { state_json: unknown }).state_json;
    },
    clear: async (key) => {
      await sb().from('sessions').delete().eq('key', key);
    },
  };
}

// ── Paradata sink ─────────────────────────────────────────────────────────────

export type RuntimeParadataSink = ParadataSink & { setSessionKey?(key: string): void };

function supabaseParadataSink(): RuntimeParadataSink {
  const events: ParadataEvent[] = [];
  let sessionKey: string | undefined;
  return {
    setSessionKey: (key) => { sessionKey = key; },
    emit: (event) => {
      events.push(event);
      const surveyId = sessionKey?.split('::')?.[0] ?? null;
      const respondentId = sessionKey?.split('::')?.[1] ?? null;
      void (async () => {
        try {
          await sb().from('paradata').insert({
            session_key: sessionKey ?? null,
            survey_id: surveyId,
            respondent_id: respondentId,
            ts: new Date(event.ts).toISOString(),
            type: event.type,
            payload_json: (event as { payload?: unknown }).payload ?? null,
          });
        } catch { /* best-effort */ }
      })();
    },
    flush: async () => { /* events sent on emit */ },
    buffer: () => [...events],
  };
}

// ── Backend factory ───────────────────────────────────────────────────────────

export interface Backend {
  online: boolean;
  cms: CmsClient;
  sessionStore: SessionStore;
  paradata: RuntimeParadataSink;
}

export async function createBackend(opts?: { collectsData?: boolean }): Promise<Backend> {
  // Exploration-only surveys run entirely on local mocks — nothing reaches Supabase.
  if (SUPABASE_URL && SUPABASE_KEY && opts?.collectsData !== false) {
    return {
      online: true,
      cms: supabaseCms(),
      sessionStore: supabaseSessionStore(),
      paradata: supabaseParadataSink(),
    };
  }
  // Offline fallback: mocks
  return {
    online: false,
    cms: mockCmsClient,
    sessionStore: localSessionStore,
    paradata: createMockParadataSink(),
  };
}
