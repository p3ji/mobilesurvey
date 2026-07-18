/**
 * Browser-backed SensorServices for the respondent runtime (sensor module,
 * docs/sensor-module-plan.md). Wraps `navigator.geolocation` and emits the sensor paradata
 * audit trail. Exploration-only surveys never get this — they receive
 * `createMockSensorServices()` instead (see App.tsx), mirroring the backend split.
 */
import type { ParadataSink, SensorServices } from '@mobilesurvey/runtime-engine';

export function createBrowserSensorServices(paradata: ParadataSink): SensorServices {
  return {
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
