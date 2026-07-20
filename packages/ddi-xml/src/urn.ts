/**
 * Canonical DDI identity minting (docs/ddi-compliance-plan.md §3.2).
 *
 * DDI-Lifecycle 3.3 constrains identity components (patterns from `schemas/3.3/XMLSchema/reusable.xsd`):
 * - ID (`BaseIDType` derivative): `[A-Za-z0-9*@$\-_]+` with AT MOST ONE dot — the dot is
 *   reserved as the maintainable-scope separator (`{MaintainableID}.{ObjectID}`).
 * - Agency (`DDIAgencyIDType`): dot-separated labels of `[a-zA-Z0-9\-]{1,63}`.
 * - Version (`VersionType`): `[0-9]+(\.[0-9]+)*`.
 * - Canonical URN (`CanonicalURNType`): `urn:ddi:{agency}:{id}:{version}`.
 *
 * Internal instrument ids use dots freely (`q.cen.age`, `edit.funds.balance`), which the ID
 * component cannot carry verbatim. Two schemes handle this ({@link IdScheme}):
 *
 * - `uuid` (default) — the ID component is a UUIDv5 derived from the internal id. This is the
 *   convention Colectica and other DDI repositories use, so our identity keys the same way
 *   theirs does in a consuming graph (e.g. ddigraph's RDF output). A UUID contains no dots,
 *   so the XSD defect below is never reached.
 * - `readable` — dots are escaped bijectively: EVERY dot becomes `@`, chosen because `@` is a
 *   legal ID character that never appears in this project's ids (asserted at map time so the
 *   inverse `@` → `.` stays unambiguous). All dots must go (not just the 2nd+): the official
 *   3.3 XSD's IDType pattern has a defective post-dot character class
 *   (`[A-Zz-z0-9*@$-_]` — note `A-Zz-z`, omitting lowercase a–y), so any lowercase letter
 *   after a dot fails validation even though the spec prose allows it. Dotless mapped ids
 *   sidestep the broken branch entirely and satisfy both IDType and CanonicalURNType (whose
 *   own ID portion has the correct class). Any other XSD-illegal character (defensive; ids we
 *   generate are already clean) becomes `_`, which is lossy.
 *
 * Under either scheme the verbatim internal id is preserved in an `mst:id` extension by the
 * exporter, which the importer prefers over reversing the ID component — so round-tripping
 * never depends on the URN being invertible (and under `uuid` it isn't).
 */

import { UUID_NAMESPACE_URL, uuidV5 } from './uuid.js';

/** Placeholder agency for this project (docs/ddi-compliance-plan.md §3.1): reverse-DNS of a
 * domain the project controls. NEVER default to a registered agency (e.g. `ca.statcan`) —
 * minting under an agency is an act of authority, not formatting. */
export const DEFAULT_AGENCY = 'io.github.p3ji';

/**
 * How the ID component of a canonical URN is minted.
 *
 * - `uuid` (default): RFC 4122 UUIDv5 derived from (agency, internal id). This is what
 *   Colectica and other DDI repositories use, so our URNs key the same way theirs do in a
 *   consuming graph. It also sidesteps the official 3.3 XSD's defective post-dot character
 *   class entirely — a UUID has no dots, so the broken branch is never exercised.
 * - `readable`: the legacy dot-escaped internal id (`q.demoLoc` → `q@demoLoc`). Kept because
 *   human-readable URNs are far easier to debug, and for reproducing pre-UUID exports.
 *
 * Either way the verbatim internal id travels in an `mst:id` extension, which the importer
 * prefers — so round-tripping never depends on the URN being reversible.
 */
export type IdScheme = 'uuid' | 'readable';

/**
 * Namespace for this project's UUIDv5 minting, itself derived (so it is reproducible from
 * the source rather than a magic constant): uuidV5 of the project URL under the RFC 4122
 * URL namespace.
 */
export const MOBILESURVEY_UUID_NAMESPACE = uuidV5(
  'https://github.com/p3ji/mobilesurvey',
  UUID_NAMESPACE_URL,
);

/**
 * Stable UUIDv5 for an item, derived from the internal id alone.
 *
 * Deliberately excludes BOTH the version and the agency: DDI identity is already the triple
 * (Agency, ID, Version), so folding either into the ID component would be redundant — and
 * doing so would mean an item lost its identity when the instrument was versioned, or when
 * maintainership transferred to another agency. Keeping the hash to the internal id alone
 * makes "the same question" mint the same UUID under `urn:ddi:{anyAgency}:{uuid}:{anyVersion}`.
 */
export function itemUuid(internalId: string): string {
  return uuidV5(internalId, MOBILESURVEY_UUID_NAMESPACE);
}

const AGENCY_RE = /^[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{1,63})*$/;
const VERSION_RE = /^[0-9]+(\.[0-9]+)*$/;
// Mapped ids are dotless by construction (see module doc — the XSD's post-dot class is broken).
const ID_RE = /^[A-Za-z0-9*@$\-_]+$/;

/** Returns `agency` if it satisfies DDIAgencyIDType, else the project placeholder. */
export function sanitizeAgency(agency: string | undefined): string {
  return agency && AGENCY_RE.test(agency) && agency.length <= 253 ? agency : DEFAULT_AGENCY;
}

/** Returns `version` if it satisfies VersionType, else '1'. */
export function sanitizeVersion(version: string | undefined): string {
  return version && VERSION_RE.test(version) ? version : '1';
}

/** Maps an internal id to an XSD-legal DDI ID. Bijective for dot-only mappings (the common
 * case); see module doc for the `@` escape and the lossy `_` fallback. */
export function mapId(id: string): string {
  if (id.includes('@')) {
    // '@' is our escape character; an id already containing it would break the bijection.
    throw new Error(`Internal id "${id}" contains '@', which is reserved for DDI ID mapping.`);
  }
  const legal = id.replaceAll('.', '@').replace(/[^A-Za-z0-9*@$\-_]/g, '_');
  if (!ID_RE.test(legal)) {
    // Only reachable for pathological inputs (e.g. empty string) — surface loudly.
    throw new Error(`Cannot map internal id "${id}" to a legal DDI ID (got "${legal}").`);
  }
  return legal;
}

/** Inverse of {@link mapId} for the bijective (dot-escape) part: `@` → `.`. */
export function unmapId(mapped: string): string {
  return mapped.replaceAll('@', '.');
}

/**
 * The XSD-legal ID component for an internal id under the chosen scheme. `uuid` mode ignores
 * the dot-escaping machinery entirely (UUIDs are already legal under IDType's pre-dot class).
 */
export function schemeId(scheme: IdScheme, internalId: string): string {
  return scheme === 'uuid' ? itemUuid(internalId) : mapId(internalId);
}

/** Mints a canonical DDI URN: `urn:ddi:{agency}:{mappedId}:{version}`. Inputs are assumed
 * already sanitized/mapped (this function asserts rather than fixes). */
export function mintUrn(agency: string, mappedId: string, version: string): string {
  const urn = `urn:ddi:${agency}:${mappedId}:${version}`;
  if (!AGENCY_RE.test(agency) || !ID_RE.test(mappedId) || !VERSION_RE.test(version)) {
    throw new Error(`Refusing to mint non-canonical DDI URN "${urn}".`);
  }
  return urn;
}
