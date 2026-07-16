/**
 * The XSD gate (docs/ddi-compliance-plan.md §3.4 / P1): every bundled instrument's
 * exportDdiXml() output must validate against the official DDI-Lifecycle 3.3 schemas.
 * Round-trip tests prove self-fidelity; THIS proves standards conformance.
 */
import { describe, it, expect } from 'vitest';
import {
  lfsInstrument,
  demoInstrument,
  householdInstrument,
  censusInstrument,
  fsepInstrument,
} from '@mobilesurvey/instrument-schema';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { exportDdiXml } from '../export.js';
import { validateDdi, formatErrors } from './xsdValidate.js';

const FIXTURES: [string, Instrument][] = [
  ['demo', demoInstrument],
  ['household', householdInstrument],
  ['lfs', lfsInstrument],
  ['census', censusInstrument],
  ['fsep', fsepInstrument],
];

describe('XSD validation against official DDI-Lifecycle 3.3 schemas', () => {
  for (const [name, instrument] of FIXTURES) {
    it(`${name}: exportDdiXml() output is schema-valid`, async () => {
      const xml = exportDdiXml(instrument);
      const result = await validateDdi(xml);
      expect(result.valid, `\nXSD violations for "${name}":\n${formatErrors(result)}\n`).toBe(true);
    }, 120_000);
  }
});
