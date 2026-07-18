import type { Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';
import type { GenerationMode } from './types.js';

/**
 * Generate test values for a given ResponseDomain under the requested generation mode.
 *
 * Returns an empty array for domain types that cannot be exercised programmatically
 * (`file`, `markAll`, `grid`) — those are handled at a higher level in the enumerator.
 */
export function generateValues(
  domain: ResponseDomain,
  instrument: Instrument,
  mode: GenerationMode,
): unknown[] {
  switch (domain.type) {
    case 'code': {
      const scheme = instrument.categorySchemes.find((s) => s.id === domain.categorySchemeRef);
      const codes = (scheme?.categories ?? []).map((c) => c.code);
      if (!codes.length) return [null];

      if (domain.selection === 'single') {
        if (mode === 'routing') return [...codes];
        if (mode === 'boundary') {
          // First and last code; null for "nothing selected" (only valid if not required)
          const boundary: unknown[] = [null];
          if (codes[0] !== undefined) boundary.push(codes[0]);
          if (codes.length > 1 && codes[codes.length - 1] !== undefined) {
            boundary.push(codes[codes.length - 1]);
          }
          return boundary;
        }
        return [codes[0] ?? null];
      } else {
        // multiple selection — represent as string[]
        if (mode === 'routing') {
          const candidates: unknown[] = [[] as string[]];
          if (codes[0] !== undefined) candidates.push([codes[0]]);
          if (codes.length > 1) candidates.push([...codes]);
          return candidates;
        }
        if (mode === 'boundary') {
          return [[] as string[], codes.slice(0, 1), [...codes]];
        }
        return [codes.slice(0, 1)];
      }
    }

    case 'numeric': {
      const min = domain.min ?? 0;
      const max = domain.max ?? 100;
      const mid = Math.round((min + max) / 2);
      if (mode === 'routing') return [min, mid, max];
      if (mode === 'boundary') return [min - 1, min, mid, max, max + 1];
      return [mid];
    }

    case 'text': {
      const maxLen = domain.maxLength ?? 255;
      if (mode === 'routing') return ['Test response', ''];
      if (mode === 'boundary') {
        return [
          '',
          'A',
          'Test response',
          'A'.repeat(maxLen),
          'A'.repeat(maxLen + 1),
          '<script>alert(1)</script>',
          '😀🎉',
        ];
      }
      return ['Test response'];
    }

    case 'boolean':
      if (mode === 'routing' || mode === 'boundary') return [true, false];
      return [true];

    case 'datetime': {
      if (mode === 'routing') {
        return domain.mode === 'time'
          ? ['09:00', '23:59']
          : ['2024-01-01', '2024-12-31'];
      }
      if (mode === 'boundary') {
        return domain.mode === 'time'
          ? ['', '00:00', '09:00', '23:59', '24:00', 'not-a-time']
          : ['', '2024-01-01', '1900-01-01', '9999-12-31', 'not-a-date'];
      }
      return [domain.mode === 'time' ? '09:00' : '2024-06-15'];
    }

    case 'lookup': {
      const scheme = instrument.categorySchemes.find((s) => s.id === domain.categorySchemeRef);
      const codes = (scheme?.categories ?? []).map((c) => c.code);
      if (!codes.length) return ['test'];
      if (mode === 'routing') return [...codes];
      if (mode === 'boundary') {
        const boundary: unknown[] = [null];
        if (codes[0] !== undefined) boundary.push(codes[0]);
        if (codes.length > 1 && codes[codes.length - 1] !== undefined) {
          boundary.push(codes[codes.length - 1]);
        }
        return boundary;
      }
      return [codes[0] ?? null];
    }

    case 'file':
    case 'markAll':
    case 'grid':
    case 'table':
    case 'geolocation':
    case 'photo':
      // Handled separately in the enumerator; not enumerable via domain values alone.
      // (sensor domains: consent branches + capture are S4 sensor-module bot work.)
      return [];
  }
}

/** Convenience: single canonical/typical value for a domain. */
export function generateCanonicalValue(
  domain: ResponseDomain,
  instrument: Instrument,
): unknown {
  return generateValues(domain, instrument, 'canonical')[0] ?? null;
}
