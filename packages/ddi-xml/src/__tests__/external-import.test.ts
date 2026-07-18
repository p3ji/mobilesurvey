/**
 * P4 (docs/ddi-compliance-plan.md §3.6): import real, production-scale DDI-Lifecycle 3.3
 * files — Colectica exports of the Ireland Labour Force Survey from ddigraph's demo/.
 *
 * The fixtures are NOT committed (Git LFS, up to 66 MB); run
 *   node packages/ddi-xml/fixtures/external/fetch.mjs
 * to download them. When absent, this suite skips — so `pnpm test` stays green in a fresh
 * clone and CI. The acceptance bar: import runs clean without crashing, every skipped
 * construct appears as a fidelity note (no silent drops), and the imported instrument is
 * structurally renderable (valid per the Zod schema, non-empty sequence).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstrument } from '@mobilesurvey/instrument-schema';
import { importDdiXml } from '../import.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'external');
const lfsPath = path.join(DIR, 'LFS.xml');
const labourPath = path.join(DIR, 'Ireland_LabourSurvey.xml');
const present = existsSync(lfsPath) && existsSync(labourPath);

function countConstructs(seq: { children: unknown[] }): number {
  let n = 0;
  const walk = (c: any): void => {
    n++;
    if (c.children) c.children.forEach(walk);
    if (c.then) c.then.forEach(walk);
    if (c.else) c.else.forEach(walk);
  };
  seq.children.forEach(walk);
  return n;
}

describe.skipIf(!present)('external Ireland-LFS import (on-demand, fixtures not committed)', () => {
  it('LFS.xml (14.5 MB, 5200 fragments) imports without crashing, with complete fidelity accounting', () => {
    const xml = readFileSync(lfsPath, 'utf8');
    const t0 = performance.now();
    const { instrument, report } = importDdiXml(xml);
    const ms = Math.round(performance.now() - t0);
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1e6);
    console.log(`LFS.xml: imported in ${ms} ms, heapUsed ${heapMb} MB`);
    console.log(
      `LFS.xml: ${countConstructs(instrument.sequence)} constructs, ` +
        `${instrument.variables.length} variables, ${instrument.categorySchemes.length} category schemes, ` +
        `${report.notes.length} fidelity notes (${report.notes.filter(n => n.severity === 'warning').length} warnings)`,
    );

    expect(instrument.id).toBe('urn:ddi:ie.cso:6504ef7d-39eb-4510-b4d2-7b0238767b67:11');
    expect(instrument.metadata.agencyId).toBe('ie.cso');
    expect(instrument.metadata.title['en-IE']).toContain('Labour Force Survey');
    // A real construct tree was recovered, not an empty shell.
    expect(countConstructs(instrument.sequence)).toBeGreaterThan(500);
    // 1609 Variable fragments dedupe to ~636 unique names (repeated across 4 collection waves).
    expect(instrument.variables.length).toBeGreaterThan(500);
    expect(instrument.categorySchemes.length).toBeGreaterThan(100);
    // No silent drops: unmapped fragment types are itemized in the report.
    expect(report.notes.some(n => n.message.includes('no mapping in the instrument model'))).toBe(true);
    // Structurally renderable per the schema the designer loads.
    const result = validateInstrument(JSON.parse(JSON.stringify(instrument)));
    expect(result.ok, result.ok ? '' : JSON.stringify((result as any).issues.slice(0, 5))).toBe(true);
  }, 120_000);

  it('Ireland_LabourSurvey.xml (instrument-only, no StudyUnit) imports via synthesized schemes', () => {
    const xml = readFileSync(labourPath, 'utf8');
    const { instrument, report } = importDdiXml(xml);
    console.log(
      `Ireland_LabourSurvey.xml: ${countConstructs(instrument.sequence)} constructs, ` +
        `${instrument.categorySchemes.length} category schemes, ${report.notes.length} notes`,
    );
    expect(report.notes.some(n => n.message.includes('synthesized one around the loose fragments'))).toBe(true);
    expect(countConstructs(instrument.sequence)).toBeGreaterThan(500);
    expect(instrument.categorySchemes.length).toBeGreaterThan(100);
    const result = validateInstrument(JSON.parse(JSON.stringify(instrument)));
    expect(result.ok, result.ok ? '' : JSON.stringify((result as any).issues.slice(0, 5))).toBe(true);
  }, 120_000);
});
