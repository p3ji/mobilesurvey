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
import { importDdiXml } from '../import.js';

/**
 * Normalize an instrument for deep-equal comparison:
 * - JSON stringify/parse strips `undefined` properties (semantically equivalent to absent)
 * - Preserves `false`, `0`, `''`, and all other falsy non-undefined values
 */
function normalize(inst: Instrument): unknown {
  return JSON.parse(JSON.stringify(inst));
}

const FIXTURES: [string, Instrument][] = [
  ['demo', demoInstrument],
  ['household', householdInstrument],
  ['lfs', lfsInstrument],
  ['census', censusInstrument],
  ['fsep', fsepInstrument],
];

describe('DDI-XML round-trip', () => {
  for (const [name, original] of FIXTURES) {
    it(`${name}: exports valid XML`, () => {
      const xml = exportDdiXml(original);
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('ddi:instance:3_3');
      expect(xml).toContain('<s:StudyUnit>');
      expect(xml).toContain('<d:DataCollection>');
    });

    it(`${name}: imports without warnings`, () => {
      const xml = exportDdiXml(original);
      const { report } = importDdiXml(xml);
      const warnings = report.notes.filter(n => n.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it(`${name}: round-trips to deep-equal instrument`, () => {
      const xml = exportDdiXml(original);
      const { instrument } = importDdiXml(xml);
      expect(normalize(instrument)).toEqual(normalize(original));
    });
  }
});

describe('DDI-XML fragment-packaging round-trip', () => {
  for (const [name, original] of FIXTURES) {
    it(`${name}: fragment export round-trips to deep-equal instrument`, () => {
      const xml = exportDdiXml(original, { packaging: 'fragment' });
      expect(xml).toContain('<i:FragmentInstance');
      expect(xml).toContain('<i:TopLevelReference>');
      const { instrument, report } = importDdiXml(xml);
      expect(report.notes.filter(n => n.severity === 'warning')).toHaveLength(0);
      expect(normalize(instrument)).toEqual(normalize(original));
    });
  }

  it('demo: every versionable item gets its own Fragment', () => {
    const xml = exportDdiXml(demoInstrument, { packaging: 'fragment' });
    const fragCount = (xml.match(/<i:Fragment>/g) ?? []).length;
    // At minimum: StudyUnit + 3 modules + one fragment per question item.
    const questionCount = (xml.match(/<d:QuestionItem>/g) ?? []).length;
    expect(fragCount).toBeGreaterThan(4 + questionCount);
    // Schemes hold children by reference, not inline: a QuestionItem fragment is a direct
    // Fragment child, never nested inside the QuestionScheme element.
    expect(xml).not.toMatch(/<d:QuestionScheme>(?:(?!<\/d:QuestionScheme>).)*<d:QuestionItem>/s);
  });
});

describe('DDI-XML export structure', () => {
  it('demo: contains all category scheme IDs', () => {
    const xml = exportDdiXml(demoInstrument);
    for (const cs of demoInstrument.categorySchemes) {
      expect(xml).toContain(cs.id);
    }
  });

  it('demo: contains all variable names', () => {
    const xml = exportDdiXml(demoInstrument);
    for (const v of demoInstrument.variables) {
      expect(xml).toContain(v.name);
    }
  });

  it('lfs: bilingual labels present for both en and fr', () => {
    const xml = exportDdiXml(lfsInstrument);
    expect(xml).toContain('xml:lang="en"');
    expect(xml).toContain('xml:lang="fr"');
  });

  it('produces well-formed XML (no unclosed tags from esc)', () => {
    const xml = exportDdiXml(demoInstrument);
    // Crude but effective: balanced angle brackets
    const opens = (xml.match(/</g) ?? []).length;
    const closes = (xml.match(/>/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe('DDI-XML import: fidelity report', () => {
  it('lossless flag is true for clean round-trip', () => {
    const xml = exportDdiXml(demoInstrument);
    const { report } = importDdiXml(xml);
    expect(report.lossless).toBe(true);
  });

  it('returns warning note for unknown response domain in external XML', () => {
    const minimalXml = `<?xml version="1.0" encoding="UTF-8"?>
<DDIInstance xmlns:i="ddi:instance:3_3" xmlns:r="ddi:reusable:3_3"
             xmlns:s="ddi:studyunit:3_3" xmlns:c="ddi:conceptualcomponent:3_3"
             xmlns:l="ddi:logicalproduct:3_3" xmlns:d="ddi:datacollection:3_3">
  <s:StudyUnit>
    <r:URN>urn:ddi:test:x:1.0</r:URN>
    <r:Agency>test</r:Agency>
    <r:ID>x</r:ID>
    <r:Version>1.0.0</r:Version>
    <r:UserID type="mst:languages">en</r:UserID>
    <r:UserID type="mst:defaultLanguage">en</r:UserID>
    <r:UserID type="mst:ddiProfile">ddi-lifecycle-3.3</r:UserID>
    <s:Citation><r:Title><r:String xml:lang="en">X</r:String></r:Title></s:Citation>
    <c:ConceptualComponent><r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version></c:ConceptualComponent>
    <l:LogicalProduct><r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version></l:LogicalProduct>
    <d:DataCollection>
      <r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version>
      <d:QuestionScheme>
        <r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version>
        <d:QuestionItem>
          <r:URN>urn:ddi:test:x:1.0!qi.q1</r:URN>
          <r:Agency>test</r:Agency>
          <r:ID>qi.q1</r:ID>
          <r:Version>1.0.0</r:Version>
          <r:UserID type="mst:id">q1</r:UserID>
          <r:UserID type="mst:variableRef">myVar</r:UserID>
          <d:QuestionText><d:LiteralText><d:Text xml:lang="en">Question?</d:Text></d:LiteralText></d:QuestionText>
          <d:UnknownDomain/>
        </d:QuestionItem>
      </d:QuestionScheme>
      <d:ControlConstructScheme>
        <r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version>
        <d:QuestionConstruct>
          <r:URN>urn:ddi:test:x:1.0!q1</r:URN>
          <r:Agency>test</r:Agency>
          <r:ID>q1</r:ID>
          <r:Version>1.0.0</r:Version>
          <r:UserID type="mst:id">q1</r:UserID>
          <d:QuestionReference>
            <r:URN>urn:ddi:test:x:1.0!qi.q1</r:URN>
            <r:Agency>test</r:Agency>
            <r:ID>qi.q1</r:ID>
            <r:Version>1.0.0</r:Version>
            <r:TypeOfObject>QuestionItem</r:TypeOfObject>
          </d:QuestionReference>
        </d:QuestionConstruct>
        <d:Sequence>
          <r:URN>urn:ddi:test:x:1.0!seq.root</r:URN>
          <r:Agency>test</r:Agency>
          <r:ID>seq.root</r:ID>
          <r:Version>1.0.0</r:Version>
          <r:UserID type="mst:id">seq.root</r:UserID>
          <d:ControlConstructReference>
            <r:URN>urn:ddi:test:x:1.0!q1</r:URN>
            <r:Agency>test</r:Agency>
            <r:ID>q1</r:ID>
            <r:Version>1.0.0</r:Version>
            <r:TypeOfObject>QuestionConstruct</r:TypeOfObject>
          </d:ControlConstructReference>
        </d:Sequence>
      </d:ControlConstructScheme>
      <d:InstrumentScheme>
        <r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version>
        <d:Instrument>
          <r:URN>u</r:URN><r:Agency>a</r:Agency><r:ID>i</r:ID><r:Version>v</r:Version>
          <r:Label><r:Content xml:lang="en">X</r:Content></r:Label>
          <d:ControlConstructReference>
            <r:URN>urn:ddi:test:x:1.0!seq.root</r:URN>
            <r:Agency>test</r:Agency>
            <r:ID>seq.root</r:ID>
            <r:Version>1.0.0</r:Version>
            <r:TypeOfObject>Sequence</r:TypeOfObject>
          </d:ControlConstructReference>
        </d:Instrument>
      </d:InstrumentScheme>
    </d:DataCollection>
  </s:StudyUnit>
</DDIInstance>`;
    const { report } = importDdiXml(minimalXml);
    const unknownDomainNote = report.notes.find(n => n.message.includes('response domain'));
    expect(unknownDomainNote).toBeDefined();
    expect(unknownDomainNote?.severity).toBe('warning');
  });
});
