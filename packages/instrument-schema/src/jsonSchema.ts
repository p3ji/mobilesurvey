/**
 * Derives the JSON Schema artifact for the instrument specification from the Zod schema, so the
 * exported `.instrument.json` can be validated by any JSON Schema tool (DDI-adjacent toolchains,
 * CI, external integrators).
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { instrumentSchema } from './zod.js';

export function getInstrumentJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(instrumentSchema, {
    name: 'Instrument',
    $refStrategy: 'root',
  }) as Record<string, unknown>;
}
