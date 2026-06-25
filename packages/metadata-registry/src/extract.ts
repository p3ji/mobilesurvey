/**
 * Indexer: walk an instrument and emit one {@link RegistryEntry} per reusable component
 * (the instrument, each page, each named section, each question, each variable, each code list).
 * Captures as much DDI metadata as exists plus registry/EQ metadata, and builds the flattened
 * `searchText` used by search (and, later, embeddings).
 */
import type {
  CategoryScheme,
  ControlConstruct,
  Instrument,
  InternationalString,
  Variable,
} from '@mobilesurvey/instrument-schema';
import type { ComponentType, RegistryEntry } from './types.js';

/** All language values of an InternationalString, for language-agnostic search text. */
function intlValues(intl: InternationalString | undefined): string[] {
  if (!intl) return [];
  return Object.values(intl).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function searchText(parts: Array<string | string[] | undefined>): string {
  const flat: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (Array.isArray(p)) flat.push(...p);
    else flat.push(p);
  }
  return flat.filter(Boolean).join(' · ');
}

/** Depth-first walk of every construct in the tree. */
function* walk(node: ControlConstruct): Generator<ControlConstruct> {
  yield node;
  switch (node.type) {
    case 'sequence':
    case 'loop':
      for (const c of node.children) yield* walk(c);
      break;
    case 'ifThenElse':
      for (const c of node.then) yield* walk(c);
      for (const c of node.else ?? []) yield* walk(c);
      break;
    default:
      break;
  }
}

export interface BuildRegistryOptions {
  /** Override the "last updated" timestamp (defaults to instrument.metadata.created or now). */
  lastUpdated?: string;
}

/** Build the full set of registry entries for one instrument. */
export function buildRegistry(
  instrument: Instrument,
  options: BuildRegistryOptions = {},
): RegistryEntry[] {
  const provenance = instrument.id;
  const lastUpdated =
    options.lastUpdated ?? instrument.metadata.created ?? new Date().toISOString();
  const entries: RegistryEntry[] = [];

  // Usage counts: how many questions reference each variable / category scheme.
  const varUsage = new Map<string, number>();
  const schemeUsage = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string | undefined) => {
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const node of walk(instrument.sequence)) {
    if (node.type === 'question') {
      bump(varUsage, node.variableRef);
      const rd = node.responseDomain;
      if (rd.type === 'code' || rd.type === 'lookup') bump(schemeUsage, rd.categorySchemeRef);
      if (rd.type === 'markAll') bump(schemeUsage, rd.categorySchemeRef);
    }
  }

  const conceptLabel = (ref?: string): string[] =>
    ref ? intlValues(instrument.concepts.find((c) => c.id === ref)?.label) : [];

  // ── Instrument ────────────────────────────────────────────────────────────
  const conceptKeywords = instrument.concepts.flatMap((c) => intlValues(c.label));
  entries.push({
    entryId: `inst:${instrument.id}`,
    componentType: 'instrument',
    payload: instrument,
    searchText: searchText([
      intlValues(instrument.metadata.title),
      intlValues(instrument.metadata.description),
      conceptKeywords,
      instrument.metadata.agency,
    ]),
    ddi: {
      urn: instrument.id,
      agency: instrument.metadata.agency,
      version: instrument.version,
      label: instrument.metadata.title,
      description: instrument.metadata.description,
      keywords: conceptKeywords,
      ddiElementType: 'Instrument',
    },
    registry: { tags: ['instrument'], usageCount: 0, lastUpdated },
  });

  // ── Constructs: pages, sections, questions ─────────────────────────────────
  for (const node of walk(instrument.sequence)) {
    if (node.type === 'sequence') {
      // Skip the unlabelled root; index named pages and sections.
      const labels = intlValues(node.label);
      if (node.id === instrument.sequence.id || labels.length === 0) continue;
      const componentType: ComponentType = node.isPage ? 'page' : 'section';
      entries.push({
        entryId: `${instrument.id}#${node.id}`,
        componentType,
        payload: node,
        searchText: searchText([labels, node.isPage ? 'page screen' : 'section group']),
        ddi: {
          label: node.label,
          keywords: [componentType],
          ddiElementType: 'Sequence',
        },
        registry: { tags: [componentType], provenance, usageCount: 0, lastUpdated },
        eq: { flowTarget: node.isPage ? 'screen' : 'question' },
      });
    } else if (node.type === 'question') {
      const variable = instrument.variables.find((v) => v.name === node.variableRef);
      entries.push({
        entryId: `${instrument.id}#${node.id}`,
        componentType: 'question',
        payload: node,
        searchText: searchText([
          intlValues(node.text),
          intlValues(node.instruction),
          node.variableRef,
          node.responseDomain.type,
          conceptLabel(variable?.conceptRef),
        ]),
        ddi: {
          label: node.text,
          description: node.instruction,
          conceptRef: variable?.conceptRef,
          keywords: [node.variableRef, node.responseDomain.type].filter(Boolean),
          ddiElementType: 'QuestionItem',
        },
        registry: { tags: ['question', node.responseDomain.type], provenance, usageCount: 0, lastUpdated },
        eq: { flowTarget: 'question' },
      });
    }
  }

  // ── Variables ──────────────────────────────────────────────────────────────
  for (const v of instrument.variables as Variable[]) {
    entries.push({
      entryId: `${instrument.id}#var:${v.name}`,
      componentType: 'variable',
      payload: v,
      searchText: searchText([
        v.name,
        intlValues(v.label),
        v.representation,
        v.kind,
        conceptLabel(v.conceptRef),
      ]),
      ddi: {
        label: v.label,
        conceptRef: v.conceptRef,
        keywords: [v.name, v.representation, v.kind],
        ddiElementType: 'Variable',
      },
      registry: {
        tags: ['variable', v.kind, v.representation],
        provenance,
        usageCount: varUsage.get(v.name) ?? 0,
        lastUpdated,
      },
    });
  }

  // ── Code lists (category schemes) ──────────────────────────────────────────
  for (const scheme of instrument.categorySchemes as CategoryScheme[]) {
    const categoryLabels = scheme.categories.flatMap((c) => intlValues(c.label));
    entries.push({
      entryId: `${instrument.id}#cs:${scheme.id}`,
      componentType: 'codeList',
      payload: scheme,
      searchText: searchText([scheme.id, intlValues(scheme.label), categoryLabels]),
      ddi: {
        label: scheme.label,
        keywords: [scheme.id, ...scheme.categories.map((c) => c.code)],
        ddiElementType: 'CodeList',
      },
      registry: {
        tags: ['codeList'],
        provenance,
        usageCount: schemeUsage.get(scheme.id) ?? 0,
        lastUpdated,
      },
    });
  }

  return entries;
}

/** Build a combined registry across several instruments (the catalog). */
export function buildCatalog(instruments: Instrument[]): RegistryEntry[] {
  return instruments.flatMap((i) => buildRegistry(i));
}
