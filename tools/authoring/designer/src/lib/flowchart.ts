/**
 * Builds a Mermaid `flowchart` definition from an instrument's control-construct tree, so the
 * designer can visualise the questionnaire's flow logic.
 *
 * It walks the tree as a control-flow graph: constructs flow to their successor; `visibleWhen`
 * becomes a shown/skipped decision; `ifThenElse` becomes a then/else decision; loops (rosters)
 * become a body with a repeat/done decision. Pages and statements get distinct shapes.
 */
import type { ControlConstruct, Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { pick } from '@mobilesurvey/runtime-engine';

/** Shorten + escape a label for a Mermaid quoted string. */
function esc(text: string, max = 44): string {
  let t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1) + '…';
  return t.replace(/"/g, "'");
}

/** Make an expression human-readable and Mermaid-safe (avoids raw < > which can confuse parsing). */
function readableCond(src: string): string {
  return esc(
    (src ?? '')
      .replace(/>=/g, '≥')
      .replace(/<=/g, '≤')
      .replace(/!=/g, '≠')
      .replace(/==/g, '=')
      .replace(/&&/g, ' and ')
      .replace(/\|\|/g, ' or ')
      .replace(/</g, ' lt ')
      .replace(/>/g, ' gt ')
      .replace(/\$/g, ''),
    50,
  );
}

export function buildFlowchart(instrument: Instrument, language: LanguageCode): string {
  const lines: string[] = ['flowchart TD'];
  const declared = new Set<string>();
  let counter = 0;
  const synth = (p: string) => `${p}${counter++}`;
  const idMap = new Map<string, string>();
  const sid = (raw: string) => {
    let id = idMap.get(raw);
    if (!id) {
      id = `n${counter++}_${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
      idMap.set(raw, id);
    }
    return id;
  };

  const node = (id: string, label: string, shape: string): string => {
    if (declared.has(id)) return id;
    declared.add(id);
    const t = esc(label);
    switch (shape) {
      case 'statement':
        lines.push(`${id}[/"${t}"/]`);
        break;
      case 'computation':
        lines.push(`${id}[["${t}"]]`);
        break;
      case 'decision':
        lines.push(`${id}{"${t}"}`);
        break;
      case 'loop':
        lines.push(`${id}(["${t}"])`);
        break;
      case 'page':
        lines.push(`${id}>"${t}"]`);
        break;
      case 'terminal':
        lines.push(`${id}(("${t}"))`);
        break;
      default:
        lines.push(`${id}["${t}"]`);
    }
    return id;
  };

  const link = (a: string, b: string, label?: string) => {
    if (!a || !b) return;
    lines.push(label ? `${a} -->|"${esc(label, 24)}"| ${b}` : `${a} --> ${b}`);
  };

  /** Emit a sequence so its last item flows to `exit`; returns the entry node id. */
  const emit = (list: ControlConstruct[], exit: string): string => {
    let next = exit;
    for (let i = list.length - 1; i >= 0; i--) {
      next = emitOne(list[i]!, next);
    }
    return next;
  };

  /** Wrap a node in a shown/skipped decision if it has a visibility condition. */
  const withVisibility = (
    visibleWhen: string | undefined,
    bodyEntry: string,
    next: string,
  ): string => {
    if (!visibleWhen || !visibleWhen.trim()) return bodyEntry;
    const d = node(synth('v'), `${readableCond(visibleWhen)} ?`, 'decision');
    link(d, bodyEntry, 'shown');
    link(d, next, 'skipped');
    return d;
  };

  const emitOne = (c: ControlConstruct, next: string): string => {
    switch (c.type) {
      case 'question': {
        const label = `${pick(c.text, language) || c.variableRef || 'Question'}${
          c.variableRef ? `  (${c.variableRef})` : ''
        }`;
        const qn = node(sid(c.id), label, 'question');
        link(qn, next);
        return withVisibility(c.visibleWhen, qn, next);
      }
      case 'statement': {
        const st = node(sid(c.id), pick(c.text, language) || 'Statement', 'statement');
        link(st, next);
        return withVisibility(c.visibleWhen, st, next);
      }
      case 'computation': {
        const cn = node(
          sid(c.id),
          `${c.targetVariableRef || '?'} = ${readableCond(c.expression)}`,
          'computation',
        );
        link(cn, next);
        return cn;
      }
      case 'sequence': {
        const childEntry = emit(c.children, next);
        if (c.isPage) {
          const pg = node(sid(c.id), `Page: ${pick(c.label, language) || 'Untitled'}`, 'page');
          link(pg, childEntry);
          return withVisibility(c.visibleWhen, pg, next);
        }
        // Plain section: inline its children; apply visibility to the whole group.
        return withVisibility(c.visibleWhen, childEntry, next);
      }
      case 'ifThenElse': {
        const d = node(synth('if'), `${readableCond(c.condition)} ?`, 'decision');
        const thenEntry = emit(c.then, next);
        const elseEntry = emit(c.else ?? [], next);
        link(d, thenEntry, 'then');
        link(d, elseEntry, 'else');
        return d;
      }
      case 'loop': {
        const count = c.countVariableRef
          ? `×${c.countVariableRef}`
          : c.loopWhile
            ? 'while…'
            : '×?';
        const ln = node(sid(c.id), `Roster: ${pick(c.label, language) || 'Items'}  ${count}`, 'loop');
        const back = node(synth('rep'), 'more items?', 'decision');
        const bodyEntry = emit(c.children, back);
        link(ln, bodyEntry);
        link(back, bodyEntry, 'next item');
        link(back, next, 'done');
        return withVisibility(c.visibleWhen, ln, next);
      }
    }
  };

  const start = node('flow_start', 'Start', 'terminal');
  const end = node('flow_end', 'End', 'terminal');
  const entry = emit(instrument.sequence.children, end);
  link(start, entry);

  // A little styling for shapes.
  lines.push('classDef terminal fill:#1f5fae,stroke:#163f73,color:#fff;');
  lines.push('classDef page fill:#e6f0fb,stroke:#1f5fae,color:#1b2733;');
  lines.push(`class flow_start,flow_end terminal;`);

  return lines.join('\n');
}
