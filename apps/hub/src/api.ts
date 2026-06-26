/**
 * Hub ↔ Supabase client for the surveys resource.
 * Falls back to the local Hono API when VITE_SUPABASE_URL is not set.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Instrument } from '@mobilesurvey/instrument-schema';

// ── Supabase client (lazy, only when env vars are present) ────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env vars not set');
    _sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _sb;
}

// ── App deep links ────────────────────────────────────────────────────────────

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export const DESIGNER_URL =
  (import.meta.env.VITE_DESIGNER_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5173' : '/mobilesurvey/designer');

export const RUNTIME_URL =
  (import.meta.env.VITE_RUNTIME_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5174' : '/mobilesurvey/respondent');

export const designerLink = (id: string) => `${DESIGNER_URL}/?survey=${encodeURIComponent(id)}`;
export const respondentLink = (id: string) => `${RUNTIME_URL}/?survey=${encodeURIComponent(id)}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SurveyStatus = 'draft' | 'published';

export interface SurveySummary {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  status: SurveyStatus;
  questionCount: number;
  updatedAt: number;
  responseCount: number;
}

export interface ResponseRow {
  id: string;
  respondentId: string;
  submittedAt: string;
  durationMs: number | null;
  completed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countQuestions(instrument: Instrument): number {
  let n = 0;
  const visit = (node: { type?: string; children?: unknown[]; then?: unknown[]; else?: unknown[] }) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'question') n += 1;
    for (const arr of [node.children, node.then, node.else]) {
      if (Array.isArray(arr)) for (const c of arr) visit(c as never);
    }
  };
  visit(instrument.sequence as never);
  return n;
}

// ── Survey CRUD ───────────────────────────────────────────────────────────────

export async function listSurveys(): Promise<SurveySummary[]> {
  const { data: surveys, error } = await sb()
    .from('surveys')
    .select('id, title, requires_access_code, status, question_count, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  // Fetch response counts in one query
  const ids = (surveys ?? []).map((s: { id: string }) => s.id);
  let counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: resp } = await sb()
      .from('responses')
      .select('survey_id')
      .in('survey_id', ids);
    for (const r of resp ?? []) {
      const row = r as { survey_id: string };
      counts[row.survey_id] = (counts[row.survey_id] ?? 0) + 1;
    }
  }

  return (surveys ?? []).map((r: {
    id: string; title: string; requires_access_code: boolean;
    status: string; question_count: number; updated_at: string;
  }) => ({
    id: r.id,
    title: r.title,
    requiresAccessCode: r.requires_access_code,
    status: r.status as SurveyStatus,
    questionCount: r.question_count,
    updatedAt: new Date(r.updated_at).getTime(),
    responseCount: counts[r.id] ?? 0,
  }));
}

export async function createSurvey(title: string, instrument: Instrument): Promise<string> {
  const id = `s-${Date.now().toString(36)}`;
  const { error } = await sb().from('surveys').insert({
    id,
    title,
    instrument_json: instrument,
    requires_access_code: false,
    status: 'draft',
    question_count: countQuestions(instrument),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return id;
}

export async function setSurveyConfig(
  id: string,
  config: { requiresAccessCode?: boolean; status?: SurveyStatus },
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (config.requiresAccessCode !== undefined) patch.requires_access_code = config.requiresAccessCode;
  if (config.status !== undefined) patch.status = config.status;
  const { error } = await sb().from('surveys').update(patch).eq('id', id);
  if (error) throw error;
}

/** Upsert a survey row by explicit id — used to seed bundled demo surveys into Supabase. */
export async function upsertSurvey(id: string, title: string, instrument: Instrument, opts?: {
  requiresAccessCode?: boolean; status?: SurveyStatus;
}): Promise<void> {
  const { error } = await sb().from('surveys').upsert({
    id,
    title,
    instrument_json: instrument,
    requires_access_code: opts?.requiresAccessCode ?? false,
    status: opts?.status ?? 'published',
    question_count: countQuestions(instrument),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function deleteSurvey(id: string): Promise<void> {
  const { error } = await sb().from('surveys').delete().eq('id', id);
  if (error) throw error;
}

// ── Responses (collection monitor) ───────────────────────────────────────────

export async function fetchResponses(surveyId: string): Promise<ResponseRow[]> {
  const { data, error } = await sb()
    .from('responses')
    .select('id, respondent_id, submitted_at, duration_ms, completed')
    .eq('survey_id', surveyId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: {
    id: string; respondent_id: string; submitted_at: string;
    duration_ms: number | null; completed: boolean;
  }) => ({
    id: r.id,
    respondentId: r.respondent_id,
    submittedAt: r.submitted_at,
    durationMs: r.duration_ms,
    completed: r.completed,
  }));
}

// ── Catalog (for Searcher) ────────────────────────────────────────────────────

export interface InstrumentSummary {
  id: string;
  title: string;
  instrument: Instrument;
}

export async function fetchAllInstruments(): Promise<InstrumentSummary[]> {
  const { data, error } = await sb()
    .from('surveys')
    .select('id, title, instrument_json')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r: { instrument_json: unknown }) => r.instrument_json)
    .map((r: { id: string; title: string; instrument_json: unknown }) => ({
      id: r.id,
      title: r.title,
      instrument: r.instrument_json as Instrument,
    }));
}

// ── Connectivity check ────────────────────────────────────────────────────────

export async function pingApi(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const { error } = await sb().from('surveys').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
