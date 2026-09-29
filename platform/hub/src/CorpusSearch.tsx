/**
 * Searching the Statistics Canada metadata corpus (docs/metadata-repo-plan.md, M4).
 *
 * Searcher queries published StatCan documentation, ranks occurrences in Postgres, and cites
 * every result. The Designer owns searching and reusing questions in the user's own surveys.
 *
 * ### Three things this component owes the licence, not the design
 *
 * The Statistics Canada Open Licence requires attribution, forbids implying endorsement, and
 * requires adaptations to be identifiable as adaptations (D8). None of those is a footnote here:
 * the notice sits above the results where it cannot be scrolled past, every card carries its own
 * source citation, and the wording says "adapted from" rather than naming StatCan as the
 * publisher of this tool's output.
 *
 * ### Why the query is debounced rather than submitted
 *
 * Type-ahead is what makes a metadata repository feel searchable rather than consultable, but each
 * keystroke is a ranked query over the whole table. 250 ms is long enough that a typed word issues
 * one query instead of six, and short enough that it still reads as live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CORPUS_ATTRIBUTION,
  type CorpusCode,
  type CorpusDirectInput,
  type CorpusLineageTarget,
  type CorpusMeta,
  type CorpusStats,
  type CorpusSuggestion,
  type CorpusSurvey,
  type SearchHit,
  type SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';
import { CorpusDocumentReader } from './CorpusDocument.js';
import { CorpusSubjects } from './CorpusSubjects.js';
import { classifyHit } from './graphClassifier.js';
import { groupCorpusHits } from './groupCorpusHits.js';
import type { CorpusGraphFocus } from './CorpusLineage.js';

const DEBOUNCE_MS = 250;
const PAGE_SIZE = 25;
/** Categories shown before the card collapses the rest behind a count. */
const CODES_SHOWN = 6;

type LangFilter = 'all' | 'en' | 'fr';

function formatInt(value: number): string {
  return value.toLocaleString('en-CA');
}

/** Label for one response category: `1 — Yes (10,137)`. */
function codeLabel(code: CorpusCode): string {
  return code.f === undefined ? code.l : `${code.l} (${formatInt(code.f)})`;
}

function CodeList({ codes }: { codes: CorpusCode[] }) {
  const [expanded, setExpanded] = useState(false);
  if (codes.length === 0) return null;
  const shown = expanded ? codes : codes.slice(0, CODES_SHOWN);
  const hidden = codes.length - shown.length;

  return (
    <div className="cs-codes">
      {shown.map((code, i) => (
        <span key={`${code.c}-${i}`} className="cs-code">
          <strong>{code.c}</strong> {codeLabel(code)}
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" className="cs-code cs-code--more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}

/**
 * What to offer when a query finds nothing and auto-correction did not fire.
 *
 * Distinct from the correction path above: this runs when the best suggestion also returned zero,
 * or when the reader has insisted on their spelling. It lists near words rather than applying one,
 * because at that point the system has already been wrong once.
 *
 * An empty list is rendered as a statement about the corpus — `narcotic` is not a typo, it is a
 * word Statistics Canada does not use — rather than as silence.
 */
function Suggestions({
  source,
  query,
  onPick,
}: {
  source: SupabaseCorpusSource;
  query: string;
  onPick: (term: string) => void;
}) {
  const [terms, setTerms] = useState<CorpusSuggestion[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTerms(null);
    source
      .suggest(query, { limit: 6, signal: controller.signal })
      .then(setTerms)
      .catch(() => {
        if (!controller.signal.aborted) setTerms([]);
      });
    return () => controller.abort();
  }, [source, query]);

  if (terms === null) return null;
  if (terms.length === 0) {
    return (
      <p className="cs-suggest cs-suggest--none">
        No close match in the corpus vocabulary either — Statistics Canada may simply use different
        wording for this. Try a related term, or browse <strong>Concepts over time</strong>.
      </p>
    );
  }
  return (
    <p className="cs-suggest">
      Words the corpus does use:{' '}
      {terms.map((t, i) => (
        <span key={t.term}>
          {i > 0 && ', '}
          <button type="button" className="cs-link" onClick={() => onPick(t.term)}>
            {t.term}
          </button>
          <span className="cs-suggest__n"> ({formatInt(t.records)})</span>
        </span>
      ))}
    </p>
  );
}

function CorpusHit({
  hit,
  inputs,
  graphTargets,
  onOpen,
  onSelectVar,
  conceptId,
  onOpenConcept,
  onOpenGraph,
}: {
  hit: SearchHit;
  inputs: CorpusDirectInput[];
  graphTargets: CorpusLineageTarget[];
  onOpen: () => void;
  onSelectVar?: (name: string) => void;
  conceptId?: string;
  onOpenConcept?: (id: string) => void;
  onOpenGraph?: (focus: CorpusGraphFocus) => void;
}) {
  const meta = hit.entry.corpus as CorpusMeta | undefined;
  if (meta === undefined) return null;

  const label =
    (hit.entry.ddi.label as Record<string, string> | undefined)?.[meta.lang === 'fr' ? 'fr' : 'en'] ??
    meta.variableName;
  const classification = classifyHit(meta, label);
  const question = (hit.entry.ddi.description as Record<string, string> | undefined)?.[
    meta.lang === 'fr' ? 'fr' : 'en'
  ];

  return (
    <article className="cs-hit">
      <div className="cs-hit__head">
        <code className="cs-hit__name">{meta.variableName}</code>
        <span
          className={`cs-hit__kind cs-hit__kind--${classification.role}`}
          title={`GSIM: ${classification.origin} origin, ${classification.derivation} status`}
        >
          {classification.role === 'collected'
            ? 'Question'
            : classification.role === 'derived'
              ? 'Derived DV'
              : classification.role === 'administrative'
                ? 'Admin Link'
                : 'Paradata / Weight'}
        </span>
        {classification.isGrouped && (
          <span className="cs-hit__badge--grouped" title="PUMF Grouped Recode">
            PUMF (G)
          </span>
        )}
        <span className="cs-hit__survey">
          {meta.surveyAcronym ?? meta.surveyGroup}
          {meta.year === undefined ? '' : ` · ${meta.year}`}
        </span>
        <span className="cs-hit__lang">{meta.lang === 'fr' ? 'FR' : 'EN'}</span>
      </div>

      <p className="cs-hit__label">{label}</p>
      {question !== undefined && question !== label && <p className="cs-hit__question">{question}</p>}

      {inputs.length > 0 && (
        <div className="cs-hit__lineage">
          <span className="cs-hit__lineage-label">Linked inputs · AI inferred:</span>
          {inputs.map((input) => (
            <button
              key={input.edgeId}
              type="button"
              className="cs-hit__lineage-btn"
              onClick={() => onSelectVar?.(input.sourceVarName)}
              title={`Search for source variable ${input.sourceVarName}`}
            >
              <code>{input.sourceVarName}</code>
            </button>
          ))}
          <details className="cs-hit__lineage-evidence">
            <summary>Why these links?</summary>
            {[...new Set(inputs.map((input) => input.statcanNote))].map((note) => (
              <p key={note}>{note}</p>
            ))}
          </details>
        </div>
      )}

      {meta.universe !== undefined && (
        <p className="cs-hit__field">
          <span className="cs-hit__field-name">Universe</span> {meta.universe}
        </p>
      )}
      {meta.note !== undefined && (
        <p className="cs-hit__field">
          <span className="cs-hit__field-name">Note</span> {meta.note}
        </p>
      )}

      <CodeList codes={meta.codes} />

      <div className="cs-hit__connections">
        {conceptId !== undefined && (
          <button type="button" className="cs-link" onClick={() => onOpenConcept?.(conceptId)}>
            View concept over time ↗
          </button>
        )}
          <button type="button" className="cs-link" onClick={() => onOpenGraph?.({
            variable: {
              recordId: hit.entry.entryId,
              name: meta.variableName,
              label,
              surveyAcronym: meta.surveyAcronym ?? null,
              cycle: meta.cycle ?? null,
              year: meta.year ?? null,
              inputCount: inputs.length,
            },
            targets: graphTargets,
          })}>
          View derivation graph ↗
        </button>
      </div>

      <p className="cs-hit__cite" title={meta.file}>
        {meta.citation}
        {meta.position === undefined ? '' : ` · position ${meta.position}`}
        {meta.length === undefined ? '' : `, length ${meta.length}`}
        <button type="button" className="cs-link cs-hit__open" onClick={onOpen}>
          Open source ↗
        </button>
      </p>
    </article>
  );
}

export interface CorpusSearchProps {
  source: SupabaseCorpusSource;
  initialQuery?: string;
  initialSurvey?: string;
  onSearchStateChange?: (query: string, survey: string) => void;
  onOpenConcept?: (id: string) => void;
  onOpenGraph?: (focus: CorpusGraphFocus) => void;
}

export function CorpusSearch({
  source,
  initialQuery = '',
  initialSurvey = 'all',
  onSearchStateChange,
  onOpenConcept,
  onOpenGraph,
}: CorpusSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [lang, setLang] = useState<LangFilter>('all');
  const [survey, setSurvey] = useState<string>(initialSurvey);
  const [roleFilter, setRoleFilter] = useState<'all' | 'collected' | 'derived' | 'administrative'>('all');
  const [hideProcess, setHideProcess] = useState(true);
  const [codesOnly, setCodesOnly] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reading, setReading] = useState<{ bundle: string; path: string; page: number } | null>(
    null,
  );

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [directInputs, setDirectInputs] = useState<CorpusDirectInput[]>([]);
  const [graphTargets, setGraphTargets] = useState<Map<string, CorpusLineageTarget[]>>(new Map());
  const [graphError, setGraphError] = useState(false);
  const [clusters, setClusters] = useState<Map<string, string>>(new Map());
  const [lineageError, setLineageError] = useState(false);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [surveys, setSurveys] = useState<CorpusSurvey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Failure of the stats/survey-facet calls, kept apart from `error`.
   *
   * They were one field, and a successful search cleared the flag — so a stats call that failed on
   * mount left the page with no summary, an empty survey picker, and nothing saying why. Two
   * independent calls need two independent error slots, and this one must not hide the results.
   */
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaAttempt, setMetaAttempt] = useState(0);
  /**
   * A correction applied on the reader's behalf, and the query it replaced.
   *
   * Applied rather than merely offered, because a zero-result page with a suggestion under it
   * makes the reader do the work twice. `corrected.from` is kept so the page can say what it did
   * and offer to undo it — a correction the reader cannot see or refuse is the failure mode this
   * pattern has.
   */
  const [corrected, setCorrected] = useState<{ from: string; to: string } | null>(null);
  /** Set when the reader insists on their original spelling. */
  const [literal, setLiteral] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSearchStateChange?.(query, survey);
  }, [query, survey, onSearchStateChange]);

  const clearFilters = () => {
    setLang('all');
    setSurvey('all');
    setCodesOnly(false);
    setSubject(null);
    setRoleFilter('all');
    setHideProcess(false);
    setPage(0);
  };

  // Debounce the query; every filter change resets to the first page, because page 3 of the old
  // result set is a meaningless position in the new one.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setPage(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== query) {
      setQuery(initialQuery);
      setDebounced(initialQuery);
      setPage(0);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (initialSurvey !== undefined && initialSurvey !== survey) {
      setSurvey(initialSurvey);
      setPage(0);
    }
  }, [initialSurvey]);

  useEffect(() => setPage(0), [lang, survey, codesOnly, subject, roleFilter, hideProcess]);

  const displayedHits = useMemo(() => {
    return hits.filter((h) => {
      const m = h.entry.corpus as CorpusMeta | undefined;
      if (!m) return true;
      const c = classifyHit(m);
      if (hideProcess && c.role === 'process') return false;
      if (roleFilter !== 'all' && c.role !== roleFilter) return false;
      return true;
    });
  }, [hits, hideProcess, roleFilter]);
  const groupedHits = useMemo(() => groupCorpusHits(displayedHits), [displayedHits]);
  const inputsByTarget = useMemo(() => {
    const byTarget = new Map<string, CorpusDirectInput[]>();
    for (const input of directInputs) {
      const current = byTarget.get(input.targetRecordId) ?? [];
      current.push(input);
      byTarget.set(input.targetRecordId, current);
    }
    return byTarget;
  }, [directInputs]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [s, list] = await Promise.all([
          source.stats(controller.signal),
          source.surveys(controller.signal),
        ]);
        setStats(s);
        setSurveys(list);
        setMetaError(null);
      } catch (err) {
        // Facet calls use a small refreshed snapshot. Keep a retryable notice if a deployment
        // has not yet applied that migration or a network request fails.
        if (!controller.signal.aborted) setMetaError(describe(err));
      }
    })();
    inputRef.current?.focus();
    return () => controller.abort();
  }, [source, metaAttempt]);

  useEffect(() => {
    if (debounced.trim() === '') {
      setHits([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    (async () => {
      try {
        const result = await source.search(debounced, {
          ...(lang === 'all' ? {} : { lang }),
          ...(survey === 'all' ? {} : { survey }),
          ...(codesOnly ? { hasCodes: true } : {}),
          ...(subject === null ? {} : { subject }),
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          signal: controller.signal,
        });
        // Nothing found, and the reader has not insisted on this spelling: ask the vocabulary
        // whether they meant something else, and if the answer is confident, run it. A zero-result
        // page with a suggestion printed underneath makes the reader do the work twice.
        if (result.total === 0 && debounced !== literal) {
          const [best] = await source.suggest(debounced, { limit: 1, signal: controller.signal });
          if (best !== undefined) {
            const retry = await source.search(best.term, {
              ...(lang === 'all' ? {} : { lang }),
              ...(survey === 'all' ? {} : { survey }),
              ...(codesOnly ? { hasCodes: true } : {}),
              ...(subject === null ? {} : { subject }),
              limit: PAGE_SIZE,
              offset: 0,
              signal: controller.signal,
            });
            if (retry.total > 0) {
              setHits(retry.hits);
              setTotal(retry.total);
              setCorrected({ from: debounced, to: best.term });
              setError(null);
              return;
            }
          }
        }

        setHits(result.hits);
        setTotal(result.total);
        setCorrected(null);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setHits([]);
          setTotal(0);
          setCorrected(null);
          setError(describe(err));
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [source, debounced, lang, survey, codesOnly, subject, page, literal]);

  useEffect(() => {
    const recordIds = hits.map((hit) => hit.entry.entryId);
    setDirectInputs([]);
    setLineageError(false);
    if (recordIds.length === 0) return;
    const controller = new AbortController();
    source.directInputs(recordIds, controller.signal)
      .then((inputs) => { if (!controller.signal.aborted) setDirectInputs(inputs); })
      .catch(() => { if (!controller.signal.aborted) setLineageError(true); });
    return () => controller.abort();
  }, [source, hits]);

  useEffect(() => {
    const recordIds = hits.map((hit) => hit.entry.entryId);
    setGraphTargets(new Map());
    setGraphError(false);
    if (recordIds.length === 0) return;
    const controller = new AbortController();
    source.variableGraphTargets(recordIds, controller.signal)
      .then((targets) => { if (!controller.signal.aborted) setGraphTargets(targets); })
      .catch(() => { if (!controller.signal.aborted) setGraphError(true); });
    return () => controller.abort();
  }, [source, hits]);

  useEffect(() => {
    const recordIds = hits.map((hit) => hit.entry.entryId);
    setClusters(new Map());
    if (recordIds.length === 0) return;
    const controller = new AbortController();
    source.clustersOf(recordIds, controller.signal)
      .then((memberships) => { if (!controller.signal.aborted) setClusters(memberships); })
      .catch(() => { /* Search remains usable if concept metadata is unavailable. */ });
    return () => controller.abort();
  }, [source, hits]);

  const pages = Math.ceil(total / PAGE_SIZE);
  const summary = useMemo(() => {
    if (stats === null) return null;
    const span =
      stats.yearMin === null || stats.yearMax === null ? '' : ` · ${stats.yearMin}–${stats.yearMax}`;
    return `${formatInt(stats.variables)} variables · ${formatInt(stats.surveys)} surveys${span}`;
  }, [stats]);

  const onExample = useCallback((term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  }, []);

  if (reading !== null) {
    return (
      <CorpusDocumentReader
        source={source}
        bundle={reading.bundle}
        path={reading.path}
        page={reading.page}
        onClose={() => setReading(null)}
      />
    );
  }

  return (
    <div className="cs cs--railed">
      <CorpusSubjects source={source} selected={subject} onSelect={setSubject} />
      <div className="cs__main">
      <p className="cs-notice">
        <strong>Source:</strong> {CORPUS_ATTRIBUTION}
      </p>

      <div className="sr-search">
        <input
          ref={inputRef}
          className="sr-search__input"
          type="search"
          // No sample mnemonic here on purpose: which ones exist depends on what has been
          // loaded, and a placeholder promising `DHHGAGE` when the corpus has no such variable
          // teaches the reader that search is broken.
          placeholder="Search Statistics Canada variables — a concept, a question, or a variable name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="cs-search-help">Search includes reviewed equivalents such as “AI” and “artificial intelligence”.</p>

      <div className="cs-filters">
        <label className="cs-filter">
          <span className="cs-filter__label">Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as LangFilter)}>
            <option value="all">Both</option>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </label>

        <label className="cs-filter">
          <span className="cs-filter__label">Survey</span>
          <select value={survey} onChange={(e) => setSurvey(e.target.value)}>
            <option value="all">All surveys</option>
            {surveys.map((s) => (
              <option key={s.surveyGroup} value={s.surveyGroup}>
                {s.surveyAcronym ?? s.surveyGroup} ({formatInt(s.variables)})
              </option>
            ))}
          </select>
        </label>

        <label className="cs-filter">
          <span className="cs-filter__label">GSIM Role</span>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
            <option value="all">All Roles</option>
            <option value="collected">Questions Only</option>
            <option value="derived">Derived (DV) Only</option>
            <option value="administrative">Administrative Links</option>
          </select>
        </label>

        <label className="cs-filter cs-filter--check" title="Exclude replicate bootstrap weights (BSW*), flags, and operational paradata">
          <input type="checkbox" checked={hideProcess} onChange={(e) => setHideProcess(e.target.checked)} />
          <span>Hide paradata / weights</span>
        </label>

        <label className="cs-filter cs-filter--check">
          <input type="checkbox" checked={codesOnly} onChange={(e) => setCodesOnly(e.target.checked)} />
          <span>Has response categories</span>
        </label>

        {summary !== null && <span className="cs-summary">{summary}</span>}
        {metaError !== null && (
          <span className="cs-summary cs-summary--warn">
            Totals and the survey list are unavailable — search still works.{' '}
            <button type="button" className="cs-link" onClick={() => setMetaAttempt((n) => n + 1)}>
              Retry
            </button>
          </span>
        )}
      </div>

      {error !== null && (
        <div className="cs-error">
          <strong>Search unavailable.</strong> {error}
          <br />
          The corpus tables may not be applied to this Supabase project yet — see DEPLOYMENT.md §9e.
        </div>
      )}

      {debounced.trim() === '' && error === null && (
        <div className="cs-intro">
          <p>
            Search across Statistics Canada data dictionaries — the variables, question wording,
            universes and response categories published for the microdata files held in the
            Research Data Centres.
          </p>
          <p className="cs-intro__try">
            Try{' '}
            {['smoking', 'housing tenure', 'marital status', 'hours worked'].map((term, i) => (
              <span key={term}>
                {i > 0 && ', '}
                <button type="button" className="cs-link" onClick={() => onExample(term)}>
                  {term}
                </button>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {debounced.trim() !== '' && error === null && (
        <>
          <p className="sr-count">
            {busy
              ? 'Searching…'
              : total === 0
                ? `No results for "${debounced}".`
                : `${formatInt(total)} variable record${total === 1 ? '' : 's'} for "${
                    corrected?.to ?? debounced
                  }"` + (pages > 1 ? ` · page ${page + 1} of ${formatInt(pages)}` : '')}
            {/* A correction the reader can neither see nor refuse is how this pattern goes wrong,
                so it says what it did and offers the original back. */}
            {!busy && corrected !== null && (
              <span className="cs-corrected">
                {' '}
                — corrected from “{corrected.from}”.{' '}
                <button
                  type="button"
                  className="cs-link"
                  onClick={() => {
                    setLiteral(corrected.from);
                    setCorrected(null);
                  }}
                >
                  Search “{corrected.from}” instead
                </button>
              </span>
            )}
          </p>

          {!busy && total === 0 && (lang !== 'all' || survey !== 'all' || codesOnly || subject !== null) && (
            <p className="cs-suggest">
              The current filters may exclude matching records.{' '}
              <button type="button" className="cs-link" onClick={clearFilters}>Clear filters</button>
            </p>
          )}
          {!busy && total === 0 && <Suggestions source={source} query={debounced} onPick={onExample} />}

          {displayedHits.length === 0 && hits.length > 0 && (
            <p className="cs-suggest">
              All {hits.length} matches on this page were hidden by the current GSIM Role / Paradata filter.{' '}
              <button type="button" className="cs-link" onClick={clearFilters}>Clear filters</button>
            </p>
          )}

          {lineageError && hits.length > 0 && (
            <p className="cs-suggest">Linked inputs are temporarily unavailable; search results still work.</p>
          )}

          {graphError && hits.length > 0 && (
            <p className="cs-suggest">Graph connections are temporarily unavailable; derived variables can still open the graph view.</p>
          )}

          <div className="sr-results">
            {groupedHits.map((group) => (
              <div className="cs-result-group" key={group.hits[0]!.entry.entryId}>
                {group.hits.length > 1 && (
                  <p className="cs-result-group__label">
                    Same question · {group.hits.length} variable columns on this page
                  </p>
                )}
                <CorpusHit
                  hit={group.hits[0]!}
                  inputs={inputsByTarget.get(group.hits[0]!.entry.entryId) ?? []}
                  graphTargets={graphTargets.get(group.hits[0]!.entry.entryId) ?? []}
                  conceptId={clusters.get(group.hits[0]!.entry.entryId)}
                  onOpenConcept={onOpenConcept}
                  onOpenGraph={onOpenGraph}
                  onOpen={() => {
                    const m = group.hits[0]!.entry.corpus;
                    if (m !== undefined) setReading({ bundle: m.bundle, path: m.file, page: m.page });
                  }}
                  onSelectVar={(name) => { setQuery(name); setDebounced(name); inputRef.current?.focus(); }}
                />
                {group.hits.length > 1 && (
                  <details className="cs-result-group__more">
                    <summary>Show {group.hits.length - 1} related variable{group.hits.length === 2 ? '' : 's'}</summary>
                    {group.hits.slice(1).map((hit) => (
                      <CorpusHit
                        key={hit.entry.entryId}
                        hit={hit}
                        inputs={inputsByTarget.get(hit.entry.entryId) ?? []}
                        graphTargets={graphTargets.get(hit.entry.entryId) ?? []}
                        conceptId={clusters.get(hit.entry.entryId)}
                        onOpenConcept={onOpenConcept}
                        onOpenGraph={onOpenGraph}
                        onOpen={() => {
                          const m = hit.entry.corpus;
                          if (m !== undefined) setReading({ bundle: m.bundle, path: m.file, page: m.page });
                        }}
                        onSelectVar={(name) => { setQuery(name); setDebounced(name); inputRef.current?.focus(); }}
                      />
                    ))}
                  </details>
                )}
              </div>
            ))}
          </div>

          {pages > 1 && (
            <div className="cs-pager">
              <button
                type="button"
                className="btn btn--sm"
                disabled={page === 0 || busy}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Previous
              </button>
              <span className="cs-pager__at">
                {page + 1} / {formatInt(pages)}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                disabled={page + 1 >= pages || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/** Error text safe to render: the message if there is one, never the whole object. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
