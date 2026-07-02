/** Variables list (collected/hidden/derived), category-scheme list, and pre-fill mapping editor. */
import { useDesigner } from '../store/instrumentStore.js';
import { createVariable } from '../lib/tree.js';
import { MOCK_SAMPLE } from '../integrations/mocks.js';
import { Field } from './fields.jsx';

function genSchemeId() {
  return `cs.new${Date.now().toString(36)}`;
}

export function VariablesPanel() {
  const instrument = useDesigner((s) => s.instrument);
  const selectedId = useDesigner((s) => s.selectedId);
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);

  const sampleFields = Object.keys(MOCK_SAMPLE.fields);

  const addVariable = () => {
    const variable = createVariable(instrument);
    update((d) => void d.variables.push(variable));
    select(variable.id);
  };

  const removeVariable = (id: string) => update((d) => void (d.variables = d.variables.filter((v) => v.id !== id)));

  const addMapping = () =>
    update((d) => void d.prefillMappings.push({ sampleField: sampleFields[0] ?? '', targetVariable: '' }));
  const patchMapping = (i: number, key: 'sampleField' | 'targetVariable', value: string) =>
    update((d) => {
      const m = d.prefillMappings[i];
      if (m) m[key] = value;
    });
  const removeMapping = (i: number) =>
    update((d) => void (d.prefillMappings = d.prefillMappings.filter((_, idx) => idx !== i)));

  const addScheme = () => {
    const id = genSchemeId();
    update((d) => d.categorySchemes.push({ id, label: { en: 'New code list' }, categories: [] }));
    select(id);
  };

  const removeScheme = (id: string) =>
    update((d) => void (d.categorySchemes = d.categorySchemes.filter((c) => c.id !== id)));

  return (
    <div className="varpanel">
      {/* ── Variables ──────────────────────────────────────────────────── */}
      <div className="subpanel__head">
        <h2>Variables</h2>
        <button type="button" onClick={addVariable}>
          + Variable
        </button>
      </div>
      <ul className="varlist">
        {instrument.variables.map((v) => (
          <li key={v.id} className={selectedId === v.id ? 'varlist__item varlist__item--selected' : 'varlist__item'}>
            <button type="button" className="varlist__select" onClick={() => select(v.id)}>
              <span className={`badge badge--${v.kind}`}>{v.kind[0]!.toUpperCase()}</span>
              <span className="varlist__name">{v.name}</span>
              <span className="varlist__rep">{v.representation}</span>
            </button>
            <button type="button" className="danger" aria-label={`Delete ${v.name}`} onClick={() => removeVariable(v.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      {/* ── Category Schemes (Code Lists) ──────────────────────────────── */}
      <div className="subpanel__head">
        <h2>Code Lists</h2>
        <button type="button" onClick={addScheme}>
          + Scheme
        </button>
      </div>
      <p className="hint">Click a scheme to edit its codes in the Inspector.</p>
      <ul className="varlist">
        {instrument.categorySchemes.map((cs) => (
          <li
            key={cs.id}
            className={selectedId === cs.id ? 'varlist__item varlist__item--selected' : 'varlist__item'}
          >
            <button type="button" className="varlist__select" onClick={() => select(cs.id)}>
              <span className="badge badge--scheme">≣</span>
              <span className="varlist__name">{cs.id}</span>
              <span className="varlist__rep">{cs.categories.length} categories</span>
            </button>
            <button
              type="button"
              className="danger"
              aria-label={`Delete ${cs.id}`}
              onClick={() => removeScheme(cs.id)}
            >
              ✕
            </button>
          </li>
        ))}
        {instrument.categorySchemes.length === 0 && (
          <li className="varlist__empty">No code lists yet.</li>
        )}
      </ul>

      {/* ── Pre-fill mappings ──────────────────────────────────────────── */}
      <div className="subpanel__head">
        <h2>Pre-fill mappings</h2>
        <button type="button" onClick={addMapping}>
          + Mapping
        </button>
      </div>
      <p className="hint">Maps incoming sample/CMS fields onto instrument variables.</p>
      {instrument.prefillMappings.map((m, i) => (
        <div key={i} className="row prefill-row">
          <Field label="Sample field">
            {(id) => (
              <select id={id} value={m.sampleField} onChange={(e) => patchMapping(i, 'sampleField', e.target.value)}>
                {sampleFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Target variable">
            {(id) => (
              <select id={id} value={m.targetVariable} onChange={(e) => patchMapping(i, 'targetVariable', e.target.value)}>
                <option value="">— select —</option>
                {instrument.variables.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="button" className="danger" aria-label="Remove mapping" onClick={() => removeMapping(i)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
