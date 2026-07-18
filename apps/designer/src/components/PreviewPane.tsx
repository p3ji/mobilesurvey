/**
 * Mobile-framed runtime preview. Features:
 * - Question index panel: click any Q to jump to it (navigates page if needed).
 * - Page navigation: Previous / Next when the instrument has `isPage` sequences. Deliberately
 *   NOT gated on hard edits — an author previewing should be able to click through freely to see
 *   later pages, unlike the respondent runtime (which blocks forward navigation on hard edits).
 * - markAll: renders dichotomous checkboxes, each storing to its own variable key.
 * - All existing question types, edits, piping, language toggle.
 *
 * Pagination and question numbering are shared with the respondent runtime and the designer's
 * render mode (`@mobilesurvey/runtime-engine`'s `paginate`/`numberQuestions`) so page-splitting and
 * numbering can never drift between the three. The visual rendering below stays local: this preview
 * is deliberately compact for its 380px mobile device mockup, unlike the full-page runtime/render
 * views, so it keeps its own `pv-*` styling rather than sharing `@mobilesurvey/respondent-view`'s
 * `eq__*` components (which are sized for a full-page respondent experience).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  collectEdits,
  flattenInstrument,
  numberQuestions,
  paginate,
  runtimeMachine,
  type FiredEdit,
} from '@mobilesurvey/runtime-engine';
import type { CategoryScheme, Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { MOCK_SAMPLE } from '../integrations/mocks.js';

function categories(schemes: CategoryScheme[], ref: string) {
  return schemes.find((s) => s.id === ref)?.categories ?? [];
}

function label(intl: Record<string, string> | undefined, lang: string): string {
  if (!intl) return '';
  return intl[lang] ?? Object.values(intl)[0] ?? '';
}

function EditList({ edits }: { edits: FiredEdit[] }) {
  if (edits.length === 0) return null;
  return (
    <ul className="pv-edits">
      {edits.map((e) => (
        // role lives on a nested span, not the <li>, so the <li>'s implicit `listitem` role stays
        // intact (an explicit role on <li> breaks the <ul>'s list semantics for assistive tech).
        <li key={e.id} className={e.type === 'hard' ? 'pv-edit pv-edit--hard' : 'pv-edit pv-edit--soft'}>
          <span role={e.type === 'hard' ? 'alert' : 'status'}>
            {e.type === 'hard' ? '⛔ ' : '⚠ '}
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Control({
  domain,
  inputId,
  value,
  instrument,
  lang,
  onChange,
}: {
  domain: Exclude<ResponseDomain, { type: 'markAll' }>;
  inputId: string;
  value: unknown;
  instrument: Instrument;
  lang: string;
  onChange: (v: unknown) => void;
}) {
  switch (domain.type) {
    case 'numeric':
      return (
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? '' : String(value)}
          min={domain.min}
          max={domain.max}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      );
    case 'text':
      return domain.multiline ? (
        <textarea
          id={inputId}
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          maxLength={domain.maxLength}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <div className="pv-radios" role="radiogroup" aria-labelledby={inputId}>
          {[
            { v: true,  l: lang === 'fr' ? 'Oui' : 'Yes' },
            { v: false, l: lang === 'fr' ? 'Non' : 'No' },
          ].map((opt) => (
            <label key={String(opt.v)} className="pv-radio">
              <input
                type="radio"
                name={inputId}
                checked={value === opt.v}
                onChange={() => onChange(opt.v)}
              />
              {opt.l}
            </label>
          ))}
        </div>
      );
    case 'datetime':
      return (
        <input
          id={inputId}
          type={domain.mode === 'datetime' ? 'datetime-local' : domain.mode}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'file':
      return (
        <input
          id={inputId}
          type="file"
          accept={domain.accept?.join(',')}
          onChange={() => onChange('(file selected)')}
        />
      );
    case 'lookup': {
      const opts = categories(instrument.categorySchemes, domain.categorySchemeRef);
      const listId = `${inputId}-list`;
      return (
        <>
          <input
            id={inputId}
            list={listId}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search…"
          />
          <datalist id={listId}>
            {opts.map((c) => (
              <option key={c.code} value={label(c.label, lang)} />
            ))}
          </datalist>
        </>
      );
    }
    case 'code': {
      const opts = categories(instrument.categorySchemes, domain.categorySchemeRef);
      if (domain.selection === 'multiple') {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="pv-radios" role="group" aria-labelledby={inputId}>
            {opts.map((c) => (
              <label key={c.code} className="pv-radio">
                <input
                  type="checkbox"
                  checked={arr.includes(c.code)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...arr, c.code]
                        : arr.filter((x) => x !== c.code),
                    )
                  }
                />
                {label(c.label, lang)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <div className="pv-radios" role="radiogroup" aria-labelledby={inputId}>
          {opts.map((c) => (
            <label key={c.code} className="pv-radio">
              <input
                type="radio"
                name={inputId}
                checked={value === c.code}
                onChange={() => onChange(c.code)}
              />
              {label(c.label, lang)}
            </label>
          ))}
        </div>
      );
    }
  }
}

export function PreviewPane() {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);

  const [snapshot, send] = useMachine(runtimeMachine, {
    input: { instrument, sample: MOCK_SAMPLE.fields, language },
  });

  const [currentPage, setCurrentPage] = useState(0);
  const [indexOpen, setIndexOpen] = useState(false);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  useEffect(() => {
    send({ type: 'SET_LANGUAGE', language });
  }, [language, send]);

  const result = useMemo(
    () => flattenInstrument(instrument, snapshot.context.state),
    [instrument, snapshot.context.state],
  );

  const { pages, hasPaging } = useMemo(() => paginate(result.items), [result.items]);
  const totals = collectEdits(result);
  const qNumMap = useMemo(() => numberQuestions(pages), [pages]);

  // Clamp currentPage when page count shrinks.
  useEffect(() => {
    if (currentPage >= pages.length) setCurrentPage(Math.max(0, pages.length - 1));
  }, [pages.length, currentPage]);

  // Scroll to a question after a page change has rendered.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.getElementById(`pv-q-${pendingScroll}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingScroll(null);
    }
  }, [pendingScroll, currentPage]);

  // Build flat question index across ALL pages (uses the shared numbering, so it can never
  // disagree with the numbers shown next to each question below).
  const questionIndex = useMemo(() => {
    const pageOf = new Map<string, number>();
    pages.forEach((pg, pi) => pg.forEach((item) => pageOf.set(item.key, pi)));

    const out: Array<{
      num: number;
      key: string;
      varRef: string;
      label: string;
      pageIdx: number;
    }> = [];

    for (const item of result.items) {
      const num = qNumMap.get(item.key);
      if (num == null) continue;
      if (item.kind === 'question') {
        out.push({ num, key: item.key, varRef: item.construct.variableRef, label: item.text, pageIdx: pageOf.get(item.key) ?? 0 });
      } else if (item.kind === 'markAll' || item.kind === 'grid') {
        out.push({ num, key: item.key, varRef: item.variablePrefix + '_*', label: item.questionText, pageIdx: pageOf.get(item.key) ?? 0 });
      } else if (item.kind === 'table') {
        out.push({ num, key: item.key, varRef: item.variablePrefix + '_*_*', label: item.questionText, pageIdx: pageOf.get(item.key) ?? 0 });
      } else if (item.kind === 'geolocation' || item.kind === 'photo') {
        out.push({ num, key: item.key, varRef: item.instanceKey, label: item.questionText, pageIdx: pageOf.get(item.key) ?? 0 });
      }
    }
    return out;
  }, [result.items, pages, qNumMap]);

  const jumpTo = (key: string, pageIdx: number) => {
    setIndexOpen(false);
    if (pageIdx !== currentPage) {
      setCurrentPage(pageIdx);
      setPendingScroll(key);
    } else {
      document.getElementById(`pv-q-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const pageItems = pages[currentPage] ?? [];

  return (
    <div className="preview">
      {/* Top bar */}
      <div className="preview__bar">
        <button
          type="button"
          className={indexOpen ? 'pill pill--active' : 'pill'}
          aria-expanded={indexOpen}
          onClick={() => setIndexOpen((o) => !o)}
        >
          ≡ {questionIndex.length}Q
        </button>
        <span>
          {totals.hard > 0 && <span style={{ color: 'var(--danger)' }}>{totals.hard} hard · </span>}
          {totals.soft > 0 && <span style={{ color: 'var(--warn)' }}>{totals.soft} soft</span>}
          {totals.hard === 0 && totals.soft === 0 && <span style={{ color: 'var(--ok)' }}>✓ No edits</span>}
        </span>
        <button type="button" onClick={() => send({ type: 'RESET' })}>
          ↺ Reset
        </button>
      </div>

      {/* Question index panel */}
      {indexOpen && (
        <div className="pv-index" role="navigation" aria-label="Question index">
          <ol className="pv-index__list">
            {questionIndex.length === 0 && (
              <li className="pv-index__empty">No questions yet.</li>
            )}
            {questionIndex.map((q) => (
              <li key={q.key}>
                <button
                  type="button"
                  className="pv-index__item"
                  onClick={() => jumpTo(q.key, q.pageIdx)}
                >
                  <span className="pv-index__num">Q{q.num}</span>
                  <span className="pv-index__var">{q.varRef}</span>
                  <span className="pv-index__text">{q.label}</span>
                  {hasPaging && (
                    <span className="pv-index__page">p.{q.pageIdx + 1}</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Page navigation */}
      {hasPaging && (
        <div className="pv-page-nav" role="navigation" aria-label="Page navigation">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span>
            Page {currentPage + 1} / {pages.length}
          </span>
          <button
            type="button"
            disabled={currentPage >= pages.length - 1}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {/* Mobile device frame */}
      <div className="device" aria-label="Mobile preview">
        <form className="device__screen" onSubmit={(e) => e.preventDefault()}>
          {pageItems.map((item) => {
            if (item.kind === 'pageBreak') {
              return (
                <div key={item.key} className="pv-page-heading">
                  {item.title && <h2 className="pv-section">{item.title}</h2>}
                </div>
              );
            }
            if (item.kind === 'section') {
              return (
                <h2 key={item.key} className="pv-section">
                  {item.title}
                </h2>
              );
            }
            if (item.kind === 'loopHeading') {
              return (
                <h3
                  key={item.key}
                  className="pv-loop"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  {item.title}
                </h3>
              );
            }
            if (item.kind === 'statement') {
              return (
                <p key={item.key} className="pv-statement">
                  {item.text}
                </p>
              );
            }

            // markAll — dichotomous checkboxes, one variable per category.
            if (item.kind === 'markAll') {
              const markAllNum = qNumMap.get(item.key);
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">
                    {markAllNum != null && <span className="pv-q-num">Q{markAllNum}.</span>}
                    {item.questionText}
                  </p>
                  {item.instruction && (
                    <p className="pv-instruction">{item.instruction}</p>
                  )}
                  <p className="pv-markall-hint">Mark all that apply</p>
                  <div
                    className="pv-radios"
                    role="group"
                    aria-label={item.questionText}
                  >
                    {item.categories.map((cat) => (
                      <label key={cat.code} className="pv-radio">
                        <input
                          type="checkbox"
                          checked={cat.value === 1}
                          onChange={(e) =>
                            send({
                              type: 'ANSWER',
                              instanceKey: cat.instanceKey,
                              value: e.target.checked ? 1 : 2,
                            })
                          }
                        />
                        {cat.label}
                        {cat.value === 1 && (
                          <span className="pv-markall-code"> [1]</span>
                        )}
                        {cat.value === 2 && (
                          <span className="pv-markall-code pv-markall-code--no"> [2]</span>
                        )}
                      </label>
                    ))}
                  </div>
                  <p className="pv-markall-vars">
                    Variables:{' '}
                    {item.categories.map((c) => c.instanceKey.split('@')[0]).join(', ')}
                  </p>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            // Grid (matrix) question.
            if (item.kind === 'grid') {
              const gridNum = qNumMap.get(item.key);
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">
                    {gridNum != null && <span className="pv-q-num">Q{gridNum}.</span>}
                    {item.questionText}
                  </p>
                  {item.instruction && <p className="pv-instruction">{item.instruction}</p>}
                  <div className="pv-grid-wrapper">
                    <table className="pv-grid">
                      <thead>
                        <tr>
                          <th className="pv-grid__corner" />
                          {item.columns.map((col) => (
                            <th key={col.code} className="pv-grid__col-hdr">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.rows.map((row) => (
                          <tr key={row.code} className="pv-grid__row">
                            <td className="pv-grid__row-lbl">{row.label}</td>
                            {item.columns.map((col) => (
                              <td key={col.code} className="pv-grid__cell">
                                <input
                                  type="radio"
                                  name={`${item.key}-${row.code}`}
                                  checked={row.value === col.code}
                                  onChange={() =>
                                    send({ type: 'ANSWER', instanceKey: row.instanceKey, value: col.code })
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="pv-markall-vars">
                    Variables: {item.rows.map((r) => r.instanceKey.split('@')[0]).join(', ')}
                  </p>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            if (item.kind === 'table') {
              const tblNum = qNumMap.get(item.key);
              const decimals = item.decimals ?? 0;
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">
                    {tblNum != null && <span className="pv-q-num">Q{tblNum}.</span>}
                    {item.questionText}
                  </p>
                  {item.instruction && <p className="pv-instruction">{item.instruction}</p>}
                  {item.unit && <p className="pv-table-unit">{item.unit}</p>}
                  <div className="pv-grid-wrapper">
                    <table className="pv-grid pv-table">
                      <thead>
                        <tr>
                          <th className="pv-grid__corner" />
                          {item.columns.map((col) => (
                            <th key={col.code} className="pv-grid__col-hdr">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.rows.map((row, rowIdx) => (
                          <tr key={row.code} className="pv-grid__row">
                            <td className={row.isTotal ? 'pv-grid__row-lbl pv-table__lbl--total' : 'pv-grid__row-lbl'}>
                              {row.label}
                            </td>
                            {item.columns.map((col, colIdx) => {
                              const cell = item.cells[rowIdx]?.[colIdx];
                              if (!cell) return <td key={col.code} />;
                              if (cell.computed) {
                                return (
                                  <td key={col.code} className="pv-grid__cell pv-table__cell--computed">
                                    {cell.value !== undefined ? cell.value.toFixed(decimals) : ''}
                                  </td>
                                );
                              }
                              if (cell.disabled) {
                                return (
                                  <td key={col.code} className="pv-grid__cell pv-table__cell--disabled">—</td>
                                );
                              }
                              return (
                                <td key={col.code} className="pv-grid__cell">
                                  <input
                                    type="number"
                                    className="pv-table__input"
                                    aria-label={`${row.label}, ${col.label}`}
                                    value={cell.value ?? ''}
                                    onChange={(e) =>
                                      send({
                                        type: 'ANSWER',
                                        instanceKey: cell.instanceKey,
                                        value: e.target.value === '' ? undefined : Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="pv-markall-vars">Variables: {item.variablePrefix}_row_col (+ _TOT totals)</p>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            if (item.kind === 'geolocation') {
              const geoNum = qNumMap.get(item.key);
              // Device-frame mock: same consent → capture flow as the runtime, but the
              // "fix" is a fixed Ottawa coordinate (no real sensor in the preview).
              const mockCapture = () => {
                const f = 10 ** item.precision;
                const lat = Math.round(45.42153 * f) / f;
                const lon = Math.round(-75.697193 * f) / f;
                send({ type: 'ANSWER', instanceKey: item.subKeys.lat, value: lat });
                send({ type: 'ANSWER', instanceKey: item.subKeys.lon, value: lon });
                send({ type: 'ANSWER', instanceKey: item.subKeys.acc, value: 12 });
                send({ type: 'ANSWER', instanceKey: item.subKeys.ts, value: new Date().toISOString() });
                send({ type: 'ANSWER', instanceKey: item.subKeys.src, value: 'gps' });
                send({ type: 'ANSWER', instanceKey: item.instanceKey, value: `${lat}, ${lon} (±12 m)` });
              };
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">
                    {geoNum != null && <span className="pv-q-num">Q{geoNum}.</span>}
                    {item.questionText}
                    {item.required ? <span aria-hidden="true" className="pv-req"> *</span> : null}
                  </p>
                  {item.instruction && <p className="pv-instruction">{item.instruction}</p>}
                  {item.purpose === '' ? (
                    <p className="pv-instruction">⚠ No location declaration in Sensors &amp; consent.</p>
                  ) : item.consent === undefined ? (
                    <div className="pv-consent">
                      <p className="pv-instruction">📍 {item.purpose}</p>
                      <div className="pv-consent-actions">
                        <button type="button" onClick={() => send({ type: 'ANSWER', instanceKey: item.consentKey, value: 'granted' })}>
                          Allow
                        </button>
                        <button type="button" onClick={() => send({ type: 'ANSWER', instanceKey: item.consentKey, value: 'declined' })}>
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : item.consent === 'granted' ? (
                    <div className="pv-consent">
                      <button type="button" onClick={mockCapture}>
                        {item.src === 'gps' ? '↺ Update location (mock)' : '📍 Use my location (mock)'}
                      </button>
                      {item.src === 'gps' && item.value && <p className="pv-instruction">✓ {item.value}</p>}
                    </div>
                  ) : (
                    <div className="pv-consent">
                      <p className="pv-instruction">Location declined.</p>
                      {item.manualFallback && (
                        <input
                          type="text"
                          placeholder="Describe your location…"
                          value={item.src !== 'gps' ? (item.value ?? '') : ''}
                          onChange={(e) => {
                            send({ type: 'ANSWER', instanceKey: item.instanceKey, value: e.target.value });
                            send({ type: 'ANSWER', instanceKey: item.subKeys.src, value: 'declined' });
                          }}
                        />
                      )}
                    </div>
                  )}
                  <p className="pv-markall-vars">
                    Variables: {'{'}base{'}'} + _LAT _LON _ACC _TS _SRC · consent → CONSENT_GEOLOCATION
                  </p>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            if (item.kind === 'photo') {
              const phNum = qNumMap.get(item.key);
              const mockCapture = () => {
                send({ type: 'ANSWER', instanceKey: item.instanceKey, value: `mock/${item.constructId}.jpg` });
                send({ type: 'ANSWER', instanceKey: item.subKeys.ts, value: new Date().toISOString() });
                send({ type: 'ANSWER', instanceKey: item.subKeys.src, value: 'camera' });
              };
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">
                    {phNum != null && <span className="pv-q-num">Q{phNum}.</span>}
                    {item.questionText}
                    {item.required ? <span aria-hidden="true" className="pv-req"> *</span> : null}
                  </p>
                  {item.instruction && <p className="pv-instruction">{item.instruction}</p>}
                  {item.purpose === '' ? (
                    <p className="pv-instruction">⚠ No camera declaration in Sensors &amp; consent.</p>
                  ) : item.consent === undefined ? (
                    <div className="pv-consent">
                      <p className="pv-instruction">📷 {item.purpose}</p>
                      <div className="pv-consent-actions">
                        <button type="button" onClick={() => send({ type: 'ANSWER', instanceKey: item.consentKey, value: 'granted' })}>
                          Allow
                        </button>
                        <button type="button" onClick={() => send({ type: 'ANSWER', instanceKey: item.consentKey, value: 'declined' })}>
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : item.consent === 'granted' ? (
                    <div className="pv-consent">
                      <button type="button" onClick={mockCapture}>
                        {item.value ? '↺ Retake photo (mock)' : '📷 Take a photo (mock)'}
                      </button>
                      {item.value && <p className="pv-instruction">✓ {item.value}</p>}
                    </div>
                  ) : (
                    <div className="pv-consent">
                      <p className="pv-instruction">Camera declined — question can be skipped.</p>
                    </div>
                  )}
                  <p className="pv-markall-vars">
                    Variables: {'{'}base{'}'} = attachment ref + _TS _SRC · consent → CONSENT_CAMERA
                  </p>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            // Regular question.
            const inputId = `pv-ctrl-${item.key}`;
            const isGroupDomain =
              item.construct.responseDomain.type === 'code' ||
              item.construct.responseDomain.type === 'boolean';
            const qNum = qNumMap.get(item.key);
            return (
              <div
                key={item.key}
                id={`pv-q-${item.key}`}
                className="pv-question"
                style={{ marginInlineStart: item.depth * 8 }}
              >
                <label
                  id={inputId}
                  className="pv-label"
                  htmlFor={isGroupDomain ? undefined : inputId}
                >
                  {qNum != null && <span className="pv-q-num">Q{qNum}.</span>}
                  {item.text}
                  {item.construct.required ? (
                    <span aria-hidden="true" className="pv-req">
                      {' '}
                      *
                    </span>
                  ) : null}
                </label>
                {item.instruction ? (
                  <p className="pv-instruction">{item.instruction}</p>
                ) : null}
                <Control
                  domain={
                    item.construct.responseDomain as Exclude<
                      typeof item.construct.responseDomain,
                      { type: 'markAll' }
                    >
                  }
                  inputId={inputId}
                  value={item.value}
                  instrument={instrument}
                  lang={language}
                  onChange={(v) =>
                    send({ type: 'ANSWER', instanceKey: item.instanceKey, value: v })
                  }
                />
                <EditList edits={item.firedEdits} />
              </div>
            );
          })}
        </form>
      </div>
    </div>
  );
}
