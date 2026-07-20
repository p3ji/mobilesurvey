import { describe, it, expect } from 'vitest';
import { demoInstrument, fsepInstrument, censusInstrument } from '@mobilesurvey/instrument-schema';
import type { Instrument } from '@mobilesurvey/instrument-schema';
import { exportDdiXml } from '../export.js';
import { toJsonLd, exportJsonLd, MST_NAMESPACE } from '../jsonld.js';

interface Doc {
  '@context': Record<string, unknown>;
  '@graph': Record<string, unknown>[];
}

const doc = (i: Instrument, opts?: Parameters<typeof toJsonLd>[1]): Doc =>
  toJsonLd(i, opts) as Doc;

/** Every IRI-valued term in the context, so tests can find the graph's edges generically. */
function refTerms(context: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const [term, def] of Object.entries(context)) {
    if (def && typeof def === 'object' && (def as { '@type'?: string })['@type'] === '@id') {
      out.add(term);
    }
  }
  return out;
}

describe('JSON-LD projection', () => {
  it('emits a context and a flat @graph', () => {
    const d = doc(demoInstrument);
    expect(d['@context']).toBeDefined();
    expect(d['@context'].mst).toBe(MST_NAMESPACE);
    expect(d['@context'].disco).toBe('http://rdf-vocabulary.ddialliance.org/discovery#');
    expect(Array.isArray(d['@graph'])).toBe(true);
    expect(d['@graph'].length).toBeGreaterThan(20);
    for (const node of d['@graph']) {
      expect(node['@id']).toMatch(/^urn:ddi:/);
      expect(typeof node['@type']).toBe('string');
    }
  });

  it('uses the SAME canonical URNs as the XML export — one resource, two serializations', () => {
    for (const idScheme of ['uuid', 'readable'] as const) {
      const xml = exportDdiXml(demoInstrument, { idScheme });
      const xmlUrns = new Set(
        [...xml.matchAll(/<r:URN>([^<]+)<\/r:URN>/g)].map((m) => m[1]!),
      );
      const ldIds = doc(demoInstrument, { idScheme })['@graph'].map((n) => n['@id'] as string);
      // Every JSON-LD node identifies a resource the XML also identifies. (The XML mints a few
      // extra URNs for DDI-only wrappers — schemes, the DDIInstance — that have no JSON-LD node.)
      const missing = ldIds.filter((id) => !xmlUrns.has(id));
      expect(missing, `${idScheme}: ids absent from the XML`).toEqual([]);
    }
  });

  it('has no dangling edges — every reference resolves to a node in the graph', () => {
    for (const inst of [demoInstrument, fsepInstrument, censusInstrument]) {
      const d = doc(inst);
      const ids = new Set(d['@graph'].map((n) => n['@id'] as string));
      const terms = refTerms(d['@context']);
      for (const node of d['@graph']) {
        for (const term of terms) {
          const value = node[term];
          if (value === undefined) continue;
          // `publisher` points at the agency, which is deliberately not a graph node.
          if (term === 'publisher') continue;
          for (const ref of Array.isArray(value) ? value : [value]) {
            expect(ids, `${inst.id}: ${node['@id']}.${term} → ${String(ref)}`).toContain(ref);
          }
        }
      }
    }
  });

  it('maps InternationalString onto JSON-LD language maps', () => {
    const d = doc(demoInstrument);
    expect(d['@context'].title).toMatchObject({ '@container': '@language' });
    const questionnaire = d['@graph'].find((n) => n['@type'] === 'disco:Questionnaire')!;
    expect(questionnaire.title).toMatchObject({ en: expect.any(String), fr: expect.any(String) });
  });

  it('projects questions, variables and code lists onto disco/SKOS types', () => {
    const d = doc(demoInstrument);
    const types = d['@graph'].map((n) => n['@type'] as string);
    expect(types).toContain('disco:Questionnaire');
    expect(types).toContain('disco:Question');
    expect(types).toContain('disco:Variable');
    expect(types).toContain('skos:ConceptScheme');
    expect(types).toContain('skos:Concept');

    // A coded question links to its variable, which links to its code list, whose categories
    // are SKOS concepts in that scheme — the chain a consuming graph needs to traverse.
    const variable = d['@graph'].find((n) => n['@type'] === 'disco:Variable' && n.notation === 'freq')!;
    const list = d['@graph'].find((n) => n['@id'] === variable.codeList)!;
    expect(list['@type']).toBe('skos:ConceptScheme');
    const concepts = d['@graph'].filter((n) => n.inScheme === list['@id']);
    expect(concepts.length).toBeGreaterThan(1);
    expect(concepts[0]!.notation).toEqual(expect.any(String));
  });

  it('keeps questionnaire flow addressable (sequence membership is an ordered list)', () => {
    const d = doc(demoInstrument);
    const root = d['@graph'].find((n) => n['@type'] === 'disco:Questionnaire')!;
    const rootSeq = d['@graph'].find((n) => n['@id'] === root.rootSequence)!;
    expect(rootSeq['@type']).toBe('mst:Sequence');
    expect(Array.isArray(rootSeq.members)).toBe(true);
    expect((rootSeq.members as string[]).length).toBeGreaterThan(3);
    expect(d['@context'].members).toMatchObject({ '@container': '@list' });
  });

  it('serializes as parseable, stable JSON', () => {
    const a = exportJsonLd(demoInstrument);
    expect(() => JSON.parse(a)).not.toThrow();
    expect(a).toBe(exportJsonLd(demoInstrument));
  });

  it('carries the sensor module config through', () => {
    const q = doc(demoInstrument)['@graph'].find((n) => n['@type'] === 'disco:Questionnaire')!;
    expect(JSON.parse(q.sensorConfig as string)).toEqual(demoInstrument.sensors);
  });
});
