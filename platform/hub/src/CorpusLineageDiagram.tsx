import { useEffect, useMemo, useRef, useState } from 'react';
import type { CorpusLineageEdge, CorpusLineageTarget } from '@mobilesurvey/metadata-registry';
import { lineageEvidence } from './lineageEvidence.js';

const DIRECT_INPUTS_PER_VIEW = 6;
const NODE_WIDTH = 166;
const NODE_HEIGHT = 58;
const ROW_PITCH = 72;
const COLUMN_GAP = 58;
const PADDING = 28;
const HEADER_HEIGHT = 46;

interface DiagramNode {
  key: string;
  recordId: string;
  name: string;
  label: string;
  depth: number;
  x: number;
  y: number;
}

interface DiagramEdge {
  key: string;
  sourceKey: string;
  targetKey: string;
  evidence: 'named' | 'mapped' | 'provisional' | 'deterministic';
  derivationType: string;
}

function nodeKey(depth: number, recordId: string): string {
  return `${depth}:${recordId}`;
}

/** Unfold shared variables by step so every drawn arrow points one column toward the result. */
function layout(root: CorpusLineageTarget, edges: CorpusLineageEdge[]) {
  const maxDepth = Math.max(1, ...edges.map((edge) => edge.depth));
  const columns: DiagramNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  const nodes = new Map<string, DiagramNode>();
  const connections: DiagramEdge[] = [];

  function addNode(depth: number, id: string, name: string, label: string) {
    const key = nodeKey(depth, id);
    const existing = nodes.get(key);
    if (existing) {
      if (existing.label === existing.name && label !== name) existing.label = label;
      return existing;
    }
    const node: DiagramNode = { key, recordId: id, name, label, depth, x: 0, y: 0 };
    nodes.set(key, node);
    columns[depth]!.push(node);
    return node;
  }

  addNode(0, root.recordId, root.name, root.label);
  for (let depth = 1; depth <= maxDepth; depth++) {
    const parents = new Map(columns[depth - 1]!.map((node, index) => [node.key, index]));
    const layer = edges.filter((edge) => edge.depth === depth).sort((a, b) => {
      const aParent = parents.get(nodeKey(depth - 1, a.targetRecordId)) ?? Number.MAX_SAFE_INTEGER;
      const bParent = parents.get(nodeKey(depth - 1, b.targetRecordId)) ?? Number.MAX_SAFE_INTEGER;
      return aParent - bParent || a.sourceVarName.localeCompare(b.sourceVarName);
    });
    for (const edge of layer) {
      const target = addNode(depth - 1, edge.targetRecordId, edge.targetName, edge.targetName);
      const source = addNode(depth, edge.sourceRecordId ?? edge.edgeId, edge.sourceVarName, edge.sourceLabel);
      connections.push({
        key: `${edge.edgeId}:${depth}`,
        sourceKey: source.key,
        targetKey: target.key,
        evidence: lineageEvidence(edge),
        derivationType: edge.derivationType,
      });
    }
  }

  const width = Math.max(680, PADDING * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP);
  const rowCount = Math.max(1, ...columns.map((column) => column.length));
  const height = Math.max(270, HEADER_HEIGHT + rowCount * ROW_PITCH + PADDING);
  const columnPitch = (width - PADDING * 2 - NODE_WIDTH) / maxDepth;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const column = columns[depth]!;
    const stackHeight = column.length * ROW_PITCH - (ROW_PITCH - NODE_HEIGHT);
    const top = HEADER_HEIGHT + Math.max(0, (height - HEADER_HEIGHT - stackHeight) / 2);
    column.forEach((node, index) => {
      node.x = PADDING + (maxDepth - depth) * columnPitch;
      node.y = top + index * ROW_PITCH;
    });
  }
  return { width, height, maxDepth, columns, nodes, connections };
}

function visibleGraph(edges: CorpusLineageEdge[], directPage: number, showAll: boolean) {
  const direct = edges.filter((edge) => edge.depth === 1);
  const shown = showAll ? direct : direct.slice(directPage * DIRECT_INPUTS_PER_VIEW, (directPage + 1) * DIRECT_INPUTS_PER_VIEW);
  const included = [...shown];
  let frontier = new Set(shown.map((edge) => edge.sourceRecordId).filter((id): id is string => id !== null));
  const maxDepth = Math.max(1, ...edges.map((edge) => edge.depth));
  for (let depth = 2; depth <= maxDepth && frontier.size > 0; depth++) {
    const layer = edges.filter((edge) => edge.depth === depth && frontier.has(edge.targetRecordId));
    included.push(...layer);
    frontier = new Set(layer.map((edge) => edge.sourceRecordId).filter((id): id is string => id !== null));
  }
  return { directCount: direct.length, shown, edges: included };
}

function shortLabel(label: string, name: string): string {
  if (label === name) return '';
  return label.length > 31 ? `${label.slice(0, 28)}…` : label;
}

export function CorpusLineageDiagram({ target, edges, highlightRecordId }: { target: CorpusLineageTarget; edges: CorpusLineageEdge[]; highlightRecordId?: string }) {
  const [page, setPage] = useState(() => {
    const directIndex = edges.filter((edge) => edge.depth === 1)
      .findIndex((edge) => edge.sourceRecordId === highlightRecordId);
    return directIndex < 0 ? 0 : Math.floor(directIndex / DIRECT_INPUTS_PER_VIEW);
  });
  const [showAll, setShowAll] = useState(false);
  const [showLegendInfo, setShowLegendInfo] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const graph = useMemo(() => visibleGraph(edges, page, showAll), [edges, page, showAll]);
  const diagram = useMemo(() => layout(target, graph.edges), [target, graph.edges]);

  useEffect(() => {
    const element = viewport.current;
    if (element) {
      element.scrollTop = Math.max(0, (diagram.height - element.clientHeight) / 2);
      element.scrollLeft = Math.max(0, diagram.width - element.clientWidth);
    }
  }, [diagram.height, diagram.width, page, showAll]);

  const first = showAll ? 1 : page * DIRECT_INPUTS_PER_VIEW + 1;
  const last = showAll ? graph.directCount : Math.min((page + 1) * DIRECT_INPUTS_PER_VIEW, graph.directCount);

  return (
    <div className="kg-dag-visual kg-flow">
      <div className="kg-flow__toolbar">
        <div>
          <strong>Variable flow</strong>
          <span>Arrows point toward the derived variable.</span>
        </div>
        {graph.directCount > DIRECT_INPUTS_PER_VIEW && (
          <div className="kg-flow__controls">
            {!showAll && <button type="button" className="kg-btn kg-btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous inputs</button>}
            <span>{first}–{last} of {graph.directCount} direct inputs</span>
            {!showAll && <button type="button" className="kg-btn kg-btn--sm" disabled={last === graph.directCount} onClick={() => setPage(page + 1)}>Next inputs</button>}
            <button type="button" className="kg-btn kg-btn--sm" onClick={() => { setShowAll(!showAll); setPage(0); }}>
              {showAll ? 'Show six at a time' : 'Show all'}
            </button>
          </div>
        )}
      </div>
      <div className="kg-flow__viewport" ref={viewport}>
        <svg width={diagram.width} height={diagram.height} viewBox={`0 0 ${diagram.width} ${diagram.height}`} role="img" aria-label={`Variable flow for ${target.name}: ${graph.edges.length} published links shown`}>
          <title>Variable flow for {target.name}</title>
          <desc>Inputs on the left flow to {target.name} on the right. Solid slate lines: direct note-derived formulas. Long-dash teal lines: master-file counterparts. Dotted indigo lines: G-suffix grouped recodes. Short-dash grey lines: inferred mappings.</desc>
          <defs>
            <marker id="kg-flow-arrow-named" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#334155" />
            </marker>
            <marker id="kg-flow-arrow-counterpart" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#0d9488" />
            </marker>
            <marker id="kg-flow-arrow-collapse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#6366f1" />
            </marker>
            <marker id="kg-flow-arrow-inferred" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#94a3b8" />
            </marker>
          </defs>
          {diagram.columns.map((column, depth) => (
            <text key={`heading-${depth}`} x={column[0]!.x + NODE_WIDTH / 2} y="25" textAnchor="middle" fill="#475569" fontSize="11" fontWeight="700">
              {depth === 0 ? 'DERIVED VARIABLE' : depth === 1 ? 'DIRECT INPUTS' : `UPSTREAM STEP ${depth}`}
            </text>
          ))}
          {diagram.connections.map((edge) => {
            const source = diagram.nodes.get(edge.sourceKey)!;
            const destination = diagram.nodes.get(edge.targetKey)!;
            const x1 = source.x + NODE_WIDTH;
            const y1 = source.y + NODE_HEIGHT / 2;
            const x2 = destination.x - 8;
            const y2 = destination.y + NODE_HEIGHT / 2;
            const bend = (x1 + x2) / 2;

            const isCounterpart = edge.derivationType === 'counterpart';
            const isCollapse = edge.derivationType === 'collapse';
            const isNamed = edge.evidence === 'named' && !isCounterpart && !isCollapse;

            // Distinct stroke pattern + color + marker for each connection type:
            // 1. Note-derived (named verbatim): solid line (slate-700)
            // 2. Counterpart (PUMF ↔ Master bridge): long-dashed line (teal-600)
            // 3. G-collapse (grouped recode reduction): dotted line (indigo-500)
            // 4. Inferred / mapped: short-dashed line (slate-400)
            const strokeColor = isCounterpart
              ? '#0d9488'
              : isCollapse
                ? '#6366f1'
                : isNamed
                  ? '#334155'
                  : '#94a3b8';

            const dashArray = isCounterpart
              ? '8 4'
              : isCollapse
                ? '2 3'
                : isNamed
                  ? undefined
                  : '4 4';

            const markerId = isCounterpart
              ? 'url(#kg-flow-arrow-counterpart)'
              : isCollapse
                ? 'url(#kg-flow-arrow-collapse)'
                : isNamed
                  ? 'url(#kg-flow-arrow-named)'
                  : 'url(#kg-flow-arrow-inferred)';

            const strokeWidth = isCounterpart || isCollapse || isNamed ? '1.8' : '1.5';

            const title = isCounterpart
              ? 'Master-file counterpart; deterministic rule'
              : isCollapse
                ? 'G-suffix collapse; deterministic rule'
                : edge.evidence === 'named'
                  ? 'Source named in note'
                  : edge.evidence === 'provisional'
                    ? 'High-confidence provisional mapping; needs review'
                    : 'Source column mapped from note wording';

            return (
              <path
                key={edge.key}
                d={`M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                markerEnd={markerId}
              >
                <title>{title}</title>
              </path>
            );
          })}
          {diagram.columns.flat().map((node) => (
            <g key={node.key}>
              <title>{node.name}: {node.label}</title>
              <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="5" fill={node.recordId === highlightRecordId && node.depth > 0 ? '#fef3c7' : node.depth === 0 ? '#eff6ff' : '#f8fafc'} stroke={node.recordId === highlightRecordId && node.depth > 0 ? '#d97706' : node.depth === 0 ? '#3b82f6' : '#94a3b8'} strokeWidth={node.depth === 0 || node.recordId === highlightRecordId ? 2 : 1.3} />
              <text x={node.x + 10} y={node.y + 22} fill={node.depth === 0 ? '#1e40af' : '#0f172a'} fontSize="12" fontWeight="700" fontFamily="monospace">{node.name}</text>
              <text x={node.x + 10} y={node.y + 43} fill="#475569" fontSize="9.5">{shortLabel(node.label, node.name)}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="kg-flow__legend">
        <span className="kg-flow__legend-item" title="Explicit formula: source variable named verbatim in note">
          <span className="kg-flow__legend-line kg-flow__legend-line--solid" /> Solid: Note-derived
        </span>
        <span className="kg-flow__legend-item" title="Cross-document link: connects PUMF variable to detailed Master codebook">
          <span className="kg-flow__legend-line kg-flow__legend-line--counterpart" /> Long dash: Counterpart
        </span>
        <span className="kg-flow__legend-item" title="Grouped recode: categorical collapse (e.g. AGEG from AGE)">
          <span className="kg-flow__legend-line kg-flow__legend-line--collapse" /> Dotted: G-collapse
        </span>
        <span className="kg-flow__legend-item" title="Inferred link: mapped from questionnaire question or note wording">
          <span className="kg-flow__legend-line kg-flow__legend-line--inferred" /> Short dash: Inferred
        </span>
        <button
          type="button"
          className={`kg-flow__legend-help-btn ${showLegendInfo ? 'kg-flow__legend-help-btn--active' : ''}`}
          aria-expanded={showLegendInfo}
          aria-label="What do these 4 connection types mean?"
          title="Explain the 4 derivation types and real-world examples"
          onClick={() => setShowLegendInfo(!showLegendInfo)}
        >
          ?
        </button>
      </div>
      {showLegendInfo && (
        <div className="kg-flow__legend-guide">
          <div className="kg-flow__legend-guide-header">
            <strong>Derivation Connection Types & Real-World Examples</strong>
            <button
              type="button"
              className="kg-flow__legend-guide-close"
              aria-label="Close guide"
              onClick={() => setShowLegendInfo(false)}
            >
              ✕
            </button>
          </div>
          <table className="kg-flow__legend-table">
            <thead>
              <tr>
                <th style={{ width: '135px' }}>Type & Pattern</th>
                <th>What It Means</th>
                <th>Real-World Example</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="kg-flow__legend-item">
                    <span className="kg-flow__legend-line kg-flow__legend-line--solid" />
                    <strong>Note-derived</strong>
                  </span>
                </td>
                <td>
                  <strong>Direct formula citation:</strong> The official StatCan documentation note explicitly cites the exact input variable name(s) verbatim.
                </td>
                <td>
                  <code>ONL_SHOP</code> states <code>Derived from ANY (SHOP_DGS=1 OR SHOP_PG=1...)</code>
                </td>
              </tr>
              <tr>
                <td>
                  <span className="kg-flow__legend-item">
                    <span className="kg-flow__legend-line kg-flow__legend-line--counterpart" />
                    <strong>Counterpart</strong>
                  </span>
                </td>
                <td>
                  <strong>PUMF ↔ Master bridge:</strong> Connects an aggregated/coarsened public microdata variable to its detailed, unmasked counterpart in the confidential Master file.
                </td>
                <td>
                  <code>INCM</code> in PUMF linked to continuous master variable in RDC codebook
                </td>
              </tr>
              <tr>
                <td>
                  <span className="kg-flow__legend-item">
                    <span className="kg-flow__legend-line kg-flow__legend-line--collapse" />
                    <strong>G-collapse</strong>
                  </span>
                </td>
                <td>
                  <strong>Grouped-recode reduction:</strong> A continuous or multi-category variable collapsed into binned ranges within the same survey file (StatCan appends <code>G</code>).
                </td>
                <td>
                  <code>AGEG</code> (5-year age groups) collapsed from <code>AGE</code> (single years of age)
                </td>
              </tr>
              <tr>
                <td>
                  <span className="kg-flow__legend-item">
                    <span className="kg-flow__legend-line kg-flow__legend-line--inferred" />
                    <strong>Inferred</strong>
                  </span>
                </td>
                <td>
                  <strong>Mapped / Question alias:</strong> The note cites an interview question identifier (e.g. <code>ALC_Q45</code>) or wording mapped by the reviewer agent to the published column.
                </td>
                <td>
                  Questionnaire item <code>ALC_Q45</code> mapped to published microdata column <code>ALC_45</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
