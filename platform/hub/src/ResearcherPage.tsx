import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Calendar, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import logo from './assets/logo.png';
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

function cycleLabel(use: PilotUse): string {
  if (use.precision === 'exact_cycles') return `${use.cycles.join(', ')} ${use.cycles.length === 1 ? 'cycle' : 'cycles'}`;
  if (use.precision === 'range') return `Reported range: ${use.cycleText}`;
  return 'Cycle not established by reviewed passage';
}

export function ResearcherPage({ onHome, onSearcher }: { onHome: () => void; onSearcher?: () => void }) {
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

  useEffect(() => {
    const syncSurveys = () => {
      setSelectedSurveys(initialSurveys());
      setSelectedCycle(null);
      setSelectedPubYear(null);
    };
    window.addEventListener('hashchange', syncSurveys);
    window.addEventListener('popstate', syncSurveys);
    return () => {
      window.removeEventListener('hashchange', syncSurveys);
      window.removeEventListener('popstate', syncSurveys);
    };
  }, []);

  const programs = useMemo(() => [...new Set(works.flatMap(work => work.uses.map(use => use.program)))].sort(), []);
  const availableThemes = useMemo(() => [...new Set(works.map(work => work.theme).filter(Boolean) as string[])].sort(), []);

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
      if (selectedType === 'report' && work.workType !== 'report') return false;
      if (selectedType === 'article' && work.workType !== 'article' && work.workType !== 'journal article') return false;
      if (selectedType === 'preprint' && work.workType !== 'preprint') return false;
      if (selectedType === 'dissertation' && work.workType !== 'dissertation') return false;
      if (selectedType === 'other' && ['article', 'journal article', 'report', 'preprint', 'dissertation'].includes(work.workType ?? '')) return false;
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
  const articlesCount = useMemo(() => works.filter(w => w.workType === 'article' || w.workType === 'journal article').length, []);
  const preprintsCount = useMemo(() => works.filter(w => w.workType === 'preprint').length, []);
  const dissertationsCount = useMemo(() => works.filter(w => w.workType === 'dissertation').length, []);
  const otherCount = useMemo(
    () => works.filter(w => !['article', 'journal article', 'report', 'preprint', 'dissertation'].includes(w.workType ?? '')).length,
    []
  );
  const exactCount = works.filter(w => w.uses.some(u => u.precision === 'exact_cycles')).length;
  const exactPercentage = works.length > 0 ? Math.round((exactCount / works.length) * 100) : 0;

  function selectSurvey(program: string | null) {
    const next = program === null ? [] : selectedSurveys.includes(program)
      ? selectedSurveys.filter(value => value !== program)
      : [...selectedSurveys, program];
    setSelectedSurveys(next);
    setSelectedCycle(null);
    setSelectedPubYear(null);
    const suffix = next.length ? `?surveys=${encodeURIComponent(next.join(','))}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher${suffix}`);
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
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher`);
  }

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onHome} aria-label="Back to home">
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Researcher</strong>
          <span className="hub__sub">External published uses of Statistics Canada data</span>
        </div>
        {onSearcher && (
          <button
            type="button"
            className="researcher-link researcher-link--secondary"
            onClick={onSearcher}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
          >
            <Search size={14} aria-hidden="true" />
            Open Searcher
          </button>
        )}
      </header>

      <main className="hub__main researcher-page">
        <section className="researcher-hero" aria-labelledby="researcher-title">
          <div>
            <span className="researcher-status">Verified Research Outputs · {works.length} works</span>
            <h1 id="researcher-title">Follow the research back to the data.</h1>
            <p>
              Explore a curated, rights-reviewed catalogue of external publications that analyzed Statistics Canada surveys.
              Every survey relationship and cycle link shown here is grounded in verbatim methods evidence.
              Statistics Canada's own publications are excluded and mapped separately to retain clear attribution.
            </p>
            <div className="researcher-actions">
              <button
                type="button"
                className="researcher-link researcher-link--primary"
                onClick={() => {
                  setSelectedYearWindow('recent');
                  setSelectedType('all');
                  document.getElementById('researcher-results')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                2025–2026 outputs ({recentCount}) <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="researcher-link researcher-link--secondary"
                onClick={() => {
                  document.getElementById('researcher-trends')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <BarChart3 size={15} aria-hidden="true" />
                Theme Trends by Year
              </button>
              <button
                type="button"
                className="researcher-link researcher-link--secondary"
                onClick={() => {
                  setSelectedType('report');
                  setSelectedYearWindow('all');
                  document.getElementById('researcher-results')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Policy & NGO Reports ({reportsCount})
              </button>
              <button
                type="button"
                className="researcher-link researcher-link--secondary"
                onClick={() => {
                  resetFilters();
                  document.getElementById('researcher-results')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                All verified works ({works.length})
              </button>
            </div>
          </div>
          <div className="researcher-hero__summary" aria-label="Pilot coverage summary">
            <BookOpen size={30} strokeWidth={1.5} aria-hidden="true" />
            <strong>{works.length.toString().padStart(2, '0')}</strong>
            <span>reviewed works</span>
            <div className="researcher-hero__summary-line">
              <b>{reportsCount}</b> policy & NGO reports
            </div>
            <div className="researcher-hero__summary-line">
              <b>{recentCount}</b> published in 2025–2026 (last year)
            </div>
            <div className="researcher-hero__summary-line">
              <b>{programs.length}</b> survey programs analyzed
            </div>
            <div className="researcher-hero__summary-line">
              <b>{exactPercentage}%</b> exact-cycle precision
            </div>
          </div>
        </section>

        <ResearcherThemesViz
          works={works}
          selectedType={selectedType}
          onSelectType={type => {
            setSelectedType(type);
            setDisplayLimit(30);
          }}
          selectedTheme={selectedTheme}
          onSelectTheme={theme => {
            setSelectedTheme(theme);
            setDisplayLimit(30);
          }}
          selectedPubYear={selectedPubYear}
          onSelectPubYear={year => {
            setSelectedPubYear(year);
            setDisplayLimit(30);
          }}
          selectedSurveys={selectedSurveys}
        />

        <section className="researcher-section" id="researcher-results" aria-labelledby="researcher-results-title">
          <div className="researcher-section__heading">
            <p className="researcher-kicker">Documented Data Uses</p>
            <h2 id="researcher-results-title">Outside publications with reviewed data analysis</h2>
            <p>
              These records count observed research outputs from indexed bibliographic sources.
              A paper citing a survey as background is tracked as a mention and excluded from data-use counts.
            </p>
          </div>

          <div className="researcher-filters">
            <label className="researcher-search">
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="Search pilot publications"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search titles, themes, authors, publishers, or surveys"
              />
            </label>
            <div className="researcher-survey-filters" aria-label="Filter by survey">
              <button
                type="button"
                className={selectedSurveys.length === 0 ? 'is-active' : ''}
                aria-pressed={selectedSurveys.length === 0}
                onClick={() => selectSurvey(null)}
              >
                All surveys
              </button>
              {programs.map(program => (
                <button
                  key={program}
                  type="button"
                  className={selectedSurveys.includes(program) ? 'is-active' : ''}
                  aria-pressed={selectedSurveys.includes(program)}
                  onClick={() => selectSurvey(program)}
                  title={programNames[program]}
                >
                  {program}
                </button>
              ))}
            </div>
          </div>

          <div className="researcher-secondary-filters">
            <div className="researcher-theme-filters" aria-label="Filter by research theme">
              <span>Theme:</span>
              <button
                type="button"
                className={`researcher-theme-chip ${selectedTheme === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedTheme('all')}
                aria-pressed={selectedTheme === 'all'}
              >
                All
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
                aria-label="Filter by document type"
              >
                <option value="all">All Document Types ({works.length})</option>
                <option value="article">Journal Articles ({articlesCount})</option>
                <option value="report">Policy & NGO Reports ({reportsCount})</option>
                <option value="preprint">Preprints & Working Papers ({preprintsCount})</option>
                <option value="dissertation">Theses & Dissertations ({dissertationsCount})</option>
                <option value="other">Datasets & Other ({otherCount})</option>
              </select>

              <select
                className="researcher-select"
                value={selectedYearWindow}
                onChange={e => {
                  setSelectedYearWindow(e.target.value as any);
                  setDisplayLimit(30);
                }}
                aria-label="Filter by publication year"
              >
                <option value="all">All Publication Years ({works.length})</option>
                <option value="recent">Last Year: 2025–2026 ({recentCount})</option>
                <option value="historical">Prior Years ({works.length - recentCount})</option>
              </select>

              <select
                className="researcher-select"
                value={selectedPrecision}
                onChange={e => {
                  setSelectedPrecision(e.target.value);
                  setDisplayLimit(30);
                }}
                aria-label="Filter by cycle precision"
              >
                <option value="all">All Precision Levels</option>
                <option value="exact_cycles">Exact Cycles Only</option>
                <option value="range">Reported Range</option>
                <option value="program_only">Program Only (Unstated)</option>
              </select>

              <select
                className="researcher-select"
                value={sortOption}
                onChange={e => setSortOption(e.target.value as any)}
                aria-label="Sort publications"
              >
                <option value="year_desc">Newest Year First</option>
                <option value="year_asc">Oldest Year First</option>
                <option value="title_asc">Title (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Survey Quick Stats: Cycles and Timeline */}
          {selectedSurveys.length > 0 && (
            <section className="researcher-survey-stats" aria-label={`Statistics for ${surveyLabel}`}>
              <div className="researcher-survey-stats__header">
                <div className="researcher-survey-stats__titles">
                  <span className="researcher-survey-stats__kicker">Survey Analysis Overview</span>
                  <h4>{surveyLabel}</h4>
                </div>
                <div className="researcher-survey-stats__badges">
                  <span className="researcher-stat-badge"><b>{surveyWorks.length}</b> publications</span>
                  <span className="researcher-stat-badge"><b>{cycleStats.length}</b> cycles identified</span>
                  {peakCycle && (
                    <span className="researcher-stat-badge">Peak cycle: <b>{peakCycle.cycle}</b> ({peakCycle.count} {peakCycle.count === 1 ? 'pub' : 'pubs'})</span>
                  )}
                  {(selectedCycle || selectedPubYear) && (
                    <button
                      type="button"
                      className="researcher-clear-cycle-btn"
                      onClick={() => { setSelectedCycle(null); setSelectedPubYear(null); }}
                    >
                      Clear year filter ({selectedCycle ? `Cycle ${selectedCycle}` : `Year ${selectedPubYear}`}) <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="researcher-survey-stats__grid">
                <div className="researcher-timeline-card">
                  <div className="researcher-timeline-card__header">
                    <span className="researcher-timeline-card__title">
                      <BarChart3 size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 5 }} />
                      Publications by Survey Cycle
                    </span>
                    <span className="researcher-timeline-card__sub">Click cycle year to filter</span>
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
                    <div className="researcher-timeline-empty">No exact cycles established in reviewed passages</div>
                  )}
                </div>

                <div className="researcher-timeline-card">
                  <div className="researcher-timeline-card__header">
                    <span className="researcher-timeline-card__title">
                      <Calendar size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 5 }} />
                      Publications by Release Year
                    </span>
                    <span className="researcher-timeline-card__sub">Click release year to filter</span>
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
                    className="researcher-link researcher-link--secondary"
                    onClick={() => setDisplayLimit(prev => prev + 30)}
                    style={{ display: 'inline-flex', padding: '10px 24px', cursor: 'pointer' }}
                  >
                    Show 30 more works ({shown.length - displayLimit} remaining)
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="researcher-empty">
              <p>No reviewed publications match the selected filters.</p>
              <button type="button" className="researcher-reset-btn" onClick={resetFilters}>
                <RotateCcw size={13} style={{ verticalAlign: '-1px', marginRight: '6px' }} /> Clear all filters
              </button>
            </div>
          )}
        </section>

        <section className="researcher-method" aria-labelledby="researcher-method-title">
          <div>
            <p className="researcher-kicker">How to read this page</p>
            <h2 id="researcher-method-title">Evidence before counts</h2>
            <p>
              A paper citing a survey does not establish data analysis. The Researcher catalogue counts a publication under a survey
              only when its methods or data section confirms actual microdata analysis. A missing or unstated cycle remains explicitly unresolved
              rather than being inferred from publication year.
            </p>
          </div>
          <div className="researcher-method__next">
            <strong>Next in the pipeline</strong>
            <p>
              Automated source intake across OpenAlex and Crossref with whole-word quote grounding, human gating, and durable SQLite WAL staging.
            </p>
            <button type="button" onClick={onHome}>
              <ArrowLeft size={15} aria-hidden="true" /> Back to the Hub
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
