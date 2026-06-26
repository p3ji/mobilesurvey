/**
 * Easy Mode — full-featured flat survey editor.
 * Shows all questions with editable text, response type, inline categories,
 * routing conditions, and controls to add / delete questions.
 */
import React, { useRef, useState } from 'react';
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct, Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';
import { createConstruct, genId, insertAfter, removeNode } from '../lib/tree.js';
import { useDesigner } from '../store/instrumentStore.js';
import { findNode } from '../lib/tree.js';
import { IntlStringField } from './fields.jsx';

// ── types ────────────────────────────────────────────────────────────────────

interface FlatQuestion {
  node: ControlConstruct & { type: 'question' };
  num: number;
  pageLabel: string;
}

type AddType = 'text' | 'paragraph' | 'number' | 'boolean' | 'single' | 'multiple' | 'date' | 'statement';

const ADD_MENU: { type: AddType; label: string }[] = [
  { type: 'text',      label: 'Short text' },
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'number',    label: 'Number' },
  { type: 'boolean',   label: 'Yes / No' },
  { type: 'single',    label: 'Single choice' },
  { type: 'multiple',  label: 'Multiple choice' },
  { type: 'date',      label: 'Date' },
  { type: 'statement', label: 'Statement (no answer)' },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function flattenQuestions(root: ControlConstruct, lang: string): FlatQuestion[] {
  const result: FlatQuestion[] = [];
  let num = 0;

  function walk(node: ControlConstruct, pageLabel: string) {
    if (node.type === 'sequence') {
      const label = node.isPage ? (pick(node.label, lang) || `Page ${result.length + 1}`) : pageLabel;
      const pl = node.isPage ? label : pageLabel;
      node.children.forEach((c) => walk(c, pl));
    } else if (node.type === 'question') {
      num++;
      result.push({ node: node as FlatQuestion['node'], num, pageLabel });
    } else if (node.type === 'loop') {
      node.children.forEach((c) => walk(c, pageLabel));
    } else if (node.type === 'ifThenElse') {
      node.then.forEach((c) => walk(c, pageLabel));
      (node.else ?? []).forEach((c) => walk(c, pageLabel));
    }
  }

  walk(root, '');
  return result;
}

function domainLabel(rd: ResponseDomain): string {
  switch (rd.type) {
    case 'code':    return rd.selection === 'multiple' ? 'Multiple choice' : 'Single choice';
    case 'numeric': return `Number${rd.min !== undefined || rd.max !== undefined ? ` [${rd.min ?? ''}–${rd.max ?? ''}]` : ''}`;
    case 'text':    return rd.multiline ? 'Paragraph' : 'Short text';
    case 'datetime':return `Date${rd.mode !== 'date' ? `/${rd.mode}` : ''}`;
    case 'boolean': return 'Yes / No';
    case 'file':    return 'File upload';
    case 'lookup':  return 'Lookup';
    case 'markAll': return 'Mark all that apply';
    default:        return 'Unknown';
  }
}

function categorySchemeRef(rd: ResponseDomain): string | null {
  if (rd.type === 'code' || rd.type === 'lookup' || rd.type === 'markAll') return rd.categorySchemeRef;
  return null;
}

// ── sub-components ───────────────────────────────────────────────────────────

function CategoryList({
  schemeId,
  instrument,
  lang,
}: {
  schemeId: string;
  instrument: Instrument;
  lang: string;
}) {
  const scheme = instrument.categorySchemes.find((s) => s.id === schemeId);
  if (!scheme) return <p className="em-hint">Code list not found: <code>{schemeId}</code></p>;
  if (!scheme.categories.length) return <p className="em-hint">No categories yet — edit in Variables tab.</p>;
  const isMulti = instrument.categorySchemes.length > 0;
  void isMulti;
  return (
    <ul className="em-cats">
      {scheme.categories.map((c) => (
        <li key={c.code}>
          <span className="em-cat-code">{c.code}</span>
          <span className="em-cat-label">{pick(c.label as Record<string, string>, lang) || c.code}</span>
        </li>
      ))}
    </ul>
  );
}

function RoutingNote({ condition }: { condition: string }) {
  return (
    <p className="em-routing">
      <span className="em-routing-label">▷ Show when:</span>
      <code className="em-routing-expr">{condition}</code>
    </p>
  );
}

/** Small popup menu for choosing a question type when clicking "+". */
function AddMenu({
  onAdd,
  onClose,
}: {
  onAdd: (type: AddType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="em-add-menu" ref={ref} role="menu">
      {ADD_MENU.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          className="em-add-menu__item"
          onClick={() => { onAdd(type); onClose(); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Inline response-type editor shown when a card is expanded. */
function DomainEditor({
  node,
  instrument,
  lang,
  update,
}: {
  node: ControlConstruct & { type: 'question' };
  instrument: Instrument;
  lang: string;
  update: (recipe: (d: Instrument) => void) => void;
}) {
  const rd = node.responseDomain;
  const schemeRef = categorySchemeRef(rd);

  const setType = (addType: AddType) => {
    update((d) => {
      const n = findNode(d.sequence, node.id) as (ControlConstruct & { type: 'question' }) | null;
      if (!n || n.type !== 'question') return;
      switch (addType) {
        case 'text':      n.responseDomain = { type: 'text' }; break;
        case 'paragraph': n.responseDomain = { type: 'text', multiline: true }; break;
        case 'number':    n.responseDomain = { type: 'numeric' }; break;
        case 'boolean':   n.responseDomain = { type: 'boolean' }; break;
        case 'date':      n.responseDomain = { type: 'datetime', mode: 'date' }; break;
        case 'single':
        case 'multiple': {
          const existing = rd.type === 'code' || rd.type === 'markAll' || rd.type === 'lookup'
            ? rd.categorySchemeRef : null;
          const csId = existing ?? genId('cs');
          if (!existing) d.categorySchemes.push({ id: csId, label: { en: 'New code list' }, categories: [] });
          n.responseDomain = { type: 'code', selection: addType === 'multiple' ? 'multiple' : 'single', categorySchemeRef: csId };
          break;
        }
        case 'statement':
          // Convert question to statement is complex (different node type); just clear text domain
          n.responseDomain = { type: 'text' };
          break;
      }
    });
  };

  const currentAddType = (() => {
    if (rd.type === 'text' && rd.multiline) return 'paragraph';
    if (rd.type === 'text') return 'text';
    if (rd.type === 'numeric') return 'number';
    if (rd.type === 'boolean') return 'boolean';
    if (rd.type === 'datetime') return 'date';
    if (rd.type === 'code' && rd.selection === 'multiple') return 'multiple';
    if (rd.type === 'code') return 'single';
    return 'text';
  })();

  return (
    <div className="em-domain-editor">
      <label className="em-field-label">Response type</label>
      <select
        className="em-select"
        value={currentAddType}
        onChange={(e) => setType(e.target.value as AddType)}
      >
        {ADD_MENU.filter(a => a.type !== 'statement').map(({ type, label }) => (
          <option key={type} value={type}>{label}</option>
        ))}
      </select>

      {schemeRef && (
        <div className="em-cats-editor">
          <div className="em-field-label">
            Categories
            <span className="em-hint"> — add/remove in the Variables tab</span>
          </div>
          <CategoryList schemeId={schemeRef} instrument={instrument} lang={lang} />
        </div>
      )}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────────────

export function EasyModeView() {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const languages = instrument.languages;
  const selectedId = useDesigner((s) => s.selectedId);
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);

  // Which "add question" button is open: null | 'before-<id>' | 'end'
  const [addOpen, setAddOpen] = useState<string | null>(null);

  const questions = flattenQuestions(instrument.sequence, language);

  const handleAdd = (afterId: string | null, addType: AddType) => {
    update((d) => {
      let newNode: ControlConstruct;
      if (addType === 'statement') {
        newNode = createConstruct('statement');
      } else {
        newNode = createConstruct('question');
        const q = newNode as ControlConstruct & { type: 'question' };
        switch (addType) {
          case 'paragraph': q.responseDomain = { type: 'text', multiline: true }; break;
          case 'number':    q.responseDomain = { type: 'numeric' }; break;
          case 'boolean':   q.responseDomain = { type: 'boolean' }; break;
          case 'date':      q.responseDomain = { type: 'datetime', mode: 'date' }; break;
          case 'single':
          case 'multiple': {
            const csId = genId('cs');
            d.categorySchemes.push({ id: csId, label: { en: 'New code list' }, categories: [] });
            q.responseDomain = { type: 'code', selection: addType === 'multiple' ? 'multiple' : 'single', categorySchemeRef: csId };
            break;
          }
          default: q.responseDomain = { type: 'text' };
        }
      }
      if (afterId) {
        insertAfter(d.sequence, afterId, newNode);
      } else {
        // Append to first page / sequence root
        if (d.sequence.type === 'sequence') d.sequence.children.push(newNode);
      }
    });
  };

  const handleDelete = (nodeId: string) => {
    update((d) => { removeNode(d.sequence, nodeId); });
    if (selectedId === nodeId) select(null);
  };

  const editText = (nodeId: string, newText: Record<string, string>) =>
    update((d) => {
      const n = findNode(d.sequence, nodeId) as (ControlConstruct & { type: 'question' }) | null;
      if (n && n.type === 'question') n.text = newText;
    });

  const editInstruction = (nodeId: string, val: Record<string, string>) =>
    update((d) => {
      const n = findNode(d.sequence, nodeId) as (ControlConstruct & { type: 'question' }) | null;
      if (n && n.type === 'question') n.instruction = val;
    });

  const editRouting = (nodeId: string, expr: string) =>
    update((d) => {
      const n = findNode(d.sequence, nodeId) as (ControlConstruct & { type: 'question' }) | null;
      if (n && n.type === 'question') n.visibleWhen = expr || undefined;
    });

  const toggleRequired = (nodeId: string, val: boolean) =>
    update((d) => {
      const n = findNode(d.sequence, nodeId) as (ControlConstruct & { type: 'question' }) | null;
      if (n && n.type === 'question') n.required = val;
    });

  /** An inline "+ Add" strip rendered between cards and at the end of the list. */
  const AddStrip = ({ afterId }: { afterId: string | null }) => {
    const key = afterId ?? 'end';
    return (
      <div className="em-add-strip">
        <button
          type="button"
          className="em-add-btn"
          aria-haspopup="menu"
          aria-expanded={addOpen === key}
          onClick={(e) => { e.stopPropagation(); setAddOpen(addOpen === key ? null : key); }}
        >
          + Add question
        </button>
        {addOpen === key && (
          <AddMenu
            onAdd={(t) => handleAdd(afterId, t)}
            onClose={() => setAddOpen(null)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="easymode" onClick={() => setAddOpen(null)}>
      <div className="easymode__header">
        <div>
          <h2 className="easymode__title">
            {pick(instrument.metadata.title as Record<string, string>, language) ?? 'Survey'}
          </h2>
          <p className="easymode__sub">
            {questions.length} questions · Easy Mode shows all questions in order with categories and routing.
          </p>
        </div>
      </div>

      {questions.length === 0 && (
        <p className="easymode__empty">No questions yet. Use the button below to add your first question.</p>
      )}

      <div className="easymode__list">
        {questions.length === 0 && <AddStrip afterId={null} />}

        {questions.map(({ node, num, pageLabel }, idx) => {
          const isSelected = selectedId === node.id;
          const schemeRef = categorySchemeRef(node.responseDomain);
          const hasCategories = !!schemeRef;
          const hasRouting = !!node.visibleWhen;

          return (
            <React.Fragment key={node.id}>
              <div
                className={['easymode__card', isSelected ? 'easymode__card--selected' : ''].filter(Boolean).join(' ')}
              >
                {/* Card header row */}
                <div className="easymode__card-head" onClick={() => select(node.id)}>
                  <span className="easymode__num">Q{num}</span>
                  {pageLabel && <span className="easymode__page">{pageLabel}</span>}
                  <span className="easymode__domain">{domainLabel(node.responseDomain)}</span>
                  {node.required && <span className="easymode__req">Required</span>}
                  {hasRouting && <span className="easymode__badge-routing">Has routing</span>}
                  <button
                    type="button"
                    className="easymode__delete"
                    aria-label={`Delete Q${num}`}
                    onClick={(e) => { e.stopPropagation(); handleDelete(node.id); }}
                  >
                    ✕
                  </button>
                </div>

                {/* Question text: collapsed = plain text, expanded = editor */}
                {isSelected ? (
                  <div className="easymode__edit" onClick={(e) => e.stopPropagation()}>
                    <IntlStringField
                      label="Question text"
                      value={node.text}
                      languages={languages}
                      multiline
                      onChange={(v) => editText(node.id, v)}
                    />
                    <IntlStringField
                      label="Instruction (optional)"
                      value={node.instruction ?? {}}
                      languages={languages}
                      onChange={(v) => editInstruction(node.id, v)}
                    />

                    <DomainEditor node={node} instrument={instrument} lang={language} update={update} />

                    <div className="em-field-row">
                      <label className="em-field-label">Show when (routing expression)</label>
                      <input
                        type="text"
                        className="em-input"
                        placeholder="e.g. $age >= 18"
                        value={node.visibleWhen ?? ''}
                        onChange={(e) => editRouting(node.id, e.target.value)}
                      />
                    </div>

                    <label className="em-checkbox-row">
                      <input
                        type="checkbox"
                        checked={node.required ?? false}
                        onChange={(e) => toggleRequired(node.id, e.target.checked)}
                      />
                      Required
                    </label>
                  </div>
                ) : (
                  <div className="easymode__preview" onClick={() => select(node.id)}>
                    <p className="easymode__qtext">
                      {pick(node.text, language) || <em className="em-placeholder">Click to edit question text</em>}
                    </p>

                    {/* Show categories inline */}
                    {hasCategories && (
                      <CategoryList schemeId={schemeRef!} instrument={instrument} lang={language} />
                    )}

                    {/* Show routing condition */}
                    {hasRouting && <RoutingNote condition={node.visibleWhen!} />}
                  </div>
                )}
              </div>

              {/* Add strip between cards */}
              {idx < questions.length - 1 && <AddStrip afterId={node.id} />}
            </React.Fragment>
          );
        })}

        {/* Add strip at the end */}
        {questions.length > 0 && <AddStrip afterId={questions[questions.length - 1]!.node.id} />}
      </div>
    </div>
  );
}
