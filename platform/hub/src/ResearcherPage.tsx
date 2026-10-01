import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Layers3, Search } from 'lucide-react';
import logo from './assets/logo.png';

export function ResearcherPage({
  onHome,
  onSearcher,
}: {
  onHome: () => void;
  onSearcher: () => void;
}) {
  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onHome}>
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Researcher</strong>
          <span className="hub__sub">Published uses of Statistics Canada data</span>
        </div>
      </header>

      <main className="hub__main researcher-page">
        <section className="researcher-hero" aria-labelledby="researcher-title">
          <div>
            <span className="researcher-status">In construction</span>
            <h1 id="researcher-title">Follow where survey data is used.</h1>
            <p>
              Researcher will connect published work to the Statistics Canada surveys and cycles it
              analyzes. It will help survey teams find articles about their data and see how the
              published record changes over time.
            </p>
            <div className="researcher-actions">
              <button type="button" className="researcher-link researcher-link--primary" onClick={onSearcher}>
                Explore surveys in Searcher <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="researcher-link researcher-link--secondary" onClick={onHome}>
                <ArrowLeft size={17} aria-hidden="true" /> Back to the Hub
              </button>
            </div>
          </div>
          <div className="researcher-hero__mark" aria-hidden="true">
            <BookOpen size={68} strokeWidth={1.25} />
            <span>Survey → Cycle → Research</span>
          </div>
        </section>

        <section className="researcher-section" aria-labelledby="researcher-planned-title">
          <div className="researcher-section__heading">
            <p className="researcher-kicker">What we are building</p>
            <h2 id="researcher-planned-title">A source-linked view of published research</h2>
            <p>These features are planned. Article records and usage charts are not available yet.</p>
          </div>
          <div className="researcher-cards">
            <article className="researcher-card">
              <Search size={23} aria-hidden="true" />
              <h3>Find articles by survey</h3>
              <p>Choose one or several surveys to see works that use them, with cycle and source evidence where available.</p>
            </article>
            <article className="researcher-card">
              <Layers3 size={23} aria-hidden="true" />
              <h3>Understand the research</h3>
              <p>Browse themes, abstracts where sharing is permitted, and named variables when a work identifies them.</p>
            </article>
            <article className="researcher-card">
              <CalendarDays size={23} aria-hidden="true" />
              <h3>See patterns over time</h3>
              <p>Compare observed publication counts by survey and year, with CRDCN and other sources identified.</p>
            </article>
          </div>
        </section>

        <section className="researcher-roadmap" aria-labelledby="researcher-roadmap-title">
          <div>
            <p className="researcher-kicker">Planned coverage</p>
            <h2 id="researcher-roadmap-title">Beginning with academic research</h2>
            <p>
              The first catalogue will draw from CRDCN and academic publications found elsewhere.
              Later stages will add Canadian government reports, NGOs and think tanks, international
              uses, and eventually media mentions. Counts will describe works found in the indexed
              sources, not all uses of Statistics Canada data.
            </p>
          </div>
          <ol aria-label="Researcher coverage stages">
            <li><span>01</span> Academic publications</li>
            <li><span>02</span> Canadian government reports</li>
            <li><span>03</span> NGOs and think tanks</li>
            <li><span>04</span> International uses</li>
            <li><span>05</span> Media mentions</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
