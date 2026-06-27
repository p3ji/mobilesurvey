/**
 * Full-screen respondent-facing survey app.
 * Shown when the designer's "Render" button is clicked.
 * Uses a fresh XState machine instance — no state shared with the preview pane.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  flattenInstrument,
  runtimeMachine,
  pick,
  type FiredEdit,
  type RenderItem,
} from '@mobilesurvey/runtime-engine';
import type {
  CategoryScheme,
  Instrument,
  LanguageCode,
  ResponseDomain,
} from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { MOCK_SAMPLE } from '../integrations/mocks.js';

// ─── utilities ────────────────────────────────────────────────────────────────

function groupIntoPages(items: RenderItem[]): { pages: RenderItem[][]; hasPaging: boolean } {
  const pages: RenderItem[][] = [];
  let current: RenderItem[] = [];
  let hasPaging = false;
  for (const item of items) {
    if (item.kind === 'pageBreak') {
      hasPaging = true;
      if (current.length > 0) pages.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);
  return { pages, hasPaging };
}

function pageHasHardEdits(pageItems: RenderItem[]): boolean {
  return pageItems.some(
    (item) => item.kind === 'question' && item.firedEdits.some((e) => e.type === 'hard'),
  );
}

function schemeCategories(schemes: CategoryScheme[], ref: string) {
  return schemes.find((s) => s.id === ref)?.categories ?? [];
}

function lbl(intl: Record<string, string> | undefined, lang: string): string {
  if (!intl) return '';
  return intl[lang] ?? Object.values(intl)[0] ?? '';
}

// ─── sub-components ───────────────────────────────────────────────────────────

function EditList({ edits }: { edits: FiredEdit[] }) {
  if (!edits.length) return null;
  return (
    <ul className="pv-edits">
      {edits.map((e) => (
        <li
          key={e.id}
          className={`pv-edit pv-edit--${e.type}`}
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
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
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
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
      const listId = `${inputId}-list`;
      return (
        <>
          <input
            id={inputId}
            list={listId}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={lang === 'fr' ? 'Rechercher…' : 'Search…'}
          />
          <datalist id={listId}>
            {opts.map((c) => (
              <option key={c.code} value={lbl(c.label, lang)} />
            ))}
          </datalist>
        </>
      );
    }
    case 'code': {
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
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
                      e.target.checked ? [...arr, c.code] : arr.filter((x) => x !== c.code),
                    )
                  }
                />
                {lbl(c.label, lang)}
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
              {lbl(c.label, lang)}
            </label>
          ))}
        </div>
      );
    }
  }
}

// ─── completion screen ────────────────────────────────────────────────────────

function CompletionScreen({
  responses,
  onReset,
  onExit,
}: {
  responses: Record<string, unknown>;
  onReset: () => void;
  onExit: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const filled = Object.fromEntries(
    Object.entries(responses).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const json = JSON.stringify(filled, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rapp">
      <div className="rapp__complete">
        <div className="rapp__complete-icon" aria-hidden="true">✓</div>
        <h2 className="rapp__complete-title">Survey submitted</h2>
        <p className="rapp__complete-sub">
          Responses collected in this session, in data-schema form.
        </p>

        <div className="rapp__resp-header">
          <strong>Response data</strong>
          <button type="button" onClick={handleCopy}>
            {copied ? '✓ Copied' : '⎘ Copy JSON'}
          </button>
        </div>
        <pre className="rapp__responses">{json}</pre>

        <div className="rapp__complete-actions">
          <button type="button" onClick={onReset}>
            ↺ Take survey again
          </button>
          <button type="button" onClick={onExit} className="rapp__exit-btn">
            ← Back to designer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function RespondentApp({ onExit }: { onExit: () => void }) {
  const instrument = useDesigner((s) => s.instrument);
  const designerLang = useDesigner((s) => s.language);

  const [lang, setLang] = useState<LanguageCode>(designerLang);
  const [currentPage, setCurrentPage] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const [snapshot, send] = useMachine(runtimeMachine, {
    input: { instrument, sample: MOCK_SAMPLE.fields, language: lang },
  });

  // Keep machine language in sync.
  useEffect(() => {
    send({ type: 'SET_LANGUAGE', language: lang });
  }, [lang, send]);

  const result = useMemo(
    () => flattenInstrument(instrument, snapshot.context.state),
    [instrument, snapshot.context.state],
  );

  const { pages } = useMemo(() => groupIntoPages(result.items), [result.items]);

  // Clamp currentPage when visible pages change (e.g. conditional pages appear/disappear).
  useEffect(() => {
    if (currentPage >= pages.length) setCurrentPage(Math.max(0, pages.length - 1));
  }, [pages.length, currentPage]);

  const pageItems = pages[currentPage] ?? [];
  const isLastPage = currentPage >= pages.length - 1;
  const blocked = pageHasHardEdits(pageItems);

  const scrollTop = () => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const handleNext = () => {
    if (blocked) return;
    if (isLastPage) {
      send({ type: 'COMPLETE' });
    } else {
      setCurrentPage((p) => p + 1);
      scrollTop();
    }
  };

  const handleBack = () => {
    setCurrentPage((p) => Math.max(0, p - 1));
    scrollTop();
  };

  const handleReset = () => {
    send({ type: 'RESET' });
    setCurrentPage(0);
  };

  // Completion screen
  if (snapshot.value === 'complete') {
    return (
      <CompletionScreen
        responses={snapshot.context.state.responses}
        onReset={handleReset}
        onExit={onExit}
      />
    );
  }

  const progress = pages.length > 1 ? ((currentPage + 1) / pages.length) * 100 : 100;
  const titleIntl = instrument.metadata.title;
  const title = pick(titleIntl, lang);

  return (
    <div className="rapp">
      {/* ── Header ── */}
      <header className="rapp__header">
        <button type="button" className="rapp__back-link" onClick={onExit} aria-label="Exit to designer">
          ← Designer
        </button>
        <span className="rapp__title">{title}</span>
        <div className="rapp__lang">
          {instrument.languages.map((l) => (
            <button
              key={l}
              type="button"
              className={l === lang ? 'pill pill--active' : 'pill'}
              aria-pressed={l === lang}
              onClick={() => setLang(l as LanguageCode)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* ── Progress bar ── */}
      <div className="rapp__progress-track" role="progressbar" aria-valuenow={currentPage + 1} aria-valuemax={pages.length}>
        <div className="rapp__progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="rapp__page-label">
        {lang === 'fr' ? 'Page' : 'Page'} {currentPage + 1} / {pages.length}
      </div>

      {/* ── Content ── */}
      <div className="rapp__content" ref={contentRef}>
        <form onSubmit={(e) => e.preventDefault()}>
          {pageItems.map((item) => {
            if (item.kind === 'pageBreak') {
              return item.title ? (
                <h2 key={item.key} className="rapp__page-heading">{item.title}</h2>
              ) : null;
            }

            if (item.kind === 'section') {
              return (
                <h3 key={item.key} className="rapp__section-heading">
                  {item.title}
                </h3>
              );
            }

            if (item.kind === 'loopHeading') {
              return (
                <div key={item.key} className="rapp__loop-heading">
                  {item.title}
                </div>
              );
            }

            if (item.kind === 'statement') {
              return (
                <div key={item.key} className="rapp__statement">
                  {item.text}
                </div>
              );
            }

            // markAll — dichotomous checkboxes, one variable per category.
            if (item.kind === 'markAll') {
              return (
                <div key={item.key} className="rapp__question">
                  <p className="rapp__q-text">{item.questionText}</p>
                  {item.instruction && (
                    <p className="pv-instruction">{item.instruction}</p>
                  )}
                  <div className="pv-radios" role="group" aria-label={item.questionText}>
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
                      </label>
                    ))}
                  </div>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            // Grid (matrix) question.
            if (item.kind === 'grid') {
              return (
                <div key={item.key} className="rapp__question">
                  <p className="rapp__q-text">{item.questionText}</p>
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
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            // Regular question.
            const inputId = `rapp-ctrl-${item.key}`;
            const isGroupDomain =
              item.construct.responseDomain.type === 'code' ||
              item.construct.responseDomain.type === 'boolean';

            return (
              <div key={item.key} className="rapp__question">
                <label
                  id={inputId}
                  className="rapp__q-text"
                  htmlFor={isGroupDomain ? undefined : inputId}
                >
                  {item.text}
                  {item.construct.required && (
                    <span aria-hidden="true" className="pv-req"> *</span>
                  )}
                </label>
                {item.instruction && (
                  <p className="pv-instruction">{item.instruction}</p>
                )}
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
                  lang={lang}
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

      {/* ── Navigation ── */}
      <footer className="rapp__nav">
        <button
          type="button"
          className="rapp__nav-back"
          disabled={currentPage === 0}
          onClick={handleBack}
        >
          ← {lang === 'fr' ? 'Retour' : 'Back'}
        </button>

        {blocked && (
          <span className="rapp__nav-hint">
            {lang === 'fr' ? 'Corrigez les erreurs pour continuer' : 'Fix errors to continue'}
          </span>
        )}

        <button
          type="button"
          className={isLastPage ? 'rapp__nav-submit' : 'rapp__nav-next'}
          disabled={blocked}
          onClick={handleNext}
        >
          {isLastPage
            ? (lang === 'fr' ? 'Soumettre ✓' : 'Submit ✓')
            : (lang === 'fr' ? 'Suivant →' : 'Next →')}
        </button>
      </footer>
    </div>
  );
}
