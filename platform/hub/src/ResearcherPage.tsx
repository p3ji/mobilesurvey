import { useEffect, useMemo, useState } from 'react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Calendar, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import logo from './assets/brand-light.svg';
import pilotRecords from './researcherPilot.json';
import { ResearcherThemesViz } from './ResearcherThemesViz.jsx';

interface PilotUse {
  program: string;
  precision: 'exact_cycles' | 'range' | 'program_only';
  cycles: string[];
  cycleText: string;
  evidenceLocation: string;
}

interface PilotWork {
  id: string;
  title: string;
  doi: string | null;
  url: string;
  year: number | null;
  workType: string | null;
  issuingOrganization: string | null;
  sources: string[];
  theme: string | null;
  uses: PilotUse[];
  mentions: Array<{ program: string; evidenceLocation: string }>;
}

const works = pilotRecords as PilotWork[];
const programNames: Record<string, string> = {
  CIUS: 'Canadian Internet Use Survey',
  CCHS: 'Canadian Community Health Survey',
  CHMS: 'Canadian Health Measures Survey',
  GSS: 'General Social Survey',
  LFS: 'Labour Force Survey',
  CIS: 'Canadian Income Survey',
  CSD: 'Canadian Survey on Disability',
  SHS: 'Survey of Household Spending',
  APS: 'Aboriginal Peoples Survey',
  CHS: 'Canadian Housing Survey',
  SFS: 'Survey of Financial Security',
  LSIC: 'Longitudinal Survey of Immigrants to Canada',
  LISA: 'Longitudinal and International Study of Adults',
  CHSCY: 'Canadian Health Survey on Children and Youth',
  EICS: 'Employment Insurance Coverage Survey',
  NGS: 'National Graduates Survey',
  CSS: 'Canadian Social Survey',
  CPSS: 'Canadian Perspectives Survey Series',
  CSCSC: 'Canadian Survey of Cyber Security and Cybercrime',
  SDTIU: 'Survey of Digital Technology and Internet Use',
  SFGSME: 'Survey on Financing and Growth of Small and Medium Enterprises',
  SOLMP: 'Survey on the Official Language Minority Population',
  CTADS: 'Canadian Tobacco, Alcohol and Drugs Survey',
  CTNS: 'Canadian Tobacco and Nicotine Survey',
  HES: 'Households and the Environment Survey',
  PIAAC: 'Programme for the International Assessment of Adult Competencies',
  CAFHS: 'Canadian Armed Forces Health Survey',
  CAFVMHS: 'Canadian Armed Forces Members and Veterans Mental Health Follow-up Survey',
  CNICS: 'Childhood National Immunization Coverage Survey',
  CSIT: 'Canadian Survey on Interprovincial Trade',
  EWHS: 'Survey on Working from Home and Working Conditions',
  PSIS: 'Postsecondary Student Information System',
  RAIS: 'Registered Apprenticeship Information System',
  IMDB: 'Longitudinal Immigration Database',
  NHS: 'National Household Survey',
  PSES: 'Public Service Employee Survey',
  CLPS: 'Canadian Legal Problems Survey',
  CVCS: 'Canadian Survey on Victimization and Community Safety',
  SCMH: 'Survey on COVID-19 and Mental Health',
  CADS: 'Canadian Alcohol and Drugs Survey',
  PSSCSC: 'Survey on Postsecondary Students Skills and Career Prospects',
  SMHSE: 'Survey on Mental Health and Stressful Events',
};

function initialSurveys(): string[] {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const raw = params.get('surveys') ?? params.get('survey') ?? '';
  return raw.split(',').filter(program => program in programNames);
}

function initialTab(): 'stats' | 'search' {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const tab = params.get('tab');
  if (tab === 'search') return 'search';
  if (tab === 'stats') return 'stats';
  return 'stats';
}

function cycleLabel(use: PilotUse): string {
  if (use.precision === 'exact_cycles') return `${use.cycles.join(', ')} ${use.cycles.length === 1 ? 'cycle' : 'cycles'}`;
  if (use.precision === 'range') return `Reported range: ${use.cycleText}`;
  return 'Cycle not established by reviewed passage';
}

export function ResearcherPage({ onHome, onSearcher }: { onHome: () => void; onSearcher?: () => void }) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const [activeTab, setActiveTab] = useState<'stats' | 'search'>(initialTab);
  const [selectedSurveys, setSelectedSurveys] = useState<string[]>(initialSurveys);
  const [selectedTheme, setSelectedTheme] = useState<string>('all');
  const [selectedPrecision, setSelectedPrecision] = useState<string>('all');
  const [selectedYearWindow, setSelectedYearWindow] = useState<'all' | 'recent' | 'historical'>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
  const [selectedPubYear, setSelectedPubYear] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<'year_desc' | 'year_asc' | 'title_asc'>('year_desc');
  const [query, setQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(30);

  function handleTabChange(nextTab: 'stats' | 'search') {
    setActiveTab(nextTab);
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    params.set('tab', nextTab);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher?${params.toString()}`);
  }

  useEffect(() => {
    const syncState = () => {
      setActiveTab(initialTab());
      setSelectedSurveys(initialSurveys());
      setSelectedCycle(null);
      setSelectedPubYear(null);
    };
    window.addEventListener('hashchange', syncState);
    window.addEventListener('popstate', syncState);
    return () => {
      window.removeEventListener('hashchange', syncState);
      window.removeEventListener('popstate', syncState);
    };
  }, []);

  const programs = useMemo(() => [...new Set(works.flatMap(work => work.uses.map(use => use.program)))].sort(), []);
  const availableThemes = useMemo(() => [...new Set(works.map(work => work.theme).filter(Boolean) as string[])].sort(), []);

  const programCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const work of works) {
      for (const use of work.uses) {
        counts[use.program] = (counts[use.program] ?? 0) + 1;
      }
    }
    return counts;
  }, []);

  const surveyWorks = useMemo(() => {
    if (selectedSurveys.length === 0) return [];
    return works.filter(w => w.uses.some(u => selectedSurveys.includes(u.program)));
  }, [selectedSurveys]);

  const cycleStats = useMemo(() => {
    if (selectedSurveys.length === 0) return [];
    const map = new Map<string, number>();
    for (const work of surveyWorks) {
      const workCycles = new Set<string>();
      for (const use of work.uses) {
        if (selectedSurveys.includes(use.program)) {
          for (const c of use.cycles) workCycles.add(c);
        }
      }
      for (const c of workCycles) {
        map.set(c, (map.get(c) ?? 0) + 1);
      }
    }
    const entries = Array.from(map.entries()).sort((a, b) => {
      const numA = parseInt(a[0], 10);
      const numB = parseInt(b[0], 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a[0].localeCompare(b[0]);
    });
    const maxCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);
    return entries.map(([cycle, count]) => ({
      cycle,
      count,
      heightPct: maxCount > 0 ? Math.max(16, Math.round((count / maxCount) * 100)) : 16,
    }));
  }, [selectedSurveys, surveyWorks]);

  const pubYearStats = useMemo(() => {
    if (selectedSurveys.length === 0) return [];
    const map = new Map<number, number>();
    for (const work of surveyWorks) {
      if (work.year) {
        map.set(work.year, (map.get(work.year) ?? 0) + 1);
      }
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    const maxCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);
    return entries.map(([year, count]) => ({
      year,
      count,
      heightPct: maxCount > 0 ? Math.max(16, Math.round((count / maxCount) * 100)) : 16,
    }));
  }, [selectedSurveys, surveyWorks]);

  const peakCycle = useMemo(() => {
    if (cycleStats.length === 0) return null;
    return [...cycleStats].sort((a, b) => b.count - a.count)[0];
  }, [cycleStats]);

  const surveyLabel = useMemo(() => {
    if (selectedSurveys.length === 0) return '';
    return selectedSurveys.map(p => `${p} — ${programNames[p] ?? p}`).join(', ');
  }, [selectedSurveys]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return works.filter(work => {
      // Survey filter
      if (selectedSurveys.length > 0 && !work.uses.some(use => selectedSurveys.includes(use.program))) return false;
      // Theme filter
      if (selectedTheme !== 'all' && work.theme?.toLowerCase() !== selectedTheme.toLowerCase()) return false;
      // Precision filter
      if (selectedPrecision !== 'all' && !work.uses.some(use => use.precision === selectedPrecision)) return false;
      // Year window filter
      if (selectedYearWindow === 'recent' && (work.year ?? 0) < 2025) return false;
      if (selectedYearWindow === 'historical' && (work.year ?? 0) >= 2025) return false;
      // Document type filter
      if (selectedType !== 'all' && work.workType !== selectedType) return false;
      // Cycle year filter
      if (selectedCycle) {
        const hasCycle = work.uses.some(u =>
          selectedSurveys.includes(u.program) &&
          (u.cycles.includes(selectedCycle) || u.cycleText.includes(selectedCycle))
        );
        if (!hasCycle) return false;
      }
      // Publication year filter
      if (selectedPubYear && work.year !== selectedPubYear) return false;
      // Query search
      if (term) {
        const hay = [
          work.title,
          work.year,
          work.theme,
          work.workType,
          work.issuingOrganization,
          ...work.sources,
          ...work.uses.map(use => `${use.program} ${programNames[use.program] ?? ''} ${use.cycles.join(' ')} ${use.cycleText}`),
        ].map(v => String(v ?? '').toLowerCase());
        if (!hay.some(v => v.includes(term))) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortOption === 'year_desc') return (b.year ?? 0) - (a.year ?? 0);
      if (sortOption === 'year_asc') return (a.year ?? 0) - (b.year ?? 0);
      return a.title.localeCompare(b.title);
    });
  }, [query, selectedSurveys, selectedTheme, selectedPrecision, selectedYearWindow, selectedType, selectedCycle, selectedPubYear, sortOption]);

  const recentCount = useMemo(() => works.filter(w => (w.year ?? 0) >= 2025).length, []);
  const reportsCount = useMemo(() => works.filter(w => w.workType === 'report').length, []);
  const articlesCount = useMemo(() => works.filter(w => w.workType === 'article').length, []);
  const preprintsCount = useMemo(() => works.filter(w => w.workType === 'preprint').length, []);
  const dissertationsCount = useMemo(() => works.filter(w => w.workType === 'dissertation').length, []);
  const conferencesCount = useMemo(() => works.filter(w => w.workType === 'conference-paper').length, []);
  const exactCount = works.filter(w => w.uses.some(u => u.precision === 'exact_cycles')).length;
  const exactPercentage = works.length > 0 ? Math.round((exactCount / works.length) * 100) : 0;

  function selectSurvey(program: string | null) {
    const next = program === null ? [] : selectedSurveys.includes(program)
      ? selectedSurveys.filter(value => value !== program)
      : [...selectedSurveys, program];
    setSelectedSurveys(next);
    setSelectedCycle(null);
    setSelectedPubYear(null);
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    params.set('tab', activeTab);
    if (next.length) {
      params.set('surveys', next.join(','));
    } else {
      params.delete('surveys');
      params.delete('survey');
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher?${params.toString()}`);
  }

  function resetFilters() {
    setSelectedSurveys([]);
    setSelectedTheme('all');
    setSelectedPrecision('all');
    setSelectedYearWindow('all');
    setSelectedType('all');
    setSelectedCycle(null);
    setSelectedPubYear(null);
    setQuery('');
    setSortOption('year_desc');
    setDisplayLimit(30);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher?tab=${activeTab}`);
  }

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onHome} aria-label={l('Back to home', 'Retour à l’accueil')}>
            <img src={logo} alt={l('Back to home', 'Retour à l’accueil')} className="hub__back-logo" />
          </button>
          <strong>Researcher</strong>
          <span className="hub__sub">{l('External published uses of Statistics Canada data', 'Publications externes utilisant les données de Statistique Canada')}</span>
        </div>
        {onSearcher && (
          <button
            type="button"
            className="researcher-header-btn"
            onClick={onSearcher}
          >
            <Search size={14} aria-hidden="true" />
            {l('Open Searcher', 'Ouvrir Searcher')}
          </button>
        )}
      </header>

      <main className="hub__main researcher-page">
        <section className="researcher-hero" aria-labelledby="researcher-title">
          <div>
            <span className="researcher-status">{l('Verified Research Outputs', 'Publications de recherche vérifiées')} (2015–2026) · {works.length} {l('works', 'travaux')}</span>
            <h1 id="researcher-title">{l('Follow the research back to the data.', 'Remontez de la recherche jusqu’aux données.')}</h1>
            <p>
              {l("Explore a curated, rights-reviewed catalogue of external publications that analyzed Statistics Canada surveys. Every survey relationship and cycle link shown here is grounded in verbatim methods evidence. Statistics Canada's own publications are excluded and mapped separately to retain clear attribution.", 'Explorez un catalogue sélectionné de publications externes qui ont analysé des enquêtes de Statistique Canada. Chaque lien avec une enquête ou un cycle repose sur une preuve explicite dans la méthode de l’étude. Les publications de Statistique Canada sont répertoriées séparément.')}
            </p>
            <div className="researcher-hero__mobile-stats">
              <span><b>{works.length}</b> {l('reviewed works', 'travaux vérifiés')}</span>
              <span><b>{programs.length}</b> {l('survey programs', 'programmes d’enquête')}</span>
              <span><b>{reportsCount}</b> {l('policy reports', 'rapports de politiques')}</span>
              <span><b>{exactPercentage}%</b> {l('exact cycle', 'cycle exact')}</span>
            </div>
          </div>
          <div className="researcher-hero__summary" aria-label={l('Pilot coverage summary', 'Sommaire de la couverture du projet pilote')}>
            <BookOpen size={30} strokeWidth={1.5} aria-hidden="true" />
            <strong>{works.length.toString().padStart(2, '0')}</strong>
            <span>{l('reviewed works', 'travaux vérifiés')}</span>
            <div className="researcher-hero__summary-line">
              <b>{reportsCount}</b> {l('policy & NGO reports', 'rapports de politiques et d’ONG')}
            </div>
            <div className="researcher-hero__summary-line">
              <b>{recentCount}</b> {l('published in 2025–2026 (last year)', 'publiés en 2025–2026')}
            </div>
            <div className="researcher-hero__summary-line">
              <b>{programs.length}</b> {l('survey programs analyzed', 'programmes d’enquête analysés')}
            </div>
            <div className="researcher-hero__summary-line">
              <b>{exactPercentage}%</b> {l('exact-cycle precision', 'cycles identifiés avec précision')}
            </div>
          </div>
        </section>

        {/* Top-Level Navigation Tabs: 1) Stats  2) Search */}
        <div className="researcher-tabs-container">
          <nav className="researcher-tabs" role="tablist" aria-label={l('Researcher views', 'Vues de Researcher')}>
            <button
              type="button"
              role="tab"
              id="tab-stats"
              aria-controls="panel-stats"
              aria-selected={activeTab === 'stats'}
              className={`researcher-tab ${activeTab === 'stats' ? 'researcher-tab--active' : ''}`}
              onClick={() => handleTabChange('stats')}
            >
              <BarChart3 size={16} aria-hidden="true" />
              <span className="researcher-tab__label-desktop">1) {l('Stats & Output Trends', 'Statistiques et tendances de publication')}</span>
              <span className="researcher-tab__label-mobile">1) {l('Stats & Trends', 'Statistiques et tendances')}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="tab-search"
              aria-controls="panel-search"
              aria-selected={activeTab === 'search'}
              className={`researcher-tab ${activeTab === 'search' ? 'researcher-tab--active' : ''}`}
              onClick={() => handleTabChange('search')}
            >
              <Search size={16} aria-hidden="true" />
              <span className="researcher-tab__label-desktop">2) {l('Search Publications', 'Rechercher des publications')} ({works.length})</span>
              <span className="researcher-tab__label-mobile">2) {l('Search', 'Rechercher')} ({works.length})</span>
            </button>
          </nav>
        </div>

        {/* Tab 1: Stats & Empirical Thematic Trends */}
        <div
          id="panel-stats"
          role="tabpanel"
          aria-labelledby="tab-stats"
          hidden={activeTab !== 'stats'}
          style={{ display: activeTab === 'stats' ? 'block' : 'none' }}
        >
          <ResearcherThemesViz
            works={works}
            programNames={programNames}
            onSwitchToSearch={() => handleTabChange('search')}
          />
        </div>

        {/* Tab 2: Search Publications Catalogue */}
        <div
          id="panel-search"
          role="tabpanel"
          aria-labelledby="tab-search"
          hidden={activeTab !== 'search'}
          style={{ display: activeTab === 'search' ? 'block' : 'none' }}
        >
            <section className="researcher-section" id="researcher-results" aria-labelledby="researcher-results-title">
          <div className="researcher-section__heading">
            <p className="researcher-kicker">{l('Documented Data Uses', 'Utilisations documentées des données')}</p>
            <h2 id="researcher-results-title">{l('Outside publications with reviewed data analysis', 'Publications externes dont l’analyse des données a été vérifiée')}</h2>
            <p>
              {l('These records count observed research outputs from indexed bibliographic sources. A paper citing a survey as background is tracked as a mention and excluded from data-use counts.', 'Ces notices dénombrent les travaux repérés dans les sources bibliographiques indexées. Une publication qui cite une enquête en contexte est comptée comme mention, et non comme utilisation de ses données.')}
            </p>
          </div>

          <div className="researcher-filters">
            <label className="researcher-search">
              <Search size={18} aria-hidden="true" />
              <input
                aria-label={l('Search pilot publications', 'Rechercher dans les publications du projet pilote')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={l('Search titles, themes, authors, publishers, or surveys', 'Rechercher un titre, thème, auteur, éditeur ou une enquête')}
              />
            </label>
            <div className="researcher-survey-filters" aria-label={l('Filter by survey', 'Filtrer par enquête')}>
              <button
                type="button"
                className={selectedSurveys.length === 0 ? 'is-active' : ''}
                aria-pressed={selectedSurveys.length === 0}
                onClick={() => selectSurvey(null)}
              >
                {l('All surveys', 'Toutes les enquêtes')} <span className="researcher-survey-badge">{works.length}</span>
              </button>
              {programs.map(program => (
                <button
                  key={program}
                  type="button"
                  className={selectedSurveys.includes(program) ? 'is-active' : ''}
                  aria-pressed={selectedSurveys.includes(program)}
                  onClick={() => selectSurvey(program)}
                  title={`${programNames[program] ?? program} (${programCounts[program] ?? 0} publications)`}
                >
                  {program} <span className="researcher-survey-badge">{programCounts[program] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="researcher-secondary-filters">
            <div className="researcher-theme-filters" aria-label={l('Filter by research theme', 'Filtrer par thème de recherche')}>
              <span>{l('Theme:', 'Thème :')}</span>
              <button
                type="button"
                className={`researcher-theme-chip ${selectedTheme === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedTheme('all')}
                aria-pressed={selectedTheme === 'all'}
              >
                {l('All', 'Tous')}
              </button>
              {availableThemes.map(theme => (
                <button
                  key={theme}
                  type="button"
                  className={`researcher-theme-chip ${selectedTheme === theme ? 'is-active' : ''}`}
                  onClick={() => setSelectedTheme(theme)}
                  aria-pressed={selectedTheme === theme}
                >
                  {theme}
                </button>
              ))}
            </div>

            <div className="researcher-controls">
              <select
                className="researcher-select"
                value={selectedType}
                onChange={e => {
                  setSelectedType(e.target.value);
                  setDisplayLimit(30);
                }}
                aria-label={l('Filter by document type', 'Filtrer par type de document')}
              >
                <option value="all">{l('All Document Types', 'Tous les types de documents')} ({works.length})</option>
                <option value="article">{l('Journal Articles', 'Articles de revue')} ({articlesCount})</option>
                <option value="report">{l('Policy & Institutional Reports', 'Rapports de politiques et d’organismes')} ({reportsCount})</option>
                <option value="dissertation">{l('Theses & Dissertations', 'Thèses et mémoires')} ({dissertationsCount})</option>
                <option value="preprint">{l('Preprints & Working Papers', 'Prépublications et documents de travail')} ({preprintsCount})</option>
                <option value="conference-paper">{l('Conference Papers', 'Communications de conférence')} ({conferencesCount})</option>
              </select>

              <select
                className="researcher-select"
                value={selectedYearWindow}
                onChange={e => {
                  setSelectedYearWindow(e.target.value as any);
                  setDisplayLimit(30);
                }}
                aria-label={l('Filter by publication year', 'Filtrer par année de publication')}
              >
                <option value="all">{l('All Publication Years', 'Toutes les années de publication')} : 2015–2026 ({works.length})</option>
                <option value="recent">{l('Recent Surge', 'Période récente')} : 2025–2026 ({recentCount})</option>
                <option value="historical">{l('Baseline Horizon', 'Période antérieure')} : 2015–2024 ({works.length - recentCount})</option>
              </select>

              <select
                className="researcher-select"
                value={selectedPrecision}
                onChange={e => {
                  setSelectedPrecision(e.target.value);
                  setDisplayLimit(30);
                }}
                aria-label={l('Filter by cycle precision', 'Filtrer selon la précision du cycle')}
              >
                <option value="all">{l('All Precision Levels', 'Tous les niveaux de précision')}</option>
                <option value="exact_cycles">{l('Exact Cycles Only', 'Cycles exacts seulement')}</option>
                <option value="range">{l('Reported Range', 'Intervalle déclaré')}</option>
                <option value="program_only">{l('Program Only (Unstated)', 'Programme seulement (cycle non précisé)')}</option>
              </select>

              <select
                className="researcher-select"
                value={sortOption}
                onChange={e => setSortOption(e.target.value as any)}
                aria-label={l('Sort publications', 'Trier les publications')}
              >
                <option value="year_desc">{l('Newest Year First', 'Années les plus récentes d’abord')}</option>
                <option value="year_asc">{l('Oldest Year First', 'Années les plus anciennes d’abord')}</option>
                <option value="title_asc">{l('Title (A-Z)', 'Titre (A–Z)')}</option>
              </select>
            </div>
          </div>

          {/* Survey Quick Stats: Cycles and Timeline */}
          {selectedSurveys.length > 0 && (
            <section className="researcher-survey-stats" aria-label={`Statistics for ${surveyLabel}`}>
              <div className="researcher-survey-stats__header">
                <div className="researcher-survey-stats__titles">
                  <span className="researcher-survey-stats__kicker">{l('Survey Analysis Overview', 'Aperçu des analyses par enquête')}</span>
                  <h4>{surveyLabel}</h4>
                </div>
                <div className="researcher-survey-stats__badges">
                  <span className="researcher-stat-badge"><b>{surveyWorks.length}</b> {l('publications', 'publications')}</span>
                  <span className="researcher-stat-badge"><b>{cycleStats.length}</b> {l('cycles identified', 'cycles identifiés')}</span>
                  {peakCycle && (
                    <span className="researcher-stat-badge">{l('Peak cycle:', 'Cycle le plus étudié :')} <b>{peakCycle.cycle}</b> ({peakCycle.count} {l('pubs', 'publications')})</span>
                  )}
                  {(selectedCycle || selectedPubYear) && (
                    <button
                      type="button"
                      className="researcher-clear-cycle-btn"
                      onClick={() => { setSelectedCycle(null); setSelectedPubYear(null); }}
                    >
                      {l('Clear year filter', 'Effacer le filtre d’année')} ({selectedCycle ? `Cycle ${selectedCycle}` : `${l('Year', 'Année')} ${selectedPubYear}`}) <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="researcher-survey-stats__grid">
                <div className="researcher-timeline-card">
                  <div className="researcher-timeline-card__header">
                    <span className="researcher-timeline-card__title">
                      <BarChart3 size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 5 }} />
                      {l('Publications by Survey Cycle', 'Publications par cycle d’enquête')}
                    </span>
                    <span className="researcher-timeline-card__sub">{l('Click cycle year to filter', 'Cliquez sur un cycle pour filtrer')}</span>
                  </div>
                  {cycleStats.length > 0 ? (
                    <div className="researcher-timeline-chart" role="group" aria-label="Survey cycle distribution">
                      {cycleStats.map(({ cycle, count, heightPct }) => (
                        <button
                          key={cycle}
                          type="button"
                          className={`researcher-timeline-item ${selectedCycle === cycle ? 'is-active' : ''}`}
                          onClick={() => {
                            setSelectedCycle(selectedCycle === cycle ? null : cycle);
                            setDisplayLimit(30);
                          }}
                          title={`Cycle ${cycle}: ${count} publication${count === 1 ? '' : 's'}. Click to filter.`}
                          aria-pressed={selectedCycle === cycle}
                        >
                          <span className="researcher-timeline-item__count">{count}</span>
                          <div className="researcher-timeline-item__track">
                            <div className="researcher-timeline-item__bar" style={{ height: `${heightPct}%` }} />
                          </div>
                          <span className="researcher-timeline-item__label">{cycle}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="researcher-timeline-empty">{l('No exact cycles established in reviewed passages', 'Aucun cycle exact établi dans les extraits examinés')}</div>
                  )}
                </div>

                <div className="researcher-timeline-card">
                  <div className="researcher-timeline-card__header">
                    <span className="researcher-timeline-card__title">
                      <Calendar size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 5 }} />
                      {l('Publications by Release Year', 'Publications par année de parution')}
                    </span>
                    <span className="researcher-timeline-card__sub">{l('Click release year to filter', 'Cliquez sur une année de parution pour filtrer')}</span>
                  </div>
                  {pubYearStats.length > 0 ? (
                    <div className="researcher-timeline-chart" role="group" aria-label="Publication year distribution">
                      {pubYearStats.map(({ year, count, heightPct }) => (
                        <button
                          key={year}
                          type="button"
                          className={`researcher-timeline-item ${selectedPubYear === year ? 'is-active' : ''}`}
                          onClick={() => {
                            setSelectedPubYear(selectedPubYear === year ? null : year);
                            setDisplayLimit(30);
                          }}
                          title={`Published in ${year}: ${count} publication${count === 1 ? '' : 's'}. Click to filter.`}
                          aria-pressed={selectedPubYear === year}
                        >
                          <span className="researcher-timeline-item__count">{count}</span>
                          <div className="researcher-timeline-item__track">
                            <div className="researcher-timeline-item__bar researcher-timeline-item__bar--pub" style={{ height: `${heightPct}%` }} />
                          </div>
                          <span className="researcher-timeline-item__label">{year}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="researcher-timeline-empty">No publication years recorded</div>
                  )}
                </div>
              </div>
            </section>
          )}

          <p className="researcher-count" aria-live="polite">
            Showing {Math.min(shown.length, displayLimit)} of {shown.length} matched works ({works.length} total reviewed)
            {selectedSurveys.length > 0 && (
              <span className="researcher-active-filter-badge">
                Survey: {selectedSurveys.join(', ')}
                <button type="button" onClick={() => { setSelectedSurveys([]); setSelectedCycle(null); setSelectedPubYear(null); }} aria-label="Remove survey filter">×</button>
              </span>
            )}
            {selectedType !== 'all' && (
              <span className="researcher-active-filter-badge">
                Type: {selectedType === 'conference-paper' ? 'Conference Paper' : selectedType}
                <button type="button" onClick={() => setSelectedType('all')} aria-label="Remove document type filter">×</button>
              </span>
            )}
            {selectedTheme !== 'all' && (
              <span className="researcher-active-filter-badge">
                Theme: {selectedTheme}
                <button type="button" onClick={() => setSelectedTheme('all')} aria-label="Remove theme filter">×</button>
              </span>
            )}
            {selectedCycle && (
              <span className="researcher-active-filter-badge">
                Cycle {selectedCycle}
                <button type="button" onClick={() => setSelectedCycle(null)} aria-label="Remove cycle filter">×</button>
              </span>
            )}
            {selectedPubYear && (
              <span className="researcher-active-filter-badge">
                Published {selectedPubYear}
                <button type="button" onClick={() => setSelectedPubYear(null)} aria-label="Remove publication year filter">×</button>
              </span>
            )}
            {(selectedSurveys.length > 0 || selectedTheme !== 'all' || selectedPrecision !== 'all' || selectedYearWindow !== 'all' || selectedType !== 'all' || selectedCycle !== null || selectedPubYear !== null || query.trim()) && (
              <button type="button" onClick={resetFilters} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}>
                Reset all filters
              </button>
            )}
          </p>

          {shown.length ? (
            <>
              <div className="researcher-results">
                {shown.slice(0, displayLimit).map(work => (
                  <article className="researcher-result" key={work.id}>
                    <div className="researcher-result__meta">
                      <span>{work.year ?? 'Year unknown'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{work.workType ?? 'Publication'}</span>
                      {work.issuingOrganization && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="researcher-badge researcher-badge--org">{work.issuingOrganization}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      {work.sources.map(src => (
                        <span key={src} className="researcher-badge researcher-badge--source">{src}</span>
                      ))}
                    </div>

                    <h3>
                      <a href={work.url} target="_blank" rel="noopener noreferrer">
                        {work.title}
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </h3>

                    <div className="researcher-result__facts">
                      {work.theme && <span className="researcher-result__theme">Theme: {work.theme}</span>}
                      {work.doi && (
                        <a href={`https://doi.org/${work.doi}`} target="_blank" rel="noopener noreferrer" style={{ color: '#536575', textDecoration: 'none' }}>
                          DOI: {work.doi}
                        </a>
                      )}
                    </div>

                    <div className="researcher-result__uses">
                      {work.uses.map((use, index) => (
                        <div className="researcher-use" key={`${use.program}-${index}`}>
                          <div>
                            <strong>{use.program}</strong>
                            <span>{programNames[use.program] ?? use.program}</span>
                          </div>
                          <p>{cycleLabel(use)}</p>
                          <div className="researcher-use__footer">
                            <a href={work.url} target="_blank" rel="noopener noreferrer">
                              Evidence: {use.evidenceLocation} <ExternalLink size={12} aria-hidden="true" />
                            </a>
                            {onSearcher && (
                              <button
                                type="button"
                                onClick={() => {
                                  window.location.hash = `#searcher?survey=${encodeURIComponent(use.program)}`;
                                  onSearcher();
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#0d6efd',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  padding: '0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  marginLeft: 'auto',
                                }}
                                title={`Search variables in ${use.program}`}
                              >
                                Search {use.program} variables <ArrowRight size={11} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {work.mentions.length > 0 && (
                      <p className="researcher-result__mention">
                        <b>Background mention:</b> {work.mentions.map(m => `${m.program} (${m.evidenceLocation})`).join(', ')}. Mentions are excluded from data-use counts.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              {shown.length > displayLimit && (
                <div style={{ textAlign: 'center', marginTop: '24px' }}>
                  <button
                    type="button"
                    className="researcher-load-more-btn"
                    onClick={() => setDisplayLimit(prev => prev + 30)}
                  >
                    {l('Show 30 more works', 'Afficher 30 autres travaux')} ({shown.length - displayLimit} {l('remaining', 'restants')})
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="researcher-empty">
              <p>{l('No reviewed publications match the selected filters.', 'Aucune publication vérifiée ne correspond aux filtres sélectionnés.')}</p>
              <button type="button" className="researcher-reset-btn" onClick={resetFilters}>
                <RotateCcw size={13} style={{ verticalAlign: '-1px', marginRight: '6px' }} /> {l('Clear all filters', 'Effacer tous les filtres')}
              </button>
            </div>
          )}
        </section>
      </div>

    <section className="researcher-method" aria-labelledby="researcher-method-title">
          <div>
            <p className="researcher-kicker">{l('How to read this page', 'Comment lire cette page')}</p>
            <h2 id="researcher-method-title">{l('Evidence before counts', 'Des preuves avant les chiffres')}</h2>
            <p>
              {l('A paper citing a survey does not establish data analysis. The Researcher catalogue counts a publication under a survey only when its methods or data section confirms actual microdata analysis. A missing or unstated cycle remains explicitly unresolved rather than being inferred from publication year.', 'La citation d’une enquête ne prouve pas que ses données ont été analysées. Le catalogue Researcher associe une publication à une enquête seulement lorsque sa méthode ou sa section sur les données confirme l’analyse des microdonnées. Un cycle absent ou non précisé demeure indéterminé; il n’est pas déduit de l’année de publication.')}
            </p>
          </div>
          <div className="researcher-method__next">
            <strong>{l('Next in the pipeline', 'Prochaine étape')}</strong>
            <p>
              {l('Automated source intake across OpenAlex and Crossref with whole-word quote grounding, human gating, and durable SQLite WAL staging.', 'Intégration automatisée des sources OpenAlex et Crossref, avec vérification des citations, revue humaine et préparation fiable des données.')}
            </p>
            <button type="button" onClick={onHome}>
              <ArrowLeft size={15} aria-hidden="true" /> {l('Back to the Hub', 'Retour à l’accueil')}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
