/** Top toolbar: title, language toggle, undo/redo, mode toggle, save, export menu, help, render. */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import { getInstrumentJsonSchema, validateInstrument } from '@mobilesurvey/instrument-schema';
import { exportDdiXml, exportJsonLd, importDdiXml } from '@mobilesurvey/ddi-xml';
import { useDesigner } from '../store/instrumentStore.js';
import { saveSurvey } from '../lib/surveyApi.js';
import { printSpec } from '../lib/specReport.js';
import { exportHtml } from '../lib/htmlExport.js';

/** The authoring-tool manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/authoring-tool.md';

/** Hub home page. In dev (localhost), uses port 5175; in prod, uses /. */
function getHubUrl(): string {
  const envUrl = import.meta.env.VITE_HUB_URL as string | undefined;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return '/';
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocalhost ? 'http://localhost:5175' : '/';
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
  const [activeSurveyId, setActiveSurveyId] = useState<string | null>(surveyId);
  const [collectModalOpen, setCollectModalOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveSurveyId(surveyId);
  }, [surveyId]);

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
    let targetId = activeSurveyId;
    if (!targetId) {
      targetId = `s-${Date.now().toString(36)}`;
      setActiveSurveyId(targetId);
      const url = new URL(window.location.href);
      url.searchParams.set('survey', targetId);
      window.history.replaceState(null, '', url.toString());
    }
    setSaveState('saving');
    const ok = await saveSurvey(targetId, instrument);
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

  const exportDdi = (packaging: 'instance' | 'fragment' = 'instance') => {
    const xml = exportDdiXml(instrument, { packaging });
    const slug = (pick(instrument.metadata.title as Record<string, string>, language) ?? 'instrument')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const suffix = packaging === 'fragment' ? '.ddi-fragments.xml' : '.ddi.xml';
    download(xml, `${slug}${suffix}`, 'application/xml;charset=utf-8');
    setExportOpen(false);
  };

  const exportLinkedData = () => {
    const jsonld = exportJsonLd(instrument);
    const slug = (pick(instrument.metadata.title as Record<string, string>, language) ?? 'instrument')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    download(jsonld, `${slug}.jsonld`, 'application/ld+json;charset=utf-8');
    setExportOpen(false);
  };

  const handleImportXml = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportError(null);
      try {
        const { instrument: imported, report } = importDdiXml(reader.result as string);
        const warnings = report.notes.filter(n => n.severity === 'warning');
        if (warnings.length) {
          setImportError(`Imported with ${warnings.length} warning(s): ${warnings[0]?.message ?? ''}`);
        }
        load(imported);
        setExportOpen(false);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid DDI-XML');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
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
          <span className="toolbar__mark" aria-hidden="true"><span /><span /><span /><span /></span>
          <strong>Modular Survey Tools</strong>
        </a>
        <h1 className="toolbar__title">{pick(instrument.metadata.title as Record<string, string>, language)}</h1>
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

      <div className="toolbar__group">
        <button
          type="button"
          className={saveState === 'saved' ? 'toolbar__save toolbar__save--ok' : 'toolbar__save'}
          onClick={save}
          disabled={saveState === 'saving'}
          aria-label="Save survey locally"
          title="Save survey locally in your browser storage"
        >
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? '✓ Saved locally'
              : saveState === 'error'
                ? '⚠ Retry save'
                : '💾 Save'}
        </button>
      </div>

      {/* Import / Export dropdown */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml,application/xml,text/xml"
        style={{ display: 'none' }}
        onChange={handleImportXml}
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
            <button type="button" role="menuitem" onClick={() => xmlInputRef.current?.click()}>
              ⬆ Import DDI-XML
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
            <button type="button" role="menuitem" onClick={() => exportDdi('instance')}>
              ⬇ DDI-XML (DDI-L 3.3)
            </button>
            <button type="button" role="menuitem" onClick={() => exportDdi('fragment')}>
              ⬇ DDI-XML (FragmentInstance, for repositories)
            </button>
            <button type="button" role="menuitem" onClick={exportLinkedData}>
              ⬇ JSON-LD (linked data, FAIR)
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
          href={`${getHubUrl()}#privacy`}
          target="_blank"
          rel="noopener noreferrer"
          title="Privacy &amp; Demonstration Notice"
        >
          🛡 Privacy
        </a>
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
        <button
          type="button"
          className="toolbar__collect-btn"
          onClick={() => setCollectModalOpen(true)}
          title="Deploy or collect responses for this survey"
        >
          🌐 Collect…
        </button>
        <button type="button" className="toolbar__render-btn" onClick={onRender} aria-label="Render survey">
          ▶ Render
        </button>
      </div>

      {collectModalOpen && (
        <div className="designer-modal-backdrop" onClick={() => setCollectModalOpen(false)} role="presentation">
          <div
            className="designer-modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="designer-collect-title"
          >
            <div className="designer-modal-header">
              <span className="designer-modal-badge">ℹ Interactive Demonstration</span>
              <button
                type="button"
                className="designer-modal-close"
                onClick={() => setCollectModalOpen(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="designer-modal-body">
              <h2 id="designer-collect-title">Survey Collection &amp; Custom Deployment</h2>
              <p className="designer-modal-lead">
                The questionnaire designer and preview sandbox on this platform are provided as an interactive demonstration.
              </p>

              <div className="designer-modal-callout">
                <strong>🔒 Privacy &amp; Research Ethics Standards</strong>
                <p>
                  To uphold statutory privacy regulations (PIPEDA/GDPR) and research ethics standards (TCPS 2), live multi-respondent cloud data collection is restricted in this public sandbox. Any surveys you build remain 100% private to your browser.
                </p>
              </div>

              <div className="designer-modal-solution-box">
                <h3>Need to collect real data for your organization?</h3>
                <p>
                  We provide dedicated, production-ready survey installations tailored to research institutes, public agencies, and enterprises:
                </p>
                <ul>
                  <li><strong>Dedicated Cloud or On-Premises:</strong> Air-gapped self-hosting with zero external dependencies.</li>
                  <li><strong>Regulatory PII Security:</strong> Role-based access control, cryptographic respondent codes, and automated PII redaction.</li>
                  <li><strong>Statistical Metadata Alignment:</strong> DDI-Lifecycle 3.3 standards, Statistics Canada knowledge graph integration, and audit logging.</li>
                  <li><strong>Unlimited Scale:</strong> High-concurrency electronic questionnaires and CATI phone interviewer workflows.</li>
                </ul>
              </div>
            </div>

            <div className="designer-modal-footer">
              <a
                href={`mailto:contact@peji.ca?subject=${encodeURIComponent(`Inquiry: Custom Survey Deployment & Data Collection - ${pick(instrument.metadata.title as Record<string, string>, language) || 'Custom Survey'}`)}&body=${encodeURIComponent(`Hello Peji Team,\n\nI am interested in discussing a dedicated survey deployment / data collection solution.\n\nSurvey: ${pick(instrument.metadata.title as Record<string, string>, language) || 'Custom Survey'}\nExpected number of respondents:\nHosting requirements (Cloud / On-premises):\n\nThank you!`)}`}
                className="designer-btn-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                ✉ Contact for Custom Solution (contact@peji.ca)
              </a>
              <button
                type="button"
                className="designer-btn-secondary"
                onClick={() => {
                  setCollectModalOpen(false);
                  onRender();
                }}
              >
                ▶ Test in Sandbox (Render)
              </button>
              <button
                type="button"
                className="designer-btn-subtle"
                onClick={() => setCollectModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="designer-modal-footer-note">
              <span>Read our </span>
              <a
                href={`${getHubUrl()}#privacy`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy &amp; Demonstration Notice
              </a>
              <span> for details on local storage and data handling.</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
