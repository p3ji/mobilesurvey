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
  const languages = useDesigner((s) => s.instrument.languages);
  const update = useDesigner((s) => s.update);
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
    table: {
      type: 'table',
      rowSchemeRef: firstScheme,
      colSchemeRef: firstScheme,
      variablePrefix: 'T01',
      totalRow: true,
    },
    geolocation: { type: 'geolocation', precision: 3, manualFallback: true },
    photo: { type: 'photo', facing: 'environment' },
  };

  return (
    <div className="subpanel">
      <h3>Response domain</h3>
      <Field label="Type">
        {(id) => (
          <select
            id={id}
            value={domain.type}
            onChange={(e) => {
              const nextType = e.target.value as ResponseDomain['type'];
              // Sensor domains require an instrument-level declaration (consent text);
              // auto-add a starter one so the question is immediately valid and runnable.
              const sensorKind =
                nextType === 'geolocation' ? 'geolocation' : nextType === 'photo' ? 'camera' : null;
              if (sensorKind) {
                const starter: Record<string, [string, string]> = {
                  geolocation: [
                    'We ask for your location to place your answers geographically. Coordinates are rounded before they are stored.',
                    'Nous demandons votre position pour situer vos réponses géographiquement. Les coordonnées sont arrondies avant d’être conservées.',
                  ],
                  camera: [
                    'We ask you to photograph the subject of this question. The photo is downscaled and stripped of hidden metadata before upload.',
                    'Nous vous demandons de photographier l’objet de cette question. La photo est réduite et débarrassée des métadonnées cachées avant le téléversement.',
                  ],
                };
                update((draft) => {
                  draft.sensors ??= { sensors: [] };
                  if (!draft.sensors.sensors.some((s) => s.kind === sensorKind)) {
                    const [en, fr] = starter[sensorKind]!;
                    draft.sensors.sensors.push({
                      kind: sensorKind,
                      purpose: Object.fromEntries(languages.map((l) => [l, l === 'fr' ? fr : en])),
                    });
                  }
                });
              }
              onChange(defaults[nextType]);
            }}
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

      {domain.type === 'geolocation' && (
        <>
          <div className="row">
            <Field label="Precision (decimals)" hint="Privacy dial: 2 ≈ 1.1 km, 3 ≈ 110 m, 5 ≈ raw GPS">
              {(id) => (
                <select
                  id={id}
                  value={domain.precision ?? 3}
                  onChange={(e) =>
                    onChange({ ...domain, precision: Number(e.target.value) as 2 | 3 | 4 | 5 })
                  }
                >
                  <option value={2}>2 (~1.1 km)</option>
                  <option value={3}>3 (~110 m)</option>
                  <option value={4}>4 (~11 m)</option>
                  <option value={5}>5 (raw)</option>
                </select>
              )}
            </Field>
            <Field label="Max accuracy (m)" hint="Reject fixes worse than this radius; blank = accept any">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  value={domain.maxAccuracyM ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...domain,
                      maxAccuracyM: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              )}
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={domain.manualFallback !== false}
              onChange={(e) => onChange({ ...domain, manualFallback: e.target.checked })}
            />
            Offer a typed location description when consent is declined or the fix fails
            (recommended — keeps the survey completable)
          </label>
          <p className="hint">
            Stores a summary in this question's variable plus generated
            {' '}<code>_LAT/_LON/_ACC/_TS/_SRC</code> sub-variables. Consent text lives in the
            root sequence's <strong>Sensors &amp; consent</strong> panel.
          </p>
        </>
      )}

      {domain.type === 'photo' && (
        <>
          <div className="row">
            <Field label="Camera" hint="Which camera the capture input requests">
              {(id) => (
                <select
                  id={id}
                  value={domain.facing ?? 'environment'}
                  onChange={(e) =>
                    onChange({ ...domain, facing: e.target.value as 'environment' | 'user' })
                  }
                >
                  <option value="environment">Back (environment)</option>
                  <option value="user">Front (user)</option>
                </select>
              )}
            </Field>
            <Field label="Max edge (px)" hint="Client-side downscale cap before upload (default 1600)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={200}
                  max={8000}
                  value={domain.maxEdgePx ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...domain,
                      maxEdgePx: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              )}
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={domain.allowLibrary === true}
              onChange={(e) => onChange({ ...domain, allowLibrary: e.target.checked || undefined })}
            />
            Also allow picking an existing photo from the device library
          </label>
          <p className="hint">
            Stores the attachment ref (storage path — never image bytes) in this question's
            variable plus generated <code>_TS/_SRC</code> sub-variables. Photos are downscaled
            and EXIF-stripped client-side. Consent text lives in the root sequence's
            {' '}<strong>Sensors &amp; consent</strong> panel.
          </p>
        </>
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

      {domain.type === 'table' && (
        <>
          <Field label="Row scheme (line items)">
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
          <Field label="Column scheme">
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
            hint="Generates prefix_row_col per cell (numeric). Totals: prefix_row_TOT, prefix_TOT_col, prefix_TOT_TOT are referenceable in edits and piping."
          >
            {(id) => (
              <input
                id={id}
                type="text"
                value={domain.variablePrefix}
                placeholder="T01"
                onChange={(e) => onChange({ ...domain, variablePrefix: e.target.value })}
              />
            )}
          </Field>
          <IntlStringField
            label="Unit caption"
            value={domain.unit}
            languages={languages}
            onChange={(v) =>
              onChange({ ...domain, unit: Object.values(v).some(Boolean) ? v : undefined })
            }
          />
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={domain.totalRow ?? false}
              onChange={(e) => onChange({ ...domain, totalRow: e.target.checked || undefined })}
            />
            Computed “Total” row (column sums)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={domain.totalCol ?? false}
              onChange={(e) => onChange({ ...domain, totalCol: e.target.checked || undefined })}
            />
            Computed “Total” column (row sums)
          </label>
          <Field
            label="Disabled cells"
            hint="One ROWCODE:COLCODE per line — cells shown shaded and never enterable."
          >
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={(domain.disabledCells ?? []).join('\n')}
                placeholder="other:vol"
                onChange={(e) => {
                  const cells = e.target.value
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean);
                  onChange({ ...domain, disabledCells: cells.length ? cells : undefined });
                }}
              />
            )}
          </Field>
          {(() => {
            const rowScheme = schemes.find((s) => s.id === domain.rowSchemeRef);
            const colScheme = schemes.find((s) => s.id === domain.colSchemeRef);
            const rowCodes = new Set(rowScheme?.categories.map((c) => c.code) ?? []);
            const colCodes = new Set(colScheme?.categories.map((c) => c.code) ?? []);
            const bad = (domain.disabledCells ?? []).filter((cell) => {
              const [r, c] = cell.split(':');
              return !rowCodes.has(r ?? '') || !colCodes.has(c ?? '');
            });
            const sample =
              rowScheme && colScheme && domain.variablePrefix
                ? rowScheme.categories
                    .slice(0, 2)
                    .flatMap((r) =>
                      colScheme.categories
                        .slice(0, 2)
                        .map((c) => `${domain.variablePrefix}_${r.code}_${c.code}`),
                    )
                : [];
            return (
              <>
                {bad.length > 0 && (
                  <p className="hint hint--warn">
                    Unknown row/column codes in disabled cells: {bad.join(', ')}
                  </p>
                )}
                {sample.length > 0 && (
                  <p className="hint">
                    Generated: {sample.join(', ')}… — model group subtotals (“Total – Spirits”)
                    as one table per group.
                  </p>
                )}
              </>
            );
          })()}
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
        <h3>Validation edits</h3>
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

/** DDI agency-id pattern (dot-separated labels), mirrored from instrument-schema's Zod rule. */
const AGENCY_ID_RE = /^[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{1,63})*$/;

/** Instrument-level DDI identity settings, shown when the root sequence is selected. */
function SurveyIdentityFields({ instrument }: { instrument: Instrument }) {
  const update = useDesigner((s) => s.update);
  const agencyId = instrument.metadata.agencyId ?? '';
  const invalid = agencyId !== '' && !AGENCY_ID_RE.test(agencyId);
  return (
    <>
      <Field
        label="DDI maintenance agency ID"
        hint="Stamped into every URN on DDI-XML export (urn:ddi:{agency}:{id}:{version}). Leave blank to publish under the project placeholder io.github.p3ji. Only set a registered agency (e.g. ca.statcan) if you actually publish on its behalf."
      >
        {(id) => (
          <input
            id={id}
            type="text"
            value={agencyId}
            placeholder="io.github.p3ji (placeholder)"
            onChange={(e) =>
              update((draft) => {
                draft.metadata.agencyId = e.target.value.trim() || undefined;
              })
            }
          />
        )}
      </Field>
      {invalid && (
        <p className="hint" role="alert">
          Not a valid DDI agency ID — use dot-separated labels of letters, digits and hyphens
          (e.g. io.github.p3ji). Export will fall back to the placeholder.
        </p>
      )}
    </>
  );
}

const SENSOR_KIND_LABEL: Record<string, string> = {
  geolocation: 'Location (GPS)',
  camera: 'Camera',
};

/**
 * Instrument-level sensor declarations + consent text, shown when the root sequence is
 * selected. A declaration is auto-added when the first sensor question is created; this
 * panel is where its respondent-facing purpose/retention text is edited.
 */
function SensorConsentFields({ instrument }: { instrument: Instrument }) {
  const update = useDesigner((s) => s.update);
  const declarations = instrument.sensors?.sensors ?? [];
  if (declarations.length === 0) return null;
  return (
    <div className="subpanel">
      <h3>Sensors &amp; consent</h3>
      <p className="hint">
        Shown verbatim on the consent card before the sensor can fire. Declining always keeps
        the survey completable.
      </p>
      {declarations.map((decl, i) => (
        <div key={decl.kind}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{SENSOR_KIND_LABEL[decl.kind] ?? decl.kind}</strong>
            <button
              type="button"
              className="btn-small"
              onClick={() =>
                update((draft) => {
                  draft.sensors!.sensors.splice(i, 1);
                  if (draft.sensors!.sensors.length === 0) delete draft.sensors;
                })
              }
            >
              Remove
            </button>
          </div>
          <IntlStringField
            label="Purpose (why, what is stored, at what precision)"
            value={decl.purpose}
            languages={instrument.languages}
            multiline
            onChange={(v) =>
              update((draft) => {
                draft.sensors!.sensors[i]!.purpose = v;
              })
            }
          />
          <IntlStringField
            label="Retention statement (optional)"
            value={decl.retention}
            languages={instrument.languages}
            onChange={(v) =>
              update((draft) => {
                draft.sensors!.sensors[i]!.retention = v;
              })
            }
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
          {node.id === instrument.sequence.id && <SurveyIdentityFields instrument={instrument} />}
          {node.id === instrument.sequence.id && <SensorConsentFields instrument={instrument} />}
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
          <h3>Categories ({scheme.categories.length})</h3>
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
        <h2>Code List · <code>{scheme.id}</code></h2>
        <SchemeEditor schemeId={scheme.id} instrument={instrument} />
      </div>
    );
  }

  const variable = instrument.variables.find((v) => v.id === selectedId);
  if (variable) {
    return (
      <div className="inspector">
        <h2>Variable · {variable.name}</h2>
        <VariableEditor variable={variable} instrument={instrument} />
      </div>
    );
  }

  const node = findNode(instrument.sequence, selectedId);
  if (!node) return <p className="hint pad">Selection not found.</p>;

  const qNum = node.type === 'question' ? buildQNumMap(instrument.sequence).get(node.id) : undefined;

  return (
    <div className="inspector">
      <h2>
        {qNum != null && <span className="inspector__qnum">Q{qNum}</span>}
        {node.type} · <code>{node.id}</code>
      </h2>
      <ConstructEditor node={node} instrument={instrument} />
    </div>
  );
}
