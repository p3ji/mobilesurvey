import { useEffect, useMemo, useState } from 'react';
import type {
  CorpusLineageEdge,
  CorpusLineageTarget,
  SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';
import { CorpusLineageDiagram } from './CorpusLineageDiagram.js';
import { lineageEvidence } from './lineageEvidence.js';
import featuredDataRaw from './data/featuredDerivations.json';

export interface FeaturedDerivationItem extends CorpusLineageTarget {
  stages?: number;
  isPumf?: boolean;
}

const featuredData = featuredDataRaw as FeaturedDerivationItem[];

export interface CorpusGraphFocus {
  variable: CorpusLineageTarget;
  targets: CorpusLineageTarget[];
}

interface CorpusLineageProps {
  source: SupabaseCorpusSource;
  onSelectSearch?: (query: string, survey?: string) => void;
  initialFocus?: CorpusGraphFocus | null;
}

export function CorpusLineage({ source, onSelectSearch, initialFocus }: CorpusLineageProps) {
  const initialTarget = initialFocus?.targets[0] ?? null;
  const [filter, setFilter] = useState<'all' | 'pumf' | 'multi'>('all');
  const [selected, setSelected] = useState<CorpusLineageTarget | null>(
    initialTarget ?? (featuredData[0] as CorpusLineageTarget) ?? null
  );
  const [edges, setEdges] = useState<CorpusLineageEdge[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTarget) {
      setSelected(initialTarget);
    }
  }, [initialTarget]);

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

  const featuredTargets = useMemo(() => {
    let list = featuredData;
    if (filter === 'pumf') {
      list = list.filter((t) => t.isPumf);
    } else if (filter === 'multi') {
      list = list.filter((t) => (t.stages ?? 1) >= 3);
    }

    if (!initialFocus) return list;
    const initialTargets = initialFocus.targets.map((t) => {
      const match = featuredData.find((f) => f.recordId === t.recordId);
      return match ?? { ...t, stages: 1, isPumf: false };
    });
    const missing = initialTargets.filter((t) => !list.some((b) => b.recordId === t.recordId));
    return [...missing, ...list];
  }, [filter, initialFocus]);

  const handleFilterChange = (nextFilter: 'all' | 'pumf' | 'multi') => {
    setFilter(nextFilter);
    let nextList = featuredData;
    if (nextFilter === 'pumf') nextList = nextList.filter((t) => t.isPumf);
    else if (nextFilter === 'multi') nextList = nextList.filter((t) => (t.stages ?? 1) >= 3);

    if (selected && !nextList.some((t) => t.recordId === selected.recordId)) {
      if (nextList.length > 0) setSelected(nextList[0]!);
    }
  };

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
  const downstreamTargets = initialFocus?.targets.filter((target) => target.recordId !== initialFocus.variable.recordId) ?? [];
  const hasOwnInputs = initialFocus?.targets.some((target) => target.recordId === initialFocus.variable.recordId) ?? false;

  return (
    <section className="kg-pane kg-lineage">
      <p className="kg-pane__desc">
        Examples showcasing published provenance between derived variables and their inputs.
        Solid lines indicate direct formulas cited verbatim in StatCan notes; long-dashed teal lines bridge public variables to master-file counterparts; dotted indigo lines indicate grouped-recode category collapses; and short-dashed lines indicate inferred question mappings.
        To trace lineage for any specific variable, search for it in the <strong>Search</strong> tab.
      </p>
      <div className="kg-dag-layout">
        <aside className="kg-dag-sidebar">
          <h3 className="kg-dag-sidebar__title">Example Derivations</h3>
          <p className="kg-dag-sidebar__desc">
            Sample multi-stage pipelines and PUMF recodes demonstrating derivation lineage. Use <strong>Search</strong> to find and inspect any variable in the corpus.
          </p>

          <div className="kg-dag-searcher-callout">
            <div className="kg-dag-searcher-callout__body">
              <strong>Looking for a specific variable?</strong>
              <p>
                Search any collected question or derived indicator in <strong>Search</strong> to inspect its upstream inputs or downstream uses.
              </p>
            </div>
            {onSelectSearch && (
              <button
                type="button"
                className="kg-btn kg-btn--sm kg-btn--primary kg-dag-searcher-callout__btn"
                onClick={() => onSelectSearch('')}
              >
                Go to Search ↗
              </button>
            )}
          </div>

          <div className="kg-dag-filter-bar" role="tablist" aria-label="Filter derivations">
            <button
              type="button"
              className={`kg-dag-filter-btn ${filter === 'all' ? 'kg-dag-filter-btn--active' : ''}`}
              onClick={() => handleFilterChange('all')}
            >
              All Multi-Stage ({featuredData.length})
            </button>
            <button
              type="button"
              className={`kg-dag-filter-btn ${filter === 'pumf' ? 'kg-dag-filter-btn--active' : ''}`}
              onClick={() => handleFilterChange('pumf')}
            >
              PUMF (G) ({featuredData.filter((t) => t.isPumf).length})
            </button>
            <button
              type="button"
              className={`kg-dag-filter-btn ${filter === 'multi' ? 'kg-dag-filter-btn--active' : ''}`}
              onClick={() => handleFilterChange('multi')}
            >
              3+ Stages ({featuredData.filter((t) => (t.stages ?? 1) >= 3).length})
            </button>
          </div>

          <div className="kg-dag-list">
            {featuredTargets.map((target) => (
              <button
                key={target.recordId}
                type="button"
                className={`kg-dag-item ${selected?.recordId === target.recordId ? 'kg-dag-item--active' : ''}`}
                aria-pressed={selected?.recordId === target.recordId}
                onClick={() => setSelected(target)}
              >
                <span className="kg-dag-item__head">
                  <code>{target.name}</code>
                  <span className="kg-dag-item__badges">
                    {target.stages && target.stages > 1 && (
                      <span className="kg-badge kg-badge--stages">{target.stages} stages</span>
                    )}
                    {target.isPumf && (
                      <span className="kg-badge kg-badge--pumf">PUMF (G)</span>
                    )}
                    <span className="kg-dag-item__survey">{target.surveyAcronym ?? 'Survey'} · {target.cycle ?? target.year ?? '—'}</span>
                  </span>
                </span>
                <span className="kg-dag-item__label">{target.label}</span>
                <span className="kg-dag-item__meta">
                  {target.inputCount} direct {target.inputCount === 1 ? 'input' : 'inputs'}
                  {target.stages && target.stages > 1 ? ` · ${target.stages}-stage pipeline` : ''}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="kg-dag-main">
          {initialFocus && (
            <div className="kg-dag-card">
              <strong><code>{initialFocus.variable.name}</code></strong>
              {initialFocus.targets.length === 0 ? (
                <p>No derivation links are published for this record yet. A variable name or documentation note alone does not establish an input relationship.</p>
              ) : (
                <>
                  <p>
                    {hasOwnInputs && 'This variable has published upstream inputs. '}
                    {downstreamTargets.length > 0 && `It is a published input to ${downstreamTargets.length} derived ${downstreamTargets.length === 1 ? 'variable' : 'variables'}. Select one to inspect the flow:`}
                  </p>
                  {downstreamTargets.length > 0 && (
                    <div className="kg-flow__controls">
                      {initialFocus.targets.map((target) => (
                        <button key={target.recordId} type="button" className="kg-btn kg-btn--sm" onClick={() => setSelected(target)}>
                          {target.name} · {target.cycle ?? target.year ?? 'cycle unknown'}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {selected === null ? (
            <div className="kg-dag-card">{initialFocus ? 'No graph is available for this record yet. Select a linked derived variable on the left to explore another graph.' : 'Select a derived variable to inspect its lineage.'}</div>
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
              {!graphLoading && !graphError && edges.length === 0 && <p>No upstream links are published for this variable.</p>}
              {!graphLoading && edges.length > 0 && <CorpusLineageDiagram key={selected.recordId} target={selected} edges={edges} highlightRecordId={initialFocus?.variable.recordId} />}
              {!graphLoading && layers.map(([depth, layer]) => (
                <div className="kg-lineage__layer" key={depth}>
                  <h4>{depth === 1 ? 'Direct inputs' : `Upstream inputs · step ${depth}`} <span>({layer.length})</span></h4>
                  <div className="kg-lineage__edges">
                    {layer.map((edge) => (
                      <div className="kg-lineage__edge" key={edge.edgeId}>
                        <div className="kg-lineage__relation">
                          <code>{edge.targetName}</code>{' '}
                          <span>
                            {edge.derivationType === 'counterpart'
                              ? 'published in (master file)'
                              : edge.derivationType === 'collapse'
                                ? 'collapsed from'
                                : 'was derived from'}
                          </span>
                        </div>
                        <div className="kg-lineage__source">
                          <code>{edge.sourceVarName}</code>
                          <span>{edge.sourceLabel}</span>
                        </div>
                        <div className="kg-lineage__edge-meta">
                          {lineageEvidence(edge) === 'deterministic'
                            ? 'deterministic rule · verified'
                            : lineageEvidence(edge) === 'named'
                              ? 'Source named in note'
                              : lineageEvidence(edge) === 'provisional'
                                ? 'Low-certainty provisional mapping'
                                : 'Source column mapped from note'}
                          {lineageEvidence(edge) !== 'deterministic' && (
                            <>
                              {' · '}
                              {edge.dataAuthority === 'human_verified'
                                ? 'human reviewed'
                                : edge.reviewStatus === 'needs_review'
                                  ? 'needs review'
                                  : 'machine checked'}
                            </>
                          )}
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
