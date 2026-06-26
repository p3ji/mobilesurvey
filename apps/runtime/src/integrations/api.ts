/**
 * Real backend clients: fetch-based implementations of the integration interfaces that talk to
 * the `@mobilesurvey/api` service. `createBackend()` probes the API's health endpoint and returns
 * either these API-backed clients (when the server is reachable) or the local mocks (so the static
 * demo keeps working with no server).
 */
import type {
  CmsClient,
  ParadataEvent,
  ParadataSink,
  SampleUnit,
  SessionStore,
} from '@mobilesurvey/runtime-engine';
import { createMockParadataSink, localSessionStore, mockCmsClient } from './mocks.js';

/** API base URL (override with VITE_API_URL). */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

/** A published survey served by the hub/backend. */
export interface ServedSurvey {
  id: string;
  title: string;
  requiresAccessCode: boolean;
  status: string;
  instrument: unknown;
}

/** Fetch a survey definition + its publish config by id (null if not found / unreachable). */
export async function fetchSurvey(id: string): Promise<ServedSurvey | null> {
  try {
    const res = await fetch(`${API_BASE}/api/surveys/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ServedSurvey;
  } catch {
    return null;
  }
}

/** A paradata sink that can be told which session its events belong to. */
export type RuntimeParadataSink = ParadataSink & { setSessionKey?(key: string): void };

export interface Backend {
  /** True when the API service answered the health check. */
  online: boolean;
  cms: CmsClient;
  sessionStore: SessionStore;
  paradata: RuntimeParadataSink;
}

function apiCms(base: string): CmsClient {
  return {
    resolveAccessCode: async (accessCode) => {
      const res = await fetch(`${base}/api/access/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`resolveAccessCode failed: ${res.status}`);
      return (await res.json()) as { caseId: string; sample: SampleUnit };
    },
    reportStatus: async (caseId, status) => {
      await fetch(`${base}/api/cases/${encodeURIComponent(caseId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    },
  };
}

function apiSessionStore(base: string): SessionStore {
  return {
    save: async (key, state) => {
      await fetch(`${base}/api/session`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, state }),
      });
    },
    load: async (key) => {
      const res = await fetch(`${base}/api/session?key=${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { state: unknown };
      return body.state ?? null;
    },
    clear: async (key) => {
      await fetch(`${base}/api/session?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    },
  };
}

/** Posts each event to the API (fire-and-forget) while keeping a local buffer for the UI. */
function apiParadataSink(base: string): RuntimeParadataSink {
  const events: ParadataEvent[] = [];
  let sessionKey: string | undefined;
  return {
    setSessionKey: (key) => {
      sessionKey = key;
    },
    emit: (event) => {
      events.push(event);
      void fetch(`${base}/api/paradata`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: sessionKey, event }),
      }).catch(() => {
        /* best-effort; the local buffer still reflects the trail */
      });
    },
    flush: async () => {
      /* events are sent as they occur */
    },
    buffer: () => [...events],
  };
}

/** Probe the API; fall back to local mocks if it isn't reachable. */
export async function createBackend(): Promise<Backend> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      return {
        online: true,
        cms: apiCms(API_BASE),
        sessionStore: apiSessionStore(API_BASE),
        paradata: apiParadataSink(API_BASE),
      };
    }
  } catch {
    /* server not reachable — use mocks */
  }
  return {
    online: false,
    cms: mockCmsClient,
    sessionStore: localSessionStore,
    paradata: createMockParadataSink(),
  };
}
