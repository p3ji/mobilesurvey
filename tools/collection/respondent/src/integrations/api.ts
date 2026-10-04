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
import {
  getLocalSurvey,
  isLocalSurvey,
  saveLocalResponse,
  saveLocalParadata,
  surveyCollectsData,
} from '@mobilesurvey/instrument-schema';
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
  anonymized?: boolean;
  status: string;
  instrument: unknown;
}

export async function fetchSurvey(id: string): Promise<ServedSurvey | null> {
  // 1. Check local storage first (user-authored sandbox surveys)
  const local = getLocalSurvey(id);
  if (local) {
    return {
      id: local.id,
      title: local.title,
      requiresAccessCode: local.requiresAccessCode ?? false,
      anonymized: local.anonymized ?? false,
      status: local.status ?? 'published',
      instrument: local.instrument,
    };
  }

  // 2. Try Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { data, error } = await sb()
        .from('surveys')
        .select('id, title, requires_access_code, anonymized, status, instrument_json')
        .eq('id', id)
        .single();
      if (!error && data) {
        const row = data as {
          id: string; title: string; requires_access_code: boolean;
          anonymized?: boolean; status: string; instrument_json: unknown;
        };
        return {
          id: row.id,
          title: row.title,
          requiresAccessCode: row.requires_access_code,
          anonymized: row.anonymized ?? false,
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
  // Exploration-only bundled surveys and local user surveys must never be written to Supabase.
  if (isLocalSurvey(id) || !surveyCollectsData(id)) return;
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
  // 1. User-created local surveys: save to localStorage with zero cloud leakage
  if (isLocalSurvey(surveyId)) {
    saveLocalResponse({
      id: `resp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      surveyId,
      respondentId,
      submittedAt: new Date().toISOString(),
      startedAt: opts?.startedAt ? new Date(opts.startedAt).toISOString() : null,
      durationMs: opts?.durationMs ?? null,
      completed: true,
      pageCountReached: opts?.pageCountReached ?? 0,
      totalPages: opts?.totalPages ?? 0,
      answersJson: answers,
    });
    return { saved: true };
  }

  // 2. Exploration-only bundled surveys are not stored — return without writing.
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

// ── Attachments (sensor-module photos) ────────────────────────────────────────

/**
 * Upload a processed photo blob to the private `attachments` bucket (docs/sensor-module-plan.md
 * D6; bucket + policies: DEPLOYMENT.md). Returns the storage path to keep in the answer.
 * The anon role is INSERT-only on this bucket — respondents can upload but never list or read.
 */
export async function uploadAttachment(
  path: string,
  blob: Blob,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: 'Supabase not configured' };
  try {
    const { error } = await sb().storage.from('attachments').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, ref: path };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── CMS (access codes) ────────────────────────────────────────────────────────

function supabaseCms(): CmsClient {
  return {
    resolveAccessCode: async (code) => {
      const cleanCode = code.trim();
      const { data, error } = await sb()
        .from('access_codes')
        .select('code, survey_id, email, respondent_name, respondent_fields_json, status, completed_at, used_at')
        .eq('code', cleanCode)
        .single();
      if (error || !data) return null;
      const row = data as {
        code: string; survey_id: string; email?: string | null;
        respondent_name: string | null; respondent_fields_json: Record<string, unknown>;
        status?: string; completed_at?: string | null; used_at?: string | null;
      };
      const caseId = `case-${row.code}`;
      return {
        caseId,
        status: row.status ?? (row.used_at ? 'completed' : 'ready'),
        completedAt: row.completed_at ?? row.used_at,
        sample: {
          id: caseId,
          fields: {
            name: row.respondent_name ?? '',
            email: row.email ?? '',
            ...row.respondent_fields_json,
          },
        } as SampleUnit,
      };
    },
    reportStatus: async (caseId, status) => {
      const code = caseId.replace(/^case-/, '');
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {};
      if (status === 'started' || status === 'resumed') {
        patch.status = 'started';
        patch.started_at = now;
      } else if (status === 'complete' || status === 'completed') {
        patch.status = 'completed';
        patch.completed_at = now;
        patch.used_at = now;
      }
      try {
        await sb().from('access_codes').update(patch).eq('code', code);
      } catch {
        /* best-effort */
      }
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

      if (surveyId && isLocalSurvey(surveyId)) {
        saveLocalParadata(surveyId, {
          sessionKey,
          respondentId,
          ts: event.ts,
          type: event.type,
          payload: (event as { payload?: unknown }).payload,
        });
        return;
      }

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

export async function createBackend(opts?: { collectsData?: boolean; surveyId?: string }): Promise<Backend> {
  // Local user surveys run entirely on local mocks with local storage (zero cloud calls)
  if (opts?.surveyId && isLocalSurvey(opts.surveyId)) {
    return {
      online: true,
      cms: mockCmsClient,
      sessionStore: localSessionStore,
      paradata: {
        setSessionKey: () => {},
        emit: (event) => {
          saveLocalParadata(opts.surveyId!, {
            ts: event.ts,
            type: event.type,
            payload: (event as { payload?: unknown }).payload,
          });
        },
        flush: async () => {},
        buffer: () => [],
      },
    };
  }

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
