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

  it('validates Work Stream 6 coverage dashboard metrics and 5-sector distribution', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const previewFile = path.resolve(__dirname, '../../../../../platform/hub/src/researcherPilot.json');
    const works = JSON.parse(fs.readFileSync(previewFile, 'utf8'));

    // Bounded universe targets
    expect(works.length).toBeGreaterThanOrEqual(3458);

    // 5-Sector Breakdown
    let academic = 0;
    let theses = 0;
    let fedProv = 0;
    let cmaHealth = 0;
    let ngo = 0;

    for (const w of works) {
      const isThesis =
        w.workType === 'dissertation' ||
        w.sources.some((s: string) => {
          const lower = s.toLowerCase();
          return lower.includes('scholaris') || lower.includes('thesis') || lower.includes('tspace');
        });

      const isCmaHealth = w.sources.some((s: string) => {
        const lower = s.toLowerCase();
        return (
          lower.includes('public health') ||
          lower.includes('health authority') ||
          lower.includes('cma') ||
          lower.includes('toronto') ||
          lower.includes('montreal') ||
          lower.includes('vancouver') ||
          lower.includes('calgary') ||
          lower.includes('edmonton') ||
          lower.includes('ottawa') ||
          lower.includes('winnipeg') ||
          lower.includes('inspq')
        );
      });

      const isFedProv =
        !isThesis &&
        !isCmaHealth &&
        (w.sources.some((s: string) => {
          const lower = s.toLowerCase();
          return (
            lower.includes('federal') ||
            lower.includes('open.canada.ca') ||
            lower.includes('provincial') ||
            lower.includes('ontario') ||
            lower.includes('quebec') ||
            lower.includes('alberta') ||
            lower.includes('bc') ||
            lower.includes('british columbia')
          );
        }) ||
          (w.workType === 'report' &&
            w.issuingOrganization &&
            /government|ministry|gouvernement|statcan|canada|ontario|quebec/i.test(w.issuingOrganization)));

      const isNgo =
        !isThesis &&
        !isCmaHealth &&
        !isFedProv &&
        (w.sources.some((s: string) => s.toLowerCase().includes('grey literature')) || w.workType === 'report');

      if (isThesis) theses++;
      else if (isCmaHealth) cmaHealth++;
      else if (isFedProv) fedProv++;
      else if (isNgo) ngo++;
      else academic++;
    }

    expect(academic).toBeGreaterThan(2500);
    expect(theses).toBeGreaterThan(300);
    expect(fedProv).toBeGreaterThan(100);
    expect(cmaHealth).toBeGreaterThan(100);
    expect(ngo).toBeGreaterThan(100);

    // Temporal continuous coverage: 2015 to 2026
    const years = new Set(works.map((w: any) => w.year).filter(Boolean));
    for (let yr = 2015; yr <= 2026; yr++) {
      expect(years.has(yr)).toBe(true);
    }
  });
});
