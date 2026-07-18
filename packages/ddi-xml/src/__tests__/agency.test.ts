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
