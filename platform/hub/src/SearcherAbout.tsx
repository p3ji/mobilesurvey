/** A short public story of the corpus project within Searcher's tabs. */
import { useEffect, useMemo, useState } from 'react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
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
  onResearcher,
}: {
  source: SupabaseCorpusSource | null;
  onExplore: () => void;
  onResearcher: () => void;
}) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
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
      title: l('01 · Received', '01 · Reçus'),
      cardTitle: l('Start with public documents', 'Partir des documents publics'),
      cardDetailedText: l(`We received non-confidential data dictionaries for ${number(summary.totalSurveys)} Statistics Canada survey programs. Together they describe ${number(summary.totalVariables)} variable entries.`, `Nous avons reçu des dictionnaires de données non confidentiels pour ${number(summary.totalSurveys)} programmes d’enquête de Statistique Canada. Ils décrivent ensemble ${number(summary.totalVariables)} notices de variables.`),
    },
    {
      id: 'organize',
      title: l('02 · Organized', '02 · Organisés'),
      cardTitle: l('Make the collection findable', 'Rendre la collection consultable'),
      cardDetailedText: l(`We organized the information across ${number(summary.totalCycles)} survey cycles. ${searchStats ? `${number(searchStats.variables)} English entries are now searchable, each with a route back to its source.` : 'The searchable collection points readers back to the source documents.'}`, `Nous avons organisé l’information sur ${number(summary.totalCycles)} cycles d’enquête. ${searchStats ? `${number(searchStats.variables)} notices anglaises sont maintenant consultables, chacune avec un lien vers sa source.` : 'La collection consultable renvoie aux documents sources.'}`),
    },
    {
      id: 'connect',
      title: l('03 · Now', '03 · Aujourd’hui'),
      cardTitle: l('Show how things connect', 'Montrer les liens'),
      cardDetailedText: progress
        ? l(`${number(linkedPrograms)} of ${number(summary.totalSurveys)} survey programs now have at least one published, verified link. We are adding and checking more as the work continues.`, `${number(linkedPrograms)} des ${number(summary.totalSurveys)} programmes d’enquête ont maintenant au moins un lien vérifié et publié. Nous continuons d’en ajouter et d’en vérifier d’autres.`)
        : l('We are adding and checking links between related questions and measures across the collection.', 'Nous ajoutons et vérifions les liens entre les questions et les mesures apparentées de la collection.'),
    },
    {
      id: 'next',
      title: l('04 · Pilot', '04 · Projet pilote'),
      cardTitle: l('Follow published data use', 'Suivre les utilisations publiées des données'),
      cardDetailedText: l('The Researcher catalogue connects reviewed publications from outside Statistics Canada to the surveys and cycles they analyze. Each record links back to its source.', 'Le catalogue Researcher relie des publications externes vérifiées aux enquêtes et aux cycles qu’elles analysent. Chaque notice renvoie à sa source.'),
    },
  ], [linkedPrograms, progress, searchStats, language]);

  return (
    <div className="about-page about-page__main">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero__copy">
            <p className="about-eyebrow">{l('The story so far', 'Le parcours jusqu’ici')}</p>
            <h1 id="about-title">{l('Making public survey knowledge easier to follow.', 'Rendre les connaissances publiques sur les enquêtes plus faciles à explorer.')}</h1>
            <p className="about-hero__lede">
              {l('Survey documents hold decades of useful questions and measures. We are bringing them together so people can find what was asked, compare years, and see how published measures connect to their source questions.', 'Les documents d’enquête contiennent des décennies de questions et de mesures utiles. Nous les rassemblons pour permettre de retrouver les questions posées, de comparer les années et de relier les mesures publiées à leurs questions sources.')}
            </p>
            <button type="button" className="about-hero__cta" onClick={onExplore}>
              {l('Explore the collection', 'Explorer la collection')} <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="about-hero__graphic" aria-hidden="true">
            <span className="about-hero__graphic-node about-hero__graphic-node--one"><BookOpen size={26} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--two"><Search size={26} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--three"><Link2 size={28} /></span>
            <span className="about-hero__graphic-node about-hero__graphic-node--four"><Sparkles size={26} /></span>
          </div>
        </section>

        <div className="about-facts" aria-label={l('Source collection at a glance', 'La collection source en bref')}>
          <div><strong>{number(summary.totalSurveys)}</strong><span>{l('survey programs', 'programmes d’enquête')}</span></div>
          <div><strong>{number(summary.totalVariables)}</strong><span>{l('variable entries in the source archive', 'notices de variables dans les archives sources')}</span></div>
          <div><strong>{number(summary.totalCycles)}</strong><span>{l('survey cycles', 'cycles d’enquête')}</span></div>
        </div>

        <section className="about-journey" aria-labelledby="about-journey-title">
          <div className="about-section-heading">
            <p className="about-eyebrow">{l('Our path', 'Notre parcours')}</p>
            <h2 id="about-journey-title">{l('From data dictionaries to connected knowledge', 'Des dictionnaires de données aux connaissances reliées')}</h2>
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
            <span className="about-progress__live"><span aria-hidden="true" /> {l('In progress', 'En cours')}</span>
            <span className="about-progress__source">{l('Published, verified links', 'Liens vérifiés et publiés')}</span>
          </div>
          <div className="about-progress__body">
            <div>
              <h2 id="about-progress-title">{l('Connecting the surveys', 'Relier les enquêtes')}</h2>
              <p>{l('Each program counted here has at least one checked link between its variables.', 'Chaque programme compté ici possède au moins un lien vérifié entre ses variables.')}</p>
            </div>
            <div className="about-progress__figure" aria-live="polite">
              {progress ? <><strong>{number(linkedPrograms)}<span> / {number(summary.totalSurveys)}</span></strong><small>{l('survey programs linked', 'programmes d’enquête reliés')}</small></> :
                <span className="about-progress__pending">{progressError || source === null ? l('Live progress unavailable', 'Progression en direct indisponible') : l('Checking live progress…', 'Vérification de la progression…')}</span>}
            </div>
          </div>
          <div className="about-progress__track" role="progressbar" aria-label={l('Survey programs with published verified links', 'Programmes d’enquête avec des liens vérifiés et publiés')} aria-valuemin={0} aria-valuemax={summary.totalSurveys} aria-valuenow={progress ? linkedPrograms : undefined}>
            <span style={{ width: `${share}%` }} />
          </div>
          <p className="about-progress__foot">
            {progress ? l(`${number(progress.verifiedLinks)} individual verified links published so far. The count updates as new work is published.`, `${number(progress.verifiedLinks)} liens individuels vérifiés ont été publiés jusqu’ici. Le nombre augmente à mesure que de nouveaux travaux sont publiés.`) : l('The timeline above remains available while live counts load.', 'La chronologie ci-dessus reste accessible pendant le chargement des chiffres en direct.')}
          </p>
        </section>

        <section className="about-next" aria-labelledby="about-next-title">
          <div className="about-next__icon"><Check size={23} aria-hidden="true" /></div>
          <div>
            <h2 id="about-next-title">{l('Researcher catalogue', 'Catalogue Researcher')}</h2>
            <p>{l('Explore reviewed works published outside Statistics Canada that use its surveys, with source links, themes, and the surveys and cycles each work analyzes.', 'Explorez des travaux externes vérifiés qui utilisent les enquêtes de Statistique Canada, avec des liens vers les sources, les thèmes, les enquêtes et les cycles analysés.')}</p>
            <button type="button" className="about-next__link" onClick={onResearcher}>
              {l('See the Researcher page', 'Voir la page Researcher')} <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </section>
        <p className="about-attribution">{language === 'fr' ? 'Adapté de la documentation de Statistique Canada, publiée sous la Licence ouverte de Statistique Canada. Cette adaptation n’est pas approuvée par Statistique Canada.' : CORPUS_ATTRIBUTION}</p>
    </div>
  );
}
