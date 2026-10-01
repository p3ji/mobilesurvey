import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Search } from 'lucide-react';
import logo from './assets/logo.png';
import pilotRecords from './researcherPilot.json';

interface PilotUse {
  program: string;
  precision: 'exact_cycles' | 'range' | 'program_only';
  cycles: string[];
  cycleText: string;
  evidenceLocation: string;
}
interface PilotWork {
  id: string; title: string; doi: string | null; url: string; year: number | null;
  workType: string | null; sources: string[]; theme: string | null;
  issuingOrganization: string | null;
  uses: PilotUse[]; mentions: Array<{ program: string; evidenceLocation: string }>;
}

const works = pilotRecords as PilotWork[];
const programNames: Record<string, string> = {
  CIUS: 'Canadian Internet Use Survey',
  CCHS: 'Canadian Community Health Survey',
  CHMS: 'Canadian Health Measures Survey',
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

export function ResearcherPage({ onHome, onSearcher }: { onHome: () => void; onSearcher: () => void }) {
  const [selectedSurveys, setSelectedSurveys] = useState<string[]>(initialSurveys);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const syncSurveys = () => setSelectedSurveys(initialSurveys());
    window.addEventListener('hashchange', syncSurveys);
    window.addEventListener('popstate', syncSurveys);
    return () => {
      window.removeEventListener('hashchange', syncSurveys);
      window.removeEventListener('popstate', syncSurveys);
    };
  }, []);
  const programs = useMemo(() => [...new Set(works.flatMap(work => work.uses.map(use => use.program)))].sort(), []);
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return works.filter(work =>
      (selectedSurveys.length === 0 || work.uses.some(use => selectedSurveys.includes(use.program))) &&
      (!term || [work.title, work.year, work.theme, work.workType, ...work.sources,
        ...work.uses.map(use => `${use.program} ${programNames[use.program] ?? ''} ${use.cycles.join(' ')}`)]
        .some(value => String(value ?? '').toLowerCase().includes(term)))
    ).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  }, [query, selectedSurveys]);
  const unresolved = works.filter(work => work.uses.some(use => use.precision !== 'exact_cycles')).length;

  function selectSurvey(program: string | null) {
    const next = program === null ? [] : selectedSurveys.includes(program)
      ? selectedSurveys.filter(value => value !== program)
      : [...selectedSurveys, program];
    setSelectedSurveys(next);
    const suffix = next.length ? `?surveys=${encodeURIComponent(next.join(','))}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#researcher${suffix}`);
  }

  return (
    <div className="hub">
      <header className="hub__header"><div className="hub__brand">
        <button type="button" className="hub__back" onClick={onHome}><img src={logo} alt="Back to home" className="hub__back-logo" /></button>
        <strong>Researcher</strong><span className="hub__sub">External published uses of Statistics Canada data</span>
      </div></header>

      <main className="hub__main researcher-page">
        <section className="researcher-hero" aria-labelledby="researcher-title">
          <div>
            <span className="researcher-status">Reviewed pilot · {works.length} works</span>
            <h1 id="researcher-title">Follow the research back to the data.</h1>
            <p>Explore a small, source-linked sample of outside publications that analyzed Statistics Canada surveys. Each survey and cycle shown here was checked against the publication. Statistics Canada's own publications are covered separately and can be connected by survey, cycle, and theme later.</p>
            <div className="researcher-actions">
              <button type="button" className="researcher-link researcher-link--primary" onClick={() => document.getElementById('researcher-results')?.scrollIntoView({ behavior: 'smooth' })}>Browse pilot works <ArrowRight size={17} aria-hidden="true" /></button>
              <button type="button" className="researcher-link researcher-link--secondary" onClick={onSearcher}>Explore surveys in Searcher</button>
            </div>
          </div>
          <div className="researcher-hero__summary" aria-label="Pilot coverage">
            <BookOpen size={30} strokeWidth={1.5} aria-hidden="true" />
            <strong>{works.length.toString().padStart(2, '0')}</strong><span>reviewed works</span>
            <div className="researcher-hero__summary-line"><b>{programs.length}</b> survey programs</div>
            <div className="researcher-hero__summary-line"><b>{unresolved}</b> work without exact cycles</div>
          </div>
        </section>

        <section className="researcher-section" id="researcher-results" aria-labelledby="researcher-results-title">
          <div className="researcher-section__heading">
            <p className="researcher-kicker">The pilot catalogue</p>
            <h2 id="researcher-results-title">Outside publications with reviewed data use</h2>
            <p>These works test the evidence and review process. Counts describe this indexed sample, not all research using these surveys.</p>
          </div>
          <div className="researcher-filters">
            <label className="researcher-search"><Search size={18} aria-hidden="true" />
              <input aria-label="Search pilot publications" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles, themes, years, or surveys" />
            </label>
            <div className="researcher-survey-filters" aria-label="Filter by survey">
              <button type="button" className={selectedSurveys.length === 0 ? 'is-active' : ''} aria-pressed={selectedSurveys.length === 0} onClick={() => selectSurvey(null)}>All surveys</button>
              {programs.map(program => <button key={program} type="button" className={selectedSurveys.includes(program) ? 'is-active' : ''} aria-pressed={selectedSurveys.includes(program)} onClick={() => selectSurvey(program)} title={programNames[program]}>{program}</button>)}
            </div>
          </div>
          <p className="researcher-count" aria-live="polite">Showing {shown.length} of {works.length} reviewed works</p>
          {shown.length ? <div className="researcher-results">{shown.map(work => <article className="researcher-result" key={work.id}>
            <div className="researcher-result__meta"><span>{work.year ?? 'Year unknown'}</span><span aria-hidden="true">·</span><span>{work.workType ?? 'Publication'}</span><span aria-hidden="true">·</span><span>{work.sources.join(', ')}</span></div>
            <h3><a href={work.url} target="_blank" rel="noopener noreferrer">{work.title}<ExternalLink size={15} aria-hidden="true" /></a></h3>
            <div className="researcher-result__facts">{work.theme && <span className="researcher-result__theme">Theme: {work.theme}</span>}{work.doi && <span>DOI: {work.doi}</span>}</div>
            <div className="researcher-result__uses">{work.uses.map((use, index) => <div className="researcher-use" key={`${use.program}-${index}`}>
              <div><strong>{use.program}</strong><span>{programNames[use.program] ?? use.program}</span></div>
              <p>{cycleLabel(use)}</p>
              <a href={work.url} target="_blank" rel="noopener noreferrer">Evidence: {use.evidenceLocation} <ExternalLink size={12} aria-hidden="true" /></a>
            </div>)}</div>
            {work.mentions.length > 0 && <p className="researcher-result__mention">Also mentioned: {work.mentions.map(mention => mention.program).join(', ')}. These mentions are excluded from use counts.</p>}
          </article>)}</div> : <div className="researcher-empty">No pilot works match these filters. Try another survey or search term.</div>}
        </section>

        <section className="researcher-method" aria-labelledby="researcher-method-title">
          <div><p className="researcher-kicker">How to read this page</p><h2 id="researcher-method-title">Evidence before counts</h2>
            <p>A source can name a survey without analyzing it. The pilot counts a publication under a survey only after its use claim and evidence location have been reviewed. A missing cycle stays unresolved rather than being inferred from the publication year.</p>
          </div>
          <div className="researcher-method__next"><strong>Next in the pipeline</strong>
            <p>Expand beyond this sample, review more themes and sources, and connect the catalogue to durable storage. The public counts will remain labeled as observed research outputs.</p>
            <button type="button" onClick={onHome}><ArrowLeft size={15} aria-hidden="true" /> Back to the Hub</button>
          </div>
        </section>
      </main>
    </div>
  );
}
