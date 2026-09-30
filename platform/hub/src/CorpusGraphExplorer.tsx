/**
 * Statistics Canada Knowledge Graph Explorer
 *
 * High-density, sober analytical explorer for the StatCan Knowledge Graph:
 * - 113 Survey Programs & 260 Collection Cycles
 * - GSIM 2D Taxonomy (Data Origin × Derivation Status)
 * - Harmonized Sociodemographic Concept Mesh
 * - Interactive Derivation Lineage DAG (W3C PROV-O)
 * - Thematic Module Rotation Directory
 */
import { useEffect, useMemo, useState } from 'react';
import type { SupabaseCorpusSource } from '@mobilesurvey/metadata-registry';
import { CorpusLineage } from './CorpusLineage.js';
import type { CorpusGraphFocus } from './CorpusLineage.js';
import { CorpusConcepts } from './CorpusConcepts.js';
import summaryData from './data/knowledgeGraphSummary.json';

interface CorpusGraphExplorerProps {
  source: SupabaseCorpusSource;
  onSelectSearch?: (query: string, survey?: string) => void;
  initialGraphFocus?: CorpusGraphFocus | null;
  initialConceptId?: string | null;
  initialTab?: ExplorerTab;
}

export type ExplorerTab = 'surveys' | 'concepts' | 'lineage' | 'modules';

export function CorpusGraphExplorer({
  source,
  onSelectSearch,
  initialGraphFocus,
  initialConceptId,
  initialTab,
}: CorpusGraphExplorerProps) {
  const [tab, setTab] = useState<ExplorerTab>(
    initialTab ?? (initialGraphFocus ? 'lineage' : initialConceptId ? 'concepts' : 'surveys')
  );

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    } else if (initialGraphFocus) {
      setTab('lineage');
    } else if (initialConceptId) {
      setTab('concepts');
    }
  }, [initialTab, initialGraphFocus, initialConceptId]);
  const [surveyFilter, setSurveyFilter] = useState('');
  const [expandedSurvey, setExpandedSurvey] = useState<string | null>('CIS');

  const filteredSurveys = useMemo(() => {
    const q = surveyFilter.trim().toLowerCase();
    if (!q) return summaryData.surveys;
    return summaryData.surveys.filter(
      (s) =>
        s.acronym.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.topModules.some((m) => m.code.toLowerCase().includes(q))
    );
  }, [surveyFilter]);

  // Aggregate modules repository-wide
  const allModules = useMemo(() => {
    const modMap = new Map<string, { count: number; surveys: Set<string> }>();
    for (const s of summaryData.surveys) {
      for (const m of s.topModules) {
        if (m.code === 'NONE' || m.code === 'GENERAL') continue;
        const entry = modMap.get(m.code) ?? { count: 0, surveys: new Set<string>() };
        entry.count += m.count;
        entry.surveys.add(s.acronym);
        modMap.set(m.code, entry);
      }
    }
    return Array.from(modMap.entries())
      .map(([code, data]) => ({
        code,
        count: data.count,
        surveys: Array.from(data.surveys),
      }))
      .sort((a, b) => b.count - a.count);
  }, []);

  return (
    <div className="kg-explorer">
      {/* Header Metric Strip */}
      <header className="kg-header">
        <div className="kg-header__title-block">
          <h2 className="kg-header__title">Statistics Canada Knowledge Graph</h2>
          <span className="kg-header__badge">GSIM 2D · DDI 3.3 · W3C PROV-O</span>
        </div>
        <p className="kg-header__sub">
          Complete machine-readable census of <strong>{summaryData.totalVariables.toLocaleString()} variables</strong> across{' '}
          <strong>{summaryData.totalSurveys} survey programs</strong> and <strong>{summaryData.totalCycles} collection cycles</strong>.
        </p>

        <div className="kg-metrics">
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.totalVariables.toLocaleString()}</span>
            <span className="kg-metric__lbl">Variables Classified</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.totalSurveys}</span>
            <span className="kg-metric__lbl">Survey Programs</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.roles.collected.toLocaleString()}</span>
            <span className="kg-metric__lbl">Direct Questions (80.8%)</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.roles.derived.toLocaleString()}</span>
            <span className="kg-metric__lbl">Derived Indicators (10.7%)</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.roles.administrative.toLocaleString()}</span>
            <span className="kg-metric__lbl">Admin / Tax Links (2.6%)</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.roles.process.toLocaleString()}</span>
            <span className="kg-metric__lbl">Replicate Weights (5.8%)</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.derivationsExtracted.toLocaleString()}</span>
            <span className="kg-metric__lbl" title="Detected references in the local corpus; these are not all verified or published as graph links.">Detected Note References</span>
          </div>
          <div className="kg-metric">
            <span className="kg-metric__val">{summaryData.globalStats.pumfGroupedCount.toLocaleString()}</span>
            <span className="kg-metric__lbl">PUMF Recodes - (G)</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="kg-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'surveys'}
          className={`kg-tab ${tab === 'surveys' ? 'kg-tab--active' : ''}`}
          onClick={() => setTab('surveys')}
        >
          Survey Programs & Cycles ({summaryData.totalSurveys})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'concepts'}
          className={`kg-tab ${tab === 'concepts' ? 'kg-tab--active' : ''}`}
          onClick={() => setTab('concepts')}
        >
          Concepts Over Time
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'lineage'}
          className={`kg-tab ${tab === 'lineage' ? 'kg-tab--active' : ''}`}
          onClick={() => setTab('lineage')}
        >
          Derivation Lineage DAG (PROV-O)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'modules'}
          className={`kg-tab ${tab === 'modules' ? 'kg-tab--active' : ''}`}
          onClick={() => setTab('modules')}
        >
          Thematic Modules ({allModules.length})
        </button>
      </nav>

      {/* Tab 1: Survey Programs & Cycles Directory */}
      {tab === 'surveys' && (
        <section className="kg-pane">
          <div className="kg-pane__toolbar">
            <input
              type="search"
              className="kg-search-input"
              placeholder="Filter by acronym, title, or module (e.g. 'income', 'health', 'CIS', 'LFS', 'APS')..."
              value={surveyFilter}
              onChange={(e) => setSurveyFilter(e.target.value)}
            />
            <span className="kg-pane__count">Showing {filteredSurveys.length} of {summaryData.totalSurveys} programs</span>
          </div>

          <div className="kg-table-wrap">
            <table className="kg-table">
              <thead>
                <tr>
                  <th>Acronym</th>
                  <th>Survey Program / Collection Title</th>
                  <th style={{ textAlign: 'right' }}>Variables</th>
                  <th style={{ textAlign: 'center' }}>Cycles</th>
                  <th style={{ textAlign: 'right' }} title="Average substantive variables per cycle (excludes replicate bootstrap weights)">Avg Var / Cycle</th>
                  <th>GSIM Composition (Collected / Derived / Admin / Process)</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSurveys.map((s) => {
                  const isExpanded = expandedSurvey === s.acronym;
                  const total = s.total;
                  const numCycles = Math.max(1, s.cycles.length);
                  const bootstrapCount = (s as { bootstrapCount?: number }).bootstrapCount ?? 0;
                  const substantiveTotal = (s as { substantiveTotal?: number }).substantiveTotal ?? (total - bootstrapCount);
                  const avgVarsPerCycle = Math.round(substantiveTotal / numCycles);
                  const pCol = ((s.roles.collected / total) * 100).toFixed(0);
                  const pDer = ((s.roles.derived / total) * 100).toFixed(0);
                  const pAdm = ((s.roles.administrative / total) * 100).toFixed(0);
                  const pPrc = ((s.roles.process / total) * 100).toFixed(0);

                  return (
                    <tr key={s.acronym} className={isExpanded ? 'kg-tr--expanded' : ''}>
                      <td>
                        <strong className="kg-acronym">{s.acronym}</strong>
                      </td>
                      <td>
                        <div className="kg-survey-title">{s.title}</div>
                        {isExpanded && (
                          <div className="kg-survey-detail">
                            <div className="kg-cycles-list">
                              <span className="kg-cycles-label">Cycles ({s.cycles.length}):</span>
                              {s.cycles.map((c) => (
                                <span key={c} className="kg-cycle-pill">
                                  {c}
                                </span>
                              ))}
                            </div>
                            <div className="kg-detail-stats">
                              <span>PUMF Grouped Recodes: <strong>{s.pumfGroupedCount}</strong></span>
                              <span>Primary Identifiers: <strong>{s.identifierCount}</strong></span>
                              <span>Derivation Links: <strong>{s.derivationsExtracted}</strong></span>
                              {bootstrapCount > 0 && (
                                <span>Replicate Bootstrap Weights: <strong>{bootstrapCount.toLocaleString()}</strong></span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.total.toLocaleString()}</td>
                      <td style={{ textAlign: 'center' }}>{s.cycles.length}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        <span
                          title={
                            bootstrapCount > 0
                              ? `${substantiveTotal.toLocaleString()} substantive variables across ${numCycles} cycle${numCycles === 1 ? '' : 's'} (excludes ${bootstrapCount.toLocaleString()} replicate bootstrap weights)`
                              : `${substantiveTotal.toLocaleString()} variables across ${numCycles} cycle${numCycles === 1 ? '' : 's'}`
                          }
                        >
                          {avgVarsPerCycle.toLocaleString()}
                        </span>
                      </td>
                      <td>
                        <div className="kg-bar-stack" title={`Collected: ${pCol}%, Derived: ${pDer}%, Admin: ${pAdm}%, Process: ${pPrc}%`}>
                          <div className="kg-bar kg-bar--col" style={{ width: `${pCol}%` }} />
                          <div className="kg-bar kg-bar--der" style={{ width: `${pDer}%` }} />
                          <div className="kg-bar kg-bar--adm" style={{ width: `${pAdm}%` }} />
                          <div className="kg-bar kg-bar--prc" style={{ width: `${pPrc}%` }} />
                        </div>
                        <div className="kg-bar-legend">
                          <span>{pCol}% Qs</span>
                          <span>{pDer}% DV</span>
                          {Number(pAdm) > 0 && <span>{pAdm}% Adm</span>}
                          {Number(pPrc) > 0 && <span>{pPrc}% Wts</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="kg-row-actions">
                          <button
                            type="button"
                            className="kg-btn kg-btn--sm"
                            onClick={() => setExpandedSurvey(isExpanded ? null : s.acronym)}
                          >
                            {isExpanded ? 'Hide' : 'Cycles'}
                          </button>
                          {onSelectSearch && (
                            <button
                              type="button"
                              className="kg-btn kg-btn--sm kg-btn--primary"
                              onClick={() => onSelectSearch('', s.acronym)}
                              title={`Search all ${s.acronym} variables`}
                            >
                              Search ↗
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab 2: Concepts Over Time */}
      {tab === 'concepts' && (
        <section className="kg-pane">
          <p className="kg-pane__desc">
            Track how Statistics Canada measures concepts across decades — question wording changes, category additions, and series breaks.
          </p>

          <details className="kg-harmonized-accordion">
            <summary className="kg-harmonized-summary">
              <strong>Harmonized Sociodemographic Domains (10 Core Dimensions)</strong>
              <span className="kg-harmonized-sub">Standardized concept clusters across household, health, and social surveys — click to expand</span>
            </summary>
            <div className="kg-table-wrap" style={{ marginTop: 12 }}>
              <table className="kg-table kg-table--matrix">
                <thead>
                  <tr>
                    <th>Harmonized Concept Domain</th>
                    <th style={{ textAlign: 'right' }}>Total Variables</th>
                    <th>Top Survey Programs & Variable Counts</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryData.harmonizedConcepts.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <strong className="kg-concept-title">{item.label}</strong>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.totalMatches.toLocaleString()}</td>
                      <td>
                        <div className="kg-survey-pills">
                          {item.topSurveys.map((ts) => (
                            <button
                              key={ts.survey}
                              type="button"
                              className="kg-survey-cell-btn"
                              onClick={() => onSelectSearch?.(item.label.split(' ')[0]!, ts.survey)}
                              title={`Search ${item.label} in ${ts.survey} (${ts.count} matches)`}
                            >
                              <strong>{ts.survey}</strong>: {ts.count.toLocaleString()}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {onSelectSearch && (
                          <button
                            type="button"
                            className="kg-btn kg-btn--sm kg-btn--primary"
                            onClick={() => onSelectSearch(item.label.split(' ')[0]!)}
                          >
                            Search in Search ↗
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div style={{ marginTop: 14 }}>
            <CorpusConcepts source={source} initialConceptId={initialConceptId ?? null} />
          </div>
        </section>
      )}

      {/* Tab 3: Published derivation lineage */}
      {tab === 'lineage' && <CorpusLineage source={source} onSelectSearch={onSelectSearch} initialFocus={initialGraphFocus} />}

      {/* Tab 4: Thematic Modules */}
      {tab === 'modules' && (
        <section className="kg-pane">
          <p className="kg-pane__desc">
            Statistics Canada microdata dictionaries use 2–4 character prefix codes representing substantive thematic modules.
          </p>

          <div className="kg-modules-grid">
            {allModules.slice(0, 32).map((m) => (
              <div key={m.code} className="kg-module-card">
                <div className="kg-module-card__head">
                  <code className="kg-module-card__code">{m.code}</code>
                  <span className="kg-module-card__count">{m.count.toLocaleString()} variables</span>
                </div>
                <div className="kg-module-card__surveys">
                  Used in: {m.surveys.slice(0, 5).join(', ')}{m.surveys.length > 5 ? ` +${m.surveys.length - 5} more` : ''}
                </div>
                {onSelectSearch && (
                  <button
                    type="button"
                    className="kg-link kg-module-card__search"
                    onClick={() => onSelectSearch(m.code)}
                  >
                    Search module {m.code} ↗
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
