/** Top toolbar: title, language toggle, undo/redo, mode toggle, save, export menu, help, render. */
import { useEffect, useRef, useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import { getInstrumentJsonSchema } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { saveSurvey } from '../lib/surveyApi.js';
import { printSpec } from '../lib/specReport.js';

/** The authoring-tool manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/authoring-tool.md';

/** Hub home page (override via env in production). */
const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined) ?? 'http://localhost:5175';

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar({
  onRender,
  surveyId,
  mode,
  onModeToggle,
}: {
  onRender: () => void;
  surveyId: string | null;
  mode: 'pro' | 'easy';
  onModeToggle: () => void;
}) {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const setLanguage = useDesigner((s) => s.setLanguage);
  const undo = useDesigner((s) => s.undo);
  const redo = useDesigner((s) => s.redo);
  const past = useDesigner((s) => s.past);
  const future = useDesigner((s) => s.future);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click.
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

  const save = async () => {
    if (!surveyId) return;
    setSaveState('saving');
    const ok = await saveSurvey(surveyId, instrument);
    setSaveState(ok ? 'saved' : 'error');
    setTimeout(() => setSaveState('idle'), 2500);
  };

  const exportJson = () => {
    const slug = (pick(instrument.metadata.title as Record<string, string>, language) ?? 'instrument')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    download(JSON.stringify(instrument, null, 2), `${slug}.instrument.json`, 'application/json');
    setExportOpen(false);
  };

  const exportPdf = () => {
    printSpec(instrument, language);
    setExportOpen(false);
  };

  const exportJsonSchema = () => {
    download(JSON.stringify(getInstrumentJsonSchema(), null, 2), 'instrument.schema.json', 'application/json');
    setExportOpen(false);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <a href={HUB_URL} className="toolbar__home" title="Return to survey hub">
          <strong>mobilesurvey</strong>
        </a>
        <span className="toolbar__title">{pick(instrument.metadata.title as Record<string, string>, language)}</span>
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

      {/* Easy / Pro mode toggle */}
      <div className="toolbar__group" role="group" aria-label="Editor mode">
        <button
          type="button"
          className={mode === 'easy' ? 'pill pill--active' : 'pill'}
          aria-pressed={mode === 'easy'}
          title="Easy Mode: simplified question list, hides routing/variables"
          onClick={onModeToggle}
        >
          Easy
        </button>
        <button
          type="button"
          className={mode === 'pro' ? 'pill pill--active' : 'pill'}
          aria-pressed={mode === 'pro'}
          title="Pro Mode: full editor with routing, variables, validation, flowchart"
          onClick={onModeToggle}
        >
          Pro
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

      {/* Export dropdown */}
      <div className="toolbar__group toolbar__export-wrap" ref={exportRef}>
        <button
          type="button"
          className={exportOpen ? 'toolbar__export toolbar__export--open' : 'toolbar__export'}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
          onClick={() => setExportOpen((o) => !o)}
        >
          Export ▾
        </button>
        {exportOpen && (
          <div className="toolbar__export-menu" role="menu">
            <button type="button" role="menuitem" onClick={exportJson}>
              ⬇ Instrument JSON
            </button>
            <button type="button" role="menuitem" onClick={exportJsonSchema}>
              ⬇ JSON Schema
            </button>
            <button type="button" role="menuitem" onClick={exportPdf}>
              🖨 PDF Spec
            </button>
          </div>
        )}
      </div>

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
