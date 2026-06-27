/** Right-of-tree element inspector: edits the selected construct or variable. */
import React from 'react';
import type {
  CategoryScheme,
  ControlConstruct,
  EditRule,
  Instrument,
  ResponseDomain,
  Variable,
} from '@mobilesurvey/instrument-schema';
import { pick } from '@mobilesurvey/runtime-engine';
import { useDesigner } from '../store/instrumentStore.js';
import { buildQNumMap, findNode, genId } from '../lib/tree.js';
import { ConditionField, Field, IntlStringField, TextField } from './fields.jsx';

/** Bind an updater to a construct id, casting the located node to the editor's known subtype. */
function useEditConstruct(id: string) {
  const update = useDesigner((s) => s.update);
  return function edit<T extends ControlConstruct>(mutate: (node: T) => void) {
    update((draft) => {
      const node = findNode(draft.sequence, id) as T | null;
      if (node) mutate(node);
    });
  };
}

function useEditVariable(id: string) {
  const update = useDesigner((s) => s.update);
  return (mutate: (v: Variable) => void) =>
    update((draft) => {
      const v = draft.variables.find((x) => x.id === id);
      if (v) mutate(v);
    });
}

function VariableSelect({
  label,
  value,
  variables,
  onChange,
  filter,
}: {
  label: string;
  value: string;
  variables: Variable[];
  onChange: (name: string) => void;
  filter?: (v: Variable) => boolean;
}) {
  const list = filter ? variables.filter(filter) : variables;
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {list.map((v) => (
            <option key={v.id} value={v.name}>
              {v.name} ({v.representation})
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function ResponseDomainEditor({
  domain,
  schemes,
  onChange,
}: {
  domain: ResponseDomain;
  schemes: CategoryScheme[];
  onChange: (d: ResponseDomain) => void;
}) {
  const firstScheme = schemes[0]?.id ?? '';
  const defaults: Record<ResponseDomain['type'], ResponseDomain> = {
    code: { type: 'code', categorySchemeRef: firstScheme, selection: 'single' },
    numeric: { type: 'numeric' },
    text: { type: 'text' },
    datetime: { type: 'datetime', mode: 'date' },
    boolean: { type: 'boolean' },
    file: { type: 'file' },
    lookup: { type: 'lookup', categorySchemeRef: firstScheme },
    markAll: { type: 'markAll', categorySchemeRef: firstScheme, variablePrefix: 'Q' },
    grid: { type: 'grid', rowSchemeRef: firstScheme, colSchemeRef: firstScheme, variablePrefix: 'G' },
  };

  return (
    <div className="subpanel">
      <h4>Response domain</h4>
      <Field label="Type">
        {(id) => (
          <select
            id={id}
            value={domain.type}
            onChange={(e) => onChange(defaults[e.target.value as ResponseDomain['type']])}
          >
            {Object.keys(defaults).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </Field>

      {(domain.type === 'code' || domain.type === 'lookup') && (
        <Field label="Category scheme">
          {(id) => (
            <select
              id={id}
              value={domain.categorySchemeRef}
              onChange={(e) => onChange({ ...domain, categorySchemeRef: e.target.value })}
            >
              <option value="">— select —</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {domain.type === 'code' && (
        <Field label="Selection">
          {(id) => (
            <select
              id={id}
              value={domain.selection}
              onChange={(e) => onChange({ ...domain, selection: e.target.value as 'single' | 'multiple' })}
            >
              <option value="single">single</option>
              <option value="multiple">multiple</option>
            </select>
          )}
        </Field>
      )}

      {domain.type === 'numeric' && (
        <div className="row">
          <Field label="Min">
            {(id) => (
              <input
                id={id}
                type="number"
                value={domain.min ?? ''}
                onChange={(e) => onChange({ ...domain, min: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Max">
            {(id) => (
              <input
                id={id}
                type="number"
                value={domain.max ?? ''}
                onChange={(e) => onChange({ ...domain, max: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Decimals">
            {(id) => (
              <input
                id={id}
                type="number"
                value={domain.decimals ?? ''}
                onChange={(e) => onChange({ ...domain, decimals: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
      )}

      {domain.type === 'text' && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(domain.multiline)}
            onChange={(e) => onChange({ ...domain, multiline: e.target.checked })}
          />
          Multiline
        </label>
      )}

      {domain.type === 'datetime' && (
        <Field label="Mode">
          {(id) => (
            <select
              id={id}
              value={domain.mode}
              onChange={(e) => onChange({ ...domain, mode: e.target.value as 'date' | 'time' | 'datetime' })}
            >
              <option value="date">date</option>
              <option value="time">time</option>
              <option value="datetime">datetime</option>
            </select>
          )}
        </Field>
      )}

      {domain.type === 'lookup' && (
        <p className="hint">Rendered with the advanced-search UI (auto-suggest / fuzzy match).</p>
      )}

      {domain.type === 'markAll' && (
        <>
          <Field label="Category scheme">
            {(id) => (
              <select
                id={id}
                value={domain.categorySchemeRef}
                onChange={(e) => onChange({ ...domain, categorySchemeRef: e.target.value })}
              >
                <option value="">— select —</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Variable prefix"
            hint="Each checkbox stores as prefix_CODE (e.g. Q01_A, Q01_B). Reserved codes: 1=yes, 2=no, 6=skip, 7=don't know, 9=missing."
          >
            {(id) => (
              <input
                id={id}
                type="text"
                value={domain.variablePrefix}
                placeholder="Q01"
                onChange={(e) => onChange({ ...domain, variablePrefix: e.target.value })}
              />
            )}
          </Field>
          {domain.categorySchemeRef && domain.variablePrefix && (
            <p className="hint">
              Generated:{' '}
              {schemes
                .find((s) => s.id === domain.categorySchemeRef)
                ?.categories.map((c) => `${domain.variablePrefix}_${c.code}`)
                .join(', ') ?? '—'}
            </p>
          )}
        </>
      )}

      {domain.type === 'grid' && (
        <>
          <Field label="Row scheme (items / statements)">
            {(id) => (
              <select
                id={id}
                value={domain.rowSchemeRef}
                onChange={(e) => onChange({ ...domain, rowSchemeRef: e.target.value })}
              >
                <option value="">— select —</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>{s.id}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Column scheme (shared response scale)">
            {(id) => (
              <select
                id={id}
                value={domain.colSchemeRef}
                onChange={(e) => onChange({ ...domain, colSchemeRef: e.target.value })}
              >
                <option value="">— select —</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>{s.id}</option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Variable prefix"
            hint="Generates prefix_rowCode per row (e.g. G01_A, G01_B …). Each stores the selected column code."
          >
            {(id) => (
              <input
                id={id}
                type="text"
                value={domain.variablePrefix}
                placeholder="G01"
                onChange={(e) => onChange({ ...domain, variablePrefix: e.target.value })}
              />
            )}
          </Field>
          {domain.rowSchemeRef && domain.variablePrefix && (
            <p className="hint">
              Generated:{' '}
              {schemes
                .find((s) => s.id === domain.rowSchemeRef)
                ?.categories.map((c) => `${domain.variablePrefix}_${c.code}`)
                .join(', ') ?? '—'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EditsEditor({
  edits,
  languages,
  onChange,
}: {
  edits: EditRule[];
  languages: string[];
  onChange: (edits: EditRule[]) => void;
}) {
  const addEdit = () =>
    onChange([
      ...edits,
      { id: genId('edit'), type: 'soft', when: '', message: Object.fromEntries(languages.map((l) => [l, ''])) },
    ]);
  const patch = (i: number, mut: (e: EditRule) => EditRule) =>
    onChange(edits.map((e, idx) => (idx === i ? mut(e) : e)));

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        <h4>Validation edits</h4>
        <button type="button" onClick={addEdit}>
          + Add edit
        </button>
      </div>
      {edits.length === 0 ? <p className="hint">No edits.</p> : null}
      {edits.map((edit, i) => (
        <div key={edit.id} className="edit-card">
          <div className="row">
            <Field label="Severity">
              {(id) => (
                <select
                  id={id}
                  value={edit.type}
                  onChange={(e) => patch(i, (x) => ({ ...x, type: e.target.value as 'hard' | 'soft' }))}
                >
                  <option value="hard">hard (blocks)</option>
                  <option value="soft">soft (warns)</option>
                </select>
              )}
            </Field>
            <button
              type="button"
              className="danger"
              aria-label="Remove edit"
              onClick={() => onChange(edits.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
          <ConditionField
            label="Fires when (true = violation)"
            value={edit.when}
            onChange={(v) => patch(i, (x) => ({ ...x, when: v }))}
          />
          <IntlStringField
            label="Message"
            value={edit.message}
            languages={languages}
            onChange={(m) => patch(i, (x) => ({ ...x, message: m }))}
          />
        </div>
      ))}
    </div>
  );
}

function ConstructEditor({ node, instrument }: { node: ControlConstruct; instrument: Instrument }) {
  const languages = instrument.languages;
  const edit = useEditConstruct(node.id);

  switch (node.type) {
    case 'sequence':
      return (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(node.isPage)}
              onChange={(e) => edit<typeof node>((n) => void (n.isPage = e.target.checked))}
            />
            This is a <strong>page</strong> (adds a page break; preview navigates page-by-page)
          </label>
          <IntlStringField
            label={node.isPage ? 'Page title' : 'Section label'}
            value={node.label}
            languages={languages}
            onChange={(v) => edit<typeof node>((n) => void (n.label = v))}
          />
          <ConditionField
            label="Visible when"
            value={node.visibleWhen ?? ''}
            onChange={(v) => edit<typeof node>((n) => void (n.visibleWhen = v))}
          />
          <Field label="Interviewer module kind">
            {(id) => (
              <select
                id={id}
                value={node.moduleKind ?? ''}
                onChange={(e) => edit<typeof node>((n) => {
                  n.moduleKind = (e.target.value || undefined) as typeof n.moduleKind;
                })}
              >
                <option value="">— standard section/page —</option>
                <option value="entry">Entry — pre-interview validation</option>
                <option value="main">Main — core survey content</option>
                <option value="exit">Exit — post-interview housekeeping</option>
              </select>
            )}
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(node.interviewerOnly)}
              onChange={(e) => edit<typeof node>((n) => void (n.interviewerOnly = e.target.checked || undefined))}
            />
            Interviewer only (hidden in self-administered mode)
          </label>
        </>
      );
    case 'statement':
      return (
        <>
          <IntlStringField
            label="Statement text"
            value={node.text}
            languages={languages}
            multiline
            onChange={(v) => edit<typeof node>((n) => void (n.text = v))}
          />
          <ConditionField
            label="Visible when"
            value={node.visibleWhen ?? ''}
            onChange={(v) => edit<typeof node>((n) => void (n.visibleWhen = v))}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(node.interviewerOnly)}
              onChange={(e) => edit<typeof node>((n) => void (n.interviewerOnly = e.target.checked || undefined))}
            />
            Interviewer only (hidden in self-administered mode)
          </label>
        </>
      );
    case 'ifThenElse':
      return (
        <ConditionField
          label="Branch condition"
          hint="When true, the `then` children show; otherwise `else`."
          value={node.condition}
          onChange={(v) => edit<typeof node>((n) => void (n.condition = v))}
        />
      );
    case 'computation':
      return (
        <>
          <VariableSelect
            label="Target variable"
            value={node.targetVariableRef}
            variables={instrument.variables}
            onChange={(name) => edit<typeof node>((n) => void (n.targetVariableRef = name))}
          />
          <ConditionField
            label="Expression"
            value={node.expression}
            onChange={(v) => edit<typeof node>((n) => void (n.expression = v))}
          />
        </>
      );
    case 'loop':
      return (
        <>
          <IntlStringField
            label="Roster label"
            value={node.label}
            languages={languages}
            onChange={(v) => edit<typeof node>((n) => void (n.label = v))}
          />
          <TextField
            label="Loop index variable"
            hint="Available inside the loop as $name (e.g. i, m, e)."
            value={node.loopVariable}
            onChange={(v) => edit<typeof node>((n) => void (n.loopVariable = v))}
          />
          <VariableSelect
            label="Count variable (iterations)"
            value={node.countVariableRef ?? ''}
            variables={instrument.variables}
            filter={(v) => v.representation === 'numeric'}
            onChange={(name) => edit<typeof node>((n) => void (n.countVariableRef = name))}
          />
          <ConditionField
            label="…or loop while"
            value={node.loopWhile ?? ''}
            onChange={(v) => edit<typeof node>((n) => void (n.loopWhile = v))}
          />
          <IntlStringField
            label="Per-item heading"
            value={node.itemLabel}
            languages={languages}
            onChange={(v) => edit<typeof node>((n) => void (n.itemLabel = v))}
          />
          <ConditionField
            label="Visible when"
            value={node.visibleWhen ?? ''}
            onChange={(v) => edit<typeof node>((n) => void (n.visibleWhen = v))}
          />
        </>
      );
    case 'question':
      return (
        <>
          <VariableSelect
            label="Collects variable"
            value={node.variableRef}
            variables={instrument.variables}
            onChange={(name) => edit<typeof node>((n) => void (n.variableRef = name))}
          />
          <IntlStringField
            label="Question text"
            value={node.text}
            languages={languages}
            multiline
            onChange={(v) => edit<typeof node>((n) => void (n.text = v))}
          />
          <IntlStringField
            label="Instruction"
            value={node.instruction}
            languages={languages}
            onChange={(v) => edit<typeof node>((n) => void (n.instruction = v))}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(node.required)}
              onChange={(e) => edit<typeof node>((n) => void (n.required = e.target.checked))}
            />
            Required
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(node.interviewerOnly)}
              onChange={(e) => edit<typeof node>((n) => void (n.interviewerOnly = e.target.checked || undefined))}
            />
            Interviewer only (hidden in self-administered mode)
          </label>
          <ResponseDomainEditor
            domain={node.responseDomain}
            schemes={instrument.categorySchemes}
            onChange={(d) => edit<typeof node>((n) => void (n.responseDomain = d))}
          />
          <EditsEditor
            edits={node.edits ?? []}
            languages={languages}
            onChange={(e) => edit<typeof node>((n) => void (n.edits = e))}
          />
          <ConditionField
            label="Visible when"
            value={node.visibleWhen ?? ''}
            onChange={(v) => edit<typeof node>((n) => void (n.visibleWhen = v))}
          />
        </>
      );
  }
}

function VariableEditor({ variable, instrument }: { variable: Variable; instrument: Instrument }) {
  const edit = useEditVariable(variable.id);
  return (
    <>
      <TextField label="Name" value={variable.name} onChange={(v) => edit((x) => void (x.name = v))} />
      <Field label="Role">
        {(id) => (
          <select
            id={id}
            value={variable.kind}
            onChange={(e) => edit((x) => void (x.kind = e.target.value as Variable['kind']))}
          >
            <option value="collected">collected</option>
            <option value="hidden">hidden</option>
            <option value="derived">derived</option>
          </select>
        )}
      </Field>
      <Field label="Representation">
        {(id) => (
          <select
            id={id}
            value={variable.representation}
            onChange={(e) => edit((x) => void (x.representation = e.target.value as Variable['representation']))}
          >
            {['code', 'numeric', 'text', 'datetime', 'boolean', 'file'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </Field>
      <IntlStringField
        label="Label"
        value={variable.label}
        languages={instrument.languages}
        onChange={(v) => edit((x) => void (x.label = v))}
      />
      {variable.representation === 'code' && (
        <Field label="Category scheme">
          {(id) => (
            <select
              id={id}
              value={variable.categorySchemeRef ?? ''}
              onChange={(e) => edit((x) => void (x.categorySchemeRef = e.target.value || undefined))}
            >
              <option value="">— none —</option>
              {instrument.categorySchemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {variable.kind === 'derived' && (
        <ConditionField
          label="Compute"
          value={variable.compute ?? ''}
          onChange={(v) => edit((x) => void (x.compute = v))}
        />
      )}
    </>
  );
}

function SchemeEditor({ schemeId, instrument }: { schemeId: string; instrument: Instrument }) {
  const update = useDesigner((s) => s.update);
  const language = useDesigner((s) => s.language);
  const languages = instrument.languages;
  const scheme = instrument.categorySchemes.find((c) => c.id === schemeId);
  if (!scheme) return <p className="hint">Scheme not found.</p>;

  return (
    <>
      <IntlStringField
        label="Label"
        value={scheme.label}
        languages={languages}
        onChange={(v) =>
          update((d) => {
            const s = d.categorySchemes.find((c) => c.id === schemeId);
            if (s) s.label = v;
          })
        }
      />
      <p className="hint">ID: <code>{scheme.id}</code></p>
      <div className="subpanel">
        <div className="subpanel__head">
          <h4>Categories ({scheme.categories.length})</h4>
          <button
            type="button"
            onClick={() =>
              update((d) => {
                const s = d.categorySchemes.find((c) => c.id === schemeId);
                if (s) s.categories.push({ code: `code${s.categories.length + 1}`, label: {} });
              })
            }
          >
            + Category
          </button>
        </div>
        {scheme.categories.length === 0 && <p className="hint">No categories yet.</p>}
        {scheme.categories.map((cat, i) => (
          <div key={i} className="edit-card">
            <div className="row">
              <Field label="Code">
                {(id) => (
                  <input
                    id={id}
                    type="text"
                    value={cat.code}
                    onChange={(e) =>
                      update((d) => {
                        const s = d.categorySchemes.find((c) => c.id === schemeId);
                        if (s && s.categories[i]) s.categories[i]!.code = e.target.value;
                      })
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                className="danger"
                aria-label="Remove category"
                onClick={() =>
                  update((d) => {
                    const s = d.categorySchemes.find((c) => c.id === schemeId);
                    if (s) s.categories = s.categories.filter((_, j) => j !== i);
                  })
                }
              >
                ✕
              </button>
            </div>
            <IntlStringField
              label="Label"
              value={cat.label}
              languages={languages}
              onChange={(v) =>
                update((d) => {
                  const s = d.categorySchemes.find((c) => c.id === schemeId);
                  if (s && s.categories[i]) s.categories[i]!.label = v;
                })
              }
            />
          </div>
        ))}
      </div>
      {scheme.categories.length > 0 && (
        <p className="hint">
          Codes: {scheme.categories.map((c) => (
            <code key={c.code} style={{ marginRight: 4 }}>
              {c.code} — {(c.label as Record<string, string>)[language] ?? (c.label as Record<string, string>)['en'] ?? '—'}
            </code>
          ))}
        </p>
      )}
    </>
  );
}

/** Read-only preview of a library construct shown in the center Inspector when user clicks a library card. */
function LibraryPreview({ node, language }: { node: ControlConstruct; language: string }) {
  const setLibraryPreview = useDesigner((s) => s.setLibraryPreview);
  const renderNode = (n: ControlConstruct, depth = 0): React.ReactNode => {
    const indent = { marginInlineStart: depth * 16 };
    switch (n.type) {
      case 'sequence':
        return (
          <div key={n.id} style={indent} className="lib-preview__group">
            <strong>{n.isPage ? '□ Page: ' : '▣ Section: '}{pick(n.label, language) || n.id}</strong>
            {'children' in n && n.children.map((c) => renderNode(c, depth + 1))}
          </div>
        );
      case 'question':
        return (
          <div key={n.id} style={indent} className="lib-preview__q">
            <span className="lib-preview__qtext">? {pick(n.text, language) || n.variableRef || n.id}</span>
            {n.responseDomain && (
              <span className="lib-preview__domain">
                [{n.responseDomain.type}
                {'categorySchemeRef' in n.responseDomain ? ` · ${n.responseDomain.categorySchemeRef}` : ''}]
              </span>
            )}
          </div>
        );
      case 'statement':
        return (
          <div key={n.id} style={indent} className="lib-preview__stmt">
            " {pick(n.text, language) || n.id}
          </div>
        );
      case 'loop':
        return (
          <div key={n.id} style={indent} className="lib-preview__group">
            <strong>↻ Roster: {pick(n.label, language) || n.id}</strong>
            {n.children.map((c) => renderNode(c, depth + 1))}
          </div>
        );
      case 'ifThenElse':
        return (
          <div key={n.id} style={indent} className="lib-preview__group">
            <strong>⎇ If: {n.condition || '…'}</strong>
          </div>
        );
      default:
        return <div key={(n as ControlConstruct).id} style={indent}>· {(n as ControlConstruct).id}</div>;
    }
  };

  return (
    <div className="lib-preview">
      <div className="lib-preview__badge">
        Library Preview — read-only
        <button type="button" className="lib-preview__close" onClick={() => setLibraryPreview(null)}>
          ✕ Close
        </button>
      </div>
      <div className="lib-preview__content">
        {renderNode(node)}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>Click <strong>+ Insert</strong> in the Library panel to add this to your survey.</p>
    </div>
  );
}

export function Inspector() {
  const instrument = useDesigner((s) => s.instrument);
  const selectedId = useDesigner((s) => s.selectedId);
  const language = useDesigner((s) => s.language);
  const libraryPreviewConstruct = useDesigner((s) => s.libraryPreviewConstruct);

  // Library preview takes priority (cleared when user clicks tree).
  if (libraryPreviewConstruct) {
    return (
      <div className="inspector">
        <LibraryPreview node={libraryPreviewConstruct} language={language} />
      </div>
    );
  }

  if (!selectedId) return <p className="hint pad">Select an element from the structure tree.</p>;

  // Category scheme?
  const scheme = instrument.categorySchemes.find((c) => c.id === selectedId);
  if (scheme) {
    return (
      <div className="inspector">
        <h3>Code List · <code>{scheme.id}</code></h3>
        <SchemeEditor schemeId={scheme.id} instrument={instrument} />
      </div>
    );
  }

  const variable = instrument.variables.find((v) => v.id === selectedId);
  if (variable) {
    return (
      <div className="inspector">
        <h3>Variable · {variable.name}</h3>
        <VariableEditor variable={variable} instrument={instrument} />
      </div>
    );
  }

  const node = findNode(instrument.sequence, selectedId);
  if (!node) return <p className="hint pad">Selection not found.</p>;

  const qNum = node.type === 'question' ? buildQNumMap(instrument.sequence).get(node.id) : undefined;

  return (
    <div className="inspector">
      <h3>
        {qNum != null && <span className="inspector__qnum">Q{qNum}</span>}
        {node.type} · <code>{node.id}</code>
      </h3>
      <ConstructEditor node={node} instrument={instrument} />
    </div>
  );
}
