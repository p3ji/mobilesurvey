/** Top toolbar: title, language toggle, undo/redo, save, help, render. */
import { useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import { useDesigner } from '../store/instrumentStore.js';
import { saveSurvey } from '../lib/surveyApi.js';

/** The authoring-tool manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/authoring-tool.md';

export function Toolbar({ onRender, surveyId }: { onRender: () => void; surveyId: string | null }) {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const setLanguage = useDesigner((s) => s.setLanguage);
  const undo = useDesigner((s) => s.undo);
  const redo = useDesigner((s) => s.redo);
  const past = useDesigner((s) => s.past);
  const future = useDesigner((s) => s.future);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    if (!surveyId) return;
    setSaveState('saving');
    const ok = await saveSurvey(surveyId, instrument);
    setSaveState(ok ? 'saved' : 'error');
    setTimeout(() => setSaveState('idle'), 2500);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <strong>mobilesurvey</strong>
        <span className="toolbar__title">{pick(instrument.metadata.title, language)}</span>
      </div>
      <div className="toolbar__group" role="group" aria-label="Language">
        {instrument.languages.map((lang) => (
          <button
            key={lang}
            type="button"
            className={lang === language ? 'pill pill--active' : 'pill'}
            aria-pressed={lang === language}
            onClick={() => setLanguage(lang)}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="toolbar__group">
        <button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo">
          ↶ Undo
        </button>
        <button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo">
          ↷ Redo
        </button>
      </div>
      {surveyId && (
        <div className="toolbar__group">
          <button
            type="button"
            className={saveState === 'saved' ? 'toolbar__save toolbar__save--ok' : 'toolbar__save'}
            onClick={save}
            disabled={saveState === 'saving'}
            aria-label="Save survey to the hub"
          >
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? '✓ Saved'
                : saveState === 'error'
                  ? '⚠ Retry save'
                  : '💾 Save'}
          </button>
        </div>
      )}
      <div className="toolbar__group">
        <a
          className="toolbar__help"
          href={HELP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the authoring tool manual (opens in a new tab)"
          title="User manual"
        >
          ? Help
        </a>
        <button type="button" className="toolbar__render-btn" onClick={onRender} aria-label="Render survey">
          ▶ Render
        </button>
      </div>
    </header>
  );
}
