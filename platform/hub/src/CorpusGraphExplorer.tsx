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
import { useMemo, useState } from 'react';
import summaryData from './data/knowledgeGraphSummary.json';

interface CorpusGraphExplorerProps {
  onSelectSearch?: (query: string, survey?: string) => void;
}

type ExplorerTab = 'surveys' | 'harmonized' | 'lineage' | 'modules';

interface BenchmarkDAG {
  id: string;
  targetName: string;
  targetLabel: string;
  survey: string;
  origin: 'collected' | 'administrative' | 'process';
  derivation: 'base' | 'derived';
  isGrouped: boolean;
  inputs: Array<{ name: string; label: string; origin: 'collected' | 'administrative' | 'process' }>;
  groupedRecode?: { name: string; label: string };
  ruleNote: string;
  standardCitation: string;
}

const BENCHMARK_DAGS: BenchmarkDAG[] = [
  {
    id: 'cchs_bmi',
    targetName: 'HWTDVBMI',
    targetLabel: 'Body Mass Index (Continuous DV)',
    survey: 'CCHS',
    origin: 'collected',
    derivation: 'derived',
    isGrouped: false,
    inputs: [
      { name: 'HWT_HT', label: 'Self-Reported Height (Metres)', origin: 'collected' },
      { name: 'HWT_WT', label: 'Self-Reported Weight (Kilograms)', origin: 'collected' },
      { name: 'DHH_AGE', label: 'Respondent Age at Interview', origin: 'collected' },
    ],
    groupedRecode: {
      name: 'HWTGDBMI',
      label: 'Body Mass Index - Grouped Categories (Underweight / Normal / Overweight / Obese) - (G)',
    },
    ruleNote: 'Based on: HWT_HT, HWT_WT and DHH_AGE. Calculated as Weight (kg) / [Height (m)]^2 for respondents aged 18 and older, excluding pregnant females.',
    standardCitation: 'Statistics Canada CCHS Derived Variables Documentation, Module HWT (Height and Weight)',
  },
  {
    id: 'cchs_gen_health',
    targetName: 'GENDHDI',
    targetLabel: 'Perceived Health Status Index',
    survey: 'CCHS',
    origin: 'collected',
    derivation: 'derived',
    isGrouped: false,
    inputs: [
      { name: 'GEN_01', label: 'Self-rated general health (1=Excellent to 5=Poor)', origin: 'collected' },
    ],
    groupedRecode: {
      name: 'GENDHDIG',
      label: 'Perceived Health - Collapsed Dichotomy (Excellent/Very Good/Good vs Fair/Poor) - (G)',
    },
    ruleNote: 'Based on: GEN_01. Recoded from 5-point Likert scale to standardized binary analytical health indicator.',
    standardCitation: 'CCHS Documentation, Module GEN (General Health)',
  },
  {
    id: 'cis_lim_at',
    targetName: 'LIM_AT',
    targetLabel: 'Low Income Measure After Tax',
    survey: 'CIS',
    origin: 'administrative',
    derivation: 'derived',
    isGrouped: false,
    inputs: [
      { name: 'T1FF_INC', label: 'CRA Tax Record - Net Total Income', origin: 'administrative' },
      { name: 'CF_SIZE', label: 'Census Family Size & Composition', origin: 'collected' },
      { name: 'TAX_DED', label: 'Federal & Provincial Tax Payable', origin: 'administrative' },
    ],
    groupedRecode: {
      name: 'LIM_ATG',
      label: 'Low Income Status Flag (Below 50% Adjusted Median Household Income) - (G)',
    },
    ruleNote: 'Based on CRA T1FF administrative tax file linkage matched to CIS survey household roster. Computed using 50% adjusted median after-tax income threshold.',
    standardCitation: 'Canadian Income Survey (CIS) Methodology & Low Income Measures',
  },
  {
    id: 'gss_living_arr',
    targetName: 'DLIVARR',
    targetLabel: 'Living Arrangement of Respondent',
    survey: 'GSS',
    origin: 'collected',
    derivation: 'derived',
    isGrouped: true,
    inputs: [
      { name: 'DHH_REL', label: 'Relationship to Household Reference Person', origin: 'collected' },
      { name: 'DHH_NUM', label: 'Total Persons in Household Roster', origin: 'collected' },
      { name: 'DHH_MAR', label: 'Legal Marital Status', origin: 'collected' },
    ],
    groupedRecode: {
      name: 'DLIVARRG',
      label: 'Collapsed Living Arrangement (Alone, Spouse/Partner, Single Parent, Other) - (G)',
    },
    ruleNote: 'Based on household roster matrix variables. Classifies dwelling into standardized family structure categories.',
    standardCitation: 'General Social Survey (GSS) Harmonized Sociodemographic Definitions',
  },
  {
    id: 'eics_elig',
    targetName: 'ELIG_EI',
    targetLabel: 'Employment Insurance Eligibility Indicator',
    survey: 'EICS',
    origin: 'collected',
    derivation: 'derived',
    isGrouped: false,
    inputs: [
      { name: 'LFS_HRS', label: 'Insurable Hours Worked in Reference Period', origin: 'collected' },
      { name: 'JOB_TERM', label: 'Reason for Job Separation (Layoff / Quit / Illness)', origin: 'collected' },
      { name: 'ROE_RECORD', label: 'Record of Employment Linkage Flag', origin: 'administrative' },
    ],
    groupedRecode: {
      name: 'ELIG_EIG',
      label: 'EI Benefit Eligibility Category (Eligible / Non-Eligible Involuntary / Voluntary) - (G)',
    },
    ruleNote: 'Derived from questionnaire items combined with administrative ROE insurable hour cutoffs across economic regions.',
    standardCitation: 'Employment Insurance Coverage Survey (EICS) Derived Specifications',
  },
];

export function CorpusGraphExplorer({ onSelectSearch }: CorpusGraphExplorerProps) {
  const [tab, setTab] = useState<ExplorerTab>('surveys');
  const [surveyFilter, setSurveyFilter] = useState('');
  const [expandedSurvey, setExpandedSurvey] = useState<string | null>('CIS');
  const [selectedDAG, setSelectedDAG] = useState<BenchmarkDAG>(BENCHMARK_DAGS[0]!);

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
            <span className="kg-metric__lbl">Derivation Links</span>
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
          aria-selected={tab === 'harmonized'}
          className={`kg-tab ${tab === 'harmonized' ? 'kg-tab--active' : ''}`}
          onClick={() => setTab('harmonized')}
        >
          Harmonized Concept Mesh ({summaryData.harmonizedConcepts.length})
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
                  <th>GSIM Composition (Collected / Derived / Admin / Process)</th>
                  <th>Top Modules</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSurveys.map((s) => {
                  const isExpanded = expandedSurvey === s.acronym;
                  const total = s.total;
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
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.total.toLocaleString()}</td>
                      <td style={{ textAlign: 'center' }}>{s.cycles.length}</td>
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
                      <td>
                        <div className="kg-mod-pills">
                          {s.topModules.slice(0, 4).map((m) => (
                            <span key={m.code} className="kg-mod-pill" title={`${m.count} vars in module ${m.code}`}>
                              {m.code}
                            </span>
                          ))}
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

      {/* Tab 2: Harmonized Concept Mesh */}
      {tab === 'harmonized' && (
        <section className="kg-pane">
          <p className="kg-pane__desc">
            Statistics Canada standardizes core concepts across household, health, and social surveys.
            Click any cell below to search for that concept within that survey program.
          </p>

          <div className="kg-table-wrap">
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
                          Search All ↗
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab 3: Interactive Derivation Lineage DAG */}
      {tab === 'lineage' && (
        <section className="kg-pane">
          <div className="kg-dag-layout">
            <div className="kg-dag-sidebar">
              <h3 className="kg-dag-sidebar__title">Benchmark Derivations</h3>
              <p className="kg-dag-sidebar__desc">
                Select a standard StatCan derived indicator to inspect its computational lineage DAG:
              </p>
              <div className="kg-dag-list">
                {BENCHMARK_DAGS.map((dag) => (
                  <button
                    key={dag.id}
                    type="button"
                    className={`kg-dag-item ${selectedDAG.id === dag.id ? 'kg-dag-item--active' : ''}`}
                    onClick={() => setSelectedDAG(dag)}
                  >
                    <div className="kg-dag-item__head">
                      <code>{dag.targetName}</code>
                      <span className="kg-dag-item__survey">{dag.survey}</span>
                    </div>
                    <div className="kg-dag-item__label">{dag.targetLabel}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="kg-dag-main">
              <div className="kg-dag-card">
                <div className="kg-dag-card__header">
                  <div>
                    <h3 className="kg-dag-card__title">
                      Lineage DAG: <code>{selectedDAG.targetName}</code> ({selectedDAG.targetLabel})
                    </h3>
                    <span className="kg-dag-card__sub">{selectedDAG.standardCitation}</span>
                  </div>
                  {onSelectSearch && (
                    <button
                      type="button"
                      className="kg-btn kg-btn--primary"
                      onClick={() => onSelectSearch(selectedDAG.targetName, selectedDAG.survey)}
                    >
                      Find Variable in Searcher ↗
                    </button>
                  )}
                </div>

                {/* SVG Visual DAG */}
                <div className="kg-dag-visual">
                  <svg viewBox="0 0 740 240" className="kg-dag-svg" preserveAspectRatio="xMidYMid meet">
                    <defs>
                      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                      </marker>
                    </defs>

                    {/* Inputs Column (Left) */}
                    <text x="90" y="24" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600">
                      INPUT VARIABLES (disco:Variable)
                    </text>
                    {selectedDAG.inputs.map((inp, idx) => {
                      const yPos = 40 + idx * 60;
                      return (
                        <g key={inp.name}>
                          <rect x="20" y={yPos} width="140" height="46" rx="4" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
                          <text x="30" y={yPos + 18} fill="#0f172a" fontSize="11" fontWeight="700" fontFamily="monospace">
                            {inp.name}
                          </text>
                          <text x="30" y={yPos + 34} fill="#64748b" fontSize="9">
                            {inp.label.slice(0, 22)}...
                          </text>
                          {/* Connection line to target */}
                          <path
                            d={`M 160 ${yPos + 23} C 260 ${yPos + 23}, 260 110, 310 110`}
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth="1.5"
                            markerEnd="url(#arrow)"
                          />
                        </g>
                      );
                    })}

                    {/* Center Column: Derived Index Target */}
                    <text x="380" y="54" textAnchor="middle" fill="#1e3a8a" fontSize="11" fontWeight="600">
                      DERIVED VARIABLE (prov:wasDerivedFrom)
                    </text>
                    <rect x="300" y="70" width="160" height="80" rx="6" fill="#eff6ff" stroke="#3b82f6" strokeWidth="2" />
                    <text x="380" y="98" textAnchor="middle" fill="#1e40af" fontSize="14" fontWeight="700" fontFamily="monospace">
                      {selectedDAG.targetName}
                    </text>
                    <text x="380" y="118" textAnchor="middle" fill="#1e293b" fontSize="10" fontWeight="500">
                      {selectedDAG.targetLabel.slice(0, 26)}
                    </text>
                    <text x="380" y="136" textAnchor="middle" fill="#2563eb" fontSize="9">
                      GSIM: {selectedDAG.origin} / {selectedDAG.derivation}
                    </text>

                    {/* Right Column: Grouped Recode (if exists) */}
                    {selectedDAG.groupedRecode && (
                      <>
                        <text x="630" y="54" textAnchor="middle" fill="#701a75" fontSize="11" fontWeight="600">
                          PUMF GROUPED RECODE (- G)
                        </text>
                        <path d="M 460 110 L 530 110" fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrow)" />
                        <rect x="540" y="70" width="180" height="80" rx="6" fill="#fdf4ff" stroke="#c026d3" strokeWidth="2" />
                        <text x="630" y="98" textAnchor="middle" fill="#86198f" fontSize="14" fontWeight="700" fontFamily="monospace">
                          {selectedDAG.groupedRecode.name}
                        </text>
                        <text x="630" y="118" textAnchor="middle" fill="#1e293b" fontSize="10" fontWeight="500">
                          {selectedDAG.groupedRecode.label.slice(0, 28)}...
                        </text>
                        <text x="630" y="136" textAnchor="middle" fill="#a21caf" fontSize="9">
                          Categorical Collapsing (PUMF)
                        </text>
                      </>
                    )}
                  </svg>
                </div>

                {/* Evidence Note */}
                <div className="kg-dag-evidence">
                  <h4 className="kg-dag-evidence__title">Extracted Derivation Logic & Documentation Evidence</h4>
                  <blockquote className="kg-dag-evidence__quote">"{selectedDAG.ruleNote}"</blockquote>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

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
