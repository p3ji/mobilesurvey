/**
 * Export an Instrument to DDI-Lifecycle 3.3 XML.
 *
 * Extension mechanism: fields without a standard DDI-L mapping are stored as
 * <r:UserID type="mst:KEY">value</r:UserID> elements, where "mst" is a
 * Modular Survey Tools namespace prefix. These round-trip losslessly.
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
} from '@mobilesurvey/instrument-schema';
import { el, txt } from './xml.js';
import { mapId, mintUrn, sanitizeAgency, sanitizeVersion } from './urn.js';

const NS_DECL: Record<string, string> = {
  'xmlns:i': 'ddi:instance:3_3',
  'xmlns:r': 'ddi:reusable:3_3',
  'xmlns:s': 'ddi:studyunit:3_3',
  'xmlns:c': 'ddi:conceptualcomponent:3_3',
  'xmlns:l': 'ddi:logicalproduct:3_3',
  'xmlns:d': 'ddi:datacollection:3_3',
  'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  'xsi:schemaLocation':
    'ddi:instance:3_3 https://ddialliance.org/Specification/DDI-Lifecycle/3.3/XMLSchema/instance.xsd',
};

interface Ctx {
  version: string;
  agency: string;
  langs: string[];
  qi: string[];  // accumulated d:QuestionItem elements
  cc: string[];  // accumulated control construct elements
}

/** Canonical DDI URN for a local id (docs/ddi-compliance-plan.md §3.2). */
function fullUrn(ctx: Ctx, localId: string): string {
  return mintUrn(ctx.agency, mapId(localId), ctx.version);
}

/**
 * Emit DDI identity block: URN + Agency/ID/Version identification sequence (both allowed by
 * AbstractIdentifiableType's choice maxOccurs=2; URN takes precedence on conflict). r:ID
 * carries the XSD-legal mapped id — the verbatim internal id travels in an `mst:id` extension
 * emitted separately by callers, which the importer prefers.
 */
function identity(ctx: Ctx, localId: string): string {
  return (
    txt('r:URN', {}, fullUrn(ctx, localId)) +
    txt('r:Agency', {}, ctx.agency) +
    txt('r:ID', {}, mapId(localId)) +
    txt('r:Version', {}, ctx.version)
  );
}

/** The URN + identification-sequence body shared by every DDI reference element. */
function refIdentity(ctx: Ctx, localId: string): string {
  return identity(ctx, localId);
}

/** Emit <r:UserID typeOfUserID="mst:KEY">value</r:UserID> only when value is non-empty.
 * `typeOfUserID` is UserIDType's required attribute name (reusable.xsd). Text content is escaped. */
function mst(key: string, value: string): string {
  return value ? txt('r:UserID', { typeOfUserID: `mst:${key}` }, value) : '';
}

function intlLabel(ctx: Ctx, v: InternationalString): string {
  return el(
    'r:Label',
    {},
    ...ctx.langs.map(l => txt('r:Content', { 'xml:lang': l }, v[l] ?? v['en'] ?? '')),
  );
}

/** DynamicTextType: TextContent (⊃ LiteralText) repeats; each LiteralTextType holds exactly ONE Text. */
function ddiLiteralText(tag: string, ctx: Ctx, v: InternationalString): string {
  return el(
    tag,
    {},
    ...ctx.langs.map(l =>
      el('d:LiteralText', {}, txt('d:Text', { 'xml:lang': l }, v[l] ?? v['en'] ?? '')),
    ),
  );
}

function ccRef(ctx: Ctx, localId: string, typeOfObject: string): string {
  return el(
    'd:ControlConstructReference',
    {},
    refIdentity(ctx, localId),
    txt('r:TypeOfObject', {}, typeOfObject),
  );
}

/**
 * Native DDI response-domain element for a question. Domains are RepresentationType-based and
 * accept NO UserID children, so every MST-specific field travels instead as one
 * `mst:rd` JSON extension at the QuestionItem level (emitted by renderQ; the importer prefers
 * it and this native element is a standards-facing projection).
 *
 * Mapping notes:
 * - code/lookup/markAll → CodeDomain with the required CodeListReference.
 * - datetime → DateTimeDomain with the required r:DateTypeCode.
 * - boolean/file → TextDomain (no closer 3.3 domain without a code list).
 * - grid/table → TextDomain: GridDomain is NOT in QuestionItemType's response-domain choice
 *   (3.3 models grids as a separate d:QuestionGrid item). A faithful QuestionGrid mapping for
 *   the establishment `table` domain is future work (docs/ddi-compliance-plan.md §8 territory);
 *   until then the full table definition round-trips via the mst:rd extension.
 */
function rdEl(ctx: Ctx, rd: ResponseDomain): string {
  switch (rd.type) {
    case 'code':
    case 'lookup':
    case 'markAll': {
      const clId = `${rd.categorySchemeRef}.cl`;
      return el(
        'd:CodeDomain',
        {},
        el('r:CodeListReference', {}, refIdentity(ctx, clId), txt('r:TypeOfObject', {}, 'CodeList')),
      );
    }
    case 'numeric':
      return el('d:NumericDomain', {});
    case 'datetime': {
      const code = rd.mode === 'date' ? 'Date' : rd.mode === 'time' ? 'Time' : 'DateTime';
      return el('d:DateTimeDomain', {}, txt('r:DateTypeCode', {}, code));
    }
    case 'text':
    case 'boolean':
    case 'file':
    case 'grid':
    case 'table':
      return el('d:TextDomain', {});
  }
}

function renderQ(ctx: Ctx, q: QuestionConstruct): void {
  const qiId = `qi.${q.id}`;
  ctx.qi.push(
    el(
      'd:QuestionItem',
      {},
      identity(ctx, qiId),
      mst('id', q.id),
      mst('variableRef', q.variableRef),
      q.required !== undefined ? mst('required', String(q.required)) : '',
      q.interviewerOnly ? mst('interviewerOnly', 'true') : '',
      q.visibleWhen ? mst('visibleWhen', q.visibleWhen) : '',
      q.tooltip ? mst('tooltip', JSON.stringify(q.tooltip)) : '',
      q.edits !== undefined ? mst('edits', JSON.stringify(q.edits)) : '',
      // 3.3 has no InstructionText child on QuestionItem (instructions are a separate
      // InterviewerInstruction scheme) — carried as an extension instead.
      q.instruction ? mst('instruction', JSON.stringify(q.instruction)) : '',
      // Authoritative response-domain definition; the native element below is a projection.
      mst('rd', JSON.stringify(q.responseDomain)),
      ddiLiteralText('d:QuestionText', ctx, q.text),
      rdEl(ctx, q.responseDomain),
    ),
  );
  ctx.cc.push(
    el(
      'd:QuestionConstruct',
      {},
      identity(ctx, q.id),
      mst('id', q.id),
      q.visibleWhen ? mst('visibleWhen', q.visibleWhen) : '',
      q.interviewerOnly ? mst('interviewerOnly', 'true') : '',
      el(
        'r:QuestionReference', // QuestionConstructType refs live in the r: namespace
        {},
        refIdentity(ctx, qiId),
        txt('r:TypeOfObject', {}, 'QuestionItem'),
      ),
    ),
  );
}

function typeOfConstruct(c: ControlConstruct): string {
  switch (c.type) {
    case 'sequence': return 'Sequence';
    case 'question': return 'QuestionConstruct';
    case 'ifThenElse': return 'IfThenElse';
    case 'loop': return 'Loop';
    case 'computation': return 'ComputationItem';
    case 'statement': return 'StatementItem';
  }
}

function renderSeq(ctx: Ctx, s: SequenceConstruct): void {
  for (const child of s.children) renderConstruct(ctx, child);
  ctx.cc.push(
    el(
      'd:Sequence',
      {},
      identity(ctx, s.id),
      mst('id', s.id),
      s.isPage ? mst('isPage', 'true') : '',
      s.moduleKind ? mst('moduleKind', s.moduleKind) : '',
      s.interviewerOnly ? mst('interviewerOnly', 'true') : '',
      s.visibleWhen ? mst('visibleWhen', s.visibleWhen) : '',
      s.label ? intlLabel(ctx, s.label) : '',
      ...s.children.map(c => ccRef(ctx, c.id, typeOfConstruct(c))),
    ),
  );
}

function renderIte(ctx: Ctx, ite: IfThenElseConstruct): void {
  const thenId = `${ite.id}_then`;
  const elseId = ite.else?.length ? `${ite.id}_else` : null;
  renderSeq(ctx, { type: 'sequence', id: thenId, children: ite.then });
  if (elseId) renderSeq(ctx, { type: 'sequence', id: elseId, children: ite.else! });
  ctx.cc.push(
    el(
      'd:IfThenElse',
      {},
      identity(ctx, ite.id),
      mst('id', ite.id),
      el(
        'd:IfCondition',
        {},
        el(
          'r:Command',
          {},
          txt('r:ProgramLanguage', {}, 'MST-Expression'),
          txt('r:CommandContent', {}, ite.condition),
        ),
      ),
      el(
        'd:ThenConstructReference',
        {},
        refIdentity(ctx, thenId),
        txt('r:TypeOfObject', {}, 'Sequence'),
      ),
      elseId
        ? el(
            'd:ElseConstructReference',
            {},
            refIdentity(ctx, elseId),
            txt('r:TypeOfObject', {}, 'Sequence'),
          )
        : '',
    ),
  );
}

function renderLoop(ctx: Ctx, loop: LoopConstruct): void {
  const bodyId = `${loop.id}_body`;
  renderSeq(ctx, { type: 'sequence', id: bodyId, children: loop.children });
  ctx.cc.push(
    el(
      'd:Loop',
      {},
      identity(ctx, loop.id),
      mst('id', loop.id),
      mst('loopVariable', loop.loopVariable),
      loop.countVariableRef ? mst('countVariableRef', loop.countVariableRef) : '',
      loop.loopWhile ? mst('loopWhile', loop.loopWhile) : '',
      loop.visibleWhen ? mst('visibleWhen', loop.visibleWhen) : '',
      loop.itemLabel ? mst('itemLabel', JSON.stringify(loop.itemLabel)) : '',
      loop.label ? intlLabel(ctx, loop.label) : '',
      el(
        'd:ControlConstructReference',
        {},
        refIdentity(ctx, bodyId),
        txt('r:TypeOfObject', {}, 'Sequence'),
      ),
    ),
  );
}

function renderComp(ctx: Ctx, comp: ComputationConstruct): void {
  ctx.cc.push(
    el(
      'd:ComputationItem',
      {},
      identity(ctx, comp.id),
      mst('id', comp.id),
      mst('targetVariableRef', comp.targetVariableRef),
      mst('expression', comp.expression),
    ),
  );
}

function renderStmt(ctx: Ctx, stmt: StatementConstruct): void {
  ctx.cc.push(
    el(
      'd:StatementItem',
      {},
      identity(ctx, stmt.id),
      mst('id', stmt.id),
      stmt.visibleWhen ? mst('visibleWhen', stmt.visibleWhen) : '',
      stmt.interviewerOnly ? mst('interviewerOnly', 'true') : '',
      ddiLiteralText('d:DisplayText', ctx, stmt.text),
    ),
  );
}

function renderConstruct(ctx: Ctx, c: ControlConstruct): void {
  switch (c.type) {
    case 'question': return renderQ(ctx, c);
    case 'sequence': return renderSeq(ctx, c);
    case 'ifThenElse': return renderIte(ctx, c);
    case 'loop': return renderLoop(ctx, c);
    case 'computation': return renderComp(ctx, c);
    case 'statement': return renderStmt(ctx, c);
  }
}

function renderVar(ctx: Ctx, v: Variable): string {
  // VariableRepresentationType's value slot accepts the r:ValueRepresentation substitution
  // group (Numeric/Text/DateTime/Code — all in the r: namespace). boolean/file have no DDI
  // representation element; they travel as an mst:repr extension on the Variable itself
  // (VariableRepresentationType has no UserID slot).
  let repr = '';
  if (v.representation === 'code' && v.categorySchemeRef) {
    const clId = `${v.categorySchemeRef}.cl`;
    repr = el(
      'l:VariableRepresentation',
      {},
      el(
        'r:CodeRepresentation',
        {},
        el('r:CodeListReference', {}, refIdentity(ctx, clId), txt('r:TypeOfObject', {}, 'CodeList')),
      ),
    );
  } else if (v.representation === 'numeric') {
    repr = el('l:VariableRepresentation', {}, el('r:NumericRepresentation', {}));
  } else if (v.representation === 'text') {
    repr = el('l:VariableRepresentation', {}, el('r:TextRepresentation', {}));
  } else if (v.representation === 'datetime') {
    // DateTimeRepresentation requires a DateTypeCode child; Variable doesn't carry a mode
    // (that lives on the question's response domain), so the generic DateTime code is used.
    repr = el(
      'l:VariableRepresentation',
      {},
      el('r:DateTimeRepresentation', {}, txt('r:DateTypeCode', {}, 'DateTime')),
    );
  }
  // VariableType child order: VariableName, r:Label, …, r:ConceptReference, …, VariableRepresentation.
  return el(
    'l:Variable',
    {},
    identity(ctx, v.id),
    mst('id', v.id),
    mst('name', v.name),
    mst('kind', v.kind),
    repr === '' ? mst('repr', v.representation) : '',
    v.compute ? mst('compute', v.compute) : '',
    v.interviewerOnly ? mst('interviewerOnly', 'true') : '',
    v.isPII ? mst('isPII', 'true') : '',
    el('l:VariableName', {}, txt('r:String', { 'xml:lang': ctx.langs[0]! }, v.name)),
    intlLabel(ctx, v.label),
    v.conceptRef
      ? el(
          'r:ConceptReference',
          {},
          refIdentity(ctx, v.conceptRef),
          txt('r:TypeOfObject', {}, 'Concept'),
        )
      : '',
    repr,
  );
}

/** Serialize an Instrument to a DDI-Lifecycle 3.3 XML string. */
export function exportDdiXml(instrument: Instrument): string {
  const uparts = instrument.id.split(':');
  // Agency/version must satisfy the XSD's DDIAgencyIDType/VersionType patterns; anything
  // unparseable falls back to the project placeholder (docs/ddi-compliance-plan.md §3.1).
  // P2 of the plan replaces this derivation with an explicit agencyId config.
  const agency = sanitizeAgency(uparts[2]);
  const shortId = uparts[3] ?? instrument.id; // raw; identity()/fullUrn() map at emission

  const ctx: Ctx = {
    version: sanitizeVersion(instrument.version),
    agency,
    langs: instrument.languages,
    qi: [],
    cc: [],
  };

  renderSeq(ctx, instrument.sequence);

  const catSchemes = instrument.categorySchemes.map(cs => ({
    catScheme: el(
      'l:CategoryScheme',
      {},
      identity(ctx, cs.id),
      mst('id', cs.id),
      intlLabel(ctx, cs.label),
      ...cs.categories.map(cat =>
        el(
          'l:Category',
          {},
          identity(ctx, `${cs.id}.${cat.code}`),
          mst('code', cat.code),
          intlLabel(ctx, cat.label),
        ),
      ),
    ),
    codeList: el(
      'l:CodeList',
      {},
      identity(ctx, `${cs.id}.cl`),
      mst('id', cs.id),
      intlLabel(ctx, cs.label),
      ...cs.categories.map(cat =>
        // CodeType: identity head, then r:CategoryReference, then REQUIRED r:Value.
        el(
          'l:Code',
          {},
          identity(ctx, `${cs.id}.cd.${cat.code}`),
          el(
            'r:CategoryReference',
            {},
            refIdentity(ctx, `${cs.id}.${cat.code}`),
            txt('r:TypeOfObject', {}, 'Category'),
          ),
          txt('r:Value', {}, cat.code),
        ),
      ),
    ),
  }));

  const concepts = instrument.concepts.map(c =>
    el(
      'c:Concept',
      {},
      identity(ctx, c.id),
      mst('id', c.id),
      intlLabel(ctx, c.label),
      c.description
        ? el(
            'r:Description',
            {},
            ...ctx.langs.map(l =>
              txt('r:Content', { 'xml:lang': l }, c.description![l] ?? c.description!['en'] ?? ''),
            ),
          )
        : '',
    ),
  );

  const universes = instrument.universes.map(u =>
    el(
      'c:Universe',
      {},
      identity(ctx, u.id),
      mst('id', u.id),
      u.clause ? mst('clause', u.clause) : '',
      intlLabel(ctx, u.label),
    ),
  );

  const variables = instrument.variables.map(v => renderVar(ctx, v));

  const nsStr = Object.entries(NS_DECL)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n  ');

  const studyUnit = el(
    's:StudyUnit',
    {},
    identity(ctx, shortId),
    // Verbatim originals: the canonical URN/Version above are XSD-sanitized forms, so the
    // exact instrument id and version round-trip through extensions the importer prefers.
    mst('instrumentId', instrument.id),
    mst('instrumentVersion', instrument.version),
    mst('languages', instrument.languages.join(' ')),
    mst('defaultLanguage', instrument.defaultLanguage),
    mst('ddiProfile', instrument.ddiProfile),
    instrument.prefillMappings.length ? mst('prefillMappings', JSON.stringify(instrument.prefillMappings)) : '',
    instrument.interviewer ? mst('interviewer', JSON.stringify(instrument.interviewer)) : '',
    // Citation (r: namespace per StudyUnitType; CitationType children in schema order:
    // Title, Creator > CreatorName (a BibliographicNameType, i.e. r:String children),
    // PublicationDate > SimpleDate).
    el(
      'r:Citation',
      {},
      el(
        'r:Title',
        {},
        ...instrument.languages.map(l =>
          txt('r:String', { 'xml:lang': l }, instrument.metadata.title[l] ?? ''),
        ),
      ),
      instrument.metadata.agency
        ? el(
            'r:Creator',
            {},
            el('r:CreatorName', {}, txt('r:String', { 'xml:lang': instrument.defaultLanguage }, instrument.metadata.agency)),
          )
        : '',
      instrument.metadata.created
        ? el('r:PublicationDate', {}, txt('r:SimpleDate', {}, instrument.metadata.created))
        : '',
    ),
    // Abstract is a StudyUnit sibling of Citation (not a Citation child) per StudyUnitType.
    instrument.metadata.description
      ? el(
          'r:Abstract',
          {},
          ...instrument.languages.map(l =>
            txt(
              'r:Content',
              { 'xml:lang': l },
              instrument.metadata.description![l] ?? instrument.metadata.description!['en'] ?? '',
            ),
          ),
        )
      : '',
    // ConceptualComponent
    el(
      'c:ConceptualComponent',
      {},
      identity(ctx, `${shortId}_cc`),
      concepts.length
        ? el('c:ConceptScheme', {}, identity(ctx, `${shortId}_csc`), ...concepts)
        : '',
      universes.length
        ? el('c:UniverseScheme', {}, identity(ctx, `${shortId}_us`), ...universes)
        : '',
    ),
    // StudyUnitType module order: ConceptualComponent, then DataCollection, then the
    // l:BaseLogicalProduct substitution group (l:LogicalProduct).
    // DataCollection
    el(
      'd:DataCollection',
      {},
      identity(ctx, `${shortId}_dc`),
      el('d:QuestionScheme', {}, identity(ctx, `${shortId}_qs`), ...ctx.qi),
      el('d:ControlConstructScheme', {}, identity(ctx, `${shortId}_ccs`), ...ctx.cc),
      el(
        'd:InstrumentScheme',
        {},
        identity(ctx, `${shortId}_is`),
        el(
          'd:Instrument',
          {},
          identity(ctx, `${shortId}_inst`),
          intlLabel(ctx, instrument.metadata.title),
          el(
            'd:ControlConstructReference',
            {},
            refIdentity(ctx, instrument.sequence.id),
            txt('r:TypeOfObject', {}, 'Sequence'),
          ),
        ),
      ),
    ),
    // LogicalProduct
    el(
      'l:LogicalProduct',
      {},
      identity(ctx, `${shortId}_lp`),
      ...catSchemes.map(cs => cs.catScheme),
      catSchemes.length
        ? el('l:CodeListScheme', {}, identity(ctx, `${shortId}_cls`), ...catSchemes.map(cs => cs.codeList))
        : '',
      variables.length
        ? el('l:VariableScheme', {}, identity(ctx, `${shortId}_vs`), ...variables)
        : '',
    ),
  );

  // DDIInstanceType extends r:MaintainableType, so the root wrapper carries its own identity.
  const rootIdentity = identity(ctx, `${shortId}_ddii`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<i:DDIInstance\n  ${nsStr}>\n${rootIdentity}${studyUnit}\n</i:DDIInstance>`;
}
