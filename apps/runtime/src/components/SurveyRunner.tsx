/**
 * Page-by-page questionnaire runner. Drives the runtime-engine XState machine, paginates the
 * flattened instrument, gates forward navigation on hard edits, persists progress for resume, and
 * emits paradata on navigation and submission.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  flattenInstrument,
  numberQuestions,
  pageHasHardEdits,
  paginate,
  pick,
  runtimeMachine,
  type ParadataSink,
  type RuntimeState,
  type SampleUnit,
} from '@mobilesurvey/runtime-engine';
import type { Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { isRtl, QuestionPage } from '@mobilesurvey/respondent-view';

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
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [showSaved, setShowSaved] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Keep the document language and direction in sync with the active locale.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    return () => {
      document.documentElement.removeAttribute('dir');
    };
  }, [lang, dir]);

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
  const qNumbers = useMemo(() => numberQuestions(pages), [pages]);

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
  const focusContent = () => contentRef.current?.focus();

  const handleNext = () => {
    if (blocked) return;
    if (isLastPage) {
      paradata.emit({ ts: Date.now(), type: 'page_complete', payload: { page: currentPage } });
      onSubmit(snapshot.context.state.responses);
    } else {
      paradata.emit({ ts: Date.now(), type: 'page_next', payload: { from: currentPage } });
      setCurrentPage((p) => p + 1);
      scrollTop();
      focusContent();
    }
  };

  const handleBack = () => {
    paradata.emit({ ts: Date.now(), type: 'page_back', payload: { from: currentPage } });
    setCurrentPage((p) => Math.max(0, p - 1));
    scrollTop();
    focusContent();
  };

  const answer = (instanceKey: string, value: unknown) => {
    paradata.emit({ ts: Date.now(), type: 'answer', payload: { key: instanceKey } });
    send({ type: 'ANSWER', instanceKey, value });
  };

  return (
    <div className="eq" dir={dir}>
      <header className="eq__header">
        <h1 className="eq__title">{pick(instrument.metadata.title, lang)}</h1>
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

      <div id="eq-main" className="eq__content" ref={contentRef} tabIndex={-1}>
        <form onSubmit={(e) => e.preventDefault()}>
          <QuestionPage
            items={pageItems}
            instrument={instrument}
            lang={lang}
            qNumbers={qNumbers}
            onAnswer={answer}
          />
        </form>
      </div>

      <footer className="eq__nav">
        <button
          type="button"
          className="eq__nav-back"
          disabled={currentPage === 0}
          onClick={handleBack}
        >
          {dir === 'rtl' ? '→' : '←'} {lang === 'fr' ? 'Retour' : 'Back'}
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
              ? `Suivant ${dir === 'rtl' ? '←' : '→'}`
              : `Next ${dir === 'rtl' ? '←' : '→'}`}
        </button>
      </footer>
    </div>
  );
}
