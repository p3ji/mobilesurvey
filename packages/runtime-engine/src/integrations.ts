/**
 * Integration boundary (the spec's data-flow diagram). These interfaces decouple survey content
 * from operational systems. They live in `runtime-engine` so every consumer — the designer's
 * preview, the standalone respondent runtime, and a future real backend — shares one contract.
 *
 * Iteration-1 implementations are in-memory / localStorage mocks supplied per app.
 */

export interface SampleUnit {
  /** Sample unit identifier (case id). */
  id: string;
  /** Contact info + auxiliary pre-fill fields, e.g. `contact_name`, `region_code`, `email`. */
  fields: Record<string, unknown>;
}

/** Ingests the sample file (contact info + pre-fills). */
export interface SampleProvider {
  list(): Promise<SampleUnit[]>;
  get(id: string): Promise<SampleUnit | undefined>;
}

/** Collection Management System interface: case assignment + status round-trip. */
export interface CmsClient {
  /** Exchange a respondent access code for a case and its pre-fill context. */
  resolveAccessCode(accessCode: string): Promise<{ caseId: string; sample: SampleUnit } | null>;
  /** Push a status/mode change back to the CMS. */
  reportStatus(caseId: string, status: string): Promise<void>;
}

export interface ParadataEvent {
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
}

/** Collection paradata sink (audit trail of respondent behaviour). */
export interface ParadataSink {
  emit(event: ParadataEvent): void;
  flush(): Promise<void>;
  /** Snapshot of buffered events (for the demo analytics view). */
  buffer(): ParadataEvent[];
}

/** Encrypted, resumable session-state cache (guards against mobile network drop-outs). */
export interface SessionStore {
  save(key: string, state: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  clear(key: string): Promise<void>;
}

// ── Sensor module (docs/sensor-module-plan.md) ────────────────────────────────

/** A successful device-location fix (raw precision; the caller rounds per the domain). */
export interface LocationFix {
  lat: number;
  lon: number;
  /** Reported accuracy radius in metres. */
  accuracyM: number;
  ts: number;
}

export type LocationError = 'denied' | 'timeout' | 'unavailable';

export type RecognitionProfile = 'food' | 'document' | 'generic';

/** One suggested item from a recognition pass (pre-confirmation). */
export interface RecognitionItem {
  label: string;
  /** Estimated quantity in `unit` (recognition profiles that can't estimate omit it). */
  qty?: number;
  unit?: 'g' | 'ml' | 'serving';
  /** Model confidence 0–1. */
  confidence: number;
}

export interface RecognitionResult {
  items: RecognitionItem[];
  modelId: string;
  latencyMs: number;
}

/**
 * Pluggable image-recognition backend (docs/sensor-module-plan.md D5). The demo default is
 * Anthropic vision behind the client-bundled-key pattern; production fronts the same
 * interface with a serverless proxy. Output is a SUGGESTION — the UI always routes it
 * through respondent confirmation before storage.
 */
export interface RecognitionProvider {
  recognize(
    blob: Blob,
    profile: RecognitionProfile,
    opts: { maxItems: number },
  ): Promise<RecognitionResult>;
}

/**
 * Device-sensor access, behind the same integration boundary as `CmsClient`/`SessionStore`:
 * the respondent runtime provides browser implementations; the designer preview,
 * exploration-only surveys, and tests use `createMockSensorServices()`. Consent gating lives
 * in the UI layer (the consent card) — implementations only do the capture.
 */
export interface SensorServices {
  captureLocation(opts?: {
    maxAccuracyM?: number;
    timeoutMs?: number;
  }): Promise<{ ok: true; fix: LocationFix } | { ok: false; error: LocationError }>;
  /**
   * Persist an already-processed (downscaled, EXIF-stripped) photo blob and return an opaque
   * attachment ref (storage path) to store in the answer — never the image bytes. The
   * respondent runtime uploads to Supabase Storage; the mock returns a fake ref.
   */
  storePhoto(
    blob: Blob,
    ctx: { questionId: string },
  ): Promise<{ ok: true; ref: string; ts: number } | { ok: false; error: 'upload_failed' }>;
  /**
   * Run the configured recognition provider over the just-captured (processed) blob.
   * `unavailable` = no provider configured (graceful absence: the item list becomes manual
   * entry); `failed` = the provider errored.
   */
  recognizePhoto(
    blob: Blob,
    profile: RecognitionProfile,
    opts: { maxItems: number },
  ): Promise<{ ok: true; result: RecognitionResult } | { ok: false; error: 'unavailable' | 'failed' }>;
}

/**
 * Deterministic mock: a fixed Ottawa coordinate with a small index-based jitter so repeated
 * captures are distinguishable but stable across runs (no Math.random — keeps tests exact).
 */
export function createMockSensorServices(): SensorServices {
  let n = 0;
  let p = 0;
  return {
    captureLocation: async () => {
      n += 1;
      return {
        ok: true,
        fix: { lat: 45.42153 + n * 0.0001, lon: -75.697193 - n * 0.0001, accuracyM: 12, ts: Date.now() },
      };
    },
    storePhoto: async (_blob, ctx) => {
      p += 1;
      return { ok: true, ref: `mock/${ctx.questionId}-${p}.jpg`, ts: Date.now() };
    },
    recognizePhoto: async (_blob, _profile, opts) => {
      const items: RecognitionItem[] = [
        { label: 'Apple', qty: 150, unit: 'g', confidence: 0.92 },
        { label: 'Sandwich', qty: 1, unit: 'serving', confidence: 0.81 },
      ];
      return {
        ok: true,
        result: { items: items.slice(0, opts.maxItems), modelId: 'mock', latencyMs: 5 },
      };
    },
  };
}
