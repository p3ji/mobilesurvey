/** Hub ↔ backend client for the surveys resource, plus links to the other apps. */
import type { Instrument } from '@mobilesurvey/instrument-schema';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

/** Detect if we're running locally (dev) or on GitHub Pages (production). */
function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/** Where the designer and respondent runtime are served (override via env in other deployments). */
export const DESIGNER_URL =
  (import.meta.env.VITE_DESIGNER_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5173' : '/mobilesurvey/designer/');

export const RUNTIME_URL =
  (import.meta.env.VITE_RUNTIME_URL as string | undefined) ??
  (isLocalhost() ? 'http://localhost:5174' : '/mobilesurvey/respondent/');

export type SurveyStatus = 'draft' | 'published';

export interface SurveySummary {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  status: SurveyStatus;
  questionCount: number;
  updatedAt: number;
}

export async function listSurveys(): Promise<SurveySummary[]> {
  const res = await fetch(`${API_BASE}/api/surveys`);
  if (!res.ok) throw new Error(`listSurveys failed: ${res.status}`);
  return (await res.json()) as SurveySummary[];
}

export async function createSurvey(title: string, instrument: Instrument): Promise<string> {
  const res = await fetch(`${API_BASE}/api/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, instrument }),
  });
  if (!res.ok) throw new Error(`createSurvey failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export async function setSurveyConfig(
  id: string,
  config: { requiresAccessCode?: boolean; status?: SurveyStatus },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`setSurveyConfig failed: ${res.status}`);
}

export async function deleteSurvey(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteSurvey failed: ${res.status}`);
}

/** Deep links into the other apps. */
export const designerLink = (id: string) => `${DESIGNER_URL}/?survey=${encodeURIComponent(id)}`;
export const respondentLink = (id: string) => `${RUNTIME_URL}/?survey=${encodeURIComponent(id)}`;

export async function pingApi(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
