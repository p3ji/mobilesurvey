import { describe, it, expect, afterEach } from 'vitest';
import { StatCanWdsClient } from '../src/engine/statcan-wds.js';

describe('StatCanWdsClient request timeouts', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attaches an AbortSignal timeout to cube list, metadata, and slice fetches', async () => {
    const signals: Array<AbortSignal | undefined> = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      const u = String(url);
      if (u.includes('getAllCubesListLite')) {
        return Response.json([{ productId: 14100287, cubeTitleEn: 'Labour force', cubeTitleFr: 'PA', releaseTime: '2026-01-01', archived: '2' }]);
      }
      if (u.includes('getCubeMetadata')) {
        return Response.json([{
          status: 'SUCCESS',
          object: {
            productId: 14100287,
            cubeTitleEn: 'Labour force',
            cubeTitleFr: 'PA',
            frequencyCode: 6,
            startReferencePeriod: '2020-01-01',
            endReferencePeriod: '2026-01-01',
            dimension: [{ dimensionPositionId: 1, dimensionNameEn: 'Geography', hasUom: false, member: [{ memberId: 1, memberNameEn: 'Canada' }] }],
          },
        }]);
      }
      return Response.json([{ status: 'SUCCESS', object: { vectorDataPoint: [] } }]);
    }) as typeof fetch;

    const client = new StatCanWdsClient();
    await client.search('Labour');
    await client.fetchSlice(14100287, '1.0.0.0.0.0.0.0.0.0');

    expect(signals.length).toBe(3);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });
});
