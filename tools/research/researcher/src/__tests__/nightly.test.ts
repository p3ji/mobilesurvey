import { describe, expect, it } from 'vitest';
import { runNightlyEnrichment } from '../nightly_enrichment.js';

describe('Nightly Enrichment Pipeline', () => {
  it('runs cleanly in dryRun with skipHarvest and skipLlm modes', async () => {
    const report = await runNightlyEnrichment({
      dryRun: true,
      skipHarvest: true,
      skipLlm: true,
    });

    expect(report).toBeDefined();
    expect(report.audit.gatePassed).toBe(true);
    expect(report.audit.flaggedClaims).toBe(0);
    expect(report.catalogue.totalPublicWorks).toBeGreaterThan(3400);
    expect(report.catalogue.verifiedCount).toBeGreaterThan(3000);
  }, 45_000);
});
