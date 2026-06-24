/**
 * In-memory / localStorage mock implementations of the integration boundary. These exist so the
 * decoupled seams from the spec's data-flow diagram are real from day one.
 */
import type {
  CmsClient,
  ParadataEvent,
  ParadataSink,
  SampleProvider,
  SampleUnit,
  SessionStore,
} from './types.js';

/** A demo sample profile used by the preview/prefill editor. */
export const MOCK_SAMPLE: SampleUnit = {
  id: 'case-0001',
  fields: {
    contact_name: 'Jordan Lee',
    region_code: 'QC',
    email: 'jordan.lee@example.org',
    phone: '+1-555-0100',
  },
};

const SAMPLE_UNITS: SampleUnit[] = [
  MOCK_SAMPLE,
  { id: 'case-0002', fields: { contact_name: 'Marie Tremblay', region_code: 'ON', email: 'marie.t@example.org' } },
];

export const mockSampleProvider: SampleProvider = {
  list: async () => SAMPLE_UNITS,
  get: async (id) => SAMPLE_UNITS.find((u) => u.id === id),
};

export const mockCmsClient: CmsClient = {
  // A trivial code→case map. Real CMS would validate single/multi-use codes server-side.
  resolveAccessCode: async (accessCode) => {
    const map: Record<string, string> = { ABC123: 'case-0001', DEF456: 'case-0002' };
    const caseId = map[accessCode.trim().toUpperCase()];
    if (!caseId) return null;
    const sample = SAMPLE_UNITS.find((u) => u.id === caseId)!;
    return { caseId, sample };
  },
  reportStatus: async (caseId, status) => {
    // eslint-disable-next-line no-console
    console.info(`[mock CMS] case ${caseId} → ${status}`);
  },
};

export function createMockParadataSink(): ParadataSink {
  const events: ParadataEvent[] = [];
  return {
    emit: (event) => {
      events.push(event);
    },
    flush: async () => {
      /* no-op: a real sink would POST to the paradata module */
    },
    buffer: () => [...events],
  };
}

/**
 * localStorage-backed session store. NOTE: the base64 encoding here is obfuscation ONLY — it is a
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
