/**
 * Browser-backed SensorServices for the respondent runtime (sensor module,
 * docs/sensor-module-plan.md). Wraps `navigator.geolocation` and emits the sensor paradata
 * audit trail. Exploration-only surveys never get this — they receive
 * `createMockSensorServices()` instead (see App.tsx), mirroring the backend split.
 */
import type { ParadataSink, SensorServices } from '@mobilesurvey/runtime-engine';
import { uploadAttachment } from './api.js';
import { createAnthropicRecognitionProvider } from './recognition.js';

export function createBrowserSensorServices(
  paradata: ParadataSink,
  ids: { surveyId: string; respondentId: string },
): SensorServices {
  const recognition = createAnthropicRecognitionProvider();
  return {
    recognizePhoto: async (blob, profile, opts) => {
      if (!recognition) return { ok: false, error: 'unavailable' };
      try {
        const result = await recognition.recognize(blob, profile, opts);
        // Raw pre-confirmation suggestions go to paradata (D7); the variables hold only what
        // the respondent confirms, so the correction rate is derivable by comparing the two.
        paradata.emit({
          ts: Date.now(),
          type: 'recognition-ran',
          payload: { modelId: result.modelId, latencyMs: result.latencyMs, items: result.items },
        });
        return { ok: true, result };
      } catch (e) {
        paradata.emit({ ts: Date.now(), type: 'recognition-failed', payload: { error: String(e) } });
        return { ok: false, error: 'failed' };
      }
    },
    storePhoto: async (blob, ctx) => {
      // Path scheme {surveyId}/{respondentId}/{questionId}-{ts}.jpg — retakes get a new
      // object; the superseded one stays in the bucket (accepted for the demo, noted in
      // DEPLOYMENT.md housekeeping).
      const path = `${ids.surveyId}/${ids.respondentId}/${ctx.questionId}-${Date.now()}.jpg`;
      const res = await uploadAttachment(path, blob);
      if (!res.ok) {
        paradata.emit({ ts: Date.now(), type: 'photo-upload-failed', payload: { error: res.error } });
        return { ok: false, error: 'upload_failed' };
      }
      paradata.emit({
        ts: Date.now(),
        type: 'photo-captured',
        payload: { ref: res.ref, bytes: blob.size },
      });
      return { ok: true, ref: res.ref, ts: Date.now() };
    },
    captureLocation: (opts) =>
      new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
          paradata.emit({ ts: Date.now(), type: 'location-failed', payload: { error: 'unavailable' } });
          resolve({ ok: false, error: 'unavailable' });
          return;
        }
        const timeoutMs = opts?.timeoutMs ?? 15000;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const fix = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
              ts: pos.timestamp,
            };
            // Audit trail records fix quality, never raw coordinates — the answer variables
            // hold the (rounded) location; paradata must not leak a higher precision.
            paradata.emit({
              ts: Date.now(),
              type: 'location-captured',
              payload: { accuracyM: Math.round(fix.accuracyM), source: 'gps' },
            });
            resolve({ ok: true, fix });
          },
          (err) => {
            const error =
              err.code === err.PERMISSION_DENIED
                ? ('denied' as const)
                : err.code === err.TIMEOUT
                  ? ('timeout' as const)
                  : ('unavailable' as const);
            paradata.emit({ ts: Date.now(), type: 'location-failed', payload: { error } });
            resolve({ ok: false, error });
          },
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
        );
      }),
  };
}
