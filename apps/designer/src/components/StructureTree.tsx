/** Left-hand tree of the instrument's control constructs. Searchable, collapsible. */
import { useMemo, useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import {
  addChild,
  buildQNumMap,
  childArrays,
  createConstruct,
  insertAfter,
  isContainer,
  moveNode,
  removeNode,
  type AddableType,
} from '../lib/tree.js';

const ADD_ITEMS: { type: AddableType; icon: string; label: string }[] = [
  { type: 'page',        icon: '□',  label: 'Page' },
  { type: 'question',    icon: '?',  label: 'Question' },
  { type: 'sequence',    icon: '▣',  label: 'Section' },
  { type: 'loop',        icon: '↻',  label: 'Roster' },
  { type: 'ifThenElse',  icon: '⎇',  label: 'Branch' },
  { type: 'statement',   icon: '"',  label: 'Statement' },
  { type: 'computation', icon: 'ƒ',  label: 'Computation' },
];

function getIcon(node: ControlConstruct): string {
  if (node.type === 'sequence') return node.isPage ? '□' : '▣';
  const icons: Partial<Record<ControlConstruct['type'], string>> = {
    question: '?', ifThenElse: '⎇', loop: '↻', computation: 'ƒ', statement: '"',
  };
  return icons[node.type] ?? '·';
}

function nodeLabel(node: ControlConstruct, language: string): string {
  switch (node.type) {
    case 'sequence': return pick(node.label, language) || (node.isPage ? 'Page' : 'Section');
    case 'question': return pick(node.text, language) || node.variableRef || 'Question';
    case 'statement': return pick(node.text, language) || 'Statement';
    case 'loop': return `${pick(node.label, language) || 'Roster'} (×${node.countVariableRef || '?'})`;
    case 'ifThenElse': return `If ${node.condition || '…'}`;
    case 'computation': return `${node.targetVariableRef || '?'} = ${node.expression || '…'}`;
  }
}

// ── Search helpers ─────────────────────────────────────────────────────────────

interface VisibleResult { ids: Set<string>; matchCount: number; }

function computeVisible(
  root: ControlConstruct,
  query: string,
  language: string,
): VisibleResult | null {
  if (!query.trim()) return null;
  const q = query.toLowerCase();
  const ids = new Set<string>();
  let matchCount = 0;

  function nodeMatches(node: ControlConstruct): boolean {
    if (nodeLabel(node, language).toLowerCase().includes(q)) return true;
    if (node.type === 'question' && node.variableRef?.toLowerCase().includes(q)) return true;
    return false;
  }

  function walk(node: ControlConstruct, ancestors: string[]): boolean {
    const self = nodeMatches(node);
    if (self) matchCount++;
    const path = [...ancestors, node.id];
    let childHit = false;
    if (isContainer(node)) {
      for (const arr of childArrays(node)) {
        for (const child of arr) {
          if (walk(child, path)) childHit = true;
        }
      }
    }
    if (self || childHit) {
      ids.add(node.id);
      for (const a of ancestors) ids.add(a);
    }
    return self || childHit;
  }

  walk(root, []);
  return { ids, matchCount };
}

function collectContainerIds(node: ControlConstruct, out: Set<string> = new Set()): Set<string> {
  if (isContainer(node)) {
    out.add(node.id);
    for (const arr of childArrays(node)) for (const c of arr) collectContainerIds(c, out);
  }
  return out;
}

// ── Match highlight ────────────────────────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="tree__match">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Tree node ──────────────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  isRoot = false,
  qNumMap,
  collapsedIds,
  onToggle,
  visibleIds,
  query,
}: {
  node: ControlConstruct;
  depth: number;
  isRoot?: boolean;
  qNumMap: Map<string, number>;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  visibleIds: Set<string> | null;
  query: string;
}) {
  // Hooks must run unconditionally
  const { selectedId, language, newlyInsertedId } = useDesigner();
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);
  const [addOpen, setAddOpen] = useState(false);

  // Filter: skip nodes outside the visible set
  if (visibleIds && !visibleIds.has(node.id)) return null;

  const selected = selectedId === node.id;
  const container = isContainer(node);
  const isNew = node.id === newlyInsertedId;
  // When filtering, force-expand so matches are reachable
  const collapsed = visibleIds ? false : collapsedIds.has(node.id);
  const label = nodeLabel(node, language);

  const handleAdd = (type: AddableType) => {
    const child = createConstruct(type);
    update((draft) => {
      if (container) {
        addChild(draft.sequence, node.id, child, 'then');
      } else {
        insertAfter(draft.sequence, node.id, child);
      }
    });
    select(child.id);
    setAddOpen(false);
  };

  const addItems =
    node.type === 'sequence' ? ADD_ITEMS : ADD_ITEMS.filter((t) => t.type !== 'page');

  const rowClass = [
    'tree__row',
    selected ? 'tree__row--selected' : '',
    isNew ? 'tree__row--new' : '',
  ].filter(Boolean).join(' ');

  return (
    <li className="tree__item">
      <div className={rowClass} style={{ paddingInlineStart: depth * 14 + 8 }}>
        {container ? (
          <button
            type="button"
            className="tree__chevron"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            title={collapsed ? 'Expand children' : 'Collapse children'}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="tree__chevron-spacer" aria-hidden="true" />
        )}

        <button
          type="button"
          className="tree__select"
          aria-current={selected ? 'true' : undefined}
          onClick={() => select(node.id)}
        >
          <span className="tree__icon" aria-hidden="true">{getIcon(node)}</span>
          {node.type === 'question' && qNumMap.has(node.id) && (
            <span className="tree__qnum">Q{qNumMap.get(node.id)}.</span>
          )}
          <span className="tree__label">
            <HighlightMatch text={label} query={query} />
          </span>
          {node.type === 'sequence' && node.moduleKind && (
            <span className={`tree__module-badge tree__module-badge--${node.moduleKind}`}>
              {node.moduleKind.toUpperCase()}
            </span>
          )}
          {('interviewerOnly' in node && node.interviewerOnly) && (
            <span className="tree__iv-icon" aria-label="Interviewer only" title="Interviewer only">🎧</span>
          )}
        </button>

        <span className="tree__actions">
          <button
            type="button"
            aria-label={container ? 'Add child item' : 'Insert item after'}
            aria-expanded={addOpen}
            title={container ? 'Add child' : 'Add after'}
            className={addOpen ? 'tree__add-btn tree__add-btn--open' : 'tree__add-btn'}
            onClick={(e) => { e.stopPropagation(); setAddOpen((o) => !o); }}
          >
            ⊕
          </button>
          {!isRoot && (
            <>
              <button type="button" aria-label="Move up"
                onClick={() => update((d) => void moveNode(d.sequence, node.id, -1))}>↑</button>
              <button type="button" aria-label="Move down"
                onClick={() => update((d) => void moveNode(d.sequence, node.id, 1))}>↓</button>
              <button type="button" aria-label="Delete" className="danger"
                onClick={() => update((d) => void removeNode(d.sequence, node.id))}>✕</button>
            </>
          )}
        </span>
      </div>

      {addOpen && (
        <div className="tree__inline-add" style={{ paddingInlineStart: (depth + 1) * 14 + 8 }}>
          <span className="tree__add-hint">{container ? 'Add into:' : 'Add after:'}</span>
          {addItems.map((t) => (
            <button key={t.type} type="button" onClick={() => handleAdd(t.type)}>
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
          <button type="button" aria-label="Close" onClick={() => setAddOpen(false)}>✕</button>
        </div>
      )}

      {container && !collapsed && (
        <ul className="tree__children">
          {childArrays(node).map((arr, branchIndex) => (
            <li key={branchIndex} className="tree__branch">
              {node.type === 'ifThenElse' && (
                <span className="tree__branch-label">
                  {branchIndex === 0 ? 'then' : 'else'}
                </span>
              )}
              <ul>
                {arr.map((child) => (
                  <TreeNode key={child.id} node={child} depth={depth + 1} qNumMap={qNumMap}
                    collapsedIds={collapsedIds} onToggle={onToggle}
                    visibleIds={visibleIds} query={query} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ── StructureTree ──────────────────────────────────────────────────────────────

export function StructureTree() {
  const root = useDesigner((s) => s.instrument.sequence);
  const language = useDesigner((s) => s.language);
  const qNumMap = buildQNumMap(root);

  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => computeVisible(root, query, language),
    [root, query, language],
  );

  const onToggle = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const collapseAll = () => setCollapsedIds(collectContainerIds(root));
  const expandAll = () => setCollapsedIds(new Set());

  return (
    <nav className="tree" aria-label="Questionnaire structure">
      <div className="tree__toolbar">
        <div className="tree__search-wrap">
          <input
            type="search"
            className="tree__search-input"
            placeholder="Search questions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search questions"
          />
          {visible && (
            <span className="tree__search-count" aria-live="polite">
              {visible.matchCount} match{visible.matchCount === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        <div className="tree__toolbar-btns">
          <button type="button" className="tree__ctrl-btn" title="Collapse all" onClick={collapseAll}>⊖</button>
          <button type="button" className="tree__ctrl-btn" title="Expand all" onClick={expandAll}>⊕</button>
        </div>
      </div>

      <ul>
        <TreeNode
          node={root}
          depth={0}
          isRoot
          qNumMap={qNumMap}
          collapsedIds={collapsedIds}
          onToggle={onToggle}
          visibleIds={visible?.ids ?? null}
          query={query}
        />
      </ul>
    </nav>
  );
}
