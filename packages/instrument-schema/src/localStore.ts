/**
 * Local storage manager for user-authored surveys.
 * Keeps user questionnaires 100% private to their device with zero cloud leakage.
 */
import type { Instrument } from './types.js';
import { blankInstrument } from './blank.js';
import { bundledSurvey } from './bundled.js';

export interface LocalSurveyRecord {
  id: string;
  title: string;
  instrument: Instrument;
  questionCount: number;
  requiresAccessCode?: boolean;
  anonymized?: boolean;
  status?: 'draft' | 'published';
  createdAt: number;
  updatedAt: number;
}

export const LOCAL_SURVEYS_STORAGE_KEY = 'mobilesurvey_local_surveys_v1';
export const LOCAL_RESPONSES_STORAGE_KEY = 'mobilesurvey_local_responses_v1';
export const LOCAL_PARADATA_STORAGE_KEY = 'mobilesurvey_local_paradata_v1';
export const LOCAL_SURVEYS_CHANGE_EVENT = 'mobilesurvey:local-surveys-change';

/** Helper to count total question nodes inside an instrument sequence. */
export function countQuestions(instrument: Instrument): number {
  let n = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.type === 'question') n += 1;
    for (const key of ['children', 'then', 'else', 'body']) {
      const arr = rec[key];
      if (Array.isArray(arr)) {
        for (const child of arr) visit(child);
      }
    }
  };
  visit(instrument.sequence);
  return n;
}

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function safeGetStorage(): MinimalStorage | null {
  try {
    const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : null;
    if (g && typeof g['localStorage'] === 'object' && g['localStorage'] !== null) {
      return g['localStorage'] as MinimalStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function notifyChange(): void {
  try {
    const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : null;
    const target = g && typeof g['window'] === 'object' && g['window'] !== null ? g['window'] : g;
    if (target && typeof (target as { dispatchEvent?: unknown }).dispatchEvent === 'function') {
      const CustomEventCtor = g ? (g['CustomEvent'] as (new (type: string) => unknown) | undefined) : undefined;
      if (CustomEventCtor) {
        (target as { dispatchEvent: (evt: unknown) => boolean }).dispatchEvent(new CustomEventCtor(LOCAL_SURVEYS_CHANGE_EVENT));
      }
    }
  } catch {
    // Ignore if event dispatch fails in non-browser envs
  }
}

/** Lists all surveys stored in the browser's localStorage. */
export function listLocalSurveys(): LocalSurveyRecord[] {
  const storage = safeGetStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_SURVEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse local surveys from localStorage:', err);
  }
  return [];
}

/** Fetches a specific survey from localStorage by ID. */
export function getLocalSurvey(id: string): LocalSurveyRecord | null {
  return listLocalSurveys().find((s) => s.id === id) ?? null;
}

/** Checks whether a survey ID is a local on-device survey. */
export function isLocalSurvey(id: string | null | undefined): boolean {
  if (!id) return false;
  return getLocalSurvey(id) !== null || id.startsWith('s-');
}

/** Saves or updates a survey in localStorage. */
export function saveLocalSurvey(survey: LocalSurveyRecord): void {
  const storage = safeGetStorage();
  if (!storage) return;
  const current = listLocalSurveys().filter((s) => s.id !== survey.id);
  const updated: LocalSurveyRecord = {
    ...survey,
    questionCount: countQuestions(survey.instrument),
    requiresAccessCode: survey.requiresAccessCode ?? false,
    anonymized: survey.anonymized ?? false,
    status: survey.status ?? 'draft',
    updatedAt: Date.now(),
  };
  current.unshift(updated);
  try {
    storage.setItem(LOCAL_SURVEYS_STORAGE_KEY, JSON.stringify(current));
    notifyChange();
  } catch (err) {
    console.error('Failed to save survey to localStorage:', err);
  }
}

/** Updates configuration fields (access code, status, title) of a local survey. */
export function updateLocalSurveyConfig(
  id: string,
  config: {
    requiresAccessCode?: boolean;
    anonymized?: boolean;
    status?: 'draft' | 'published';
    title?: string;
  },
): boolean {
  const existing = getLocalSurvey(id);
  if (!existing) return false;
  const updated: LocalSurveyRecord = {
    ...existing,
    ...(config.requiresAccessCode !== undefined ? { requiresAccessCode: config.requiresAccessCode } : {}),
    ...(config.anonymized !== undefined ? { anonymized: config.anonymized } : {}),
    ...(config.status !== undefined ? { status: config.status } : {}),
    ...(config.title !== undefined ? { title: config.title } : {}),
    updatedAt: Date.now(),
  };
  saveLocalSurvey(updated);
  return true;
}

/** Creates and saves a new blank (or provided) survey in localStorage. */
export function createLocalSurvey(title: string, customInstrument?: Instrument): LocalSurveyRecord {
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const instrument = customInstrument ? JSON.parse(JSON.stringify(customInstrument)) : blankInstrument(title);

  if (title && instrument.metadata) {
    instrument.metadata.title = {
      ...(typeof instrument.metadata.title === 'object' && instrument.metadata.title !== null ? instrument.metadata.title : {}),
      en: title,
    };
  }

  const now = Date.now();
  const record: LocalSurveyRecord = {
    id,
    title: title || 'Untitled survey',
    instrument,
    questionCount: countQuestions(instrument),
    requiresAccessCode: false,
    anonymized: false,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  saveLocalSurvey(record);
  return record;
}

/** Deletes a survey from localStorage by ID. */
export function deleteLocalSurvey(id: string): boolean {
  const storage = safeGetStorage();
  if (!storage) return false;
  const current = listLocalSurveys();
  const remaining = current.filter((s) => s.id !== id);
  if (remaining.length === current.length) return false;
  try {
    storage.setItem(LOCAL_SURVEYS_STORAGE_KEY, JSON.stringify(remaining));
    deleteLocalResponses(id);
    notifyChange();
    return true;
  } catch (err) {
    console.error('Failed to delete local survey:', err);
    return false;
  }
}

/** Clones an existing local or bundled survey into a new local survey. */
export function cloneLocalSurvey(sourceId: string, newTitle?: string): LocalSurveyRecord | null {
  let sourceInstrument: Instrument | null = null;
  let sourceTitle = 'Cloned Survey';
  let requiresAccessCode = false;

  const local = getLocalSurvey(sourceId);
  if (local) {
    sourceInstrument = JSON.parse(JSON.stringify(local.instrument));
    sourceTitle = local.title;
    requiresAccessCode = local.requiresAccessCode ?? false;
  } else {
    const bundled = bundledSurvey(sourceId);
    if (bundled) {
      sourceInstrument = JSON.parse(JSON.stringify(bundled.instrument));
      sourceTitle = bundled.title;
      requiresAccessCode = bundled.requiresAccessCode;
    }
  }

  if (!sourceInstrument) return null;

  const title = newTitle ?? `${sourceTitle} (Copy)`;
  const created = createLocalSurvey(title, sourceInstrument);
  if (requiresAccessCode) {
    updateLocalSurveyConfig(created.id, { requiresAccessCode });
  }
  return getLocalSurvey(created.id);
}

// ── Local responses storage ───────────────────────────────────────────────────

export interface LocalResponseRecord {
  id: string;
  surveyId: string;
  respondentId: string;
  submittedAt: string;
  startedAt?: string | null;
  durationMs: number | null;
  completed: boolean;
  pageCountReached?: number;
  totalPages?: number;
  answersJson: Record<string, unknown>;
}

export function listLocalResponses(surveyId?: string): LocalResponseRecord[] {
  const storage = safeGetStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_RESPONSES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (surveyId) return parsed.filter((r) => r.surveyId === surveyId);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function countLocalResponses(surveyId: string): number {
  return listLocalResponses(surveyId).length;
}

export function saveLocalResponse(response: LocalResponseRecord): void {
  const storage = safeGetStorage();
  if (!storage) return;
  const all = listLocalResponses().filter((r) => r.id !== response.id);
  all.unshift(response);
  try {
    storage.setItem(LOCAL_RESPONSES_STORAGE_KEY, JSON.stringify(all));
    notifyChange();
  } catch (err) {
    console.error('Failed to save local response:', err);
  }
}

export function deleteLocalResponses(surveyId: string): void {
  const storage = safeGetStorage();
  if (!storage) return;
  const remaining = listLocalResponses().filter((r) => r.surveyId !== surveyId);
  try {
    storage.setItem(LOCAL_RESPONSES_STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    /* ignore */
  }
}

// ── Local paradata storage ───────────────────────────────────────────────────

export interface LocalParadataRecord {
  id: number;
  surveyId: string;
  sessionKey: string | null;
  respondentId: string | null;
  ts: string;
  type: string;
  payloadJson: unknown;
}

function listLocalParadataAll(): LocalParadataRecord[] {
  const storage = safeGetStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_PARADATA_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return [];
}

export function listLocalParadata(surveyId: string): LocalParadataRecord[] {
  return listLocalParadataAll().filter((p) => p.surveyId === surveyId);
}

export function saveLocalParadata(
  surveyId: string,
  event: {
    sessionKey?: string | null;
    respondentId?: string | null;
    ts: number | string;
    type: string;
    payload?: unknown;
  },
): void {
  const storage = safeGetStorage();
  if (!storage) return;
  const all = listLocalParadataAll();
  const nextId = all.length > 0 ? Math.max(...all.map((p) => p.id)) + 1 : 1;
  all.push({
    id: nextId,
    surveyId,
    sessionKey: event.sessionKey ?? null,
    respondentId: event.respondentId ?? null,
    ts: typeof event.ts === 'number' ? new Date(event.ts).toISOString() : event.ts,
    type: event.type,
    payloadJson: event.payload ?? null,
  });
  // Cap at 1000 events
  const trimmed = all.slice(-1000);
  try {
    storage.setItem(LOCAL_PARADATA_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}
