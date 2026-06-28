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

const NS_DECL: Record<string, string> = {
  'xmlns:i': 'ddi:instance:3_3',
  'xmlns:r': 'ddi:reusable:3_3',
  'xmlns:s': 'ddi:studyunit:3_3',
  'xmlns:c': 'ddi:conceptualcomponent:3_3',
  'xmlns:l': 'ddi:logicalproduct:3_3',
  'xmlns:d': 'ddi:datacollection:3_3',
};

interface Ctx {
  urn: string;
  version: string;
  agency: string;
  langs: string[];
  qi: string[];  // accumulated d:QuestionItem elements
  cc: string[];  // accumulated control construct elements
}

function fullUrn(ctx: Ctx, localId: string): string {
  return `${ctx.urn}!${localId}`;
}

/** Emit DDI identity block: URN, Agency, ID, Version. */
function identity(ctx: Ctx, localId: string): string {
  return (
    txt('r:URN', {}, fullUrn(ctx, localId)) +
    txt('r:Agency', {}, ctx.agency) +
    txt('r:ID', {}, localId) +
    txt('r:Version', {}, ctx.version)
  );
}

/** Emit <r:UserID type="mst:KEY">value</r:UserID> only when value is non-empty. Text content is escaped. */
function mst(key: string, value: string): string {
  return value ? txt('r:UserID', { type: `mst:${key}` }, value) : '';
}

function intlLabel(ctx: Ctx, v: InternationalString): string {
  return el(
    'r:Label',
    {},
    ...ctx.langs.map(l => txt('r:Content', { 'xml:lang': l }, v[l] ?? v['en'] ?? '')),
  );
}

function ddiLiteralText(tag: string, ctx: Ctx, v: InternationalString): string {
  return el(
    tag,
    {},
    el(
      'd:LiteralText',
      {},
      ...ctx.langs.map(l => txt('d:Text', { 'xml:lang': l }, v[l] ?? v['en'] ?? '')),
    ),
  );
}

function ccRef(ctx: Ctx, localId: string, typeOfObject: string): string {
  return el(
    'd:ControlConstructReference',
    {},
    txt('r:URN', {}, fullUrn(ctx, localId)),
    txt('r:Agency', {}, ctx.agency),
    txt('r:ID', {}, localId),
    txt('r:Version', {}, ctx.version),
    txt('r:TypeOfObject', {}, typeOfObject),
  );
}

function rdEl(ctx: Ctx, rd: ResponseDomain): string {
  switch (rd.type) {
    case 'code': {
      const clId = `${rd.categorySchemeRef}.cl`;
      return el(
        'd:CodeDomain',
        {},
        el(
          'r:CodeListReference',
          {},
          txt('r:URN', {}, fullUrn(ctx, clId)),
          txt('r:Agency', {}, ctx.agency),
          txt('r:ID', {}, clId),
          txt('r:Version', {}, ctx.version),
        ),
        rd.selection === 'multiple' ? mst('selection', 'multiple') : '',
      );
    }
    case 'numeric':
      return el(
        'd:NumericDomain',
        {},
        rd.min != null ? mst('min', String(rd.min)) : '',
        rd.max != null ? mst('max', String(rd.max)) : '',
        rd.decimals != null ? mst('decimals', String(rd.decimals)) : '',
        rd.unit ? mst('unit', JSON.stringify(rd.unit)) : '',
      );
    case 'text':
      return el(
        'd:TextDomain',
        {},
        rd.multiline ? mst('multiline', 'true') : '',
        rd.maxLength != null ? mst('maxLength', String(rd.maxLength)) : '',
        rd.pattern ? mst('pattern', rd.pattern) : '',
      );
    case 'datetime':
      return el('d:DateTimeDomain', {}, mst('mode', rd.mode));
    case 'boolean':
      return el('d:CodeDomain', {}, mst('rdType', 'boolean'));
    case 'file':
      return el(
        'd:TextDomain',
        {},
        mst('rdType', 'file'),
        rd.accept ? mst('accept', rd.accept.join(',')) : '',
        rd.maxSizeMb != null ? mst('maxSizeMb', String(rd.maxSizeMb)) : '',
      );
    case 'lookup': {
      const clId = `${rd.categorySchemeRef}.cl`;
      return el(
        'd:CodeDomain',
        {},
        el(
          'r:CodeListReference',
          {},
          txt('r:URN', {}, fullUrn(ctx, clId)),
          txt('r:Agency', {}, ctx.agency),
          txt('r:ID', {}, clId),
          txt('r:Version', {}, ctx.version),
        ),
        mst('rdType', 'lookup'),
        rd.hierarchical ? mst('hierarchical', 'true') : '',
      );
    }
    case 'markAll': {
      const clId = `${rd.categorySchemeRef}.cl`;
      return el(
        'd:CodeDomain',
        {},
        el(
          'r:CodeListReference',
          {},
          txt('r:URN', {}, fullUrn(ctx, clId)),
          txt('r:Agency', {}, ctx.agency),
          txt('r:ID', {}, clId),
          txt('r:Version', {}, ctx.version),
        ),
        mst('rdType', 'markAll'),
        mst('variablePrefix', rd.variablePrefix),
      );
    }
    case 'grid':
      return el(
        'd:GridDomain',
        {},
        mst('rdType', 'grid'),
        mst('rowSchemeRef', rd.rowSchemeRef),
        mst('colSchemeRef', rd.colSchemeRef),
        mst('variablePrefix', rd.variablePrefix),
      );
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
      ddiLiteralText('d:QuestionText', ctx, q.text),
      q.instruction ? ddiLiteralText('d:InstructionText', ctx, q.instruction) : '',
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
        'd:QuestionReference',
        {},
        txt('r:URN', {}, fullUrn(ctx, qiId)),
        txt('r:Agency', {}, ctx.agency),
        txt('r:ID', {}, qiId),
        txt('r:Version', {}, ctx.version),
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
  const thenId = `${ite.id}!then`;
  const elseId = ite.else?.length ? `${ite.id}!else` : null;
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
        txt('r:URN', {}, fullUrn(ctx, thenId)),
        txt('r:Agency', {}, ctx.agency),
        txt('r:ID', {}, thenId),
        txt('r:Version', {}, ctx.version),
        txt('r:TypeOfObject', {}, 'Sequence'),
      ),
      elseId
        ? el(
            'd:ElseConstructReference',
            {},
            txt('r:URN', {}, fullUrn(ctx, elseId)),
            txt('r:Agency', {}, ctx.agency),
            txt('r:ID', {}, elseId),
            txt('r:Version', {}, ctx.version),
            txt('r:TypeOfObject', {}, 'Sequence'),
          )
        : '',
    ),
  );
}

function renderLoop(ctx: Ctx, loop: LoopConstruct): void {
  const bodyId = `${loop.id}!body`;
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
        txt('r:URN', {}, fullUrn(ctx, bodyId)),
        txt('r:Agency', {}, ctx.agency),
        txt('r:ID', {}, bodyId),
        txt('r:Version', {}, ctx.version),
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
  let repr = '';
  if (v.representation === 'code' && v.categorySchemeRef) {
    const clId = `${v.categorySchemeRef}.cl`;
    repr = el(
      'l:Representation',
      {},
      el(
        'l:CodeRepresentation',
        {},
        el(
          'r:CodeListReference',
          {},
          txt('r:URN', {}, fullUrn(ctx, clId)),
          txt('r:Agency', {}, ctx.agency),
          txt('r:ID', {}, clId),
          txt('r:Version', {}, ctx.version),
        ),
      ),
    );
  } else if (v.representation === 'numeric') {
    repr = el('l:Representation', {}, el('l:NumericRepresentation', {}));
  } else if (v.representation === 'text') {
    repr = el('l:Representation', {}, el('l:TextRepresentation', {}));
  } else if (v.representation === 'datetime') {
    repr = el('l:Representation', {}, el('l:DateTimeRepresentation', {}));
  } else {
    repr = el('l:Representation', {}, mst('repr', v.representation));
  }
  return el(
    'l:Variable',
    {},
    identity(ctx, v.id),
    mst('id', v.id),
    mst('name', v.name),
    mst('kind', v.kind),
    v.compute ? mst('compute', v.compute) : '',
    v.interviewerOnly ? mst('interviewerOnly', 'true') : '',
    v.conceptRef
      ? el(
          'l:ConceptReference',
          {},
          txt('r:URN', {}, fullUrn(ctx, v.conceptRef)),
          txt('r:Agency', {}, ctx.agency),
          txt('r:ID', {}, v.conceptRef),
          txt('r:Version', {}, ctx.version),
        )
      : '',
    el('l:VariableName', {}, txt('r:String', { 'xml:lang': ctx.langs[0]! }, v.name)),
    intlLabel(ctx, v.label),
    repr,
  );
}

/** Serialize an Instrument to a DDI-Lifecycle 3.3 XML string. */
export function exportDdiXml(instrument: Instrument): string {
  const uparts = instrument.id.split(':');
  const agency = uparts[2] ?? 'unknown';
  const shortId = uparts[3] ?? instrument.id;

  const ctx: Ctx = {
    urn: instrument.id,
    version: instrument.version,
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
        el(
          'l:Code',
          {},
          el(
            'l:CategoryReference',
            {},
            txt('r:URN', {}, fullUrn(ctx, `${cs.id}.${cat.code}`)),
            txt('r:Agency', {}, agency),
            txt('r:ID', {}, `${cs.id}.${cat.code}`),
            txt('r:Version', {}, ctx.version),
          ),
          txt('l:Value', {}, cat.code),
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
    txt('r:URN', {}, instrument.id),
    txt('r:Agency', {}, agency),
    txt('r:ID', {}, shortId),
    txt('r:Version', {}, instrument.version),
    mst('languages', instrument.languages.join(' ')),
    mst('defaultLanguage', instrument.defaultLanguage),
    mst('ddiProfile', instrument.ddiProfile),
    instrument.prefillMappings.length ? mst('prefillMappings', JSON.stringify(instrument.prefillMappings)) : '',
    instrument.interviewer ? mst('interviewer', JSON.stringify(instrument.interviewer)) : '',
    // Citation
    el(
      's:Citation',
      {},
      el(
        'r:Title',
        {},
        ...instrument.languages.map(l =>
          txt('r:String', { 'xml:lang': l }, instrument.metadata.title[l] ?? ''),
        ),
      ),
      instrument.metadata.agency ? txt('r:Creator', {}, instrument.metadata.agency) : '',
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
      instrument.metadata.created ? txt('r:Date', {}, instrument.metadata.created) : '',
    ),
    // ConceptualComponent
    el(
      'c:ConceptualComponent',
      {},
      identity(ctx, `${shortId}!cc`),
      concepts.length
        ? el('c:ConceptScheme', {}, identity(ctx, `${shortId}!cs.concepts`), ...concepts)
        : '',
      universes.length
        ? el('c:UniverseScheme', {}, identity(ctx, `${shortId}!us`), ...universes)
        : '',
    ),
    // LogicalProduct
    el(
      'l:LogicalProduct',
      {},
      identity(ctx, `${shortId}!lp`),
      ...catSchemes.map(cs => cs.catScheme),
      catSchemes.length
        ? el('l:CodeListScheme', {}, identity(ctx, `${shortId}!cls`), ...catSchemes.map(cs => cs.codeList))
        : '',
      variables.length
        ? el('l:VariableScheme', {}, identity(ctx, `${shortId}!vs`), ...variables)
        : '',
    ),
    // DataCollection
    el(
      'd:DataCollection',
      {},
      identity(ctx, `${shortId}!dc`),
      el('d:QuestionScheme', {}, identity(ctx, `${shortId}!qs`), ...ctx.qi),
      el('d:ControlConstructScheme', {}, identity(ctx, `${shortId}!ccs`), ...ctx.cc),
      el(
        'd:InstrumentScheme',
        {},
        identity(ctx, `${shortId}!is`),
        el(
          'd:Instrument',
          {},
          identity(ctx, `${shortId}!inst`),
          intlLabel(ctx, instrument.metadata.title),
          el(
            'd:ControlConstructReference',
            {},
            txt('r:URN', {}, fullUrn(ctx, instrument.sequence.id)),
            txt('r:Agency', {}, agency),
            txt('r:ID', {}, instrument.sequence.id),
            txt('r:Version', {}, ctx.version),
            txt('r:TypeOfObject', {}, 'Sequence'),
          ),
        ),
      ),
    ),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<DDIInstance\n  ${nsStr}>\n${studyUnit}\n</DDIInstance>`;
}
