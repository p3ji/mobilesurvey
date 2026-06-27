/**
 * Left panel in Interviewer Mode. Shows three stacked zones:
 *   ENTRY  — pre-interview validation (phone / address)
 *   MAIN   — collapsible list of all non-entry/exit sequences
 *   EXIT   — post-interview housekeeping (household phone enumeration)
 *
 * Clicking a question selects it and opens the Inspector.
 */
import { useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct, SequenceConstruct } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';

interface Props {
  onConfigClick: () => void;
  onEntryBuilderClick: () => void;
  onExitBuilderClick: () => void;
  onQuestionClick: (id: string) => void;
}

/** Walk a subtree and collect all question/statement constructs as flat list items. */
function collectItems(
  nodes: ControlConstruct[],
  language: string,
): { id: string; label: string; kind: 'question' | 'statement'; interviewerOnly: boolean }[] {
  const out: ReturnType<typeof collectItems> = [];
  for (const n of nodes) {
    if (n.type === 'question') {
      out.push({
        id: n.id,
        label: pick(n.text, language) || n.variableRef || n.id,
        kind: 'question',
        interviewerOnly: Boolean(n.interviewerOnly),
      });
    } else if (n.type === 'statement') {
      out.push({
        id: n.id,
        label: pick(n.text, language) || n.id,
        kind: 'statement',
        interviewerOnly: Boolean(n.interviewerOnly),
      });
    } else if (n.type === 'sequence' || n.type === 'loop') {
      out.push(...collectItems(n.children, language));
    } else if (n.type === 'ifThenElse') {
      out.push(...collectItems(n.then, language));
      out.push(...collectItems(n.else ?? [], language));
    }
  }
  return out;
}

function ModuleZone({
  kind,
  sequence,
  language,
  onQuestionClick,
  onAdd,
  onEdit,
}: {
  kind: 'entry' | 'exit';
  sequence: SequenceConstruct | null;
  language: string;
  onQuestionClick: (id: string) => void;
  onAdd: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const items = sequence ? collectItems(sequence.children, language) : [];
  const label = kind === 'entry' ? 'Entry Module' : 'Exit Module';
  const color = kind === 'entry' ? 'entry' : 'exit';

  return (
    <div className={`iv-zone iv-zone--${color}`}>
      <div className="iv-zone__header">
        <span className={`iv-zone__badge iv-zone__badge--${color}`}>
          {kind === 'entry' ? '📞' : '📱'} {label.toUpperCase()}
        </span>
        {sequence && (
          <button
            type="button"
            className="iv-zone__toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}
      </div>

      {sequence ? (
        <>
          {expanded && (
            <ul className="iv-zone__items">
              {items.length === 0 && (
                <li className="iv-zone__empty">No questions yet.</li>
              )}
              {items.map((item) => (
                <li key={item.id} className="iv-zone__item">
                  <button
                    type="button"
                    className="iv-zone__item-btn"
                    onClick={() => onQuestionClick(item.id)}
                  >
                    <span className="iv-zone__item-icon">
                      {item.kind === 'question' ? '?' : '"'}
                    </span>
                    <span className="iv-zone__item-label">{item.label}</span>
                    {item.interviewerOnly && (
                      <span className="iv-zone__iv-icon" title="Interviewer only">🎧</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="iv-zone__edit-btn" onClick={onEdit}>
            ✎ Edit in Builder
          </button>
        </>
      ) : (
        <button type="button" className="iv-zone__add-btn" onClick={onAdd}>
          + Add {label}
        </button>
      )}
    </div>
  );
}

function MainZone({
  sequences,
  language,
  onQuestionClick,
}: {
  sequences: SequenceConstruct[];
  language: string;
  onQuestionClick: (id: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (sequences.length === 0) {
    return (
      <div className="iv-zone iv-zone--main">
        <div className="iv-zone__header">
          <span className="iv-zone__badge iv-zone__badge--main">📋 MAIN</span>
        </div>
        <p className="iv-zone__empty">
          No main sections yet. Add sections in Pro Mode.
        </p>
      </div>
    );
  }

  return (
    <div className="iv-zone iv-zone--main">
      <div className="iv-zone__header">
        <span className="iv-zone__badge iv-zone__badge--main">📋 MAIN</span>
        <span className="iv-zone__count">{sequences.length} section{sequences.length !== 1 ? 's' : ''}</span>
      </div>
      <ul className="iv-zone__sections">
        {sequences.map((seq) => {
          const expanded = expandedIds.has(seq.id);
          const items = collectItems(seq.children, language);
          const label = pick(seq.label, language) || (seq.isPage ? 'Page' : 'Section');
          return (
            <li key={seq.id} className="iv-zone__section">
              <button
                type="button"
                className="iv-zone__section-btn"
                onClick={() => toggle(seq.id)}
              >
                <span>{expanded ? '▼' : '▶'}</span>
                <span className="iv-zone__section-label">{label}</span>
                <span className="iv-zone__section-count">{items.length}q</span>
              </button>
              {expanded && (
                <ul className="iv-zone__items iv-zone__items--nested">
                  {items.length === 0 && (
                    <li className="iv-zone__empty">No questions.</li>
                  )}
                  {items.map((item) => (
                    <li key={item.id} className="iv-zone__item">
                      <button
                        type="button"
                        className="iv-zone__item-btn"
                        onClick={() => onQuestionClick(item.id)}
                      >
                        <span className="iv-zone__item-icon">
                          {item.kind === 'question' ? '?' : '"'}
                        </span>
                        <span className="iv-zone__item-label">{item.label}</span>
                        {item.interviewerOnly && (
                          <span className="iv-zone__iv-icon" title="Interviewer only">🎧</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ModuleMapPanel({ onConfigClick, onEntryBuilderClick, onExitBuilderClick, onQuestionClick }: Props) {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const config = instrument.interviewer;

  const rootChildren = instrument.sequence.children;

  const entrySeq = config?.entryModuleRef
    ? rootChildren.find((c): c is SequenceConstruct =>
        c.type === 'sequence' && c.id === config.entryModuleRef
      ) ?? null
    : rootChildren.find((c): c is SequenceConstruct =>
        c.type === 'sequence' && c.moduleKind === 'entry'
      ) ?? null;

  const exitSeq = config?.exitModuleRef
    ? rootChildren.find((c): c is SequenceConstruct =>
        c.type === 'sequence' && c.id === config.exitModuleRef
      ) ?? null
    : rootChildren.find((c): c is SequenceConstruct =>
        c.type === 'sequence' && c.moduleKind === 'exit'
      ) ?? null;

  const mainSeqs = rootChildren.filter((c): c is SequenceConstruct =>
    c.type === 'sequence' &&
    c.id !== entrySeq?.id &&
    c.id !== exitSeq?.id
  );

  return (
    <nav className="iv-map" aria-label="Module map">
      <div className="iv-map__header">
        <span className="iv-map__title">Module Map</span>
        <button
          type="button"
          className="iv-map__config-btn"
          title="Interviewer settings"
          onClick={onConfigClick}
        >
          ⚙
        </button>
      </div>

      <ModuleZone
        kind="entry"
        sequence={entrySeq}
        language={language}
        onQuestionClick={onQuestionClick}
        onAdd={onEntryBuilderClick}
        onEdit={onEntryBuilderClick}
      />

      <MainZone
        sequences={mainSeqs}
        language={language}
        onQuestionClick={onQuestionClick}
      />

      <ModuleZone
        kind="exit"
        sequence={exitSeq}
        language={language}
        onQuestionClick={onQuestionClick}
        onAdd={onExitBuilderClick}
        onEdit={onExitBuilderClick}
      />

      <p className="iv-map__hint">
        Edit main survey structure in <strong>Pro Mode</strong>.
      </p>
    </nav>
  );
}
