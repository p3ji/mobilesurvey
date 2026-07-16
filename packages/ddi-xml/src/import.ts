/**
 * Import a DDI-Lifecycle 3.3 XML document into an Instrument.
 *
 * Designed primarily for round-tripping XML produced by exportDdiXml(), but
 * also handles external DDI-L 3.3 files on a best-effort basis, surfacing any
 * approximations as fidelity notes.
 */
import type {
  Instrument,
  ControlConstruct,
  SequenceConstruct,
  QuestionConstruct,
  IfThenElseConstruct,
  LoopConstruct,
  ComputationConstruct,
  StatementConstruct,
  InternationalString,
  ResponseDomain,
  Variable,
  CategoryScheme,
  Concept,
  Universe,
  EditRule,
  PrefillMapping,
  InterviewerConfig,
} from '@mobilesurvey/instrument-schema';
import { parseXml, type XmlNode } from './xml.js';
import { unmapId } from './urn.js';
import type { FidelityNote, ImportResult } from './types.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function kids(n: XmlNode | undefined, localName: string): XmlNode[] {
  if (!n) return [];
  return n.children.filter(c => c.localName === localName);
}

function kid(n: XmlNode | undefined, localName: string): XmlNode | undefined {
  return n?.children.find(c => c.localName === localName);
}

/** Read <r:UserID typeOfUserID="mst:KEY"> text from a node's direct children.
 * (`type` accepted as a legacy fallback for XML exported before the XSD-compliance change.) */
function mst(n: XmlNode, key: string): string | undefined {
  return n.children.find(
    c => c.localName === 'UserID' && (c.attrs['typeOfUserID'] === `mst:${key}` || c.attrs['type'] === `mst:${key}`),
  )?.text;
}

/**
 * r:ID text of a node, un-mapped back to internal-id space (the exporter maps internal ids to
 * XSD-legal DDI IDs by escaping 2nd+ dots as '@' — see urn.ts). Everything in this importer —
 * registry keys, reference targets, id fallbacks — operates uniformly in the raw space so
 * suffix conventions like `.cl` strip correctly. (An external file whose IDs genuinely contain
 * '@' would be altered by this; acceptable for now — external-file hardening is P4.)
 */
function rid(n: XmlNode): string {
  return unmapId(kid(n, 'ID')?.text ?? '');
}

/**
 * Extract the local ID from a URN produced by exportDdiXml(), in raw internal-id space.
 *
 * Current format is the canonical DDI URN `urn:ddi:{agency}:{mappedId}:{version}` — the local
 * id is the 4th colon-separated segment (agency labels contain no colons, nor do mapped ids or
 * versions). The pre-compliance format `{instrumentUrn}!{localId}` is still accepted so XML
 * exported before the canonical-URN change keeps importing.
 */
function urnToLocalId(urn: string): string {
  const bang = urn.indexOf('!');
  if (bang >= 0) return urn.slice(bang + 1);
  const parts = urn.split(':');
  if (parts.length === 5 && parts[0]?.toLowerCase() === 'urn' && parts[1]?.toLowerCase() === 'ddi') {
    return unmapId(parts[3]!);
  }
  return urn;
}

// ---------------------------------------------------------------------------
// InternationalString extraction
// ---------------------------------------------------------------------------

function intlFromLabel(n: XmlNode | undefined): InternationalString {
  const result: InternationalString = {};
  if (!n) return result;
  const label = kid(n, 'Label');
  const source = label ?? n;
  for (const c of source.children) {
    if (c.localName === 'Content' || c.localName === 'String') {
      result[c.attrs['xml:lang'] ?? 'en'] = c.text;
    }
  }
  return result;
}

function intlFromDdiText(n: XmlNode | undefined): InternationalString {
  const result: InternationalString = {};
  if (!n) return result;
  // One LiteralText per language (each LiteralTextType holds exactly one Text). The inner loop
  // also covers legacy exports that put multiple Text children under a single LiteralText.
  for (const lit of kids(n, 'LiteralText')) {
    for (const t of kids(lit, 'Text')) {
      result[t.attrs['xml:lang'] ?? 'en'] = t.text;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Response domain parsing
// ---------------------------------------------------------------------------

function parseRd(qiNode: XmlNode, qid: string, notes: FidelityNote[]): ResponseDomain {
  const codeDom = kid(qiNode, 'CodeDomain');
  if (codeDom) {
    const rdType = mst(codeDom, 'rdType');
    if (rdType === 'boolean') return { type: 'boolean' };
    const clRef = kid(codeDom, 'CodeListReference');
    const clId = clRef ? rid(clRef) : '';
    const csRef = clId.endsWith('.cl') ? clId.slice(0, -3) : clId;
    if (rdType === 'lookup') {
      return {
        type: 'lookup',
        categorySchemeRef: csRef,
        hierarchical: mst(codeDom, 'hierarchical') === 'true' || undefined,
      };
    }
    if (rdType === 'markAll') {
      return {
        type: 'markAll',
        categorySchemeRef: csRef,
        variablePrefix: mst(codeDom, 'variablePrefix') ?? '',
      };
    }
    const sel = (mst(codeDom, 'selection') ?? 'single') as 'single' | 'multiple';
    return { type: 'code', categorySchemeRef: csRef, selection: sel };
  }

  const numDom = kid(qiNode, 'NumericDomain');
  if (numDom) {
    const mn = mst(numDom, 'min');
    const mx = mst(numDom, 'max');
    const dec = mst(numDom, 'decimals');
    const unit = mst(numDom, 'unit');
    return {
      type: 'numeric',
      min: mn != null ? Number(mn) : undefined,
      max: mx != null ? Number(mx) : undefined,
      decimals: dec != null ? Number(dec) : undefined,
      unit: unit ? (JSON.parse(unit) as InternationalString) : undefined,
    };
  }

  const txtDom = kid(qiNode, 'TextDomain');
  if (txtDom) {
    if (mst(txtDom, 'rdType') === 'file') {
      const acc = mst(txtDom, 'accept');
      const mb = mst(txtDom, 'maxSizeMb');
      return {
        type: 'file',
        accept: acc ? acc.split(',') : undefined,
        maxSizeMb: mb != null ? Number(mb) : undefined,
      };
    }
    const ml = mst(txtDom, 'multiline');
    const maxLen = mst(txtDom, 'maxLength');
    const pat = mst(txtDom, 'pattern');
    return {
      type: 'text',
      multiline: ml === 'true' || undefined,
      maxLength: maxLen != null ? Number(maxLen) : undefined,
      pattern: pat ?? undefined,
    };
  }

  const dtDom = kid(qiNode, 'DateTimeDomain');
  if (dtDom) {
    return { type: 'datetime', mode: (mst(dtDom, 'mode') ?? 'date') as 'date' | 'time' | 'datetime' };
  }

  const gridDom = kid(qiNode, 'GridDomain');
  if (gridDom) {
    if (mst(gridDom, 'rdType') === 'table') {
      const unit = mst(gridDom, 'unit');
      const decimals = mst(gridDom, 'decimals');
      const min = mst(gridDom, 'min');
      const max = mst(gridDom, 'max');
      const disabledCells = mst(gridDom, 'disabledCells');
      return {
        type: 'table',
        rowSchemeRef: mst(gridDom, 'rowSchemeRef') ?? '',
        colSchemeRef: mst(gridDom, 'colSchemeRef') ?? '',
        variablePrefix: mst(gridDom, 'variablePrefix') ?? '',
        unit: unit ? (JSON.parse(unit) as InternationalString) : undefined,
        decimals: decimals != null ? Number(decimals) : undefined,
        min: min != null ? Number(min) : undefined,
        max: max != null ? Number(max) : undefined,
        totalRow: mst(gridDom, 'totalRow') === 'true' || undefined,
        totalCol: mst(gridDom, 'totalCol') === 'true' || undefined,
        disabledCells: disabledCells ? (JSON.parse(disabledCells) as string[]) : undefined,
      };
    }
    return {
      type: 'grid',
      rowSchemeRef: mst(gridDom, 'rowSchemeRef') ?? '',
      colSchemeRef: mst(gridDom, 'colSchemeRef') ?? '',
      variablePrefix: mst(gridDom, 'variablePrefix') ?? '',
    };
  }

  notes.push({ severity: 'warning', elementId: qid, message: 'Unknown response domain; defaulted to text' });
  return { type: 'text' };
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

export function importDdiXml(xml: string): ImportResult {
  const notes: FidelityNote[] = [];
  const root = parseXml(xml);
  const su = root.localName === 'StudyUnit'
    ? root
    : (root.children.find(c => c.localName === 'StudyUnit') ?? root);

  // --- StudyUnit metadata ---
  // Prefer the verbatim originals preserved in mst extensions (the r:URN/r:Version on the
  // StudyUnit are XSD-sanitized canonical forms since the compliance change); fall back to
  // them for pre-compliance or external files.
  const instrumentUrn = mst(su, 'instrumentId') ?? kid(su, 'URN')?.text ?? '';
  const version = mst(su, 'instrumentVersion') ?? kid(su, 'Version')?.text ?? '1.0.0';
  const languages = (mst(su, 'languages') ?? 'en').split(/\s+/).filter(Boolean);
  const defaultLanguage = mst(su, 'defaultLanguage') ?? languages[0] ?? 'en';
  const ddiProfile = (mst(su, 'ddiProfile') ?? 'ddi-lifecycle-3.3') as 'ddi-lifecycle-3.3';
  const prefillMappings: PrefillMapping[] = JSON.parse(mst(su, 'prefillMappings') ?? '[]');
  const interviewerRaw = mst(su, 'interviewer');
  const interviewer: InterviewerConfig | undefined = interviewerRaw
    ? (JSON.parse(interviewerRaw) as InterviewerConfig)
    : undefined;

  // --- Citation ---
  const citation = kid(su, 'Citation');
  const titleNode = kid(citation, 'Title');
  const title: InternationalString = {};
  for (const s of kids(titleNode, 'String')) {
    title[s.attrs['xml:lang'] ?? 'en'] = s.text;
  }
  if (!Object.keys(title).length) title['en'] = 'Untitled';
  // Creator > CreatorName > String per CitationType; bare-text Creator accepted as legacy.
  const creatorNode = kid(citation, 'Creator');
  const agencyName = kid(kid(creatorNode, 'CreatorName'), 'String')?.text ?? creatorNode?.text ?? undefined;
  // Abstract is a StudyUnit sibling per StudyUnitType; Citation-child accepted as legacy.
  const abstractNode = kid(su, 'Abstract') ?? kid(citation, 'Abstract');
  const description: InternationalString = {};
  for (const c of kids(abstractNode, 'Content')) {
    description[c.attrs['xml:lang'] ?? 'en'] = c.text;
  }
  // PublicationDate > SimpleDate per CitationType; bare r:Date accepted as legacy.
  const created = kid(kid(citation, 'PublicationDate'), 'SimpleDate')?.text ?? kid(citation, 'Date')?.text;

  // --- ConceptualComponent ---
  const cc = su.children.find(c => c.localName === 'ConceptualComponent');
  const conceptScheme = kid(cc, 'ConceptScheme');
  const universeScheme = kid(cc, 'UniverseScheme');

  const concepts: Concept[] = kids(conceptScheme, 'Concept').map(c => {
    const descNode = kid(c, 'Description');
    const desc: InternationalString = {};
    for (const s of kids(descNode, 'Content')) desc[s.attrs['xml:lang'] ?? 'en'] = s.text;
    return {
      id: mst(c, 'id') ?? rid(c),
      label: intlFromLabel(c),
      description: Object.keys(desc).length ? desc : undefined,
    };
  });

  const universes: Universe[] = kids(universeScheme, 'Universe').map(u => ({
    id: mst(u, 'id') ?? rid(u),
    label: intlFromLabel(u),
    clause: mst(u, 'clause') ?? undefined,
  }));

  // --- LogicalProduct ---
  const lp = su.children.find(c => c.localName === 'LogicalProduct');
  const clsNode = kid(lp, 'CodeListScheme');

  const categorySchemes: CategoryScheme[] = kids(lp, 'CategoryScheme').map(csNode => {
    const csId = mst(csNode, 'id') ?? rid(csNode);
    // Map category r:ID → code value from the matching CodeList
    const matchingCl = kids(clsNode, 'CodeList').find(cl => (mst(cl, 'id') ?? '') === csId);
    const codeMap = new Map<string, string>();
    for (const codeEl of kids(matchingCl, 'Code')) {
      const catRef = kid(codeEl, 'CategoryReference');
      const catRid = catRef ? rid(catRef) : urnToLocalId(kid(catRef ?? codeEl, 'URN')?.text ?? '');
      codeMap.set(catRid, kid(codeEl, 'Value')?.text ?? '');
    }
    return {
      id: csId,
      label: intlFromLabel(csNode),
      categories: kids(csNode, 'Category').map(catNode => {
        const catRid = rid(catNode);
        return {
          code: mst(catNode, 'code') ?? codeMap.get(catRid) ?? catRid.split('.').pop() ?? catRid,
          label: intlFromLabel(catNode),
        };
      }),
    };
  });

  // --- Variables ---
  const vsNode = kid(lp, 'VariableScheme');
  const variables: Variable[] = kids(vsNode, 'Variable').map(vNode => {
    const varId = mst(vNode, 'id') ?? rid(vNode);
    const name =
      mst(vNode, 'name') ??
      kid(kid(vNode, 'VariableName'), 'String')?.text ??
      varId;
    const kind = (mst(vNode, 'kind') ?? 'collected') as Variable['kind'];
    // Current element name is l:VariableRepresentation ('Representation' = legacy exports).
    const reprNode = kid(vNode, 'VariableRepresentation') ?? kid(vNode, 'Representation');
    // boolean/file have no DDI representation element; they travel as mst:repr on the
    // Variable itself (legacy exports carried it on the Representation node instead).
    let representation: Variable['representation'] =
      (mst(vNode, 'repr') as Variable['representation'] | undefined) ?? 'text';
    let categorySchemeRef: string | undefined;
    if (reprNode) {
      const codeRepr = kid(reprNode, 'CodeRepresentation');
      if (codeRepr) {
        representation = 'code';
        const clRef = kid(codeRepr, 'CodeListReference');
        const clId = clRef ? rid(clRef) : '';
        categorySchemeRef = clId.endsWith('.cl') ? clId.slice(0, -3) : clId || undefined;
      } else if (kid(reprNode, 'NumericRepresentation')) {
        representation = 'numeric';
      } else if (kid(reprNode, 'DateTimeRepresentation')) {
        representation = 'datetime';
      } else {
        const r = mst(reprNode, 'repr');
        if (r) representation = r as Variable['representation'];
      }
    }
    const conceptRefNode = kid(vNode, 'ConceptReference');
    return {
      id: varId,
      name,
      kind,
      label: intlFromLabel(vNode),
      representation,
      categorySchemeRef,
      compute: mst(vNode, 'compute') ?? undefined,
      interviewerOnly: mst(vNode, 'interviewerOnly') === 'true' || undefined,
      isPII: mst(vNode, 'isPII') === 'true' || undefined,
      conceptRef: conceptRefNode ? rid(conceptRefNode) : undefined,
    };
  });

  // --- DataCollection ---
  const dc = su.children.find(c => c.localName === 'DataCollection');
  const qsNode = kid(dc, 'QuestionScheme');
  const ccsNode = kid(dc, 'ControlConstructScheme');
  const isNode = kid(dc, 'InstrumentScheme');

  // QuestionItem registry: key = r:ID (e.g. "qi.q1")
  const qiRegistry = new Map<string, XmlNode>();
  for (const qi of kids(qsNode, 'QuestionItem')) qiRegistry.set(rid(qi), qi);

  // ControlConstruct registry: key = r:ID
  const ccRegistry = new Map<string, { node: XmlNode; tag: string }>();
  for (const c of ccsNode?.children ?? []) {
    if (c.prefix === 'd' || !c.prefix) ccRegistry.set(rid(c), { node: c, tag: c.localName });
  }

  // Find root sequence local ID from InstrumentScheme
  const instNode = kid(isNode, 'Instrument');
  const rootRef = kid(instNode, 'ControlConstructReference');
  const rootUrn = kid(rootRef, 'URN')?.text ?? '';
  const rootLocalId = urnToLocalId(rootUrn);

  // --- Construct tree walker ---

  function walkSeq(localId: string): SequenceConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'Sequence') {
      notes.push({ severity: 'warning', elementId: localId, message: `Sequence not found: ${localId}` });
      return { type: 'sequence', id: localId, children: [] };
    }
    const n = entry.node;
    const label = intlFromLabel(n);
    return {
      type: 'sequence',
      id: mst(n, 'id') ?? localId,
      isPage: mst(n, 'isPage') === 'true' || undefined,
      moduleKind: (mst(n, 'moduleKind') ?? undefined) as SequenceConstruct['moduleKind'],
      interviewerOnly: mst(n, 'interviewerOnly') === 'true' || undefined,
      visibleWhen: mst(n, 'visibleWhen') ?? undefined,
      label: Object.keys(label).length ? label : undefined,
      children: kids(n, 'ControlConstructReference').map(ref =>
        walkConstruct(urnToLocalId(kid(ref, 'URN')?.text ?? '')),
      ),
    };
  }

  function walkQ(localId: string): QuestionConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'QuestionConstruct') {
      notes.push({ severity: 'warning', elementId: localId, message: `QuestionConstruct not found: ${localId}` });
      return { type: 'question', id: localId, variableRef: '', text: { en: '' }, responseDomain: { type: 'text' } };
    }
    const qcNode = entry.node;
    const qId = mst(qcNode, 'id') ?? localId;
    const qcVisibleWhen = mst(qcNode, 'visibleWhen');
    const qcInterviewerOnly = mst(qcNode, 'interviewerOnly') === 'true';

    const qiUrn = kid(kid(qcNode, 'QuestionReference'), 'URN')?.text ?? '';
    const qi = qiRegistry.get(urnToLocalId(qiUrn));
    if (!qi) {
      notes.push({ severity: 'warning', elementId: qId, message: `QuestionItem not found: ${urnToLocalId(qiUrn)}` });
      return { type: 'question', id: qId, variableRef: '', text: { en: '' }, responseDomain: { type: 'text' } };
    }

    const editsRaw = mst(qi, 'edits');
    const tooltip = mst(qi, 'tooltip');
    // Instruction travels as an mst extension (3.3 has no InstructionText child on
    // QuestionItem); the element read is a legacy fallback for pre-compliance exports.
    const instructionRaw = mst(qi, 'instruction');
    const instruction = instructionRaw
      ? (JSON.parse(instructionRaw) as InternationalString)
      : intlFromDdiText(kid(qi, 'InstructionText'));
    // The mst:rd extension is the authoritative response-domain definition (the native DDI
    // domain element is a projection); parseRd remains the path for external files.
    const rdRaw = mst(qi, 'rd');

    return {
      type: 'question',
      id: qId,
      variableRef: mst(qi, 'variableRef') ?? '',
      text: intlFromDdiText(kid(qi, 'QuestionText')),
      instruction: Object.keys(instruction).length ? instruction : undefined,
      tooltip: tooltip ? (JSON.parse(tooltip) as InternationalString) : undefined,
      required: (() => { const r = mst(qi, 'required'); return r !== undefined ? r === 'true' : undefined; })(),
      edits: editsRaw !== undefined ? (JSON.parse(editsRaw) as EditRule[]) : undefined,
      visibleWhen: mst(qi, 'visibleWhen') ?? qcVisibleWhen ?? undefined,
      interviewerOnly: (mst(qi, 'interviewerOnly') === 'true' || qcInterviewerOnly) || undefined,
      responseDomain: rdRaw ? (JSON.parse(rdRaw) as ResponseDomain) : parseRd(qi, qId, notes),
    };
  }

  function walkIte(localId: string): IfThenElseConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'IfThenElse') {
      notes.push({ severity: 'warning', elementId: localId, message: `IfThenElse not found: ${localId}` });
      return { type: 'ifThenElse', id: localId, condition: '', then: [] };
    }
    const n = entry.node;
    const condition =
      kid(kid(kid(n, 'IfCondition'), 'Command'), 'CommandContent')?.text ?? '';
    const thenLocalId = urnToLocalId(kid(kid(n, 'ThenConstructReference'), 'URN')?.text ?? '');
    const elseLocalId = urnToLocalId(kid(kid(n, 'ElseConstructReference'), 'URN')?.text ?? '');
    return {
      type: 'ifThenElse',
      id: mst(n, 'id') ?? localId,
      condition,
      then: walkSeq(thenLocalId).children,
      else: elseLocalId ? walkSeq(elseLocalId).children : undefined,
    };
  }

  function walkLoop(localId: string): LoopConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'Loop') {
      notes.push({ severity: 'warning', elementId: localId, message: `Loop not found: ${localId}` });
      return { type: 'loop', id: localId, loopVariable: 'i', children: [] };
    }
    const n = entry.node;
    const bodyLocalId = urnToLocalId(
      kid(kid(n, 'ControlConstructReference'), 'URN')?.text ?? '',
    );
    const label = intlFromLabel(n);
    const itemLabelRaw = mst(n, 'itemLabel');
    return {
      type: 'loop',
      id: mst(n, 'id') ?? localId,
      loopVariable: mst(n, 'loopVariable') ?? 'i',
      countVariableRef: mst(n, 'countVariableRef') ?? undefined,
      loopWhile: mst(n, 'loopWhile') ?? undefined,
      visibleWhen: mst(n, 'visibleWhen') ?? undefined,
      itemLabel: itemLabelRaw ? (JSON.parse(itemLabelRaw) as InternationalString) : undefined,
      label: Object.keys(label).length ? label : undefined,
      children: walkSeq(bodyLocalId).children,
    };
  }

  function walkComp(localId: string): ComputationConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'ComputationItem') {
      notes.push({ severity: 'warning', elementId: localId, message: `ComputationItem not found: ${localId}` });
      return { type: 'computation', id: localId, targetVariableRef: '', expression: '' };
    }
    const n = entry.node;
    return {
      type: 'computation',
      id: mst(n, 'id') ?? localId,
      targetVariableRef: mst(n, 'targetVariableRef') ?? '',
      expression: mst(n, 'expression') ?? '',
    };
  }

  function walkStmt(localId: string): StatementConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry || entry.tag !== 'StatementItem') {
      notes.push({ severity: 'warning', elementId: localId, message: `StatementItem not found: ${localId}` });
      return { type: 'statement', id: localId, text: { en: '' } };
    }
    const n = entry.node;
    return {
      type: 'statement',
      id: mst(n, 'id') ?? localId,
      text: intlFromDdiText(kid(n, 'DisplayText')),
      visibleWhen: mst(n, 'visibleWhen') ?? undefined,
      interviewerOnly: mst(n, 'interviewerOnly') === 'true' || undefined,
    };
  }

  function walkConstruct(localId: string): ControlConstruct {
    const entry = ccRegistry.get(localId);
    if (!entry) {
      notes.push({ severity: 'warning', elementId: localId, message: `Construct not found: ${localId}` });
      return { type: 'statement', id: localId, text: { en: `[unresolved: ${localId}]` } };
    }
    switch (entry.tag) {
      case 'Sequence': return walkSeq(localId);
      case 'QuestionConstruct': return walkQ(localId);
      case 'IfThenElse': return walkIte(localId);
      case 'Loop': return walkLoop(localId);
      case 'ComputationItem': return walkComp(localId);
      case 'StatementItem': return walkStmt(localId);
      default:
        notes.push({ severity: 'info', elementId: localId, message: `Unknown construct tag: ${entry.tag}` });
        return { type: 'statement', id: localId, text: { en: `[${entry.tag}]` } };
    }
  }

  const sequence = rootLocalId
    ? walkSeq(rootLocalId)
    : { type: 'sequence' as const, id: 'seq.root', children: [] };

  const instrument: Instrument = {
    id: instrumentUrn,
    version,
    ddiProfile,
    languages,
    defaultLanguage,
    metadata: {
      title,
      agency: agencyName,
      description: Object.keys(description).length ? description : undefined,
      created,
    },
    concepts,
    universes,
    categorySchemes,
    variables,
    prefillMappings,
    sequence,
    interviewer,
  };

  return {
    instrument,
    report: {
      lossless: notes.filter(n => n.severity !== 'info').length === 0,
      notes,
    },
  };
}
