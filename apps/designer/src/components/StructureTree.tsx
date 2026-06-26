/** Left-hand tree of the instrument's control constructs. Every node has an inline ⊕ add button. */
import { useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import {
  addChild,
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

function TreeNode({
  node,
  depth,
  isRoot = false,
}: {
  node: ControlConstruct;
  depth: number;
  isRoot?: boolean;
}) {
  const { selectedId, language, newlyInsertedId } = useDesigner();
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const selected = selectedId === node.id;
  const container = isContainer(node);
  const isNew = node.id === newlyInsertedId;

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

  // Only offer 'page' as an add option when adding into a sequence (incl. root).
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
        {/* Collapse chevron for container nodes */}
        {container ? (
          <button
            type="button"
            className="tree__chevron"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            title={collapsed ? 'Expand children' : 'Collapse children'}
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
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
          <span className="tree__icon" aria-hidden="true">
            {getIcon(node)}
          </span>
          <span className="tree__label">{nodeLabel(node, language)}</span>
        </button>

        <span className="tree__actions">
          <button
            type="button"
            aria-label={container ? 'Add child item' : 'Insert item after'}
            aria-expanded={addOpen}
            title={container ? 'Add child' : 'Add after'}
            className={addOpen ? 'tree__add-btn tree__add-btn--open' : 'tree__add-btn'}
            onClick={(e) => {
              e.stopPropagation();
              setAddOpen((o) => !o);
            }}
          >
            ⊕
          </button>
          {!isRoot && (
            <>
              <button
                type="button"
                aria-label="Move up"
                onClick={() => update((d) => void moveNode(d.sequence, node.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => update((d) => void moveNode(d.sequence, node.id, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="Delete"
                className="danger"
                onClick={() => update((d) => void removeNode(d.sequence, node.id))}
              >
                ✕
              </button>
            </>
          )}
        </span>
      </div>

      {addOpen && (
        <div
          className="tree__inline-add"
          style={{ paddingInlineStart: (depth + 1) * 14 + 8 }}
        >
          <span className="tree__add-hint">
            {container ? 'Add into:' : 'Add after:'}
          </span>
          {addItems.map((t) => (
            <button key={t.type} type="button" onClick={() => handleAdd(t.type)}>
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
          <button type="button" aria-label="Close" onClick={() => setAddOpen(false)}>
            ✕
          </button>
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
                  <TreeNode key={child.id} node={child} depth={depth + 1} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function StructureTree() {
  const root = useDesigner((s) => s.instrument.sequence);
  return (
    <nav className="tree" aria-label="Questionnaire structure">
      <ul>
        <TreeNode node={root} depth={0} isRoot />
      </ul>
    </nav>
  );
}
