/**
 * Mobile-framed runtime preview. Features:
 * - Question index panel: click any Q to jump to it (navigates page if needed).
 * - Page navigation: Previous / Next when the instrument has `isPage` sequences.
 * - markAll: renders dichotomous checkboxes, each storing to its own variable key.
 * - All existing question types, edits, piping, language toggle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  collectEdits,
  flattenInstrument,
  runtimeMachine,
  type FiredEdit,
  type RenderItem,
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
        <li
          key={e.id}
          className={e.type === 'hard' ? 'pv-edit pv-edit--hard' : 'pv-edit pv-edit--soft'}
          role={e.type === 'hard' ? 'alert' : 'status'}
        >
          {e.type === 'hard' ? '⛔ ' : '⚠ '}
          {e.message}
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

/** Split a flat item list into pages at `pageBreak` markers. */
function groupIntoPages(items: RenderItem[]): { pages: RenderItem[][]; hasPaging: boolean } {
  const pages: RenderItem[][] = [];
  let current: RenderItem[] = [];
  let hasPaging = false;

  for (const item of items) {
    if (item.kind === 'pageBreak') {
      hasPaging = true;
      if (current.length > 0) pages.push(current);
      current = [item]; // pageBreak becomes the header of its page
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);

  return { pages, hasPaging };
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

  const { pages, hasPaging } = useMemo(() => groupIntoPages(result.items), [result.items]);
  const totals = collectEdits(result);

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

  // Build flat question index across ALL pages.
  const questionIndex = useMemo(() => {
    // Map each item key → page index.
    const pageOf = new Map<string, number>();
    pages.forEach((pg, pi) => pg.forEach((item) => pageOf.set(item.key, pi)));

    let n = 0;
    const out: Array<{
      num: number;
      key: string;
      varRef: string;
      label: string;
      pageIdx: number;
    }> = [];

    for (const item of result.items) {
      if (item.kind === 'question') {
        n++;
        out.push({
          num: n,
          key: item.key,
          varRef: item.construct.variableRef,
          label: item.text,
          pageIdx: pageOf.get(item.key) ?? 0,
        });
      } else if (item.kind === 'markAll') {
        n++;
        out.push({
          num: n,
          key: item.key,
          varRef: item.variablePrefix + '_*',
          label: item.questionText,
          pageIdx: pageOf.get(item.key) ?? 0,
        });
      } else if (item.kind === 'grid') {
        n++;
        out.push({
          num: n,
          key: item.key,
          varRef: item.variablePrefix + '_*',
          label: item.questionText,
          pageIdx: pageOf.get(item.key) ?? 0,
        });
      }
    }
    return out;
  }, [result.items, pages]);

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
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">{item.questionText}</p>
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
              return (
                <div
                  key={item.key}
                  id={`pv-q-${item.key}`}
                  className="pv-question"
                  style={{ marginInlineStart: item.depth * 8 }}
                >
                  <p className="pv-label">{item.questionText}</p>
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

            // Regular question.
            const inputId = `pv-ctrl-${item.key}`;
            const isGroupDomain =
              item.construct.responseDomain.type === 'code' ||
              item.construct.responseDomain.type === 'boolean';
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
