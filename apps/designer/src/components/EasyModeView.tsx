/**
 * Easy Mode — simplified instrument view for quick survey building.
 * Shows a numbered flat list of all questions with editable text and response type.
 * Hides variables, validation expressions, prefill mappings, and routing details.
 * Includes a text-export function that produces a printable questionnaire outline.
 */
import { pick } from '@mobilesurvey/runtime-engine';
import type { ControlConstruct, Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';
import { findNode } from '../lib/tree.js';
import { IntlStringField } from './fields.jsx';

interface FlatQuestion {
  node: ControlConstruct & { type: 'question' };
  num: number;
  pageLabel: string;
}

/** Flatten the sequence tree into a numbered list of questions, recording which page each is on. */
function flattenQuestions(root: ControlConstruct, lang: string): FlatQuestion[] {
  const result: FlatQuestion[] = [];
  let num = 0;

  function walk(node: ControlConstruct, pageLabel: string) {
    if (node.type === 'sequence') {
      const label = node.isPage ? (pick(node.label, lang) || `Page ${result.length + 1}`) : pageLabel;
      const pl = node.isPage ? label : pageLabel;
      if ('children' in node) node.children.forEach((c) => walk(c, pl));
    } else if (node.type === 'question') {
      num++;
      result.push({ node: node as FlatQuestion['node'], num, pageLabel });
    } else if (node.type === 'loop') {
      if ('children' in node) node.children.forEach((c) => walk(c, pageLabel));
    } else if (node.type === 'ifThenElse') {
      node.then.forEach((c) => walk(c, pageLabel));
      (node.else ?? []).forEach((c) => walk(c, pageLabel));
    }
  }

  walk(root, '');
  return result;
}

function responseDomainSummary(rd: ResponseDomain): string {
  switch (rd.type) {
    case 'code': return `${rd.selection === 'multiple' ? 'Multiple choice' : 'Single choice'} (${rd.categorySchemeRef})`;
    case 'numeric': return `Number${rd.min !== undefined || rd.max !== undefined ? ` [${rd.min ?? ''}–${rd.max ?? ''}]` : ''}`;
    case 'text': return rd.multiline ? 'Long text' : 'Short text';
    case 'datetime': return `Date/time (${rd.mode})`;
    case 'boolean': return 'Yes / No';
    case 'file': return 'File upload';
    case 'lookup': return `Lookup (${rd.categorySchemeRef})`;
    case 'markAll': return `Mark all that apply (${rd.categorySchemeRef})`;
    default: return 'Unknown';
  }
}

/** Export the instrument as a plain-text questionnaire outline. */
function exportText(instrument: Instrument, lang: string): string {
  const title = pick(instrument.metadata.title as Record<string, string>, lang) ?? 'Survey';
  const questions = flattenQuestions(instrument.sequence, lang);
  const lines: string[] = [`${title}`, `${'='.repeat(title.length)}`, ''];

  let lastPage = '';
  for (const { node, num, pageLabel } of questions) {
    if (pageLabel !== lastPage) {
      if (lastPage) lines.push('');
      lines.push(`── ${pageLabel || 'Questions'} ──`);
      lines.push('');
      lastPage = pageLabel;
    }
    const text = pick(node.text, lang) || node.variableRef || `Q${num}`;
    lines.push(`Q${num}. ${text}`);
    if (node.instruction) {
      const instr = pick(node.instruction, lang);
      if (instr) lines.push(`    (${instr})`);
    }
    lines.push(`    → ${responseDomainSummary(node.responseDomain)}`);
    if (node.required) lines.push('    [Required]');
    if (node.visibleWhen) lines.push(`    [Show when: ${node.visibleWhen}]`);
    lines.push('');
  }

  lines.push(`── End of questionnaire — ${questions.length} questions ──`);
  return lines.join('\n');
}

export function EasyModeView() {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);
  const languages = instrument.languages;
  const selectedId = useDesigner((s) => s.selectedId);
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.update);

  const questions = flattenQuestions(instrument.sequence, language);

  const downloadText = () => {
    const text = exportText(instrument, language);
    const slug = (pick(instrument.metadata.title as Record<string, string>, language) ?? 'survey')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const editText = (nodeId: string, newText: Record<string, string>) =>
    update((d) => {
      const n = findNode(d.sequence, nodeId) as (ControlConstruct & { type: 'question' }) | null;
      if (n && n.type === 'question') n.text = newText;
    });

  return (
    <div className="easymode">
      <div className="easymode__header">
        <div>
          <h2 className="easymode__title">
            {pick(instrument.metadata.title as Record<string, string>, language) ?? 'Survey'}
          </h2>
          <p className="easymode__sub">
            Easy Mode — {questions.length} questions. Switch to <strong>Pro</strong> for routing, expressions, and variables.
          </p>
        </div>
        <button type="button" className="easymode__export-btn" onClick={downloadText}>
          ⬇ Export text (.txt)
        </button>
      </div>

      {questions.length === 0 && (
        <p className="easymode__empty">
          No questions yet. Use the <strong>Pro</strong> mode Structure tree to add questions, then come back here to edit their text quickly.
        </p>
      )}

      <div className="easymode__list">
        {questions.map(({ node, num, pageLabel }) => {
          const isSelected = selectedId === node.id;
          return (
            <div
              key={node.id}
              className={isSelected ? 'easymode__card easymode__card--selected' : 'easymode__card'}
              onClick={() => select(node.id)}
            >
              <div className="easymode__card-head">
                <span className="easymode__num">Q{num}</span>
                {pageLabel && <span className="easymode__page">{pageLabel}</span>}
                <span className="easymode__domain">{responseDomainSummary(node.responseDomain)}</span>
                {node.required && <span className="easymode__req">Required</span>}
              </div>
              {isSelected ? (
                <div className="easymode__edit" onClick={(e) => e.stopPropagation()}>
                  <IntlStringField
                    label="Question text"
                    value={node.text}
                    languages={languages}
                    multiline
                    onChange={(v) => editText(node.id, v)}
                  />
                </div>
              ) : (
                <p className="easymode__qtext">
                  {pick(node.text, language) || <em style={{ color: 'var(--ink-soft)' }}>(click to edit)</em>}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
