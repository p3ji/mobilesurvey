import { describe, it, expect } from 'vitest';
import { demoInstrument, fsepInstrument } from '@mobilesurvey/instrument-schema';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { exportDdiXml } from '../export.js';
import { importDdiXml } from '../import.js';
import { DEFAULT_AGENCY } from '../urn.js';

function withAgency(inst: Instrument, agencyId: string | undefined): Instrument {
  return { ...inst, metadata: { ...inst.metadata, agencyId } };
}

describe('P2 identity model: agencyId config', () => {
  it('default export mints every URN under the project placeholder', () => {
    const xml = exportDdiXml(demoInstrument);
    const urns = xml.match(/<r:URN>([^<]+)<\/r:URN>/g) ?? [];
    expect(urns.length).toBeGreaterThan(10);
    for (const u of urns) {
      expect(u).toMatch(/<r:URN>urn:ddi:io\.github\.p3ji:[A-Za-z0-9\-_@$*]+:[0-9.]+<\/r:URN>/);
    }
  });

  it('changing agencyId changes every URN/Agency and nothing else', () => {
    const base = exportDdiXml(demoInstrument);
    const custom = exportDdiXml(withAgency(demoInstrument, 'org.example.test'));
    expect(custom).toContain('urn:ddi:org.example.test:');
    expect(custom).not.toContain(DEFAULT_AGENCY);
    expect(custom.replaceAll('org.example.test', DEFAULT_AGENCY)).toBe(base);
  });

  it('a pattern-invalid agencyId falls back to the placeholder, never a registered agency', () => {
    const xml = exportDdiXml(withAgency(demoInstrument, 'not a valid agency!'));
    expect(xml).toContain(`urn:ddi:${DEFAULT_AGENCY}:`);
    expect(xml).not.toContain('ca.statcan');
  });

  it('round-trips a custom agencyId', () => {
    const xml = exportDdiXml(withAgency(fsepInstrument, 'org.example.test'));
    const { instrument } = importDdiXml(xml);
    expect(instrument.metadata.agencyId).toBe('org.example.test');
    // Re-export is stable: same URNs come out again.
    expect(exportDdiXml(instrument)).toContain('urn:ddi:org.example.test:');
  });

  it('leaves agencyId unset on import when the export used the placeholder (unset ≡ placeholder)', () => {
    const xml = exportDdiXml(demoInstrument);
    const { instrument } = importDdiXml(xml);
    expect(instrument.metadata.agencyId).toBeUndefined();
  });
});

describe('idScheme: UUIDv5 identity (Colectica/ddigraph convention)', () => {
  const UUID_URN = /^urn:ddi:[^:]+:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9.]+$/;
  const urnsOf = (xml: string): string[] =>
    [...xml.matchAll(/<r:URN>([^<]+)<\/r:URN>/g)].map((m) => m[1]!);

  it('mints v5 UUIDs for every URN by default', () => {
    const urns = urnsOf(exportDdiXml(demoInstrument));
    expect(urns.length).toBeGreaterThan(10);
    for (const u of urns) expect(u).toMatch(UUID_URN);
  });

  it('is stable across exports — a URN is a persistent identifier, not a per-run value', () => {
    expect(exportDdiXml(demoInstrument)).toBe(exportDdiXml(demoInstrument));
  });

  it('keeps item identity when the maintenance agency changes (agency is a separate URN component)', () => {
    const idsOf = (xml: string): string[] => urnsOf(xml).map((u) => u.split(':')[3]!);
    expect(idsOf(exportDdiXml(withAgency(demoInstrument, 'org.example.test')))).toEqual(
      idsOf(exportDdiXml(demoInstrument)),
    );
  });

  it('round-trips deep-equal under both schemes and both packagings', () => {
    const norm = (i: Instrument): unknown => JSON.parse(JSON.stringify(i));
    for (const idScheme of ['uuid', 'readable'] as const) {
      for (const packaging of ['instance', 'fragment'] as const) {
        const { instrument } = importDdiXml(exportDdiXml(demoInstrument, { idScheme, packaging }));
        expect(norm(instrument), `${idScheme}/${packaging}`).toEqual(norm(demoInstrument));
      }
    }
  });

  it('opting into readable ids restores dot-escaped URNs', () => {
    const urns = urnsOf(exportDdiXml(demoInstrument, { idScheme: 'readable' }));
    expect(urns.some((u) => u.includes('@'))).toBe(true);
    for (const u of urns) expect(u).not.toMatch(UUID_URN);
  });
});
