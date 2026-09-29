/**
 * In-memory / localStorage mock implementations of the integration boundary for the respondent
 * runtime. A real deployment swaps these for a CMS API, an encrypted server session store, and a
 * paradata sink — without touching the survey engine or UI.
 */
import type {
  CmsClient,
  ParadataEvent,
  ParadataSink,
  SampleUnit,
  SessionStore,
} from '@mobilesurvey/runtime-engine';

/** Demo cases the CMS knows about (in production these come from sample-file ingestion). */
const SAMPLE_UNITS: SampleUnit[] = [
  {
    id: 'case-0001',
    fields: {
      contact_name: 'Jordan Lee',
      region_code: 'QC',
      email: 'jordan.lee@example.org',
    },
  },
  {
    id: 'case-0002',
    fields: {
      contact_name: 'Marie Tremblay',
      region_code: 'ON',
      email: 'marie.t@example.org',
    },
  },
];

/** Access code → case id. Real CMS validates single/multi-use codes server-side. */
const ACCESS_CODES: Record<string, string> = {
  ABC123: 'case-0001',
  DEF456: 'case-0002',
};

export const mockCmsClient: CmsClient = {
  resolveAccessCode: async (accessCode) => {
    // Simulate a little network latency.
    await new Promise((r) => setTimeout(r, 300));
    const caseId = ACCESS_CODES[accessCode.trim().toUpperCase()];
    if (!caseId) return null;
    const sample = SAMPLE_UNITS.find((u) => u.id === caseId)!;
    return { caseId, sample };
  },
  reportStatus: async (caseId, status) => {
    // eslint-disable-next-line no-console
    console.info(`[mock CMS] case ${caseId} → ${status}`);
  },
};

/**
 * localStorage-backed session store. NOTE: the base64 encoding here is obfuscation ONLY — a
 * placeholder for the spec's "encrypted real-time caching". Production must use real encryption
 * (e.g. WebCrypto AES-GCM with a key derived from the access code / session token).
 */
export const localSessionStore: SessionStore = {
  save: async (key, state) => {
    try {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
      localStorage.setItem(`eq:${key}`, encoded);
    } catch {
      /* storage unavailable */
    }
  },
  load: async (key) => {
    try {
      const raw = localStorage.getItem(`eq:${key}`);
      if (!raw) return null;
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch {
      return null;
    }
  },
  clear: async (key) => {
    localStorage.removeItem(`eq:${key}`);
  },
};

/** A paradata sink that buffers events in memory and mirrors them to the console. */
export function createMockParadataSink(): ParadataSink {
  const events: ParadataEvent[] = [];
  return {
    emit: (event) => {
      events.push(event);
      // eslint-disable-next-line no-console
      console.info('[paradata]', event.type, event.payload ?? '');
    },
    flush: async () => {
      /* no-op: a real sink would POST the buffer to the paradata module */
    },
    buffer: () => [...events],
  };
}
