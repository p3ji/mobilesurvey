import { describe, expect, it } from 'vitest';
import { demoInstrument } from '@mobilesurvey/instrument-schema';
import { instrumentSha256 } from './api.js';

describe('instrumentSha256', () => {
  it('identifies the loaded content even when its version stays the same', async () => {
    const edited = structuredClone(demoInstrument);
    edited.metadata.title.en = `${edited.metadata.title.en} revised`;

    const originalHash = await instrumentSha256(demoInstrument);
    expect(originalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await instrumentSha256(structuredClone(demoInstrument))).toBe(originalHash);
    expect(edited.version).toBe(demoInstrument.version);
    expect(await instrumentSha256(edited)).not.toBe(originalHash);
  });
});
