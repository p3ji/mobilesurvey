/** Top toolbar: title, language toggle, undo/redo, mode toggle, save, export menu, help, render. */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import { getInstrumentJsonSchema, validateInstrument } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { saveSurvey } from '../lib/surveyApi.js';
import { printSpec } from '../lib/specReport.js';
import { exportHtml } from '../lib/htmlExport.js';

/** The authoring-tool manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/authoring-tool.md';

/** Hub home page. In dev (localhost), uses port 5175; in prod (GH Pages), uses /mobilesurvey/. */
function getHubUrl(): string {
  const envUrl = import.meta.env.VITE_HUB_URL as string | undefined;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return '/mobilesurvey/';
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocalhost ? 'http://localhost:5175' : '/mobilesurvey/';
}

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
  onModeChange,
}: {
  onRender: () => void;
  surveyId: string | null;
  mode: 'pro' | 'easy' | 'interviewer';
  onModeChange: (m: 'pro' | 'easy' | 'interviewer') => void;
}) {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const setLanguage = useDesigner((s) => s.setLanguage);
  const load = useDesigner((s) => s.load);
  const undo = useDesigner((s) => s.undo);
  const redo = useDesigner((s) => s.redo);
  const past = useDesigner((s) => s.past);
  const future = useDesigner((s) => s.future);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close dropdowns on outside click.
  useEffect(() => {
    if (!exportOpen && !modeOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen, modeOpen]);

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

  const exportHtmlDoc = () => {
    const html = exportHtml(instrument, language);
    const slug = (pick(instrument.metadata.title as Record<string, string>, language) ?? 'instrument')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    download(html, `${slug}.html`, 'text/html;charset=utf-8');
    setExportOpen(false);
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportError(null);
      try {
        const parsed = JSON.parse(reader.result as string);
        const result = validateInstrument(parsed);
        if (result.ok) {
          load(result.instrument);
          setExportOpen(false);
        } else {
          setImportError(result.issues.map((i) => i.message).join('; '));
        }
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid JSON');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <a href={getHubUrl()} className="toolbar__home" title="Return to survey hub">
          <strong>Modular Survey Tools</strong>
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

      {/* Mode dropdown */}
      <div className="toolbar__group toolbar__mode-wrap" ref={modeRef}>
        <button
          type="button"
          className={modeOpen ? 'toolbar__mode toolbar__mode--open' : 'toolbar__mode'}
          aria-haspopup="menu"
          aria-expanded={modeOpen}
          onClick={() => setModeOpen((o) => !o)}
        >
          {mode === 'easy' ? 'Easy Mode' : mode === 'interviewer' ? 'Interviewer Mode' : 'Pro Mode'} ▾
        </button>
        {modeOpen && (
          <div className="toolbar__mode-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className={mode === 'easy' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('easy'); setModeOpen(false); }}
            >
              Easy Mode
              <span className="toolbar__mode-desc">Flat question list with categories &amp; routing</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={mode === 'pro' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('pro'); setModeOpen(false); }}
            >
              Pro Mode
              <span className="toolbar__mode-desc">Full tree, variables, expressions, flowchart</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={mode === 'interviewer' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('interviewer'); setModeOpen(false); }}
            >
              Interviewer Mode
              <span className="toolbar__mode-desc">CATI · entry/exit modules · free navigation</span>
            </button>
          </div>
        )}
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

      {/* Import / Export dropdown */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      <div className="toolbar__group toolbar__export-wrap" ref={exportRef}>
        <button
          type="button"
          className={exportOpen ? 'toolbar__export toolbar__export--open' : 'toolbar__export'}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
          onClick={() => { setExportOpen((o) => !o); setImportError(null); }}
        >
          Import / Export ▾
        </button>
        {exportOpen && (
          <div className="toolbar__export-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>
              ⬆ Import instrument JSON
            </button>
            {importError && (
              <p className="toolbar__import-error" role="alert">{importError}</p>
            )}
            <hr className="toolbar__menu-divider" />
            <button type="button" role="menuitem" onClick={exportHtmlDoc}>
              ⬇ HTML Questionnaire
            </button>
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
