import { useEffect, useMemo, useState } from 'react';
import type {
  CorpusLineageEdge,
  CorpusLineageTarget,
  CorpusLineageTargetsPage,
  SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';

const PAGE_SIZE = 20;

interface CorpusLineageProps {
  source: SupabaseCorpusSource;
  onSelectSearch?: (query: string, survey?: string) => void;
}

export function CorpusLineage({ source, onSelectSearch }: CorpusLineageProps) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<CorpusLineageTargetsPage | null>(null);
  const [selected, setSelected] = useState<CorpusLineageTarget | null>(null);
  const [edges, setEdges] = useState<CorpusLineageEdge[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError(null);
    source.lineageTargets(search, PAGE_SIZE, page * PAGE_SIZE, controller.signal)
      .then((next) => {
        setResults(next);
        setSelected(next.targets[0] ?? null);
        setListLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResults(null);
        setSelected(null);
        setListError(error instanceof Error ? error.message : 'Could not load lineage targets.');
        setListLoading(false);
      });
    return () => controller.abort();
  }, [source, search, page]);

  useEffect(() => {
    if (selected === null) {
      setEdges([]);
      return;
    }
    const controller = new AbortController();
    setGraphLoading(true);
    setGraphError(null);
    setEdges([]);
    source.lineageGraph(selected.recordId, 4, controller.signal)
      .then((next) => {
        setEdges(next);
        setGraphLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGraphError(error instanceof Error ? error.message : 'Could not load this lineage graph.');
        setGraphLoading(false);
      });
    return () => controller.abort();
  }, [source, selected]);

  const layers = useMemo(() => {
    const byDepth = new Map<number, CorpusLineageEdge[]>();
    for (const edge of edges) {
      const layer = byDepth.get(edge.depth) ?? [];
      layer.push(edge);
      byDepth.set(edge.depth, layer);
    }
    return Array.from(byDepth.entries()).sort(([a], [b]) => a - b);
  }, [edges]);
  const notes = useMemo(() => Array.from(new Set(edges.map((edge) => edge.statcanNote).filter(Boolean))), [edges]);
  const summaries = useMemo(() => Array.from(new Set(edges.map((edge) => edge.expressionSummary).filter((value): value is string => Boolean(value)))), [edges]);

  return (
    <section className="kg-pane kg-lineage">
      <p className="kg-pane__desc">
        Browse published, verified links between derived variables and their inputs. Links marked AI inferred
        were extracted from Statistics Canada notes and checked before publication; the notes remain visible below.
      </p>
      <div className="kg-dag-layout">
        <aside className="kg-dag-sidebar">
          <h3 className="kg-dag-sidebar__title">Linked derived variables</h3>
          <p className="kg-dag-sidebar__desc">
            {results === null ? 'Loading graph…' : `${results.total.toLocaleString()} ${results.total === 1 ? 'variable' : 'variables'} · ${results.edges.toLocaleString()} verified ${results.edges === 1 ? 'link' : 'links'}`}
          </p>
          <input
            type="search"
            className="kg-search-input kg-lineage__search"
            aria-label="Search linked derived variables"
            placeholder="Variable, topic, survey, cycle…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          />
          {listLoading && <p className="kg-dag-sidebar__desc" role="status">Loading variables…</p>}
          {listError && <p className="cs-error" role="alert">{listError}</p>}
          {!listLoading && !listError && results?.targets.length === 0 && (
            <p className="kg-dag-sidebar__desc">No verified lineage matches this search.</p>
          )}
          <div className="kg-dag-list">
            {results?.targets.map((target) => (
              <button
                key={target.recordId}
                type="button"
                className={`kg-dag-item ${selected?.recordId === target.recordId ? 'kg-dag-item--active' : ''}`}
                aria-pressed={selected?.recordId === target.recordId}
                onClick={() => setSelected(target)}
              >
                <span className="kg-dag-item__head">
                  <code>{target.name}</code>
                  <span className="kg-dag-item__survey">{target.surveyAcronym ?? 'Survey'} · {target.cycle ?? target.year ?? '—'}</span>
                </span>
                <span className="kg-dag-item__label">{target.label}</span>
                <span className="kg-dag-item__meta">{target.inputCount} direct {target.inputCount === 1 ? 'input' : 'inputs'}</span>
              </button>
            ))}
          </div>
          {results && results.total > PAGE_SIZE && (
            <div className="kg-lineage__pager">
              <button type="button" className="kg-btn kg-btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, results.total)} of {results.total}</span>
              <button type="button" className="kg-btn kg-btn--sm" disabled={(page + 1) * PAGE_SIZE >= results.total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </aside>

        <div className="kg-dag-main">
          {selected === null ? (
            <div className="kg-dag-card">Select a derived variable to inspect its lineage.</div>
          ) : (
            <div className="kg-dag-card">
              <div className="kg-dag-card__header">
                <div>
                  <h3 className="kg-dag-card__title">Lineage: <code>{selected.name}</code></h3>
                  <span className="kg-dag-card__sub">{selected.label} · {selected.surveyAcronym ?? 'Survey'} · {selected.cycle ?? selected.year ?? 'Cycle unknown'}</span>
                </div>
                {onSelectSearch && (
                  <button type="button" className="kg-btn kg-btn--primary" onClick={() => onSelectSearch(selected.name, selected.surveyAcronym ?? undefined)}>
                    Open in Searcher ↗
                  </button>
                )}
              </div>
              {graphLoading && <p role="status">Loading upstream links…</p>}
              {graphError && <p className="cs-error" role="alert">{graphError}</p>}
              {!graphLoading && !graphError && edges.length === 0 && <p>No verified upstream links are available for this variable.</p>}
              {!graphLoading && layers.map(([depth, layer]) => (
                <div className="kg-lineage__layer" key={depth}>
                  <h4>{depth === 1 ? 'Direct inputs' : `Upstream inputs · step ${depth}`} <span>({layer.length})</span></h4>
                  <div className="kg-lineage__edges">
                    {layer.map((edge) => (
                      <div className="kg-lineage__edge" key={edge.edgeId}>
                        <div className="kg-lineage__relation"><code>{edge.targetName}</code> <span>was derived from</span></div>
                        <div className="kg-lineage__source">
                          <code>{edge.sourceVarName}</code>
                          <span>{edge.sourceLabel}</span>
                        </div>
                        <div className="kg-lineage__edge-meta">
                          {edge.dataAuthority === 'ai_inferred' ? 'AI inferred · verified' : edge.dataAuthority === 'official_statcan' ? 'StatCan documented' : 'Human verified'}
                          {onSelectSearch && <button type="button" onClick={() => onSelectSearch(edge.sourceVarName, selected.surveyAcronym ?? undefined)}>Find source ↗</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {summaries.length > 0 && (
                <div className="kg-dag-evidence">
                  <h4 className="kg-dag-evidence__title">Inferred derivation summary</h4>
                  {summaries.map((summary) => <p className="kg-dag-evidence__quote" key={summary}>{summary}</p>)}
                </div>
              )}
              {notes.length > 0 && (
                <div className="kg-dag-evidence">
                  <h4 className="kg-dag-evidence__title">Source documentation notes</h4>
                  {notes.map((note) => <blockquote className="kg-dag-evidence__quote" key={note}>{note}</blockquote>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
