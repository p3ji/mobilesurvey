/**
 * Browsing the corpus by concept rather than by occurrence (docs/metadata-repo-plan.md §2, M3).
 *
 * The search tab answers "which variables mention smoking". This one answers the question the
 * corpus was assembled for: **how has Statistics Canada asked about this over twenty years, and
 * which cycles changed it.**
 *
 * ### Why the list is of ConceptualVariables
 *
 * DDI splits what a single "concept cluster" would conflate — `c:Concept` is the meaning,
 * `l:ConceptualVariable` is that meaning measured on a particular population, and
 * `l:RepresentedVariable` is one specific coding of it. The middle level is the one worth putting
 * in front of a reader: it is a single measure with a history, and its count of representations
 * *is* the answer to "did the coding change", with no comparison to perform.
 *
 * That number is rendered as a badge rather than buried, because a question whose categories were
 * redefined mid-series is exactly the thing a researcher needs to notice before comparing across
 * cycles — and exactly the thing that is invisible in a list of search results.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CorpusCode,
  type CorpusConceptualVariable,
  type CorpusTimelineEntry,
  type SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';
import { CorpusDocumentReader } from './CorpusDocument.js';

const DEBOUNCE_MS = 250;
const PAGE_SIZE = 25;

const formatInt = (n: number): string => n.toLocaleString('en-CA');

const span = (cv: CorpusConceptualVariable): string =>
  cv.yearMin === null || cv.yearMax === null
    ? '—'
    : cv.yearMin === cv.yearMax
      ? String(cv.yearMin)
      : `${cv.yearMin}–${cv.yearMax}`;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Codes({ codes }: { codes: CorpusCode[] }) {
  if (codes.length === 0) return <span className="cc-nocodes">no categories</span>;
  return (
    <div className="cs-codes">
      {codes.slice(0, 8).map((c, i) => (
        <span key={`${c.c}-${i}`} className="cs-code">
          <strong>{c.c}</strong> {c.l}
        </span>
      ))}
      {codes.length > 8 && <span className="cs-code cs-code--more">+{codes.length - 8}</span>}
    </div>
  );
}

/**
 * One conceptual variable's occurrences, in chronological order.
 *
 * Entries are annotated with whether their coding differs from the previous year's, which is the
 * whole point of the view — a reader scanning down the column should be able to see where a series
 * breaks without holding two code lists in their head.
 */
function Timeline({
  source,
  cv,
  onClose,
  onRead,
}: {
  source: SupabaseCorpusSource;
  cv: CorpusConceptualVariable;
  onClose: () => void;
  onRead: (path: string, page: number) => void;
}) {
  const [entries, setEntries] = useState<CorpusTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setEntries(null);
    setError(null);
    source
      .timeline(cv.conceptualVariableId, controller.signal)
      .then(setEntries)
      .catch((err) => {
        if (!controller.signal.aborted) setError(describe(err));
      });
    return () => controller.abort();
  }, [source, cv.conceptualVariableId]);

  // Which entries begin a new coding. Computed here rather than in SQL because it is a property of
  // the rendered sequence, not of the data — it depends on the order the reader sees.
  const changeAt = new Set<string>();
  let previous: string | undefined;
  for (const e of entries ?? []) {
    if (previous !== undefined && e.representedVariableId !== previous) changeAt.add(e.recordId);
    previous = e.representedVariableId;
  }

  return (
    <div className="cc-timeline">
      <div className="cc-timeline__head">
        <div>
          <h2 className="cc-timeline__title">{cv.label}</h2>
          <p className="cc-timeline__meta">
            {span(cv)} · {formatInt(cv.years)} year{cv.years === 1 ? '' : 's'} ·{' '}
            {formatInt(cv.occurrences)} occurrence{cv.occurrences === 1 ? '' : 's'} ·{' '}
            {formatInt(cv.surveys)} survey{cv.surveys === 1 ? '' : 's'} ·{' '}
            {cv.representations === 1
              ? 'one coding throughout'
              : `${formatInt(cv.representations)} different codings`}
          </p>
          {cv.universe !== null && (
            <p className="cc-timeline__universe">
              <span className="cs-hit__field-name">Universe</span> {cv.universe}
            </p>
          )}
        </div>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Close
        </button>
      </div>

      {error !== null && <div className="cs-error">{error}</div>}
      {entries === null && error === null && <p className="hub__loading">Loading timeline…</p>}

      {entries !== null && (
        <ol className="cc-entries">
          {entries.map((e) => (
            <li
              key={e.recordId}
              className={`cc-entry${changeAt.has(e.recordId) ? ' cc-entry--changed' : ''}`}
            >
              <div className="cc-entry__when">
                <strong>{e.year ?? e.cycle ?? '—'}</strong>
                <span>{e.surveyAcronym ?? e.surveyGroup}</span>
              </div>
              <div className="cc-entry__body">
                <div className="cc-entry__head">
                  <code className="cs-hit__name">{e.name}</code>
                  {changeAt.has(e.recordId) && (
                    <span className="cc-changed">coding changed here</span>
                  )}
                </div>
                {e.questionText !== null && <p className="cc-entry__q">{e.questionText}</p>}
                <Codes codes={e.codes} />
                <p className="cs-hit__cite">
                  {e.citation}
                  <button
                    type="button"
                    className="cs-link cs-hit__open"
                    onClick={() => onRead(e.path, e.page)}
                  >
                    Open source ↗
                  </button>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function CorpusConcepts({ source }: { source: SupabaseCorpusSource }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [minYears, setMinYears] = useState(2);
  const [page, setPage] = useState(0);

  const [concepts, setConcepts] = useState<CorpusConceptualVariable[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CorpusConceptualVariable | null>(null);
  const [reading, setReading] = useState<{ path: string; page: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setPage(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => setPage(0), [changedOnly, minYears]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    source
      .concepts({
        q: debounced,
        minYears,
        changedOnly,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        signal: controller.signal,
      })
      .then((result) => {
        setConcepts(result.concepts);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setConcepts([]);
          setTotal(0);
          setError(describe(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [source, debounced, changedOnly, minYears, page]);

  const pages = Math.ceil(total / PAGE_SIZE);
  const onExample = useCallback((term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  }, []);

  if (reading !== null) {
    return (
      <CorpusDocumentReader
        source={source}
        // Timeline entries carry only the path — corpus_document_at takes a null bundle and
        // matches on path alone, which is why it was written that way.
        bundle={null}
        path={reading.path}
        page={reading.page}
        onClose={() => setReading(null)}
      />
    );
  }

  if (open !== null) {
    return (
      <Timeline
        source={source}
        cv={open}
        onClose={() => setOpen(null)}
        onRead={(path, page) => setReading({ path, page })}
      />
    );
  }

  return (
    <div className="cc">
      <p className="cc-intro">
        One measure, traced across every cycle that asked it. Grouping follows DDI’s variable
        cascade, so a concept measured on a different population stays a different entry, and the
        number of <em>codings</em> tells you where a series is not comparable.
      </p>

      <div className="sr-search">
        <input
          ref={inputRef}
          className="sr-search__input"
          type="search"
          placeholder="Filter concepts — “smoking”, “income”, “tenure”… or leave blank to browse"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="cs-filters">
        <label className="cs-filter">
          <span className="cs-filter__label">Spanning at least</span>
          <select value={minYears} onChange={(e) => setMinYears(Number(e.target.value))}>
            <option value={2}>2 years</option>
            <option value={5}>5 years</option>
            <option value={10}>10 years</option>
          </select>
        </label>
        <label className="cs-filter cs-filter--check">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />
          <span>Coding changed between cycles</span>
        </label>
        <span className="cs-summary">
          {busy ? 'Loading…' : `${formatInt(total)} concept${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {error !== null && (
        <div className="cs-error">
          <strong>Concepts unavailable.</strong> {error}
          <br />
          The cascade tables may not be applied yet — see DEPLOYMENT.md §9e.
        </div>
      )}

      {error === null && concepts.length === 0 && !busy && (
        <div className="cs-intro">
          <p>
            No concepts match. Try{' '}
            {['smoking', 'income', 'marital status'].map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <button type="button" className="cs-link" onClick={() => onExample(t)}>
                  {t}
                </button>
              </span>
            ))}
            , or lower the year threshold.
          </p>
        </div>
      )}

      <div className="cc-list">
        {concepts.map((cv) => (
          <button
            key={cv.conceptualVariableId}
            type="button"
            className="cc-card"
            onClick={() => setOpen(cv)}
          >
            <div className="cc-card__main">
              <span className="cc-card__label">{cv.label}</span>
              {cv.universe !== null && <span className="cc-card__universe">{cv.universe}</span>}
            </div>
            <div className="cc-card__stats">
              <span className="cc-card__span">{span(cv)}</span>
              <span className="cc-card__stat">{formatInt(cv.years)} yrs</span>
              <span className="cc-card__stat">{formatInt(cv.occurrences)} occ</span>
              <span className="cc-card__stat">{formatInt(cv.surveys)} svy</span>
              {cv.representations > 1 && (
                <span className="cc-card__changed">{cv.representations} codings</span>
              )}
            </div>
          </button>
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
    </div>
  );
}
