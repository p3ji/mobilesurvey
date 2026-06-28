/**
 * `@mobilesurvey/ddi-xml` — codec between the mobilesurvey `Instrument` model and a
 * DDI-Lifecycle-flavoured XML serialization.
 *
 * - `instrumentToDdiXml` / `instrumentToXmlElement` — export (loss-free for the full model).
 * - `ddiXmlToInstrument` — import, returning an `ImportResult` with a fidelity report.
 *
 * The low-level XML reader/writer is isolated in `./xml` so it can later be replaced by a hardened
 * parser for the full DDI-Lifecycle 3.3 / Codebook 2.5 adapter without changing the mapping layer.
 */
export { instrumentToDdiXml, instrumentToXmlElement } from './export.js';
export { ddiXmlToInstrument } from './import.js';
export { isFaithful, type FidelityLevel, type FidelityNote, type ImportResult } from './fidelity.js';
export { parseXml, serializeXml, DdiXmlError, type XmlElement } from './xml.js';
