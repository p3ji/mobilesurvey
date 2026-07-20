/**
 * JSON-LD projection of an Instrument — the FAIR-facing serialization of our native JSON.
 *
 * Why this exists as a projection rather than a replacement: our working `Instrument` JSON is
 * what the designer edits, Zod validates, and the runtime executes; making *it* JSON-LD would
 * put linked-data ceremony in the hot path of every editor keystroke for no benefit. Instead
 * this emits a standards-facing view, exactly as `export.ts` emits a DDI-XML view — and,
 * critically, **both views use the same canonical URNs as `@id`**, so an XML fragment and a
 * JSON-LD node describing the same question are the same resource to a consuming graph.
 *
 * Shape: a flat `@graph` of nodes cross-referenced by `@id`, mirroring FragmentInstance
 * packaging — the form that loads cleanly into a triplestore without recursion.
 *
 * Vocabulary: DDI-RDF Discovery (`disco`) for the entities it covers, SKOS for code lists,
 * DCTerms for descriptive metadata, and a project namespace (`mst:`) for everything DDI-RDF
 * has no term for — questionnaire flow (sequences, branches, loops), edit rules, and the
 * sensor module. The disco mapping is our reading of the vocabulary, not a certified
 * crosswalk; the `mst:` terms are deliberately explicit so nothing masquerades as standard.
 *
 * `InternationalString` maps directly onto a JSON-LD language map (`@container: "@language"`),
 * so `{en, fr}` needs no transformation.
 */
import type {
  Category,
  CategoryScheme,
  Concept,
  ControlConstruct,
  Instrument,
  InternationalString,
  Universe,
  Variable,
} from '@mobilesurvey/instrument-schema';
import { mintUrn, sanitizeAgency, sanitizeVersion, schemeId, type IdScheme } from './urn.js';

/** Project namespace for terms with no DDI-RDF/SKOS/DCTerms equivalent. */
export const MST_NAMESPACE = 'https://p3ji.github.io/mobilesurvey/ns#';

/**
 * The `@context`. Reference-valued terms are declared `"@type": "@id"` so their values are
 * IRIs (real edges in the graph) rather than strings.
 */
const CONTEXT = {
  disco: 'http://rdf-vocabulary.ddialliance.org/discovery#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  mst: MST_NAMESPACE,

  // Descriptive metadata (language maps).
  title: { '@id': 'dcterms:title', '@container': '@language' },
  description: { '@id': 'dcterms:description', '@container': '@language' },
  prefLabel: { '@id': 'skos:prefLabel', '@container': '@language' },
  questionText: { '@id': 'disco:questionText', '@container': '@language' },
  instruction: { '@id': 'mst:instruction', '@container': '@language' },

  // Literals.
  notation: 'skos:notation',
  identifier: 'dcterms:identifier',
  created: { '@id': 'dcterms:created', '@type': 'xsd:dateTime' },
  version: 'mst:version',
  agency: 'mst:agency',
  representation: 'mst:representation',
  variableKind: 'mst:variableKind',
  responseDomain: 'mst:responseDomain',
  expression: 'mst:expression',
  condition: 'mst:condition',
  visibleWhen: 'mst:visibleWhen',
  required: 'mst:required',
  isPII: 'mst:isPII',
  editRules: 'mst:editRules',
  sensorConfig: 'mst:sensorConfig',
  isPage: 'mst:isPage',

  // Reference-valued terms (edges).
  publisher: { '@id': 'dcterms:publisher', '@type': '@id' },
  inScheme: { '@id': 'skos:inScheme', '@type': '@id' },
  hasTopConcept: { '@id': 'skos:hasTopConcept', '@type': '@id' },
  question: { '@id': 'disco:question', '@type': '@id' },
  variable: { '@id': 'disco:variable', '@type': '@id' },
  universe: { '@id': 'disco:universe', '@type': '@id' },
  // Deliberately `mst:` and not `skos:related`: SKOS scopes that term to concept-to-concept
  // associative links, so using it for variable→concept would be a misuse. If DDI-RDF has a
  // sanctioned term for this edge, it belongs here instead.
  concept: { '@id': 'mst:concept', '@type': '@id' },
  codeList: { '@id': 'mst:codeList', '@type': '@id' },
  collects: { '@id': 'mst:collects', '@type': '@id' },
  rootSequence: { '@id': 'mst:rootSequence', '@type': '@id' },
  members: { '@id': 'mst:members', '@type': '@id', '@container': '@list' },
  thenBranch: { '@id': 'mst:thenBranch', '@type': '@id', '@container': '@list' },
  elseBranch: { '@id': 'mst:elseBranch', '@type': '@id', '@container': '@list' },
  target: { '@id': 'mst:target', '@type': '@id' },
} as const;

interface Node {
  '@id': string;
  '@type': string;
  [key: string]: unknown;
}

export interface JsonLdOptions {
  /** Identity scheme for `@id` URNs — must match the XML export to describe the same resources. */
  idScheme?: IdScheme;
}

/** Drop undefined/empty values so the emitted graph carries no noise. */
function defined(node: Node): Node {
  for (const [k, v] of Object.entries(node)) {
    const empty =
      v === undefined ||
      v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) delete node[k];
  }
  return node;
}

function intl(v: InternationalString | undefined): InternationalString | undefined {
  return v && Object.keys(v).length > 0 ? v : undefined;
}

export function toJsonLd(instrument: Instrument, options?: JsonLdOptions): unknown {
  const scheme: IdScheme = options?.idScheme ?? 'uuid';
  const agency = sanitizeAgency(instrument.metadata.agencyId);
  const version = sanitizeVersion(instrument.version);
  /** Canonical URN for an internal id — identical to what export.ts mints for the XML. */
  const urn = (localId: string): string => mintUrn(agency, schemeId(scheme, localId), version);

  const graph: Node[] = [];
  const variableUrnByName = new Map<string, string>(
    instrument.variables.map((v) => [v.name, urn(v.id)]),
  );

  // --- Questionnaire ---------------------------------------------------------
  const shortId = instrument.id.split(':')[3] ?? instrument.id;
  graph.push(
    defined({
      '@id': urn(shortId),
      '@type': 'disco:Questionnaire',
      identifier: instrument.id,
      title: intl(instrument.metadata.title),
      description: intl(instrument.metadata.description),
      created: instrument.metadata.created,
      version: instrument.version,
      agency,
      publisher: `urn:ddi:agency:${agency}`,
      rootSequence: urn(instrument.sequence.id),
      sensorConfig: instrument.sensors ? JSON.stringify(instrument.sensors) : undefined,
    }),
  );

  // --- Concepts / universes --------------------------------------------------
  for (const c of instrument.concepts as Concept[]) {
    graph.push(
      defined({
        '@id': urn(c.id),
        '@type': 'skos:Concept',
        prefLabel: intl(c.label),
        description: intl(c.description),
      }),
    );
  }
  for (const u of instrument.universes as Universe[]) {
    graph.push(
      defined({
        '@id': urn(u.id),
        '@type': 'disco:Universe',
        prefLabel: intl(u.label),
        expression: u.clause,
      }),
    );
  }

  // --- Code lists (SKOS) -----------------------------------------------------
  for (const cs of instrument.categorySchemes as CategoryScheme[]) {
    const schemeUrn = urn(cs.id);
    graph.push(
      defined({
        '@id': schemeUrn,
        '@type': 'skos:ConceptScheme',
        title: intl(cs.label),
        hasTopConcept: cs.categories.map((cat: Category) => urn(`${cs.id}.${cat.code}`)),
      }),
    );
    for (const cat of cs.categories) {
      graph.push(
        defined({
          '@id': urn(`${cs.id}.${cat.code}`),
          '@type': 'skos:Concept',
          notation: cat.code,
          prefLabel: intl(cat.label),
          inScheme: schemeUrn,
        }),
      );
    }
  }

  // --- Variables -------------------------------------------------------------
  for (const v of instrument.variables as Variable[]) {
    graph.push(
      defined({
        '@id': urn(v.id),
        '@type': 'disco:Variable',
        notation: v.name,
        prefLabel: intl(v.label),
        representation: v.representation,
        variableKind: v.kind,
        codeList: v.categorySchemeRef ? urn(v.categorySchemeRef) : undefined,
        concept: v.conceptRef ? urn(v.conceptRef) : undefined,
        expression: v.compute,
        isPII: v.isPII,
      }),
    );
  }

  // --- Control constructs ----------------------------------------------------
  const walk = (node: ControlConstruct): void => {
    const base = { '@id': urn(node.id), visibleWhen: 'visibleWhen' in node ? node.visibleWhen : undefined };
    switch (node.type) {
      case 'question':
        graph.push(
          defined({
            ...base,
            '@type': 'disco:Question',
            questionText: intl(node.text),
            instruction: intl(node.instruction),
            required: node.required,
            responseDomain: JSON.stringify(node.responseDomain),
            collects: variableUrnByName.get(node.variableRef),
            editRules: node.edits ? JSON.stringify(node.edits) : undefined,
          }),
        );
        return;
      case 'sequence':
        graph.push(
          defined({
            ...base,
            '@type': 'mst:Sequence',
            title: intl(node.label),
            isPage: node.isPage,
            members: node.children.map((c) => urn(c.id)),
          }),
        );
        node.children.forEach(walk);
        return;
      case 'ifThenElse':
        graph.push(
          defined({
            ...base,
            '@type': 'mst:Branch',
            condition: node.condition,
            thenBranch: node.then.map((c) => urn(c.id)),
            elseBranch: (node.else ?? []).map((c) => urn(c.id)),
          }),
        );
        node.then.forEach(walk);
        (node.else ?? []).forEach(walk);
        return;
      case 'loop':
        graph.push(
          defined({
            ...base,
            '@type': 'mst:Loop',
            title: intl(node.label),
            condition: node.loopWhile,
            members: node.children.map((c) => urn(c.id)),
          }),
        );
        node.children.forEach(walk);
        return;
      case 'computation':
        graph.push(
          defined({
            ...base,
            '@type': 'mst:Computation',
            expression: node.expression,
            target: variableUrnByName.get(node.targetVariableRef),
          }),
        );
        return;
      case 'statement':
        graph.push(defined({ ...base, '@type': 'mst:Statement', questionText: intl(node.text) }));
        return;
    }
  };
  walk(instrument.sequence);

  return { '@context': CONTEXT, '@graph': graph };
}

/** Serialize an Instrument as a JSON-LD document string. */
export function exportJsonLd(instrument: Instrument, options?: JsonLdOptions): string {
  return JSON.stringify(toJsonLd(instrument, options), null, 2);
}
