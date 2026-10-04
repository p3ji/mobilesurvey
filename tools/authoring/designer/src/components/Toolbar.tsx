/** Top toolbar: title, language toggle, undo/redo, mode toggle, save, export menu, help, render. */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import { LanguageSwitch, setUiLanguage, useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
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
  const uiLanguage = useUiLanguage();
  const l = (en: string, fr: string) => uiText(uiLanguage, en, fr);
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
        <a href={getHubUrl()} className="toolbar__home" title={l('Return to survey hub', 'Retour à l’accueil des outils')}>
          <span className="toolbar__mark" aria-hidden="true"><span /><span /><span /><span /></span>
          <strong>Modular Survey Tools</strong>
        </a>
        <h1 className="toolbar__title">{pick(instrument.metadata.title as Record<string, string>, language)}</h1>
      </div>

      <LanguageSwitch />
      <div className="toolbar__group" role="group" aria-label={l('Questionnaire language', 'Langue du questionnaire')}>
        {instrument.languages.map((lang) => (
          <button
            key={lang}
            type="button"
            className={lang === language ? 'pill pill--active' : 'pill'}
            aria-pressed={lang === language}
            onClick={() => { setLanguage(lang); if (lang === 'en' || lang === 'fr') setUiLanguage(lang); }}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={undo} disabled={past.length === 0} aria-label={l('Undo', 'Annuler')}>
          ↶ {l('Undo', 'Annuler')}
        </button>
        <button type="button" onClick={redo} disabled={future.length === 0} aria-label={l('Redo', 'Rétablir')}>
          ↷ {l('Redo', 'Rétablir')}
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
          {mode === 'easy' ? l('Easy Mode', 'Mode simplifié') : mode === 'interviewer' ? l('Interviewer Mode', 'Mode intervieweur') : 'Mode Pro'} ▾
        </button>
        {modeOpen && (
          <div className="toolbar__mode-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className={mode === 'easy' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('easy'); setModeOpen(false); }}
            >
              {l('Easy Mode', 'Mode simplifié')}
              <span className="toolbar__mode-desc">{l('Flat question list with categories & routing', 'Liste de questions avec catégories et cheminement')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={mode === 'pro' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('pro'); setModeOpen(false); }}
            >
              {l('Pro Mode', 'Mode Pro')}
              <span className="toolbar__mode-desc">{l('Full tree, variables, expressions, flowchart', 'Arborescence, variables, expressions et organigramme')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={mode === 'interviewer' ? 'toolbar__mode-item toolbar__mode-item--active' : 'toolbar__mode-item'}
              onClick={() => { onModeChange('interviewer'); setModeOpen(false); }}
            >
              {l('Interviewer Mode', 'Mode intervieweur')}
              <span className="toolbar__mode-desc">{l('CATI · entry/exit modules · free navigation', 'ITAO · modules d’entrée et de sortie · navigation libre')}</span>
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
          aria-label={l('Save survey locally', 'Enregistrer l’enquête localement')}
          title={l('Save survey locally in your browser storage', 'Enregistrer l’enquête dans votre navigateur')}
        >
          {saveState === 'saving'
            ? l('Saving…', 'Enregistrement…')
            : saveState === 'saved'
              ? l('✓ Saved locally', '✓ Enregistré localement')
              : saveState === 'error'
                ? l('⚠ Retry save', '⚠ Réessayer')
                : l('💾 Save', '💾 Enregistrer')}
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
          {l('Import / Export', 'Importer / Exporter')} ▾
        </button>
        {exportOpen && (
          <div className="toolbar__export-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>
              ⬆ {l('Import instrument JSON', 'Importer un instrument JSON')}
            </button>
            <button type="button" role="menuitem" onClick={() => xmlInputRef.current?.click()}>
              ⬆ {l('Import DDI-XML', 'Importer DDI-XML')}
            </button>
            {importError && (
              <p className="toolbar__import-error" role="alert">{importError}</p>
            )}
            <hr className="toolbar__menu-divider" />
            <button type="button" role="menuitem" onClick={exportHtmlDoc}>
              ⬇ {l('HTML Questionnaire', 'Questionnaire HTML')}
            </button>
            <button type="button" role="menuitem" onClick={exportJson}>
              ⬇ {l('Instrument JSON', 'Instrument JSON')}
            </button>
            <button type="button" role="menuitem" onClick={() => exportDdi('instance')}>
              ⬇ DDI-XML (DDI-L 3.3)
            </button>
            <button type="button" role="menuitem" onClick={() => exportDdi('fragment')}>
              ⬇ DDI-XML ({l('FragmentInstance, for repositories', 'FragmentInstance, pour les dépôts')})
            </button>
            <button type="button" role="menuitem" onClick={exportLinkedData}>
              ⬇ JSON-LD ({l('linked data, FAIR', 'données liées, FAIR')})
            </button>
            <button type="button" role="menuitem" onClick={exportJsonSchema}>
              ⬇ {l('JSON Schema', 'Schéma JSON')}
            </button>
            <button type="button" role="menuitem" onClick={exportPdf}>
              🖨 {l('PDF Spec', 'Spécification PDF')}
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
          title={l('Privacy & Demonstration Notice', 'Confidentialité et avis sur la démonstration')}
        >
          🛡 {l('Privacy', 'Confidentialité')}
        </a>
        <a
          className="toolbar__help"
          href={HELP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l('Open the authoring tool manual (opens in a new tab)', 'Ouvrir le manuel de l’outil de conception (nouvel onglet)')}
          title={l('User manual', 'Guide d’utilisation')}
        >
          ? {l('Help', 'Aide')}
        </a>
        <button
          type="button"
          className="toolbar__collect-btn"
          onClick={() => setCollectModalOpen(true)}
          title={l('Deploy or collect responses for this survey', 'Publier cette enquête ou recueillir des réponses')}
        >
          🌐 {l('Collect…', 'Collecter…')}
        </button>
        <button type="button" className="toolbar__render-btn" onClick={onRender} aria-label={l('Render survey', 'Afficher l’enquête')}>
          ▶ {l('Render', 'Afficher')}
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
              <span className="designer-modal-badge">ℹ {l('Interactive Demonstration', 'Démonstration interactive')}</span>
              <button
                type="button"
                className="designer-modal-close"
                onClick={() => setCollectModalOpen(false)}
                aria-label={l('Close dialog', 'Fermer la fenêtre')}
              >
                ✕
              </button>
            </div>

            <div className="designer-modal-body">
              <h2 id="designer-collect-title">{l('Survey Collection & Custom Deployment', 'Collecte d’enquête et déploiement personnalisé')}</h2>
              <p className="designer-modal-lead">
                {l('The questionnaire designer and preview sandbox on this platform are provided as an interactive demonstration.', 'Le concepteur de questionnaires et l’environnement d’aperçu de cette plateforme sont offerts à titre de démonstration interactive.')}
              </p>

              <div className="designer-modal-callout">
                <strong>🔒 {l('Privacy & Research Ethics Standards', 'Confidentialité et normes d’éthique de la recherche')}</strong>
                <p>
                  {l('To uphold statutory privacy regulations (PIPEDA/GDPR) and research ethics standards (TCPS 2), live multi-respondent cloud data collection is restricted in this public sandbox. Any surveys you build remain 100% private to your browser.', 'Afin de respecter les règles de confidentialité et les normes d’éthique de la recherche, la collecte infonuagique auprès de plusieurs répondants n’est pas offerte dans cette démonstration publique. Les enquêtes que vous créez restent privées dans votre navigateur.')}
                </p>
              </div>

              <div className="designer-modal-solution-box">
                <h3>{l('Need to collect real data for your organization?', 'Vous devez recueillir des données réelles pour votre organisation?')}</h3>
                <p>
                  {l('We provide dedicated, production-ready survey installations tailored to research institutes, public agencies, and enterprises:', 'Nous proposons des installations d’enquête dédiées, adaptées aux instituts de recherche, aux organismes publics et aux entreprises :')}
                </p>
                <ul>
                  <li><strong>{l('Dedicated Cloud or On-Premises:', 'Infonuagique dédiée ou installation locale :')}</strong> {l('Air-gapped self-hosting with zero external dependencies.', 'Hébergement autonome isolé, sans dépendances externes.')}</li>
                  <li><strong>{l('Regulatory PII Security:', 'Protection des renseignements personnels :')}</strong> {l('Role-based access control, cryptographic respondent codes, and automated PII redaction.', 'Accès selon les rôles, codes de répondants protégés et caviardage automatisé.')}</li>
                  <li><strong>{l('Statistical Metadata Alignment:', 'Conformité des métadonnées statistiques :')}</strong> {l('DDI-Lifecycle 3.3 standards, Statistics Canada knowledge graph integration, and audit logging.', 'Norme DDI-Lifecycle 3.3, intégration au graphe de connaissances de Statistique Canada et journal d’audit.')}</li>
                  <li><strong>{l('Unlimited Scale:', 'Capacité de montée en charge :')}</strong> {l('High-concurrency electronic questionnaires and CATI phone interviewer workflows.', 'Questionnaires électroniques et processus d’interview téléphonique assistée par ordinateur.')}</li>
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
                ✉ {l('Contact for Custom Solution', 'Nous joindre pour une solution personnalisée')} (contact@peji.ca)
              </a>
              <button
                type="button"
                className="designer-btn-secondary"
                onClick={() => {
                  setCollectModalOpen(false);
                  onRender();
                }}
              >
                ▶ {l('Test in Sandbox (Render)', 'Tester dans la démo (Afficher)')}
              </button>
              <button
                type="button"
                className="designer-btn-subtle"
                onClick={() => setCollectModalOpen(false)}
              >
                {l('Close', 'Fermer')}
              </button>
            </div>

            <div className="designer-modal-footer-note">
              <span>{l('Read our ', 'Lisez notre ')}</span>
              <a
                href={`${getHubUrl()}#privacy`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {l('Privacy & Demonstration Notice', 'avis de confidentialité et de démonstration')}
              </a>
              <span>{l(' for details on local storage and data handling.', ' pour en savoir plus sur le stockage local et le traitement des données.')}</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
