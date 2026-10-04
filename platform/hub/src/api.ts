/**
 * Hub ↔ Supabase client for the surveys resource.
 * Falls back to the local Hono API when VITE_SUPABASE_URL is not set.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  compareInstrumentVersions,
  createLocalSurvey,
  deleteLocalSurvey,
  getLocalSurvey,
  isLocalSurvey,
  listLocalParadata,
  listLocalResponses,
  updateLocalSurveyConfig,
  type Instrument,
} from '@mobilesurvey/instrument-schema';
import { SupabaseCorpusSource } from '@mobilesurvey/metadata-registry';

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

/** Append-only newsletter signup. Duplicate addresses receive the same public success state. */
export async function subscribeToUpdates(email: string, language: 'en' | 'fr'): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Signup is unavailable in this local preview.');
  const { error } = await sb().from('newsletter_subscribers').insert({
    email: email.trim().toLowerCase(),
    language,
  });
  if (error && error.code !== '23505') throw new Error('Unable to save your signup. Please try again.');
}

// ── App deep links ────────────────────────────────────────────────────────────

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export const DESIGNER_URL =
  (import.meta.env.VITE_DESIGNER_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5173' : '/designer');

export const RUNTIME_URL =
  (import.meta.env.VITE_RUNTIME_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5174' : '/respondent');

export const designerLink = (id: string) => `${DESIGNER_URL}/?survey=${encodeURIComponent(id)}`;

// ── StatCan corpus source ─────────────────────────────────────────────────────

/**
 * The corpus may live in its own Supabase project rather than the app's.
 *
 * Not premature generality: the corpus is the only thing here big enough to approach the 500 MB
 * tier cap, and it is read-only reference data with a completely different lifecycle from survey
 * responses. Splitting it is a realistic deployment, and a deployment shape that needs a code
 * change is one nobody adopts. Unset, these fall back to the app's project.
 */
const CORPUS_URL = (import.meta.env.VITE_CORPUS_URL as string | undefined) ?? SUPABASE_URL;
const CORPUS_KEY = (import.meta.env.VITE_CORPUS_ANON_KEY as string | undefined) ?? SUPABASE_KEY;

/**
 * The StatCan metadata corpus, or `null` when this deployment has no Supabase configured.
 *
 * Returning `null` rather than throwing is deliberate: the corpus is an *additional* source, and
 * the Searcher must keep working over bundled instruments on a laptop with no backend (plan §5).
 * Callers branch on the null instead of catching.
 *
 * The key here is the publishable anon key and the table grants it `select` only — the loader's
 * service-role key never reaches a browser (docs/metadata-repo-plan.md D5).
 */
let _corpus: SupabaseCorpusSource | null | undefined;
export function corpusSource(): SupabaseCorpusSource | null {
  if (_corpus === undefined) {
    _corpus =
      CORPUS_URL && CORPUS_KEY
        ? new SupabaseCorpusSource({ url: CORPUS_URL, anonKey: CORPUS_KEY })
        : null;
  }
  return _corpus;
}
export const respondentLink = (id: string, params?: Record<string, string>) => {
  const base = `${RUNTIME_URL}/?survey=${encodeURIComponent(id)}`;
  if (!params) return base;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  const str = q.toString();
  return str ? `${base}&${str}` : base;
};

export const personalizedRespondentLink = (id: string, token: string, extraParams?: Record<string, string>) => {
  return respondentLink(id, { token, ...extraParams });
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type SurveyStatus = 'draft' | 'published';

export interface SurveySummary {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  anonymized?: boolean;
  status: SurveyStatus;
  questionCount: number;
  updatedAt: number;
  responseCount: number;
}

export type AccessCodeStatus = 'ready' | 'sent' | 'started' | 'completed';

export interface AccessCodeRow {
  code: string;
  surveyId: string;
  email: string | null;
  respondentName: string | null;
  respondentFieldsJson: Record<string, unknown>;
  status: AccessCodeStatus;
  sentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  usedAt: string | null;
}

export interface ResponseRow {
  id: string;
  respondentId: string;
  submittedAt: string;
  durationMs: number | null;
  completed: boolean;
  answersJson: Record<string, unknown>;
  instrumentVersion: string | null;
  instrumentSha256: string | null;
}

export interface SurveyParadataRow {
  id: number;
  sessionKey: string | null;
  respondentId: string | null;
  ts: string;
  type: string;
  payloadJson: unknown;
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
    .select('id, title, requires_access_code, anonymized, status, question_count, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  // Count in Postgres: fetching IDs silently truncates at the Data API row limit.
  const ids = (surveys ?? []).map((s: { id: string }) => s.id);
  let counts: Record<string, number> = {};
  if (ids.length > 0) {
    const results = await Promise.all(ids.map(async (id) => {
      const { count, error: countError } = await sb()
        .from('responses')
        .select('id', { count: 'exact', head: true })
        .eq('survey_id', id);
      if (countError) throw countError;
      return [id, count ?? 0] as const;
    }));
    counts = Object.fromEntries(results);
  }

  return (surveys ?? []).map((r: {
    id: string; title: string; requires_access_code: boolean;
    anonymized?: boolean; status: string; question_count: number; updated_at: string;
  }) => ({
    id: r.id,
    title: r.title,
    requiresAccessCode: r.requires_access_code,
    anonymized: r.anonymized ?? false,
    status: r.status as SurveyStatus,
    questionCount: r.question_count,
    updatedAt: new Date(r.updated_at).getTime(),
    responseCount: counts[r.id] ?? 0,
  }));
}

/**
 * Create a visitor survey. Always stored in the browser (localStore) — the public demo never
 * writes visitor-authored instruments to the shared Supabase project.
 */
export async function createSurvey(title: string, instrument: Instrument): Promise<string> {
  return createLocalSurvey(title, instrument).id;
}

export async function setSurveyConfig(
  id: string,
  config: { requiresAccessCode?: boolean; anonymized?: boolean; status?: SurveyStatus },
): Promise<void> {
  if (isLocalSurvey(id) && getLocalSurvey(id)) {
    updateLocalSurveyConfig(id, config);
    return;
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (config.requiresAccessCode !== undefined) patch.requires_access_code = config.requiresAccessCode;
  if (config.anonymized !== undefined) patch.anonymized = config.anonymized;
  if (config.status !== undefined) patch.status = config.status;
  const { error } = await sb().from('surveys').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Access codes & sample recipients ──────────────────────────────────────────

const MOCK_CODES_KEY = 'mobilesurvey:mock_access_codes';

function getMockAccessCodes(): AccessCodeRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MOCK_CODES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setMockAccessCodes(rows: AccessCodeRow[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MOCK_CODES_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

export async function fetchAccessCodes(surveyId: string): Promise<AccessCodeRow[]> {
  if (isLocalSurvey(surveyId)) return getMockAccessCodes().filter((r) => r.surveyId === surveyId);
  try {
    const { data, error } = await sb()
      .from('access_codes')
      .select('code, survey_id, email, respondent_name, respondent_fields_json, status, sent_at, started_at, completed_at, used_at')
      .eq('survey_id', surveyId)
      .order('code', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: {
      code: string; survey_id: string; email: string | null;
      respondent_name: string | null; respondent_fields_json: Record<string, unknown>;
      status: string | null; sent_at: string | null; started_at: string | null;
      completed_at: string | null; used_at: string | null;
    }) => ({
      code: r.code,
      surveyId: r.survey_id,
      email: r.email ?? null,
      respondentName: r.respondent_name ?? null,
      respondentFieldsJson: r.respondent_fields_json ?? {},
      status: (r.status ?? (r.used_at ? 'completed' : 'ready')) as AccessCodeStatus,
      sentAt: r.sent_at ?? null,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? r.used_at ?? null,
      usedAt: r.used_at ?? null,
    }));
  } catch {
    return getMockAccessCodes().filter((r) => r.surveyId === surveyId);
  }
}

export async function saveAccessCodes(
  surveyId: string,
  records: Array<{
    code: string;
    email?: string | null;
    respondentName?: string | null;
    respondentFieldsJson?: Record<string, unknown>;
    status?: AccessCodeStatus;
  }>,
): Promise<void> {
  const rows = records.map((r) => ({
    code: r.code.trim(),
    survey_id: surveyId,
    email: r.email?.trim() || null,
    respondent_name: r.respondentName?.trim() || null,
    respondent_fields_json: r.respondentFieldsJson ?? {},
    status: r.status ?? 'ready',
  }));

  const writeLocal = () => {
    const all = getMockAccessCodes().filter((existing) => !rows.some((r) => r.code === existing.code));
    for (const r of rows) {
      all.push({
        code: r.code,
        surveyId: r.survey_id,
        email: r.email,
        respondentName: r.respondent_name,
        respondentFieldsJson: r.respondent_fields_json,
        status: r.status as AccessCodeStatus,
        sentAt: null,
        startedAt: null,
        completedAt: null,
        usedAt: null,
      });
    }
    setMockAccessCodes(all);
  };

  // Local sandbox surveys keep their sample list on-device only.
  if (isLocalSurvey(surveyId)) { writeLocal(); return; }

  try {
    const { error } = await sb().from('access_codes').upsert(rows, { onConflict: 'code' });
    if (error) throw error;
  } catch {
    writeLocal();
  }
}

/** True when the code lives in the on-device mock store (local sandbox survey or offline fallback). */
function isMockCode(code: string): boolean {
  return getMockAccessCodes().some((r) => r.code === code);
}

export async function updateAccessCode(
  code: string,
  patch: Partial<AccessCodeRow>,
): Promise<void> {
  const writeLocal = () => {
    const all = getMockAccessCodes();
    const idx = all.findIndex((r) => r.code === code);
    const item = idx !== -1 ? all[idx] : undefined;
    if (item) {
      all[idx] = { ...item, ...patch };
      setMockAccessCodes(all);
    }
  };
  // A Supabase update matching zero rows returns no error, so route mock codes explicitly.
  if (isMockCode(code)) { writeLocal(); return; }

  const dbPatch: Record<string, unknown> = {};
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.respondentName !== undefined) dbPatch.respondent_name = patch.respondentName;
  if (patch.sentAt !== undefined) dbPatch.sent_at = patch.sentAt;
  if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) {
    dbPatch.completed_at = patch.completedAt;
    dbPatch.used_at = patch.completedAt;
  }

  try {
    const { error } = await sb().from('access_codes').update(dbPatch).eq('code', code);
    if (error) throw error;
  } catch {
    writeLocal();
  }
}

export async function deleteAccessCode(code: string): Promise<void> {
  const writeLocal = () => setMockAccessCodes(getMockAccessCodes().filter((r) => r.code !== code));
  if (isMockCode(code)) { writeLocal(); return; }
  try {
    const { error } = await sb().from('access_codes').delete().eq('code', code);
    if (error) throw error;
  } catch {
    writeLocal();
  }
}

export async function clearAccessCodes(surveyId: string): Promise<void> {
  const writeLocal = () => setMockAccessCodes(getMockAccessCodes().filter((r) => r.surveyId !== surveyId));
  if (isLocalSurvey(surveyId)) { writeLocal(); return; }
  try {
    const { error } = await sb().from('access_codes').delete().eq('survey_id', surveyId);
    if (error) throw error;
  } catch {
    writeLocal();
  }
}

/** Upsert a survey row by explicit id — used to seed bundled demo surveys into Supabase. */
/**
 * Seed/refresh a bundled-survey row. A missing row is inserted; an existing row is updated
 * when the shipped instrument's `version` is newer than the stored one, or when the versions
 * are equal but the content differs (for bundled surveys the shipped bundle is the source of
 * truth — this self-heals rows written from a half-edited dev snapshot, e.g. a Vite HMR
 * re-mount firing the seeding effect between edits). A stored row that is strictly newer, or
 * identical, is left untouched.
 */
export async function upsertSurvey(id: string, title: string, instrument: Instrument, opts?: {
  requiresAccessCode?: boolean; status?: SurveyStatus;
}): Promise<void> {
  const { data: existing } = await sb()
    .from('surveys')
    .select('instrument_json')
    .eq('id', id)
    .maybeSingle();
  const stored = (existing as { instrument_json?: Instrument } | null)?.instrument_json;
  if (stored !== undefined) {
    const cmp = compareInstrumentVersions(instrument.version, stored?.version ?? '0.0.0');
    if (cmp < 0) return; // stored row is newer — never downgrade
    if (cmp === 0 && JSON.stringify(stored) === JSON.stringify(instrument)) return; // identical
  }
  const { error } = await sb().from('surveys').upsert({
    id,
    title,
    instrument_json: instrument,
    requires_access_code: opts?.requiresAccessCode ?? false,
    status: opts?.status ?? 'published',
    question_count: countQuestions(instrument),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteSurvey(id: string): Promise<void> {
  if (isLocalSurvey(id) && getLocalSurvey(id)) {
    deleteLocalSurvey(id);
    setMockAccessCodes(getMockAccessCodes().filter((r) => r.surveyId !== id));
    return;
  }
  const { error } = await sb().from('surveys').delete().eq('id', id);
  if (error) throw error;
}

// ── Responses (collection monitor) ───────────────────────────────────────────

export async function fetchResponses(surveyId: string): Promise<ResponseRow[]> {
  if (isLocalSurvey(surveyId)) {
    return listLocalResponses(surveyId).map((r) => ({
      id: r.id,
      respondentId: r.respondentId,
      submittedAt: r.submittedAt,
      durationMs: r.durationMs,
      completed: r.completed,
      answersJson: r.answersJson,
      instrumentVersion: r.instrumentVersion ?? null,
      instrumentSha256: r.instrumentSha256 ?? null,
    }));
  }
  type Row = {
    id: string; respondent_id: string; submitted_at: string;
    duration_ms: number | null; completed: boolean; answers_json: Record<string, unknown> | null;
    instrument_version: string | null; instrument_sha256: string | null;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;
  // Keyset paging on the primary key avoids offset shifts as new submissions arrive.
  while (true) {
    let query = sb()
      .from('responses')
      .select('id, respondent_id, submitted_at, duration_ms, completed, answers_json, instrument_version, instrument_sha256')
      .eq('survey_id', surveyId)
      .order('id', { ascending: true })
      .limit(500);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1]!.id;
  }
  return rows.map((r) => ({
    id: r.id,
    respondentId: r.respondent_id,
    submittedAt: r.submitted_at,
    durationMs: r.duration_ms,
    completed: r.completed,
    answersJson: r.answers_json ?? {},
    instrumentVersion: r.instrument_version,
    instrumentSha256: r.instrument_sha256,
  })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
}

export async function fetchSurveyParadata(surveyId: string): Promise<SurveyParadataRow[]> {
  if (isLocalSurvey(surveyId)) {
    return listLocalParadata(surveyId).map((p) => ({
      id: p.id,
      sessionKey: p.sessionKey,
      respondentId: p.respondentId,
      ts: p.ts,
      type: p.type,
      payloadJson: p.payloadJson,
    }));
  }
  type Row = {
    id: number; session_key: string | null; respondent_id: string | null;
    ts: string; type: string; payload_json: unknown;
  };
  const rows: Row[] = [];
  let cursor: number | null = null;
  while (true) {
    let query = sb()
      .from('paradata')
      .select('id, session_key, respondent_id, ts, type, payload_json')
      .eq('survey_id', surveyId)
      .order('id', { ascending: true })
      .limit(500);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1]!.id;
  }
  return rows.map((r) => ({
    id: r.id,
    sessionKey: r.session_key,
    respondentId: r.respondent_id,
    ts: r.ts,
    type: r.type,
    payloadJson: r.payload_json,
  })).sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
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

export async function fetchSurveyInstrument(surveyId: string): Promise<Instrument | null> {
  const local = getLocalSurvey(surveyId);
  if (local) return local.instrument;
  const { data, error } = await sb()
    .from('surveys')
    .select('instrument_json')
    .eq('id', surveyId)
    .single();
  if (error || !data) return null;
  return (data as { instrument_json: Instrument }).instrument_json;
}

// ── CATI: types + local-API client ───────────────────────────────────────────

/** Local Hono API base URL — used for CATI endpoints (not in Supabase schema). */
const LOCAL_API =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:8787' : null);

export type CaseStatus =
  | 'new'
  | 'in_progress'
  | 'complete'
  | 'callback'
  | 'refused'
  | 'non_contact';

export interface CaseDetail {
  id: string;
  fields: Record<string, string | number | boolean>;
  status: CaseStatus;
  interviewerId: string | null;
  callbackAt: number | null;
  callbackNote: string | null;
  accessCode: string | null;
}

export interface InterviewerRow {
  id: string;
  name: string;
  email: string | null;
}

async function localFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!LOCAL_API) return null;
  const res = await fetch(`${LOCAL_API}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('json') ? (res.json() as Promise<T>) : (null as T);
}

export async function fetchCases(interviewerId?: string): Promise<CaseDetail[]> {
  const qs = interviewerId ? `?interviewer_id=${encodeURIComponent(interviewerId)}` : '';
  return (await localFetch<CaseDetail[]>(`/api/cases${qs}`)) ?? [];
}

export async function fetchInterviewers(): Promise<InterviewerRow[]> {
  return (await localFetch<InterviewerRow[]>('/api/interviewers')) ?? [];
}

export async function assignCaseToInterviewer(
  caseId: string,
  interviewerId: string,
): Promise<void> {
  await localFetch(`/api/cases/${encodeURIComponent(caseId)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewerId }),
  });
}

export async function recordCaseOutcome(
  caseId: string,
  outcome: { status: CaseStatus; callbackAt?: number; callbackNote?: string },
): Promise<void> {
  await localFetch(`/api/cases/${encodeURIComponent(caseId)}/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outcome),
  });
}

// ── Connectivity check ────────────────────────────────────────────────────────

/**
 * Resolve a stored attachment ref (photo answers keep the storage path, never bytes) to a
 * short-lived signed URL for display. Needs the demo-only anon SELECT policy on the private
 * `attachments` bucket (DEPLOYMENT.md §9d); returns null when unavailable.
 */
export async function signedAttachmentUrl(ref: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { data, error } = await sb().storage.from('attachments').createSignedUrl(ref, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function pingApi(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const { error } = await sb().from('surveys').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
