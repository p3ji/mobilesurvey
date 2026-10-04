import { useState, useMemo, useRef } from 'react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import {
  Trash2,
  Download,
  Copy,
  Upload,
  Search,
  Check,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Info,
} from 'lucide-react';
import { useDataCart, CartVariableItem } from './useDataCart.js';

interface DataCartViewProps {
  onSearch: () => void;
  onExploreProgram?: (surveyProgram: string) => void;
}

export function DataCartView({ onSearch, onExploreProgram }: DataCartViewProps) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const {
    items,
    count,
    removeItem,
    updateNotes,
    clearCart,
    importCart,
    exportJson,
    exportCsv,
    getVariableNames,
    surveySummary,
  } = useDataCart();

  const [searchFilter, setSearchFilter] = useState('');
  const [selectedSurveyFilter, setSelectedSurveyFilter] = useState('all');
  const [groupBySurvey, setGroupBySurvey] = useState(true);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [expandedCodes, setExpandedCodes] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filter items by local search query and survey program
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (selectedSurveyFilter !== 'all') {
        const prog = item.surveyAcronym || item.surveyGroup;
        if (prog !== selectedSurveyFilter) return false;
      }
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        item.variableName.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.question && item.question.toLowerCase().includes(q)) ||
        (item.userNotes && item.userNotes.toLowerCase().includes(q)) ||
        (item.universe && item.universe.toLowerCase().includes(q))
      );
    });
  }, [items, searchFilter, selectedSurveyFilter]);

  // Unique survey programs represented in the cart
  const distinctPrograms = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => {
      set.add(item.surveyAcronym || item.surveyGroup);
    });
    return Array.from(set).sort();
  }, [items]);

  // Group items by survey program if groupBySurvey is enabled
  const groupedItems = useMemo(() => {
    if (!groupBySurvey) return null;
    const map = new Map<string, CartVariableItem[]>();
    for (const item of filteredItems) {
      const prog = item.surveyAcronym || item.surveyGroup;
      if (!map.has(prog)) {
        map.set(prog, []);
      }
      map.get(prog)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredItems, groupBySurvey]);

  const handleCopy = async (format: 'comma' | 'space' | 'newline' | 'r' | 'stata' | 'sas') => {
    const text = getVariableNames(format);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFormat(format);
      setShowCopyDropdown(false);
      setTimeout(() => setCopiedFormat(null), 3000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  const handleDownloadCsv = () => {
    const csv = exportCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statcan_variables_cart_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statcan_variables_cart_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result as string;
      if (content) {
        const result = importCart(content);
        if (result.success) {
          setImportStatus({
            success: true,
            message: `Successfully imported cart: added ${result.added} new variable(s).`,
          });
        } else {
          setImportStatus({
            success: false,
            message: result.error || 'Failed to import JSON cart file.',
          });
        }
        setTimeout(() => setImportStatus(null), 5000);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  };

  const toggleCodeList = (id: string) => {
    setExpandedCodes(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // ── Render Variable Card ──────────────────────────────────────────────────
  const renderItemCard = (item: CartVariableItem) => {
    const isCodesOpen = !!expandedCodes[item.id];
    const codes = item.codes || [];

    return (
      <article key={item.id} className="cart-card">
        <div className="cart-card__header">
          <div className="cart-card__title-row">
            <code className="cs-hit__name cart-card__name">{item.variableName}</code>
            {item.role && (
              <span className={`cs-hit__kind cs-hit__kind--${item.role}`}>
                {item.role === 'collected'
                  ? l('Question', 'Question')
                  : item.role === 'derived'
                    ? l('Derived DV', 'Variable dérivée')
                    : item.role === 'administrative'
                      ? l('Admin Link', 'Lien administratif')
                      : l('Paradata / Weight', 'Paradonnée / poids')}
              </span>
            )}
            {item.isGrouped && (
              <span className="cs-hit__badge--grouped" title="PUMF Grouped Recode">
                PUMF (G)
              </span>
            )}
            {item.isHarmonized && (
              <span className="cs-hit__badge--harmonized" title={l('Harmonized standard question', 'Question standard harmonisée')}>
                {l('Harmonized', 'Harmonisée')}
              </span>
            )}
            {item.isSelectAll && (
              <span className="cs-hit__badge--select-all" title={l('Select all item', 'Élément Sélectionner tout')}>
                {l('Select all', 'Sélectionner tout')}
              </span>
            )}

            <span className="cart-card__survey">
              {item.surveyAcronym ?? item.surveyGroup}
              {item.year ? ` · ${item.year}` : ''}
            </span>
            <span className="cs-hit__lang">{item.lang === 'fr' ? 'FR' : 'EN'}</span>
          </div>

          <button
            type="button"
            className="cart-card__remove-btn"
            onClick={() => removeItem(item.id)}
            title={l(`Remove ${item.variableName} from cart`, `Retirer ${item.variableName} du panier`)}
            aria-label={l(`Remove ${item.variableName} from cart`, `Retirer ${item.variableName} du panier`)}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>{l('Remove', 'Retirer')}</span>
          </button>
        </div>

        <p className="cart-card__label">{item.label}</p>
        {item.question && item.question !== item.label && (
          <p className="cart-card__question">{item.question}</p>
        )}

        {item.universe && (
          <p className="cs-hit__field">
            <span className="cs-hit__field-name">{l('Universe:', 'Univers :')}</span> {item.universe}
          </p>
        )}
        {item.note && (
          <p className="cs-hit__field">
            <span className="cs-hit__field-name">{l('Note:', 'Note :')}</span> {item.note}
          </p>
        )}

        {codes.length > 0 && (
          <div className="cart-card__codes">
            <button
              type="button"
              className="cart-card__codes-toggle"
              onClick={() => toggleCodeList(item.id)}
              aria-expanded={isCodesOpen}
            >
              <span>{codes.length} {l('response categories', 'catégories de réponse')}</span>
              <span>{isCodesOpen ? l('▲ Hide', '▲ Masquer') : l('▼ Show', '▼ Afficher')}</span>
            </button>
            {isCodesOpen && (
              <div className="cs-codes cart-card__codes-list">
                {codes.map((c, i) => (
                  <span key={`${c.c}-${i}`} className="cs-code">
                    <span className="cs-code__val">{c.c}</span>
                    <span className="cs-code__sep">:</span>
                    <span className="cs-code__lbl">{c.l}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* User Notes field */}
        <div className="cart-card__notes-wrap">
          <label htmlFor={`cart-notes-${item.id}`} className="cart-card__notes-label">
            {l('Research Notes / Hypotheses:', 'Notes de recherche / hypothèses :')}
          </label>
          <input
            id={`cart-notes-${item.id}`}
            type="text"
            className="cart-card__notes-input"
            placeholder={l("Add personal notes (e.g. 'Primary outcome', 'Covariate for model 2', 'Needs recoding')...", 'Ajouter des notes (p. ex. résultat principal, covariable, recodage nécessaire)…')}
            value={item.userNotes ?? ''}
            onChange={e => updateNotes(item.id, e.target.value)}
          />
        </div>
      </article>
    );
  };

  // ── Empty Cart State ──────────────────────────────────────────────────────
  if (count === 0) {
    return (
      <div className="cart-view cart-view--empty">
        <div className="cart-empty-box">
          <div className="cart-empty-icon" aria-hidden="true">
            <FileSpreadsheet size={48} strokeWidth={1.5} />
          </div>
          <h2>{l('Your Data Cart is empty', 'Votre panier de données est vide')}</h2>
          <p className="cart-empty-lead">
            {l('Collect and organize Statistics Canada variables from across surveys and cycles as you search. Saved variables persist safely in your browser and can be exported as CSV spreadsheets, machine-readable JSON codebooks, or R / Stata / SAS syntax.', 'Rassemblez des variables de Statistique Canada provenant de diverses enquêtes et de divers cycles. Les variables enregistrées restent dans votre navigateur et peuvent être exportées en CSV, en JSON ou sous forme de syntaxe R, Stata ou SAS.')}
          </p>
          <div className="cart-empty-actions">
            <button type="button" className="cart-primary-btn" onClick={onSearch}>
              <Search size={16} aria-hidden="true" />
              <span>{l('Search Statistics Canada Variables', 'Rechercher des variables de Statistique Canada')}</span>
            </button>
            <button
              type="button"
              className="cart-secondary-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              <span>{l('Import Saved Cart (JSON)', 'Importer un panier enregistré (JSON)')}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".json,application/json"
              onChange={handleFileChange}
            />
          </div>

          <div className="cart-empty-features">
            <div className="cart-feature-card">
              <Sparkles size={20} className="cart-feature-icon" />
              <h4>{l('One-Click Collection', 'Ajout en un clic')}</h4>
              <p>{l('Click "+ Add to cart" on any search result card to bookmark variables for your study.', 'Cliquez sur « Ajouter au panier » dans un résultat pour conserver des variables pour votre étude.')}</p>
            </div>
            <div className="cart-feature-card">
              <FileSpreadsheet size={20} className="cart-feature-icon" />
              <h4>{l('Spreadsheet Export', 'Exportation en tableur')}</h4>
              <p>{l('Download complete variable definitions with response codes, question text, and notes in CSV.', 'Téléchargez en CSV les définitions des variables, les codes de réponse, le texte des questions et vos notes.')}</p>
            </div>
            <div className="cart-feature-card">
              <Copy size={20} className="cart-feature-icon" />
              <h4>{l('Syntax Generation', 'Génération de syntaxe')}</h4>
              <p>{l('Generate copy-paste', 'Générez des listes de variables et des instructions')} <code>keep</code> {l('statements and variable lists for R, Stata, and SAS.', 'à copier dans R, Stata ou SAS.')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Populated Cart View ───────────────────────────────────────────────────
  return (
    <div className="cart-view">
      {/* Header & Overview */}
      <div className="cart-header">
        <div>
          <div className="cart-kicker">{l('Research Workspace', 'Espace de recherche')}</div>
          <h2 className="cart-title">{l('Data Cart', 'Panier de données')}</h2>
          <p className="cart-subtitle">
            {l('Saved Statistics Canada variables stored locally in your browser. Annotate, organize, and export variable lists for statistical packages or research data requests.', 'Variables de Statistique Canada enregistrées localement dans votre navigateur. Annotez, organisez et exportez des listes pour les logiciels statistiques ou les demandes d’accès aux données de recherche.')}
          </p>
        </div>

        {/* Metric summary badges */}
        <div className="cart-metrics">
          <div className="cart-metric-pill">
            <span className="cart-metric-pill__num">{count}</span>
            <span className="cart-metric-pill__lbl">Variable{count === 1 ? '' : 's'}</span>
          </div>
          <div className="cart-metric-pill">
            <span className="cart-metric-pill__num">{surveySummary.distinctSurveys}</span>
            <span className="cart-metric-pill__lbl">{l(surveySummary.distinctSurveys === 1 ? 'Survey' : 'Surveys', surveySummary.distinctSurveys === 1 ? 'Enquête' : 'Enquêtes')}</span>
          </div>
          <div className="cart-metric-pill">
            <span className="cart-metric-pill__num">{surveySummary.distinctCycles}</span>
            <span className="cart-metric-pill__lbl">Cycle{surveySummary.distinctCycles === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Notification banner if import succeeded or failed */}
      {importStatus && (
        <div className={`cart-banner ${importStatus.success ? 'cart-banner--success' : 'cart-banner--error'}`} role="status">
          <Info size={16} aria-hidden="true" />
          <span>{importStatus.message}</span>
        </div>
      )}

      {/* Main Action Bar */}
      <div className="cart-action-bar">
        <div className="cart-action-group">
          {/* Copy Names Dropdown */}
          <div className="cart-dropdown-wrap">
            <button
              type="button"
              className="cart-action-btn cart-action-btn--primary"
              onClick={() => setShowCopyDropdown(prev => !prev)}
              aria-haspopup="true"
              aria-expanded={showCopyDropdown}
            >
              {copiedFormat ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              <span>{copiedFormat ? l(`Copied (${copiedFormat.toUpperCase()})!`, `Copié (${copiedFormat.toUpperCase()})!`) : l('Copy Variable Names', 'Copier les noms des variables')}</span>
            </button>

            {showCopyDropdown && (
              <div className="cart-dropdown-menu" role="menu">
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('comma')}
                  role="menuitem"
                >
                  <strong>{l('Comma-separated', 'Séparés par des virgules')}</strong>
                  <span>e.g., GEN_01, SMK_01, INC_01</span>
                </button>
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('r')}
                  role="menuitem"
                >
                  <strong>{l('R vector syntax', 'Syntaxe de vecteur R')}</strong>
                  <span>c("GEN_01", "SMK_01", "INC_01")</span>
                </button>
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('stata')}
                  role="menuitem"
                >
                  <strong>{l('Stata keep statement', 'Instruction keep de Stata')}</strong>
                  <span>keep GEN_01 SMK_01 INC_01</span>
                </button>
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('sas')}
                  role="menuitem"
                >
                  <strong>{l('SAS keep statement', 'Instruction keep de SAS')}</strong>
                  <span>keep GEN_01 SMK_01 INC_01;</span>
                </button>
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('space')}
                  role="menuitem"
                >
                  <strong>{l('Space-delimited', 'Séparés par des espaces')}</strong>
                  <span>e.g., GEN_01 SMK_01 INC_01</span>
                </button>
                <button
                  type="button"
                  className="cart-dropdown-item"
                  onClick={() => handleCopy('newline')}
                  role="menuitem"
                >
                  <strong>{l('One per line', 'Un par ligne')}</strong>
                  <span>{l('Plain line-by-line list', 'Liste simple, une variable par ligne')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Export CSV */}
          <button type="button" className="cart-action-btn" onClick={handleDownloadCsv}>
            <FileSpreadsheet size={14} aria-hidden="true" />
            <span>{l('Export CSV', 'Exporter CSV')}</span>
          </button>

          {/* Export JSON */}
          <button type="button" className="cart-action-btn" onClick={handleDownloadJson}>
            <Download size={14} aria-hidden="true" />
            <span>{l('Export JSON', 'Exporter JSON')}</span>
          </button>

          {/* Import JSON */}
          <button
            type="button"
            className="cart-action-btn"
            onClick={() => fileInputRef.current?.click()}
            title={l('Import an existing JSON cart file', 'Importer un fichier JSON de panier existant')}
          >
            <Upload size={14} aria-hidden="true" />
            <span>{l('Import JSON', 'Importer JSON')}</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json,application/json"
            onChange={handleFileChange}
          />
        </div>

        {/* Clear Cart button */}
        <div className="cart-action-group cart-action-group--right">
          {confirmClear ? (
            <div className="cart-confirm-clear">
              <span>{l('Clear all', 'Supprimer les')} {count} {l('items?', 'éléments?')}</span>
              <button
                type="button"
                className="cart-btn-danger"
                onClick={() => {
                  clearCart();
                  setConfirmClear(false);
                }}
              >
                {l('Yes, clear', 'Oui, supprimer')}
              </button>
              <button
                type="button"
                className="cart-btn-cancel"
                onClick={() => setConfirmClear(false)}
              >
                {l('Cancel', 'Annuler')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="cart-action-btn cart-action-btn--subtle"
              onClick={() => setConfirmClear(true)}
              title={l('Remove all variables from cart', 'Retirer toutes les variables du panier')}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>{l('Clear Cart', 'Vider le panier')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search within cart bar */}
      <div className="cart-filter-bar">
        <div className="cart-search-input-wrap">
          <Search size={14} className="cart-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="cart-search-input"
            placeholder={l('Search saved variables by name, label, question or notes...', 'Rechercher dans les variables enregistrées par nom, libellé, question ou note…')}
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button
              type="button"
              className="cart-search-clear"
              onClick={() => setSearchFilter('')}
              aria-label={l('Clear cart search filter', 'Effacer le filtre de recherche du panier')}
            >
              ×
            </button>
          )}
        </div>

        {/* Survey program filter */}
        {distinctPrograms.length > 1 && (
          <select
            className="cart-survey-select"
            value={selectedSurveyFilter}
            onChange={e => setSelectedSurveyFilter(e.target.value)}
            aria-label={l('Filter cart by survey program', 'Filtrer le panier par programme d’enquête')}
          >
            <option value="all">{l('All Surveys', 'Toutes les enquêtes')} ({count})</option>
            {distinctPrograms.map(prog => {
              const progCount = items.filter(
                it => (it.surveyAcronym || it.surveyGroup) === prog
              ).length;
              return (
                <option key={prog} value={prog}>
                  {prog} ({progCount})
                </option>
              );
            })}
          </select>
        )}

        {/* Group by survey toggle */}
        <button
          type="button"
          className={`cart-toggle-btn ${groupBySurvey ? 'is-active' : ''}`}
          onClick={() => setGroupBySurvey(prev => !prev)}
          title={l('Toggle grouping variables by survey program', 'Regrouper les variables par programme d’enquête')}
          aria-pressed={groupBySurvey}
        >
          <Layers size={14} aria-hidden="true" />
          <span>{l('Group by Survey', 'Regrouper par enquête')}</span>
        </button>
      </div>

      {/* Variable Items List */}
      <div className="cart-items-wrap">
        {filteredItems.length === 0 ? (
          <div className="cart-no-matches">
            <p>{l('No variables in cart match the current search filter.', 'Aucune variable du panier ne correspond au filtre actuel.')}</p>
            <button
              type="button"
              className="cs-link"
              onClick={() => {
                setSearchFilter('');
                setSelectedSurveyFilter('all');
              }}
            >
              {l('Reset search filter', 'Réinitialiser le filtre de recherche')}
            </button>
          </div>
        ) : groupBySurvey && groupedItems ? (
          groupedItems.map(([progName, progItems]) => (
            <section key={progName} className="cart-group-section">
              <div className="cart-group-header">
                <div className="cart-group-title">
                  <h3 className="cart-group-name">{progName}</h3>
                  <span className="cart-group-count">
                    {progItems.length} variable{progItems.length === 1 ? '' : 's'}
                  </span>
                </div>
                {onExploreProgram && (
                  <button
                    type="button"
                    className="cs-link cart-group-explore"
                    onClick={() => onExploreProgram(progName)}
                  >
                    <span>{l('Search more', 'Rechercher d’autres variables de')} {progName} {l('variables', '')}</span>
                    <ArrowRight size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="cart-cards-list">
                {progItems.map(item => renderItemCard(item))}
              </div>
            </section>
          ))
        ) : (
          <div className="cart-cards-list">
            {filteredItems.map(item => renderItemCard(item))}
          </div>
        )}
      </div>

      {/* Floating / Bottom Return to Search Bar */}
      <div className="cart-footer">
        <p>
          {l('Need more variables? Return to the main search to query the full 438,000+ Statistics Canada metadata corpus.', 'Vous cherchez d’autres variables? Retournez à la recherche principale pour explorer le corpus de plus de 438 000 notices de Statistique Canada.')}
        </p>
        <button type="button" className="cart-primary-btn" onClick={onSearch}>
          <Search size={14} aria-hidden="true" />
          <span>{l('Return to Search', 'Retour à la recherche')}</span>
        </button>
      </div>
    </div>
  );
}
