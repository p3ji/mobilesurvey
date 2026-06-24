/** Variables list (collected/hidden/derived) and pre-fill mapping editor. */
import { useDesigner } from '../store/instrumentStore.js';
import { createVariable } from '../lib/tree.js';
import { MOCK_SAMPLE } from '../integrations/mocks.js';
import { Field } from './fields.jsx';

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

  return (
    <div className="varpanel">
      <div className="subpanel__head">
        <h3>Variables</h3>
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

      <div className="subpanel__head">
        <h3>Pre-fill mappings</h3>
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
