/**
 * Page-by-page questionnaire runner. Drives the runtime-engine XState machine, paginates the
 * flattened instrument, gates forward navigation on hard edits, persists progress for resume, and
 * emits paradata on navigation and submission.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  flattenInstrument,
  pageHasHardEdits,
  paginate,
  pick,
  runtimeMachine,
  type FiredEdit,
  type ParadataSink,
  type RuntimeState,
  type SampleUnit,
} from '@mobilesurvey/runtime-engine';
import type {
  CategoryScheme,
  Instrument,
  LanguageCode,
  ResponseDomain,
} from '@mobilesurvey/instrument-schema';

// ── helpers ──────────────────────────────────────────────────────────────────

function schemeCategories(schemes: CategoryScheme[], ref: string) {
  return schemes.find((s) => s.id === ref)?.categories ?? [];
}

function lbl(intl: Record<string, string> | undefined, lang: string): string {
  if (!intl) return '';
  return intl[lang] ?? Object.values(intl)[0] ?? '';
}

function EditList({ edits }: { edits: FiredEdit[] }) {
  if (!edits.length) return null;
  return (
    <ul className="eq__edits">
      {edits.map((e) => (
        <li
          key={e.id}
          className={`eq__edit eq__edit--${e.type}`}
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
        <div className="eq__radios" role="radiogroup" aria-labelledby={inputId}>
          {[
            { v: true, l: lang === 'fr' ? 'Oui' : 'Yes' },
            { v: false, l: lang === 'fr' ? 'Non' : 'No' },
          ].map((opt) => (
            <label key={String(opt.v)} className="eq__radio">
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
          <div className="eq__radios" role="group" aria-labelledby={inputId}>
            {opts.map((c) => (
              <label key={c.code} className="eq__radio">
                <input
                  type="checkbox"
                  checked={arr.includes(c.code)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...arr, c.code] : arr.filter((x) => x !== c.code))
                  }
                />
                {lbl(c.label, lang)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <div className="eq__radios" role="radiogroup" aria-labelledby={inputId}>
          {opts.map((c) => (
            <label key={c.code} className="eq__radio">
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

// ── component ────────────────────────────────────────────────────────────────

export function SurveyRunner({
  instrument,
  caseId,
  sample,
  restore,
  initialPage,
  resumed,
  paradata,
  notice,
  onPersist,
  onSubmit,
}: {
  instrument: Instrument;
  caseId: string;
  sample: SampleUnit;
  restore?: RuntimeState;
  initialPage: number;
  resumed: boolean;
  paradata: ParadataSink;
  notice?: { kind: 'demo-no-save' | 'demo-saves'; text: string };
  onPersist: (state: RuntimeState, page: number) => void;
  onSubmit: (responses: Record<string, unknown>) => void;
}) {
  const [snapshot, send] = useMachine(runtimeMachine, {
    input: {
      instrument,
      sample: sample.fields,
      language: restore?.language ?? instrument.defaultLanguage,
      restore,
    },
  });

  const lang = snapshot.context.state.language;
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [showSaved, setShowSaved] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const result = useMemo(
    () => flattenInstrument(instrument, snapshot.context.state),
    [instrument, snapshot.context.state],
  );
  const { pages } = useMemo(() => paginate(result.items), [result.items]);

  // Clamp the page when conditional pages appear/disappear.
  useEffect(() => {
    if (currentPage >= pages.length) setCurrentPage(Math.max(0, pages.length - 1));
  }, [pages.length, currentPage]);

  // Count questions per page for global sequential numbering.
  const questionsPerPage = useMemo(
    () => pages.map((p) => p.filter((i) => i.kind === 'question' || i.kind === 'markAll' || i.kind === 'grid').length),
    [pages],
  );
  const totalQuestions = useMemo(
    () => questionsPerPage.reduce((a, b) => a + b, 0),
    [questionsPerPage],
  );
  const questionOffset = useMemo(
    () => questionsPerPage.slice(0, currentPage).reduce((a, b) => a + b, 0),
    [questionsPerPage, currentPage],
  );
  const pageItems = pages[currentPage] ?? [];

  // Attach a global question number to each question/markAll item on the current page.
  const numberedPageItems = useMemo(() => {
    let n = questionOffset;
    return pageItems.map((item) => ({
      item,
      qNum: (item.kind === 'question' || item.kind === 'markAll' || item.kind === 'grid') ? ++n : null,
    }));
  }, [pageItems, questionOffset]);

  // Persist progress on every change so a reload / drop-out can resume.
  useEffect(() => {
    onPersist(snapshot.context.state, currentPage);
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 1200);
    return () => clearTimeout(t);
  }, [snapshot.context.state, currentPage, onPersist]);
  const isLastPage = currentPage >= pages.length - 1;
  const blocked = pageHasHardEdits(pageItems);
  const progress = pages.length > 1 ? (currentPage / Math.max(pages.length - 1, 1)) * 100 : 100;

  const scrollTop = () => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const handleNext = () => {
    if (blocked) return;
    if (isLastPage) {
      paradata.emit({ ts: Date.now(), type: 'page_complete', payload: { page: currentPage } });
      onSubmit(snapshot.context.state.responses);
    } else {
      paradata.emit({ ts: Date.now(), type: 'page_next', payload: { from: currentPage } });
      setCurrentPage((p) => p + 1);
      scrollTop();
    }
  };

  const handleBack = () => {
    paradata.emit({ ts: Date.now(), type: 'page_back', payload: { from: currentPage } });
    setCurrentPage((p) => Math.max(0, p - 1));
    scrollTop();
  };

  const answer = (instanceKey: string, value: unknown) => {
    paradata.emit({ ts: Date.now(), type: 'answer', payload: { key: instanceKey } });
    send({ type: 'ANSWER', instanceKey, value });
  };

  return (
    <div className="eq">
      <header className="eq__header">
        <span className="eq__title">{pick(instrument.metadata.title, lang)}</span>
        {showSaved ? <span className="eq__saved">✓ Saved</span> : null}
        <span className="eq__case">{caseId}</span>
        <div className="eq__lang" role="group" aria-label="Language">
          {instrument.languages.map((l) => (
            <button
              key={l}
              type="button"
              className={l === lang ? 'pill pill--active' : 'pill'}
              aria-pressed={l === lang}
              onClick={() => send({ type: 'SET_LANGUAGE', language: l as LanguageCode })}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div
        className="eq__progress-track"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Survey progress: ${Math.round(progress)}%`}
      >
        <div className="eq__progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="eq__page-label">
        <span className="eq__page-label-left">
          {resumed && currentPage === initialPage ? 'Resumed · ' : ''}
          {lang === 'fr' ? 'Page' : 'Page'} {currentPage + 1}{' '}
          {lang === 'fr' ? 'de' : 'of'} {pages.length}
          {totalQuestions > 0 && (questionsPerPage[currentPage] ?? 0) > 0 && (
            <> · Q{questionOffset + 1}–{Math.min(questionOffset + questionsPerPage[currentPage]!, totalQuestions)} of {totalQuestions}</>
          )}
        </span>
        <span className="eq__page-label-pct">{Math.round(progress)}%</span>
      </div>

      {notice && (
        <div className={`eq__notice eq__notice--${notice.kind}`} role="note">
          {notice.kind === 'demo-no-save' ? '⚠ ' : 'ℹ '}
          {notice.text}
        </div>
      )}

      <div className="eq__content" ref={contentRef}>
        <form onSubmit={(e) => e.preventDefault()}>
          {numberedPageItems.map(({ item, qNum }) => {
            if (item.kind === 'pageBreak') {
              return item.title ? (
                <h2 key={item.key} className="eq__page-heading">
                  {item.title}
                </h2>
              ) : null;
            }
            if (item.kind === 'section') {
              return (
                <h3 key={item.key} className="eq__section-heading">
                  {item.title}
                </h3>
              );
            }
            if (item.kind === 'loopHeading') {
              return (
                <div key={item.key} className="eq__loop-heading">
                  {item.title}
                </div>
              );
            }
            if (item.kind === 'statement') {
              return (
                <div key={item.key} className="eq__statement">
                  {item.text}
                </div>
              );
            }
            if (item.kind === 'markAll') {
              return (
                <div key={item.key} className="eq__question">
                  <p className="eq__q-text">
                    {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
                    {item.questionText}
                  </p>
                  {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
                  <div className="eq__radios" role="group" aria-label={item.questionText}>
                    {item.categories.map((cat) => (
                      <label key={cat.code} className="eq__radio">
                        <input
                          type="checkbox"
                          checked={cat.value === 1}
                          onChange={(e) => answer(cat.instanceKey, e.target.checked ? 1 : 2)}
                        />
                        {cat.label}
                      </label>
                    ))}
                  </div>
                  <EditList edits={item.firedEdits} />
                </div>
              );
            }

            if (item.kind === 'grid') {
              return (
                <div key={item.key} className="eq__question">
                  <p className="eq__q-text">
                    {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
                    {item.questionText}
                  </p>
                  {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
                  <div className="eq__grid-wrapper">
                    <table className="eq__grid">
                      <thead>
                        <tr>
                          <th className="eq__grid__corner" />
                          {item.columns.map((col) => (
                            <th key={col.code} className="eq__grid__col-hdr">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.rows.map((row) => (
                          <tr key={row.code} className="eq__grid__row">
                            <td className="eq__grid__row-lbl">{row.label}</td>
                            {item.columns.map((col) => (
                              <td key={col.code} className="eq__grid__cell">
                                <input
                                  type="radio"
                                  name={`${item.key}-${row.code}`}
                                  checked={row.value === col.code}
                                  onChange={() => answer(row.instanceKey, col.code)}
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

            const inputId = `eq-ctrl-${item.key}`;
            const isGroupDomain =
              item.construct.responseDomain.type === 'code' ||
              item.construct.responseDomain.type === 'boolean';
            return (
              <div key={item.key} className="eq__question">
                <label
                  id={inputId}
                  className="eq__q-text"
                  htmlFor={isGroupDomain ? undefined : inputId}
                >
                  {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
                  {item.text}
                  {item.construct.required && (
                    <span aria-hidden="true" className="eq__req">
                      {' '}
                      *
                    </span>
                  )}
                </label>
                {item.instruction && <p className="eq__instruction">{item.instruction}</p>}
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
                  onChange={(v) => answer(item.instanceKey, v)}
                />
                <EditList edits={item.firedEdits} />
              </div>
            );
          })}
        </form>
      </div>

      <footer className="eq__nav">
        <button
          type="button"
          className="eq__nav-back"
          disabled={currentPage === 0}
          onClick={handleBack}
        >
          ← {lang === 'fr' ? 'Retour' : 'Back'}
        </button>

        {blocked ? (
          <span className="eq__nav-hint">
            {lang === 'fr' ? 'Corrigez les erreurs pour continuer' : 'Fix errors to continue'}
          </span>
        ) : (
          <span className="eq__nav-spacer" />
        )}

        <button
          type="button"
          className={isLastPage ? 'eq__nav-submit' : 'eq__nav-next'}
          disabled={blocked}
          onClick={handleNext}
        >
          {isLastPage
            ? lang === 'fr'
              ? 'Soumettre ✓'
              : 'Submit ✓'
            : lang === 'fr'
              ? 'Suivant →'
              : 'Next →'}
        </button>
      </footer>
    </div>
  );
}
