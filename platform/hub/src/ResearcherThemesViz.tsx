import { useMemo, useState } from 'react';
import { BarChart3, Calendar, Filter, Layers, Percent, RotateCcw, X } from 'lucide-react';

export interface PilotWork {
  id: string;
  title: string;
  doi: string | null;
  url: string;
  year: number | null;
  workType: string | null;
  issuingOrganization: string | null;
  sources: string[];
  theme: string | null;
  uses: Array<{
    program: string;
    precision: 'exact_cycles' | 'range' | 'program_only';
    cycles: string[];
    cycleText: string;
    evidenceLocation: string;
  }>;
  mentions: Array<{ program: string; evidenceLocation: string }>;
}

export const THEME_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  health: { label: 'Health', color: '#0284c7', border: '#0369a1' },
  'digital society': { label: 'Digital Society', color: '#6366f1', border: '#4f46e5' },
  labour: { label: 'Labour', color: '#d97706', border: '#b45309' },
  families: { label: 'Families', color: '#8b5cf6', border: '#7c3aed' },
  'income and inequality': { label: 'Income & Inequality', color: '#059669', border: '#047857' },
  immigration: { label: 'Immigration', color: '#e11d48', border: '#be123c' },
  education: { label: 'Education', color: '#0891b2', border: '#0e7490' },
  housing: { label: 'Housing', color: '#ea580c', border: '#c2410c' },
  'Indigenous peoples': { label: 'Indigenous Peoples', color: '#b91c1c', border: '#991b1b' },
  'crime and justice': { label: 'Crime & Justice', color: '#475569', border: '#334155' },
  environment: { label: 'Environment', color: '#16a34a', border: '#15803d' },
  aging: { label: 'Aging', color: '#78716c', border: '#57534e' },
  other: { label: 'Other', color: '#94a3b8', border: '#64748b' },
};

export function getThemeConfig(themeKey: string): { label: string; color: string; border: string } {
  return THEME_CONFIG[themeKey] ?? { label: themeKey, color: '#94a3b8', border: '#64748b' };
}

export const DOC_TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All Document Types' },
  { key: 'article', label: 'Journal Articles' },
  { key: 'report', label: 'Policy & NGO Reports' },
  { key: 'preprint', label: 'Preprints & Working Papers' },
  { key: 'dissertation', label: 'Theses & Dissertations' },
  { key: 'other', label: 'Datasets & Other' },
];

export function getDocCategory(type: string | null): string {
  if (type === 'article' || type === 'journal article') return 'article';
  if (type === 'report') return 'report';
  if (type === 'preprint') return 'preprint';
  if (type === 'dissertation') return 'dissertation';
  return 'other';
}

interface ResearcherThemesVizProps {
  works: PilotWork[];
  selectedType: string;
  onSelectType: (type: string) => void;
  selectedTheme: string;
  onSelectTheme: (theme: string) => void;
  selectedPubYear: number | null;
  onSelectPubYear: (year: number | null) => void;
  selectedSurveys: string[];
}

export function ResearcherThemesViz({
  works,
  selectedType,
  onSelectType,
  selectedTheme,
  onSelectTheme,
  selectedPubYear,
  onSelectPubYear,
  selectedSurveys,
}: ResearcherThemesVizProps) {
  const [chartMode, setChartMode] = useState<'count' | 'share'>('count');
  const [timeWindow, setTimeWindow] = useState<'all' | 'recent'>('all');
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  // Compute document type counts across the entire catalog
  const docTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: works.length };
    DOC_TYPE_OPTIONS.forEach(opt => {
      if (opt.key === 'all') return;
      counts[opt.key] = works.filter(w => getDocCategory(w.workType) === opt.key).length;
    });
    return counts;
  }, [works]);

  // Filter works by the selected document type (and optionally survey if user actively filtered by survey)
  const filteredWorks = useMemo(() => {
    return works.filter(work => {
      if (selectedType !== 'all') {
        if (selectedType === 'article') {
          if (work.workType !== 'article' && work.workType !== 'journal article') return false;
        } else if (selectedType === 'other') {
          if (['article', 'journal article', 'report', 'preprint', 'dissertation'].includes(work.workType ?? '')) {
            return false;
          }
        } else if (work.workType !== selectedType) {
          return false;
        }
      }
      if (selectedSurveys.length > 0) {
        if (!work.uses.some(u => selectedSurveys.includes(u.program))) return false;
      }
      return true;
    });
  }, [works, selectedType, selectedSurveys]);

  // Aggregate theme totals for the active document type
  const themeTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const key of Object.keys(THEME_CONFIG)) {
      map[key] = 0;
    }
    for (const work of filteredWorks) {
      const t = work.theme ?? 'other';
      map[t] = (map[t] ?? 0) + 1;
    }
    return Object.entries(map)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [filteredWorks]);

  // Determine active years
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    for (const w of filteredWorks) {
      if (w.year) yearsSet.add(w.year);
    }
    if (yearsSet.size === 0) return [];
    const minYear = timeWindow === 'recent' ? 2015 : Math.min(...yearsSet);
    const maxYear = Math.max(...yearsSet, 2026);
    const result: number[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      result.push(y);
    }
    return result;
  }, [filteredWorks, timeWindow]);

  // Build matrix: year -> { total, themes: Record<theme, count> }
  const matrix = useMemo(() => {
    const data: Record<number, { total: number; themes: Record<string, number> }> = {};
    for (const y of availableYears) {
      data[y] = { total: 0, themes: {} };
    }
    for (const w of filteredWorks) {
      const y = w.year;
      if (y && data[y]) {
        const t = w.theme ?? 'other';
        data[y].total += 1;
        data[y].themes[t] = (data[y].themes[t] ?? 0) + 1;
      }
    }
    return data;
  }, [filteredWorks, availableYears]);

  const maxCount = useMemo(() => {
    let max = 1;
    for (const y of availableYears) {
      const tot = matrix[y]?.total ?? 0;
      if (tot > max) max = tot;
    }
    return max;
  }, [availableYears, matrix]);

  // Dynamic Y-axis scale ticks
  const yTicks = useMemo(() => {
    if (chartMode === 'share') {
      return [0, 25, 50, 75, 100];
    }
    const step = maxCount <= 10 ? 2 : maxCount <= 25 ? 5 : maxCount <= 60 ? 10 : maxCount <= 120 ? 25 : 50;
    const roundedMax = Math.ceil(maxCount / step) * step;
    const ticks: number[] = [];
    for (let val = 0; val <= roundedMax; val += step) {
      ticks.push(val);
    }
    return ticks;
  }, [chartMode, maxCount]);

  const chartMaxY = chartMode === 'share' ? 100 : (yTicks[yTicks.length - 1] || maxCount);

  // SVG dimensions
  const svgWidth = 960;
  const svgHeight = 260;
  const marginLeft = 48;
  const marginRight = 16;
  const marginTop = 20;
  const marginBottom = 34;
  const plotWidth = svgWidth - marginLeft - marginRight;
  const plotHeight = svgHeight - marginTop - marginBottom;

  const slotWidth = availableYears.length > 0 ? plotWidth / availableYears.length : plotWidth;
  const barWidth = Math.max(6, Math.min(36, slotWidth * 0.72));

  // Top theme & stats
  const topTheme = themeTotals[0];
  const peakYearEntry = useMemo(() => {
    let peakY: number | null = null;
    let peakVal = 0;
    for (const y of availableYears) {
      const tot = matrix[y]?.total ?? 0;
      if (tot > peakVal) {
        peakVal = tot;
        peakY = y;
      }
    }
    return peakY ? { year: peakY, count: peakVal } : null;
  }, [availableYears, matrix]);

  const activeHoveredYearData = hoveredYear && matrix[hoveredYear] ? matrix[hoveredYear] : null;

  return (
    <section className="researcher-section researcher-trends-section" id="researcher-trends" aria-labelledby="researcher-trends-title">
      <div className="researcher-section__heading researcher-trends__header">
        <div>
          <p className="researcher-kicker">Empirical Thematic Trends</p>
          <h2 id="researcher-trends-title">Publications by Theme & Year</h2>
          <p>
            Track the volume and thematic shifts of external research analyzing Statistics Canada microdata over time.
            Click any bar or theme chip to filter search results below.
          </p>
        </div>

        {/* Global summary pill */}
        <div className="researcher-trends__quick-metrics">
          <div className="researcher-metric-pill">
            <span className="researcher-metric-pill__label">Current Selection</span>
            <strong>{filteredWorks.length}</strong>
            <span className="researcher-metric-pill__sub">
              {selectedType === 'all' ? 'All Document Types' : DOC_TYPE_OPTIONS.find(o => o.key === selectedType)?.label}
            </span>
          </div>
          {topTheme && (
            <div className="researcher-metric-pill">
              <span className="researcher-metric-pill__label">Top Theme</span>
              <strong style={{ color: THEME_CONFIG[topTheme[0]]?.color ?? '#0284c7' }}>
                {THEME_CONFIG[topTheme[0]]?.label ?? topTheme[0]}
              </strong>
              <span className="researcher-metric-pill__sub">
                {topTheme[1]} pubs ({filteredWorks.length > 0 ? Math.round((topTheme[1] / filteredWorks.length) * 100) : 0}%)
              </span>
            </div>
          )}
          {peakYearEntry && (
            <div className="researcher-metric-pill">
              <span className="researcher-metric-pill__label">Peak Year</span>
              <strong>{peakYearEntry.year}</strong>
              <span className="researcher-metric-pill__sub">{peakYearEntry.count} publications</span>
            </div>
          )}
        </div>
      </div>

      {/* Primary Toolbar: Document Type Filter & Display Toggles */}
      <div className="researcher-trends__toolbar">
        <div className="researcher-trends__type-filter" role="group" aria-label="Filter visualization by document type">
          <span className="researcher-trends__filter-label">
            <Filter size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 4 }} />
            Document type:
          </span>
          <div className="researcher-trends__type-chips">
            {DOC_TYPE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`researcher-trends__type-chip ${selectedType === opt.key ? 'is-active' : ''}`}
                onClick={() => onSelectType(opt.key)}
                aria-pressed={selectedType === opt.key}
              >
                <span>{opt.label}</span>
                <span className="researcher-trends__chip-badge">{docTypeCounts[opt.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="researcher-trends__toggles">
          <div className="researcher-trends__button-group" role="group" aria-label="Chart mode">
            <button
              type="button"
              className={chartMode === 'count' ? 'is-active' : ''}
              onClick={() => setChartMode('count')}
              title="View absolute publication counts"
            >
              <BarChart3 size={13} aria-hidden="true" /> Volume
            </button>
            <button
              type="button"
              className={chartMode === 'share' ? 'is-active' : ''}
              onClick={() => setChartMode('share')}
              title="View 100% proportional theme share"
            >
              <Percent size={13} aria-hidden="true" /> 100% Share
            </button>
          </div>

          <div className="researcher-trends__button-group" role="group" aria-label="Time window">
            <button
              type="button"
              className={timeWindow === 'all' ? 'is-active' : ''}
              onClick={() => setTimeWindow('all')}
              title="Show full timeline from 1991 to 2026"
            >
              All Years (1991–2026)
            </button>
            <button
              type="button"
              className={timeWindow === 'recent' ? 'is-active' : ''}
              onClick={() => setTimeWindow('recent')}
              title="Focus on recent decades (2015–2026)"
            >
              2015–2026 (Recent)
            </button>
          </div>

          {(selectedTheme !== 'all' || selectedPubYear !== null || selectedType !== 'all') && (
            <button
              type="button"
              className="researcher-trends__clear-btn"
              onClick={() => {
                onSelectTheme('all');
                onSelectPubYear(null);
                onSelectType('all');
              }}
              title="Reset all filters on visualization"
            >
              <RotateCcw size={12} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 3 }} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Chart Container */}
      <div className="researcher-trends__chart-card" role="region" aria-label="Publication themes timeline chart">
        {filteredWorks.length === 0 ? (
          <div className="researcher-trends__empty">
            <p>No publications found matching the current document type and survey filters.</p>
            <button type="button" className="researcher-reset-btn" onClick={() => onSelectType('all')}>
              Show all document types
            </button>
          </div>
        ) : (
          <div className="researcher-trends__svg-wrap">
            <svg
              className="researcher-trends__svg"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`Stacked bar chart of publications by theme by year. Mode: ${chartMode}.`}
            >
              <defs>
                <linearGradient id="activeYearHighlight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0284c7" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {/* Y-Axis Gridlines and Ticks */}
              {yTicks.map(tickVal => {
                const tickRatio = chartMaxY > 0 ? tickVal / chartMaxY : 0;
                const yPos = marginTop + plotHeight - tickRatio * plotHeight;
                return (
                  <g key={tickVal} className="researcher-trends__grid-line">
                    <line
                      x1={marginLeft}
                      y1={yPos}
                      x2={svgWidth - marginRight}
                      y2={yPos}
                      stroke={tickVal === 0 ? '#94a3b8' : '#e2e8f0'}
                      strokeWidth={tickVal === 0 ? 1.5 : 1}
                      strokeDasharray={tickVal === 0 ? 'none' : '3 3'}
                    />
                    <text
                      x={marginLeft - 8}
                      y={yPos + 3.5}
                      textAnchor="end"
                      fontSize="10"
                      fill="#64748b"
                      fontWeight="600"
                    >
                      {chartMode === 'share' ? `${tickVal}%` : tickVal}
                    </text>
                  </g>
                );
              })}

              {/* Bars per Year */}
              {availableYears.map((year, index) => {
                const slotX = marginLeft + index * slotWidth;
                const barX = slotX + (slotWidth - barWidth) / 2;
                const yearData = matrix[year];
                const yearTotal = yearData?.total ?? 0;
                const isSelectedYear = selectedPubYear === year;
                const isHovered = hoveredYear === year;

                // Sort themes for consistent bottom-to-top stacking order
                const sortedThemes = Object.keys(THEME_CONFIG).filter(t => (yearData?.themes[t] ?? 0) > 0);

                // Compute stacked segment positions
                let currentY = marginTop + plotHeight;
                const segments: Array<{ theme: string; count: number; y: number; height: number; isTop: boolean }> = [];

                if (yearTotal > 0 && yearData) {
                  sortedThemes.forEach((theme, themeIdx) => {
                    const count = yearData.themes[theme] ?? 0;
                    if (count <= 0) return;
                    let segmentHeight = 0;
                    if (chartMode === 'share') {
                      segmentHeight = (count / yearTotal) * plotHeight;
                    } else {
                      segmentHeight = (count / chartMaxY) * plotHeight;
                    }
                    const segY = currentY - segmentHeight;
                    currentY = segY;
                    segments.push({
                      theme,
                      count,
                      y: segY,
                      height: segmentHeight,
                      isTop: themeIdx === sortedThemes.length - 1,
                    });
                  });
                }

                // Bar opacity logic when filtering
                const isYearMuted = selectedPubYear !== null && selectedPubYear !== year;

                return (
                  <g
                    key={year}
                    className={`researcher-trends__bar-group ${isSelectedYear ? 'is-selected' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`Year ${year}: ${yearTotal} publication${yearTotal === 1 ? '' : 's'}. Click to filter.`}
                    onClick={() => onSelectPubYear(isSelectedYear ? null : year)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectPubYear(isSelectedYear ? null : year);
                      }
                    }}
                  >
                    {/* Selected or Hovered Year Background Beacon */}
                    {(isSelectedYear || isHovered) && (
                      <rect
                        x={slotX + 1}
                        y={marginTop}
                        width={slotWidth - 2}
                        height={plotHeight}
                        fill={isSelectedYear ? 'url(#activeYearHighlight)' : '#f8fafc'}
                        rx={4}
                      />
                    )}

                    {/* Stacked Segments */}
                    {segments.map((seg, sIdx) => {
                      const themeConf = getThemeConfig(seg.theme);
                      const isThemeActive = selectedTheme === 'all' || selectedTheme === seg.theme;
                      const isThemeHovered = hoveredTheme === null || hoveredTheme === seg.theme;
                      const opacity = !isThemeActive ? 0.16 : !isThemeHovered ? 0.35 : isYearMuted ? 0.35 : 1;

                      return (
                        <rect
                          key={`${year}-${seg.theme}-${sIdx}`}
                          x={barX}
                          y={seg.y}
                          width={barWidth}
                          height={Math.max(1.5, seg.height)}
                          fill={themeConf.color}
                          rx={seg.isTop ? 2.5 : 0}
                          ry={seg.isTop ? 2.5 : 0}
                          opacity={opacity}
                          style={{ transition: 'opacity 0.15s ease, y 0.2s ease, height 0.2s ease' }}
                        />
                      );
                    })}

                    {/* Selected Year Accent Ring / Border */}
                    {isSelectedYear && (
                      <rect
                        x={barX - 2}
                        y={currentY - 2}
                        width={barWidth + 4}
                        height={marginTop + plotHeight - currentY + 4}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={1.5}
                        rx={3}
                      />
                    )}

                    {/* X-Axis Year Label */}
                    <text
                      x={barX + barWidth / 2}
                      y={svgHeight - 12}
                      textAnchor="middle"
                      fontSize={availableYears.length > 28 ? '8.5' : '10'}
                      fontWeight={isSelectedYear ? '800' : isHovered ? '700' : '600'}
                      fill={isSelectedYear ? '#0284c7' : isHovered ? '#1e293b' : '#64748b'}
                    >
                      {availableYears.length > 28 && index % 2 !== 0 && !isSelectedYear && !isHovered
                        ? '' // Skip alternating labels if very dense
                        : year}
                    </text>

                    {/* Full Height Interactive Hitbox */}
                    <rect
                      x={slotX}
                      y={marginTop}
                      width={slotWidth}
                      height={plotHeight + marginBottom}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredYear(year)}
                      onMouseLeave={() => setHoveredYear(null)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Live Hover Inspection Overlay / Tooltip */}
        {activeHoveredYearData && hoveredYear && (
          <div className="researcher-trends__inspector" aria-live="polite">
            <div className="researcher-trends__inspector-header">
              <span className="researcher-trends__inspector-year">
                <Calendar size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 4 }} />
                Year {hoveredYear}
              </span>
              <span className="researcher-trends__inspector-total">
                <b>{activeHoveredYearData.total}</b> publications
                {chartMode === 'share' && activeHoveredYearData.total > 0 && ' (100% share)'}
              </span>
              <span className="researcher-trends__inspector-hint">Click bar to filter search results</span>
            </div>

            <div className="researcher-trends__inspector-chips">
              {Object.entries(activeHoveredYearData.themes)
                .sort((a, b) => b[1] - a[1])
                .map(([theme, count]) => {
                  const conf = getThemeConfig(theme);
                  const pct = activeHoveredYearData.total > 0 ? Math.round((count / activeHoveredYearData.total) * 100) : 0;
                  return (
                    <span
                      key={theme}
                      className="researcher-trends__inspector-chip"
                      style={{ borderLeftColor: conf.color }}
                      onMouseEnter={() => setHoveredTheme(theme)}
                      onMouseLeave={() => setHoveredTheme(null)}
                      onClick={() => onSelectTheme(selectedTheme === theme ? 'all' : theme)}
                      title={`Click to filter by ${conf.label}`}
                    >
                      <span className="researcher-trends__chip-dot" style={{ backgroundColor: conf.color }} />
                      <span className="researcher-trends__chip-name">{conf.label}:</span>
                      <b>{count}</b>
                      <span className="researcher-trends__chip-pct">({pct}%)</span>
                    </span>
                  );
                })}
            </div>
          </div>
        )}

        {/* Interactive Theme Legend & Tally */}
        <div className="researcher-trends__legend" aria-label="Themes breakdown and filter legend">
          <div className="researcher-trends__legend-title">
            <Layers size={13} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 4 }} />
            <span>Themes in current selection (click to isolate):</span>
          </div>

          <div className="researcher-trends__legend-chips">
            {themeTotals.map(([theme, count]) => {
              const conf = getThemeConfig(theme);
              const isSelected = selectedTheme === theme;
              const pct = filteredWorks.length > 0 ? Math.round((count / filteredWorks.length) * 100) : 0;

              return (
                <button
                  key={theme}
                  type="button"
                  className={`researcher-trends__legend-chip ${isSelected ? 'is-active' : ''}`}
                  style={{
                    backgroundColor: isSelected ? `${conf.color}15` : undefined,
                    borderColor: isSelected ? conf.color : undefined,
                  }}
                  onClick={() => onSelectTheme(isSelected ? 'all' : theme)}
                  onMouseEnter={() => setHoveredTheme(theme)}
                  onMouseLeave={() => setHoveredTheme(null)}
                  aria-pressed={isSelected}
                  title={`Theme ${conf.label}: ${count} publication${count === 1 ? '' : 's'} (${pct}%). Click to filter.`}
                >
                  <span className="researcher-trends__legend-dot" style={{ backgroundColor: conf.color }} />
                  <span className="researcher-trends__legend-name">{conf.label}</span>
                  <span className="researcher-trends__legend-count">{count}</span>
                  {isSelected && <X size={11} aria-hidden="true" style={{ marginLeft: 3 }} />}
                </button>
              );
            })}

            {selectedTheme !== 'all' && (
              <button
                type="button"
                className="researcher-trends__clear-theme-btn"
                onClick={() => onSelectTheme('all')}
              >
                Clear theme ({getThemeConfig(selectedTheme).label}) <X size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
