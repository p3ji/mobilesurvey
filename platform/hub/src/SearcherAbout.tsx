/** A short public story of the corpus project within Searcher's tabs. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Link2, Search, Sparkles } from 'lucide-react';
import { Chrono, type TimelineItem } from 'react-chrono';
import {
  CORPUS_ATTRIBUTION,
  type CorpusAboutProgress,
  type CorpusStats,
  type SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';
import summary from './data/knowledgeGraphSummary.json';

const REFRESH_MS = 120_000;

function number(value: number): string {
  return value.toLocaleString('en-CA');
}

export function SearcherAbout({
  source,
  onExplore,
}: {
  source: SupabaseCorpusSource | null;
  onExplore: () => void;
}) {
  const [progress, setProgress] = useState<CorpusAboutProgress | null>(null);
  const [searchStats, setSearchStats] = useState<CorpusStats | null>(null);
  const [progressError, setProgressError] = useState(false);

  useEffect(() => {
    if (source === null) return;
    let controller: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      source.aboutProgress(signal)
        .then((next) => {
          if (!signal.aborted) {
            setProgress(next);
            setProgressError(false);
          }
        })
        .catch(() => { if (!signal.aborted) setProgressError(true); });
      source.stats(signal)
        .then((next) => { if (!signal.aborted) setSearchStats(next); })
        .catch(() => { /* The public archive milestones still tell the story. */ });
    };
    refresh();
    const interval = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [source]);

  const linkedPrograms = progress?.linkedPrograms ?? 0;
  const share = Math.min(100, Math.max(0, linkedPrograms / summary.totalSurveys * 100));
  const timeline = useMemo<TimelineItem[]>(() => [
    {
      id: 'receive',
      title: '01 · Received',
      cardTitle: 'Start with public documents',
      cardDetailedText: `We received non-confidential data dictionaries for ${number(summary.totalSurveys)} Statistics Canada survey programs. Together they describe ${number(summary.totalVariables)} variable entries.`,
    },
    {
      id: 'organize',
      title: '02 · Organized',
      cardTitle: 'Make the collection findable',
      cardDetailedText: `We organized the information across ${number(summary.totalCycles)} survey cycles. ${searchStats ? `${number(searchStats.variables)} English entries are now searchable, each with a route back to its source.` : 'The searchable collection points readers back to the source documents.'}`,
    },
    {
      id: 'connect',
      title: '03 · Now',
      cardTitle: 'Show how things connect',
      cardDetailedText: progress
        ? `${number(linkedPrograms)} of ${number(summary.totalSurveys)} survey programs now have at least one published, verified link. We are adding and checking more as the work continues.`
        : 'We are adding and checking links between related questions and measures across the collection.',
    },
    {
      id: 'next',
      title: '04 · Next',
      cardTitle: 'Keep opening up the picture',
      cardDetailedText: 'Review more links, improve search, and make it easier to explore survey questions across years and languages.',
    },
  ], [linkedPrograms, progress, searchStats]);

  return (
    <div className="about-page about-page__main">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero__copy">
            <p className="about-eyebrow">The story so far</p>
            <h1 id="about-title">Making public survey knowledge easier to follow.</h1>
            <p className="about-hero__lede">
              Survey documents hold decades of useful questions and measures. We are bringing them
              together so people can find what was asked, compare years, and see how published
              measures connect to their source questions.
            </p>
            <button type="button" className="about-hero__cta" onClick={onExplore}>
              Explore the collection <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="about-hero__graphic" aria-hidden="true">
            <span className="about-hero__graphic-node about-hero__graphic-node--one"><BookOpen size={26} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--two"><Search size={26} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--three"><Link2 size={28} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--four"><Sparkles size={26} /></span>
          </div>
        </section>

        <div className="about-facts" aria-label="Source collection at a glance">
          <div><strong>{number(summary.totalSurveys)}</strong><span>survey programs</span></div>
          <div><strong>{number(summary.totalVariables)}</strong><span>variable entries in the source archive</span></div>
          <div><strong>{number(summary.totalCycles)}</strong><span>survey cycles</span></div>
        </div>

        <section className="about-journey" aria-labelledby="about-journey-title">
          <div className="about-section-heading">
            <p className="about-eyebrow">Our path</p>
            <h2 id="about-journey-title">From data dictionaries to connected knowledge</h2>
          </div>
          <div className="about-timeline">
            <Chrono
              items={timeline}
              mode="VERTICAL_ALTERNATING"
              enableBreakPoint
              responsiveBreakPoint={760}
              allowDynamicUpdate
              disableToolbar
              disableInteraction
              disableAutoScrollOnClick
              disableNavOnKey
              cardHeight={136}
              cardWidth={420}
              lineWidth={3}
              useReadMore={false}
              theme={{
                primary: '#1d4ed8',
                secondary: '#dbeafe',
                cardBgColor: '#ffffff',
                cardTitleColor: '#1b2733',
                cardSubtitleColor: '#5b6b7b',
                titleColor: '#334155',
                textColor: '#334155',
              }}
            />
          </div>
        </section>

        <section className="about-progress" aria-labelledby="about-progress-title">
          <div className="about-progress__top">
            <span className="about-progress__live"><span aria-hidden="true" /> In progress</span>
            <span className="about-progress__source">Published, verified links</span>
          </div>
          <div className="about-progress__body">
            <div>
              <h2 id="about-progress-title">Connecting the surveys</h2>
              <p>Each program counted here has at least one checked link between its variables.</p>
            </div>
            <div className="about-progress__figure" aria-live="polite">
              {progress ? <><strong>{number(linkedPrograms)}<span> / {number(summary.totalSurveys)}</span></strong><small>survey programs linked</small></> :
                <span className="about-progress__pending">{progressError || source === null ? 'Live progress unavailable' : 'Checking live progress…'}</span>}
            </div>
          </div>
          <div className="about-progress__track" role="progressbar" aria-label="Survey programs with published verified links" aria-valuemin={0} aria-valuemax={summary.totalSurveys} aria-valuenow={progress ? linkedPrograms : undefined}>
            <span style={{ width: `${share}%` }} />
          </div>
          <p className="about-progress__foot">
            {progress ? `${number(progress.verifiedLinks)} individual verified links published so far. The count updates as new work is published.` : 'The timeline above remains available while live counts load.'}
          </p>
        </section>

        <section className="about-next" aria-labelledby="about-next-title">
          <div className="about-next__icon"><Check size={23} aria-hidden="true" /></div>
          <div>
            <h2 id="about-next-title">Where this is going</h2>
            <p>We want anyone exploring a survey measure to understand its meaning, find its source,
              and follow its connections across years. More reviewed links and better discovery are next.</p>
          </div>
        </section>
        <p className="about-attribution">{CORPUS_ATTRIBUTION}</p>
    </div>
  );
}
