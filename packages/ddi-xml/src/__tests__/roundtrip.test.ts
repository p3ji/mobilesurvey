import { describe, expect, it } from 'vitest';
import {
  blankInstrument,
  demoInstrument,
  lfsInstrument,
  censusInstrument,
  validateInstrument,
  type Instrument,
} from '@mobilesurvey/instrument-schema';
import { instrumentToDdiXml, ddiXmlToInstrument } from '../index.js';

/** Zod-normalize so the comparison is against the canonical form, not authoring order. */
function normalize(inst: Instrument): Instrument {
  const r = validateInstrument(inst);
  if (!r.ok) throw new Error(`fixture is not a valid instrument: ${JSON.stringify(r.issues)}`);
  return r.instrument;
}

describe('DDI-XML round-trip', () => {
  const fixtures: Array<[string, Instrument]> = [
    ['blank', blankInstrument('Round-trip blank')],
    ['demo', demoInstrument],
    ['lfs', lfsInstrument],
    ['census', censusInstrument],
  ];

  for (const [name, inst] of fixtures) {
    it(`exports and re-imports "${name}" without loss`, () => {
      const xml = instrumentToDdiXml(inst);
      expect(xml).toContain('<Instrument');

      const result = ddiXmlToInstrument(xml);
      expect(result.notes.filter((n) => n.level === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.instrument).toEqual(normalize(inst));
    });
  }

  it('preserves bilingual labels and expression operators', () => {
    const xml = instrumentToDdiXml(demoInstrument);
    // French labels survive...
    expect(xml).toContain('xml:lang="fr"');
    // ...and routing operators are escaped, not corrupted.
    if (/<(VisibleWhen|Condition|When|LoopWhile)>/.test(xml)) {
      expect(xml).not.toMatch(/<(VisibleWhen|Condition|When|LoopWhile)>[^<]*<[^/]/);
    }
  });
});

describe('DDI-XML import of external documents', () => {
  it('imports a hand-authored document and flags unsupported elements', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Instrument id="urn:ext:demo:1" version="2.1" ddiProfile="ddi-lifecycle-3.3" defaultLanguage="en">
        <Languages><Language code="en"/></Languages>
        <Metadata><Title xml:lang="en">External Survey</Title></Metadata>
        <Concepts/>
        <Universes/>
        <CategorySchemes>
          <CategoryScheme id="cs.yn">
            <Label xml:lang="en">Yes/No</Label>
            <Category code="y"><Label xml:lang="en">Yes</Label></Category>
            <Category code="n"><Label xml:lang="en">No</Label></Category>
          </CategoryScheme>
        </CategorySchemes>
        <Variables>
          <Variable id="v.q1" name="q1" kind="collected" representation="code" categorySchemeRef="cs.yn">
            <Label xml:lang="en">Do you agree?</Label>
          </Variable>
        </Variables>
        <PrefillMappings/>
        <Sequence id="seq.root">
          <Children>
            <Question id="q.q1" variableRef="q1" required="true">
              <Text xml:lang="en">Do you agree?</Text>
              <ResponseDomain type="code" selection="single" categorySchemeRef="cs.yn"/>
            </Question>
          </Children>
        </Sequence>
        <FutureExtension foo="bar"/>
      </Instrument>`;

    const result = ddiXmlToInstrument(xml);
    expect(result.ok).toBe(true);
    expect(result.instrument?.metadata.title['en']).toBe('External Survey');
    expect(result.instrument?.variables).toHaveLength(1);
    // The unknown top-level element is reported, not silently swallowed.
    expect(result.notes.some((n) => n.level === 'dropped' && n.message.includes('FutureExtension'))).toBe(true);
  });

  it('returns an error report (not a throw) on malformed XML', () => {
    const result = ddiXmlToInstrument('<Instrument><Metadata></Instrument>');
    expect(result.ok).toBe(false);
    expect(result.instrument).toBeNull();
    expect(result.notes[0]?.level).toBe('error');
  });

  it('reports referential-integrity problems as errors', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Instrument id="urn:ext:bad:1" version="1.0.0" ddiProfile="ddi-lifecycle-3.3" defaultLanguage="en">
        <Languages><Language code="en"/></Languages>
        <Metadata><Title xml:lang="en">Bad refs</Title></Metadata>
        <Concepts/><Universes/><CategorySchemes/>
        <Variables/>
        <PrefillMappings/>
        <Sequence id="seq.root">
          <Children>
            <Question id="q.x" variableRef="does_not_exist">
              <Text xml:lang="en">Orphan</Text>
              <ResponseDomain type="text"/>
            </Question>
          </Children>
        </Sequence>
      </Instrument>`;
    const result = ddiXmlToInstrument(xml);
    expect(result.ok).toBe(false);
    expect(result.notes.some((n) => n.level === 'error')).toBe(true);
  });
});
