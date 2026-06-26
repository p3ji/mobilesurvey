/** Designer ↔ backend client: open a survey by id (from a hub link) and save edits back. */
import type { Instrument } from '@mobilesurvey/instrument-schema';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

/** The `?survey=<id>` the designer was opened with, if any. */
export function currentSurveyId(): string | null {
  return new URLSearchParams(window.location.search).get('survey');
}

export async function fetchSurvey(id: string): Promise<Instrument | null> {
  try {
    const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const survey = (await res.json()) as { instrument: Instrument };
    return survey.instrument;
  } catch {
    return null;
  }
}

export async function saveSurvey(id: string, instrument: Instrument): Promise<boolean> {
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
