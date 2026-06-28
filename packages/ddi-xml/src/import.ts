/**
 * Import: DDI-Lifecycle-flavoured XML → mobilesurvey `Instrument`, with a fidelity report.
 *
 * The mapping is the exact reverse of `export.ts`. Unrecognized elements are not silently dropped —
 * they are recorded as `dropped` notes so an operator can see precisely what did not carry over. The
 * result is run through the schema's own `validateInstrument`, so shape and referential-integrity
 * failures surface as `error` notes (the import still returns the best-effort instrument).
 */
import {
  validateInstrument,
  type CategoryScheme,
  type Concept,
  type ControlConstruct,
  type EditRule,
  type Instrument,
  type InstrumentMetadata,
  type InternationalString,
  type InterviewerConfig,
  type PrefillMapping,
  type QuestionConstruct,
  type ResponseDomain,
  type SequenceConstruct,
  type Universe,
  type Variable,
} from '@mobilesurvey/instrument-schema';
import { parseXml, DdiXmlError, type XmlElement } from './xml.js';
import type { FidelityNote, ImportResult } from './fidelity.js';

// ── element-tree helpers ───────────────────────────────────────────────────────

function kid(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c) => c.tag === tag);
}
function kids(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c) => c.tag === tag);
}
function attr(el: XmlElement, name: string): string | undefined {
  return el.attrs[name];
}
function numAttr(el: XmlElement, name: string): number | undefined {
  const v = el.attrs[name];
  return v === undefined ? undefined : Number(v);
}
function boolAttr(el: XmlElement, name: string): boolean | undefined {
  const v = el.attrs[name];
  return v === undefined ? undefined : v === 'true';
}
function textOf(el: XmlElement | undefined): string | undefined {
  return el?.text;
}

/**
 * Read an `InternationalString` from a parent's language-tagged children of the given tag, e.g.
 * `readIntl(question, 'Text')` collects `<Text xml:lang="en">…</Text><Text xml:lang="fr">…</Text>`.
 */
function readIntl(parent: XmlElement | undefined, tag: string): InternationalString {
  const out: InternationalString = {};
  if (!parent) return out;
  for (const e of kids(parent, tag)) {
    out[e.attrs['xml:lang'] ?? ''] = e.text;
  }
  return out;
}

/** True when the parent has at least one language-tagged child of the given tag. */
function hasIntl(parent: XmlElement, tag: string): boolean {
  return kids(parent, tag).length > 0;
}

/** Drop keys whose value is `undefined`, so optional fields stay absent (not present-as-undefined). */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

/** Record any child elements that the named readers did not consume. */
function noteUnknownChildren(el: XmlElement, known: ReadonlySet<string>, path: string, notes: FidelityNote[]): void {
  for (const child of el.children) {
    if (!known.has(child.tag)) {
      notes.push({ level: 'dropped', path: `${path} > ${child.tag}`, message: `Unsupported <${child.tag}> element was ignored.` });
    }
  }
}

// ── response domain ─────────────────────────────────────────────────────────────

function readResponseDomain(el: XmlElement, path: string, notes: FidelityNote[]): ResponseDomain {
  const type = attr(el, 'type');
  switch (type) {
    case 'code':
      return compact({ type, categorySchemeRef: attr(el, 'categorySchemeRef') ?? '', selection: (attr(el, 'selection') ?? 'single') as 'single' | 'multiple' }) as ResponseDomain;
    case 'numeric':
      return compact({ type, min: numAttr(el, 'min'), max: numAttr(el, 'max'), decimals: numAttr(el, 'decimals'), unit: hasIntl(el, 'Unit') ? readIntl(el, 'Unit') : undefined }) as ResponseDomain;
    case 'text':
      return compact({ type, multiline: boolAttr(el, 'multiline'), maxLength: numAttr(el, 'maxLength'), pattern: attr(el, 'pattern') }) as ResponseDomain;
    case 'datetime':
      return { type, mode: (attr(el, 'mode') ?? 'date') as 'date' | 'time' | 'datetime' };
    case 'boolean':
      return { type };
    case 'file':
      return compact({ type, accept: kids(el, 'Accept').length > 0 ? kids(el, 'Accept').map((a) => a.text) : undefined, maxSizeMb: numAttr(el, 'maxSizeMb') }) as ResponseDomain;
    case 'lookup':
      return compact({ type, categorySchemeRef: attr(el, 'categorySchemeRef') ?? '', hierarchical: boolAttr(el, 'hierarchical') }) as ResponseDomain;
    case 'markAll':
      return { type, categorySchemeRef: attr(el, 'categorySchemeRef') ?? '', variablePrefix: attr(el, 'variablePrefix') ?? '' };
    case 'grid':
      return { type, rowSchemeRef: attr(el, 'rowSchemeRef') ?? '', colSchemeRef: attr(el, 'colSchemeRef') ?? '', variablePrefix: attr(el, 'variablePrefix') ?? '' };
    default:
      notes.push({ level: 'approximated', path, message: `Unknown ResponseDomain type "${type ?? '(none)'}"; treated as open text.` });
      return { type: 'text' };
  }
}

function readEdit(el: XmlElement): EditRule {
  const scopeEl = kid(el, 'Scope');
  return compact({
    id: attr(el, 'id') ?? '',
    type: (attr(el, 'type') ?? 'soft') as 'hard' | 'soft',
    when: textOf(kid(el, 'When')) ?? '',
    message: readIntl(el, 'Message'),
    scope: scopeEl ? kids(scopeEl, 'Var').map((v) => attr(v, 'name') ?? '') : undefined,
  });
}

// ── control constructs ──────────────────────────────────────────────────────────

function readChildren(wrapper: XmlElement | undefined, path: string, notes: FidelityNote[]): ControlConstruct[] {
  if (!wrapper) return [];
  const out: ControlConstruct[] = [];
  wrapper.children.forEach((child, i) => {
    const c = readConstruct(child, `${path}[${i}]`, notes);
    if (c) out.push(c);
  });
  return out;
}

function readConstruct(el: XmlElement, path: string, notes: FidelityNote[]): ControlConstruct | null {
  switch (el.tag) {
    case 'Question':
      return compact<QuestionConstruct>({
        type: 'question',
        id: attr(el, 'id') ?? '',
        variableRef: attr(el, 'variableRef') ?? '',
        text: readIntl(el, 'Text'),
        instruction: hasIntl(el, 'Instruction') ? readIntl(el, 'Instruction') : undefined,
        tooltip: hasIntl(el, 'Tooltip') ? readIntl(el, 'Tooltip') : undefined,
        responseDomain: readResponseDomain(kid(el, 'ResponseDomain') ?? el, `${path} > ResponseDomain`, notes),
        required: boolAttr(el, 'required'),
        edits: kid(el, 'Edits') ? kids(kid(el, 'Edits')!, 'Edit').map(readEdit) : undefined,
        visibleWhen: textOf(kid(el, 'VisibleWhen')),
        interviewerOnly: boolAttr(el, 'interviewerOnly'),
      });
    case 'Sequence':
      return compact<SequenceConstruct>({
        type: 'sequence',
        id: attr(el, 'id') ?? '',
        label: hasIntl(el, 'Label') ? readIntl(el, 'Label') : undefined,
        children: readChildren(kid(el, 'Children'), `${path} > Children`, notes),
        visibleWhen: textOf(kid(el, 'VisibleWhen')),
        isPage: boolAttr(el, 'isPage'),
        moduleKind: attr(el, 'moduleKind') as SequenceConstruct['moduleKind'],
        interviewerOnly: boolAttr(el, 'interviewerOnly'),
      });
    case 'IfThenElse': {
      const elseEl = kid(el, 'Else');
      return compact<ControlConstruct>({
        type: 'ifThenElse',
        id: attr(el, 'id') ?? '',
        condition: textOf(kid(el, 'Condition')) ?? '',
        then: readChildren(kid(el, 'Then'), `${path} > Then`, notes),
        else: elseEl ? readChildren(elseEl, `${path} > Else`, notes) : undefined,
      });
    }
    case 'Loop':
      return compact<ControlConstruct>({
        type: 'loop',
        id: attr(el, 'id') ?? '',
        loopVariable: attr(el, 'loopVariable') ?? '',
        countVariableRef: attr(el, 'countVariableRef'),
        loopWhile: textOf(kid(el, 'LoopWhile')),
        label: hasIntl(el, 'Label') ? readIntl(el, 'Label') : undefined,
        itemLabel: hasIntl(el, 'ItemLabel') ? readIntl(el, 'ItemLabel') : undefined,
        children: readChildren(kid(el, 'Children'), `${path} > Children`, notes),
        visibleWhen: textOf(kid(el, 'VisibleWhen')),
      });
    case 'Computation':
      return {
        type: 'computation',
        id: attr(el, 'id') ?? '',
        targetVariableRef: attr(el, 'targetVariableRef') ?? '',
        expression: textOf(kid(el, 'Expression')) ?? '',
      };
    case 'Statement':
      return compact<ControlConstruct>({
        type: 'statement',
        id: attr(el, 'id') ?? '',
        text: readIntl(el, 'Text'),
        visibleWhen: textOf(kid(el, 'VisibleWhen')),
        interviewerOnly: boolAttr(el, 'interviewerOnly'),
      });
    default:
      notes.push({ level: 'dropped', path, message: `Unsupported control construct <${el.tag}> was ignored.` });
      return null;
  }
}

// ── top-level pieces ────────────────────────────────────────────────────────────

function readMetadata(el: XmlElement | undefined): InstrumentMetadata {
  if (!el) return { title: {} };
  return compact<InstrumentMetadata>({
    title: readIntl(el, 'Title'),
    agency: textOf(kid(el, 'Agency')),
    description: hasIntl(el, 'Description') ? readIntl(el, 'Description') : undefined,
    created: textOf(kid(el, 'Created')),
  });
}

function readConcept(el: XmlElement): Concept {
  return compact<Concept>({
    id: attr(el, 'id') ?? '',
    label: readIntl(el, 'Label'),
    description: hasIntl(el, 'Description') ? readIntl(el, 'Description') : undefined,
  });
}

function readUniverse(el: XmlElement): Universe {
  return compact<Universe>({
    id: attr(el, 'id') ?? '',
    label: readIntl(el, 'Label'),
    clause: textOf(kid(el, 'Clause')),
  });
}

function readCategoryScheme(el: XmlElement): CategoryScheme {
  return {
    id: attr(el, 'id') ?? '',
    label: readIntl(el, 'Label'),
    categories: kids(el, 'Category').map((cat) => ({ code: attr(cat, 'code') ?? '', label: readIntl(cat, 'Label') })),
  };
}

function readVariable(el: XmlElement): Variable {
  return compact<Variable>({
    id: attr(el, 'id') ?? '',
    name: attr(el, 'name') ?? '',
    kind: (attr(el, 'kind') ?? 'collected') as Variable['kind'],
    label: readIntl(el, 'Label'),
    representation: (attr(el, 'representation') ?? 'text') as Variable['representation'],
    conceptRef: attr(el, 'conceptRef'),
    categorySchemeRef: attr(el, 'categorySchemeRef'),
    compute: textOf(kid(el, 'Compute')),
    interviewerOnly: boolAttr(el, 'interviewerOnly'),
  });
}

function readPrefill(el: XmlElement): PrefillMapping {
  return { sampleField: attr(el, 'sampleField') ?? '', targetVariable: attr(el, 'targetVariable') ?? '' };
}

function readInterviewer(el: XmlElement): InterviewerConfig {
  return compact<InterviewerConfig>({
    enabled: boolAttr(el, 'enabled') ?? false,
    allowFreeNavigation: boolAttr(el, 'allowFreeNavigation') ?? false,
    entryModuleRef: attr(el, 'entryModuleRef'),
    exitModuleRef: attr(el, 'exitModuleRef'),
  });
}

const INSTRUMENT_CHILDREN = new Set([
  'Languages',
  'Metadata',
  'Concepts',
  'Universes',
  'CategorySchemes',
  'Variables',
  'PrefillMappings',
  'Sequence',
  'Interviewer',
]);

function buildInstrument(root: XmlElement, notes: FidelityNote[]): Instrument {
  noteUnknownChildren(root, INSTRUMENT_CHILDREN, 'Instrument', notes);

  const languagesEl = kid(root, 'Languages');
  const languages = languagesEl ? kids(languagesEl, 'Language').map((l) => attr(l, 'code') ?? '') : [];

  const sequenceEl = kid(root, 'Sequence');
  const sequence = sequenceEl ? readConstruct(sequenceEl, 'Instrument > Sequence', notes) : null;
  if (!sequence || sequence.type !== 'sequence') {
    notes.push({ level: 'error', path: 'Instrument > Sequence', message: 'Missing or invalid root <Sequence>.' });
  }

  const interviewerEl = kid(root, 'Interviewer');

  return compact<Instrument>({
    id: attr(root, 'id') ?? '',
    version: attr(root, 'version') ?? '1.0.0',
    ddiProfile: (attr(root, 'ddiProfile') ?? 'ddi-lifecycle-3.3') as Instrument['ddiProfile'],
    languages,
    defaultLanguage: attr(root, 'defaultLanguage') ?? languages[0] ?? 'en',
    metadata: readMetadata(kid(root, 'Metadata')),
    concepts: kids(kid(root, 'Concepts') ?? root, 'Concept').map(readConcept),
    universes: kids(kid(root, 'Universes') ?? root, 'Universe').map(readUniverse),
    categorySchemes: kids(kid(root, 'CategorySchemes') ?? root, 'CategoryScheme').map(readCategoryScheme),
    variables: kids(kid(root, 'Variables') ?? root, 'Variable').map(readVariable),
    prefillMappings: kids(kid(root, 'PrefillMappings') ?? root, 'PrefillMapping').map(readPrefill),
    sequence: (sequence?.type === 'sequence' ? sequence : { type: 'sequence', id: 'seq.root', children: [] }) as SequenceConstruct,
    interviewer: interviewerEl ? readInterviewer(interviewerEl) : undefined,
  });
}

/**
 * Parse a DDI-XML document into an instrument, returning the result plus a fidelity report.
 * Never throws on malformed input — parse failures and validation failures surface as notes.
 */
export function ddiXmlToInstrument(xml: string): ImportResult {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (err) {
    const message = err instanceof DdiXmlError ? err.message : String(err);
    return { ok: false, instrument: null, notes: [{ level: 'error', path: '', message: `Malformed XML: ${message}` }] };
  }

  const notes: FidelityNote[] = [];
  if (root.tag !== 'Instrument') {
    notes.push({ level: 'error', path: root.tag, message: `Expected <Instrument> root element, found <${root.tag}>.` });
  }

  const built = buildInstrument(root, notes);
  const validation = validateInstrument(built);
  if (!validation.ok) {
    for (const issue of validation.issues) {
      notes.push({ level: 'error', path: issue.path, message: issue.message });
    }
    return { ok: false, instrument: built, notes };
  }

  return { ok: notes.every((n) => n.level !== 'error'), instrument: validation.instrument, notes };
}
