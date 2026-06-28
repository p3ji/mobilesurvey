/**
 * Export: mobilesurvey `Instrument` → DDI-Lifecycle-flavoured XML.
 *
 * The element vocabulary mirrors DDI-Lifecycle 3.3 terminology (Instrument, CategoryScheme,
 * Category, Variable, Sequence, Question, IfThenElse, Loop, ...). `InternationalString` values are
 * emitted as DDI-style language-tagged `<Label xml:lang="...">` children. Expressions are emitted as
 * element text (never attributes) so routing operators like `<`/`&&` are unambiguous after escaping.
 *
 * This export is loss-free for the full Instrument model; `import.ts` reverses it exactly.
 */
import type {
  CategoryScheme,
  Concept,
  ControlConstruct,
  EditRule,
  Instrument,
  InstrumentMetadata,
  InternationalString,
  InterviewerConfig,
  QuestionConstruct,
  ResponseDomain,
  Universe,
  Variable,
} from '@mobilesurvey/instrument-schema';
import { serializeXml, type XmlElement } from './xml.js';

type AttrValue = string | number | boolean | undefined;

function attrs(record: Record<string, AttrValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) out[k] = String(v);
  }
  return out;
}

function el(tag: string, a: Record<string, AttrValue>, children: XmlElement[]): XmlElement {
  return { tag, attrs: attrs(a), children, text: '' };
}

function leaf(tag: string, text: string, a: Record<string, AttrValue> = {}): XmlElement {
  return { tag, attrs: attrs(a), children: [], text };
}

/**
 * An `InternationalString` becomes one language-tagged element per language, placed directly under
 * the owning element (idiomatic DDI: `<Label xml:lang="en">…</Label><Label xml:lang="fr">…</Label>`).
 * Returns the list so call sites can spread it into the parent's children.
 */
function intlEls(tag: string, value: InternationalString): XmlElement[] {
  return Object.entries(value).map(([lang, text]) => leaf(tag, text, { 'xml:lang': lang }));
}

/** An expression becomes an element whose text is the (escaped) expression source. */
function expr(tag: string, source: string): XmlElement {
  return leaf(tag, source);
}

function responseDomainEl(rd: ResponseDomain): XmlElement {
  switch (rd.type) {
    case 'code':
      return el('ResponseDomain', { type: rd.type, selection: rd.selection, categorySchemeRef: rd.categorySchemeRef }, []);
    case 'numeric':
      return el(
        'ResponseDomain',
        { type: rd.type, min: rd.min, max: rd.max, decimals: rd.decimals },
        rd.unit ? intlEls('Unit', rd.unit) : [],
      );
    case 'text':
      return el('ResponseDomain', { type: rd.type, multiline: rd.multiline, maxLength: rd.maxLength, pattern: rd.pattern }, []);
    case 'datetime':
      return el('ResponseDomain', { type: rd.type, mode: rd.mode }, []);
    case 'boolean':
      return el('ResponseDomain', { type: rd.type }, []);
    case 'file':
      return el(
        'ResponseDomain',
        { type: rd.type, maxSizeMb: rd.maxSizeMb },
        (rd.accept ?? []).map((a) => leaf('Accept', a)),
      );
    case 'lookup':
      return el('ResponseDomain', { type: rd.type, categorySchemeRef: rd.categorySchemeRef, hierarchical: rd.hierarchical }, []);
    case 'markAll':
      return el('ResponseDomain', { type: rd.type, categorySchemeRef: rd.categorySchemeRef, variablePrefix: rd.variablePrefix }, []);
    case 'grid':
      return el(
        'ResponseDomain',
        { type: rd.type, rowSchemeRef: rd.rowSchemeRef, colSchemeRef: rd.colSchemeRef, variablePrefix: rd.variablePrefix },
        [],
      );
  }
}

function editEl(e: EditRule): XmlElement {
  const children: XmlElement[] = [expr('When', e.when), ...intlEls('Message', e.message)];
  if (e.scope && e.scope.length > 0) {
    children.push(el('Scope', {}, e.scope.map((name) => leaf('Var', '', { name }))));
  }
  return el('Edit', { id: e.id, type: e.type }, children);
}

function questionEl(q: QuestionConstruct): XmlElement {
  const children: XmlElement[] = [];
  if (q.visibleWhen) children.push(expr('VisibleWhen', q.visibleWhen));
  children.push(...intlEls('Text', q.text));
  if (q.instruction) children.push(...intlEls('Instruction', q.instruction));
  if (q.tooltip) children.push(...intlEls('Tooltip', q.tooltip));
  children.push(responseDomainEl(q.responseDomain));
  if (q.edits && q.edits.length > 0) {
    children.push(el('Edits', {}, q.edits.map(editEl)));
  }
  return el('Question', { id: q.id, variableRef: q.variableRef, required: q.required, interviewerOnly: q.interviewerOnly }, children);
}

function constructEl(c: ControlConstruct): XmlElement {
  switch (c.type) {
    case 'question':
      return questionEl(c);
    case 'sequence': {
      const children: XmlElement[] = [];
      if (c.label) children.push(...intlEls('Label', c.label));
      if (c.visibleWhen) children.push(expr('VisibleWhen', c.visibleWhen));
      children.push(el('Children', {}, c.children.map(constructEl)));
      return el('Sequence', { id: c.id, isPage: c.isPage, moduleKind: c.moduleKind, interviewerOnly: c.interviewerOnly }, children);
    }
    case 'ifThenElse': {
      const children: XmlElement[] = [expr('Condition', c.condition), el('Then', {}, c.then.map(constructEl))];
      if (c.else) children.push(el('Else', {}, c.else.map(constructEl)));
      return el('IfThenElse', { id: c.id }, children);
    }
    case 'loop': {
      const children: XmlElement[] = [];
      if (c.loopWhile) children.push(expr('LoopWhile', c.loopWhile));
      if (c.label) children.push(...intlEls('Label', c.label));
      if (c.itemLabel) children.push(...intlEls('ItemLabel', c.itemLabel));
      if (c.visibleWhen) children.push(expr('VisibleWhen', c.visibleWhen));
      children.push(el('Children', {}, c.children.map(constructEl)));
      return el('Loop', { id: c.id, loopVariable: c.loopVariable, countVariableRef: c.countVariableRef }, children);
    }
    case 'computation':
      return el('Computation', { id: c.id, targetVariableRef: c.targetVariableRef }, [expr('Expression', c.expression)]);
    case 'statement': {
      const children: XmlElement[] = [...intlEls('Text', c.text)];
      if (c.visibleWhen) children.push(expr('VisibleWhen', c.visibleWhen));
      return el('Statement', { id: c.id, interviewerOnly: c.interviewerOnly }, children);
    }
  }
}

function metadataEl(m: InstrumentMetadata): XmlElement {
  const children: XmlElement[] = [...intlEls('Title', m.title)];
  if (m.agency !== undefined) children.push(leaf('Agency', m.agency));
  if (m.description) children.push(...intlEls('Description', m.description));
  if (m.created !== undefined) children.push(leaf('Created', m.created));
  return el('Metadata', {}, children);
}

function conceptEl(c: Concept): XmlElement {
  const children: XmlElement[] = [...intlEls('Label', c.label)];
  if (c.description) children.push(...intlEls('Description', c.description));
  return el('Concept', { id: c.id }, children);
}

function universeEl(u: Universe): XmlElement {
  const children: XmlElement[] = [...intlEls('Label', u.label)];
  if (u.clause) children.push(expr('Clause', u.clause));
  return el('Universe', { id: u.id }, children);
}

function categorySchemeEl(cs: CategoryScheme): XmlElement {
  const children: XmlElement[] = [...intlEls('Label', cs.label)];
  for (const cat of cs.categories) {
    children.push(el('Category', { code: cat.code }, intlEls('Label', cat.label)));
  }
  return el('CategoryScheme', { id: cs.id }, children);
}

function variableEl(v: Variable): XmlElement {
  const children: XmlElement[] = [...intlEls('Label', v.label)];
  if (v.compute) children.push(expr('Compute', v.compute));
  return el(
    'Variable',
    {
      id: v.id,
      name: v.name,
      kind: v.kind,
      representation: v.representation,
      conceptRef: v.conceptRef,
      categorySchemeRef: v.categorySchemeRef,
      interviewerOnly: v.interviewerOnly,
    },
    children,
  );
}

function interviewerEl(iv: InterviewerConfig): XmlElement {
  return el(
    'Interviewer',
    {
      enabled: iv.enabled,
      allowFreeNavigation: iv.allowFreeNavigation,
      entryModuleRef: iv.entryModuleRef,
      exitModuleRef: iv.exitModuleRef,
    },
    [],
  );
}

/** Build the DDI-XML `XmlElement` tree for an instrument (without serializing). */
export function instrumentToXmlElement(inst: Instrument): XmlElement {
  const children: XmlElement[] = [
    el('Languages', {}, inst.languages.map((code) => leaf('Language', '', { code }))),
    metadataEl(inst.metadata),
    el('Concepts', {}, inst.concepts.map(conceptEl)),
    el('Universes', {}, inst.universes.map(universeEl)),
    el('CategorySchemes', {}, inst.categorySchemes.map(categorySchemeEl)),
    el('Variables', {}, inst.variables.map(variableEl)),
    el('PrefillMappings', {}, inst.prefillMappings.map((pm) => leaf('PrefillMapping', '', { sampleField: pm.sampleField, targetVariable: pm.targetVariable }))),
    constructEl(inst.sequence),
  ];
  if (inst.interviewer) children.push(interviewerEl(inst.interviewer));

  return el(
    'Instrument',
    { id: inst.id, version: inst.version, ddiProfile: inst.ddiProfile, defaultLanguage: inst.defaultLanguage },
    children,
  );
}

/** Serialize an instrument to a DDI-Lifecycle-flavoured XML document. */
export function instrumentToDdiXml(inst: Instrument): string {
  return serializeXml(instrumentToXmlElement(inst));
}
