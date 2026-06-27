/**
 * CATI-style live preview with jump navigation.
 *
 * Right panel in Interviewer Mode. Shows:
 *   - A filterable jump-to list of all questions across all modules (entry → main → exit)
 *   - The selected question rendered in a large "CATI card" format
 *   - Module badge (ENTRY / MAIN / EXIT) on the active question
 *   - Interviewer-only badge where applicable
 */
import { useMemo, useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct, SequenceConstruct } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';

interface FlatItem {
  id: string;
  kind: 'question' | 'statement';
  label: string;
  moduleKind: 'entry' | 'main' | 'exit';
  sectionLabel: string;
  interviewerOnly: boolean;
  globalIndex: number;
  responseDomainType?: string;
  instruction?: string;
}

function flattenForPreview(
  rootChildren: ControlConstruct[],
  entryId: string | undefined,
  exitId: string | undefined,
  language: string,
): FlatItem[] {
  const items: FlatItem[] = [];
  let idx = 0;

  const visitChildren = (
    nodes: ControlConstruct[],
    moduleKind: 'entry' | 'main' | 'exit',
    sectionLabel: string,
  ) => {
    for (const node of nodes) {
      if (node.type === 'question') {
        items.push({
          id: node.id,
          kind: 'question',
          label: pick(node.text, language) || node.variableRef || node.id,
          moduleKind,
          sectionLabel,
          interviewerOnly: Boolean(node.interviewerOnly),
          globalIndex: ++idx,
          responseDomainType: node.responseDomain.type,
          instruction: node.instruction ? pick(node.instruction, language) : undefined,
        });
      } else if (node.type === 'statement') {
        items.push({
          id: node.id,
          kind: 'statement',
          label: pick(node.text, language) || node.id,
          moduleKind,
          sectionLabel,
          interviewerOnly: Boolean(node.interviewerOnly),
          globalIndex: ++idx,
        });
      } else if (node.type === 'sequence') {
        const childSection = pick(node.label, language) || sectionLabel;
        visitChildren(node.children, moduleKind, childSection);
      } else if (node.type === 'loop') {
        const childSection = pick(node.label, language) || sectionLabel;
        visitChildren(node.children, moduleKind, childSection);
      } else if (node.type === 'ifThenElse') {
        visitChildren(node.then, moduleKind, sectionLabel);
        visitChildren(node.else ?? [], moduleKind, sectionLabel);
      }
    }
  };

  // Determine ordered module sequences: entry first, then main, then exit
  const entrySeqs = rootChildren.filter(
    (c): c is SequenceConstruct =>
      c.type === 'sequence' && (c.id === entryId || c.moduleKind === 'entry'),
  );
  const exitSeqs = rootChildren.filter(
    (c): c is SequenceConstruct =>
      c.type === 'sequence' && (c.id === exitId || c.moduleKind === 'exit'),
  );
  const entryIds = new Set(entrySeqs.map((s) => s.id));
  const exitIds = new Set(exitSeqs.map((s) => s.id));
  const mainSeqs = rootChildren.filter(
    (c) => !entryIds.has(c.id) && !exitIds.has(c.id),
  );

  for (const seq of entrySeqs) {
    if (seq.type !== 'sequence') continue;
    const sl = pick(seq.label, language) || 'Entry';
    visitChildren(seq.children, 'entry', sl);
  }
  for (const node of mainSeqs) {
    if (node.type === 'sequence') {
      const sl = pick(node.label, language) || 'Main';
      visitChildren(node.children, 'main', sl);
    }
  }
  for (const seq of exitSeqs) {
    if (seq.type !== 'sequence') continue;
    const sl = pick(seq.label, language) || 'Exit';
    visitChildren(seq.children, 'exit', sl);
  }

  return items;
}

const MODULE_BADGE: Record<'entry' | 'main' | 'exit', string> = {
  entry: 'ENTRY',
  main: 'MAIN',
  exit: 'EXIT',
};

const DOMAIN_LABEL: Record<string, string> = {
  boolean: 'Yes / No',
  text: 'Open text',
  numeric: 'Number',
  code: 'Single/multi choice',
  datetime: 'Date / time',
  lookup: 'Search & select',
  markAll: 'Mark all that apply',
  grid: 'Grid / matrix',
  file: 'File upload',
};

function CatiCard({ item }: { item: FlatItem }) {
  return (
    <div className={`iv-cati-card iv-cati-card--${item.moduleKind}`}>
      <div className="iv-cati-card__meta">
        <span className={`iv-module-badge iv-module-badge--${item.moduleKind}`}>
          {MODULE_BADGE[item.moduleKind]}
        </span>
        {item.interviewerOnly && (
          <span className="iv-cati-card__iv-badge">🎧 Interviewer only</span>
        )}
        {item.sectionLabel && (
          <span className="iv-cati-card__section">{item.sectionLabel}</span>
        )}
        <span className="iv-cati-card__num">#{item.globalIndex}</span>
      </div>

      <p className="iv-cati-card__text">
        {item.kind === 'statement' ? (
          <em>{item.label}</em>
        ) : (
          item.label
        )}
      </p>

      {item.instruction && (
        <p className="iv-cati-card__instruction">{item.instruction}</p>
      )}

      {item.responseDomainType && (
        <div className="iv-cati-card__domain">
          Response: <strong>{DOMAIN_LABEL[item.responseDomainType] ?? item.responseDomainType}</strong>
        </div>
      )}
    </div>
  );
}

export function InterviewerPreview({ onJumpToQuestion }: { onJumpToQuestion: (id: string) => void }) {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const selectedId = useDesigner((s) => s.selectedId);
  const [search, setSearch] = useState('');

  const config = instrument.interviewer;
  const allItems = useMemo(
    () =>
      flattenForPreview(
        instrument.sequence.children,
        config?.entryModuleRef,
        config?.exitModuleRef,
        language,
      ),
    [instrument, config, language],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.sectionLabel.toLowerCase().includes(q) ||
        i.moduleKind.includes(q),
    );
  }, [allItems, search]);

  const activeItem = allItems.find((i) => i.id === selectedId) ?? null;

  // Group filtered items by module for the jump list
  const grouped = useMemo(() => {
    const map = new Map<'entry' | 'main' | 'exit', FlatItem[]>();
    for (const item of filtered) {
      if (!map.has(item.moduleKind)) map.set(item.moduleKind, []);
      map.get(item.moduleKind)!.push(item);
    }
    const order: Array<'entry' | 'main' | 'exit'> = ['entry', 'main', 'exit'];
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ moduleKind: k, items: map.get(k)! }));
  }, [filtered]);

  const handleJump = (id: string) => {
    onJumpToQuestion(id);
  };

  return (
    <div className="iv-preview">
      <div className="iv-preview__header">
        <span className="iv-preview__title">Interviewer Preview</span>
        {config?.allowFreeNavigation !== false && (
          <span className="iv-preview__nav-badge">Free Nav ON</span>
        )}
      </div>

      {/* Active question CATI card */}
      <div className="iv-preview__cati">
        {activeItem ? (
          <CatiCard item={activeItem} />
        ) : (
          <div className="iv-preview__empty">
            <p>Select a question from the Jump-to list to preview it here.</p>
            {allItems.length === 0 && (
              <p className="hint">No questions yet. Add an Entry Module or build the main survey.</p>
            )}
          </div>
        )}
      </div>

      {/* Jump navigation */}
      <div className="iv-preview__jump">
        <div className="iv-preview__jump-header">
          <span>Jump to question</span>
          <span className="iv-preview__count">{allItems.length} total</span>
        </div>
        <input
          className="iv-preview__search"
          type="search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="iv-preview__jump-list" role="list">
          {grouped.length === 0 && (
            <p className="iv-preview__no-results">No questions match.</p>
          )}
          {grouped.map(({ moduleKind, items }) => (
            <div key={moduleKind} className="iv-preview__group">
              <div className={`iv-preview__group-label iv-preview__group-label--${moduleKind}`}>
                {MODULE_BADGE[moduleKind]}
                {moduleKind === 'entry' && ' — Entry validation'}
                {moduleKind === 'main' && ' — Main survey'}
                {moduleKind === 'exit' && ' — Exit / coverage'}
              </div>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={[
                    'iv-preview__jump-item',
                    item.id === selectedId ? 'iv-preview__jump-item--active' : '',
                    item.interviewerOnly ? 'iv-preview__jump-item--iv' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleJump(item.id)}
                  title={item.label}
                >
                  <span className="iv-preview__jump-num">#{item.globalIndex}</span>
                  <span className="iv-preview__jump-label">{item.label}</span>
                  {item.interviewerOnly && (
                    <span className="iv-preview__jump-iv" aria-label="Interviewer only">🎧</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
