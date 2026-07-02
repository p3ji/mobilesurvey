/**
 * Full-screen respondent-facing survey app (a `position: fixed; inset: 0` overlay — not the
 * compact mobile-device mockup the live Preview tab uses). Shown when the designer's "Render"
 * button is clicked. Uses a fresh XState machine instance — no state shared with the preview pane.
 *
 * Shares pagination, numbering, and the actual question-rendering markup (`QuestionPage`) with the
 * production respondent runtime via `@mobilesurvey/respondent-view` — this is a full-page render
 * simulating the real respondent experience, so it should visually and behaviorally match runtime,
 * not the compact device-frame preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { flattenInstrument, numberQuestions, pageHasHardEdits, paginate, pick, runtimeMachine } from '@mobilesurvey/runtime-engine';
import { QuestionPage } from '@mobilesurvey/respondent-view';
import type { LanguageCode } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { MOCK_SAMPLE } from '../integrations/mocks.js';

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

  const { pages } = useMemo(() => paginate(result.items), [result.items]);

  // Clamp currentPage when visible pages change (e.g. conditional pages appear/disappear).
  useEffect(() => {
    if (currentPage >= pages.length) setCurrentPage(Math.max(0, pages.length - 1));
  }, [pages.length, currentPage]);

  const qNumByKey = useMemo(() => numberQuestions(pages), [pages]);

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
          <QuestionPage
            items={pageItems}
            instrument={instrument}
            lang={lang}
            qNumbers={qNumByKey}
            onAnswer={(instanceKey, value) => send({ type: 'ANSWER', instanceKey, value })}
          />
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
