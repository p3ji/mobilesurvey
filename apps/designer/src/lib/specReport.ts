/**
 * Generates a print-ready HTML specification of the instrument and opens it in a new window for
 * printing / "Save as PDF". This is a human-readable spec (questions, response options, edits,
 * routing, variables, code lists) — distinct from the raw JSON export.
 */
import type {
  ControlConstruct,
  Instrument,
  LanguageCode,
  ResponseDomain,
} from '@mobilesurvey/instrument-schema';
import { pick } from '@mobilesurvey/runtime-engine';

const escapeHtml = (s: string): string =>
  (s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

function domainText(d: ResponseDomain): string {
  switch (d.type) {
    case 'numeric': {
      const parts = [
        d.min !== undefined ? `min ${d.min}` : null,
        d.max !== undefined ? `max ${d.max}` : null,
        d.decimals !== undefined ? `${d.decimals} dp` : null,
      ].filter(Boolean);
      return `Numeric${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'text':
      return `Text${d.multiline ? ' (multiline)' : ''}${d.maxLength ? `, max ${d.maxLength}` : ''}`;
    case 'boolean':
      return 'Yes / No';
    case 'datetime':
      return `Date/time (${d.mode})`;
    case 'file':
      return 'File upload';
    case 'code':
      return `Choice (${d.selection}) from ${d.categorySchemeRef}`;
    case 'lookup':
      return `Lookup (search) from ${d.categorySchemeRef}`;
    case 'markAll':
      return `Mark all that apply → variables ${d.variablePrefix}_*`;
    case 'grid':
      return `Grid (rows: ${d.rowSchemeRef}, cols: ${d.colSchemeRef}) → variables ${d.variablePrefix}_*`;
  }
}

function constructHtml(
  c: ControlConstruct,
  instrument: Instrument,
  lang: LanguageCode,
  depth: number,
  numberRef: { n: number },
): string {
  const indent = `style="margin-left:${depth * 16}px"`;
  const cond = (label: string, expr?: string) =>
    expr && expr.trim() ? `<div class="meta" ${indent}><em>${label}:</em> <code>${escapeHtml(expr)}</code></div>` : '';

  switch (c.type) {
    case 'sequence': {
      const heading = pick(c.label, lang) || (c.isPage ? 'Page' : 'Section');
      const tag = c.isPage ? 'PAGE' : 'SECTION';
      return `
        <div class="block" ${indent}>
          <h3 class="${c.isPage ? 'page' : 'section'}">${tag}: ${escapeHtml(heading)}</h3>
          ${cond('Visible when', c.visibleWhen)}
        </div>
        ${c.children.map((ch) => constructHtml(ch, instrument, lang, depth + 1, numberRef)).join('')}
      `;
    }
    case 'statement':
      return `<div class="block statement" ${indent}><em>Statement:</em> ${escapeHtml(pick(c.text, lang))}${cond('Visible when', c.visibleWhen)}</div>`;
    case 'computation':
      return `<div class="block compute" ${indent}><em>Compute:</em> <code>${escapeHtml(c.targetVariableRef)} = ${escapeHtml(c.expression)}</code></div>`;
    case 'ifThenElse':
      return `
        <div class="block branch" ${indent}>
          <em>Branch — if</em> <code>${escapeHtml(c.condition)}</code>
        </div>
        <div ${indent}><strong class="lbl">then →</strong></div>
        ${c.then.map((ch) => constructHtml(ch, instrument, lang, depth + 1, numberRef)).join('')}
        ${
          c.else && c.else.length
            ? `<div ${indent}><strong class="lbl">else →</strong></div>${c.else
                .map((ch) => constructHtml(ch, instrument, lang, depth + 1, numberRef))
                .join('')}`
            : ''
        }
      `;
    case 'loop':
      return `
        <div class="block loop" ${indent}>
          <h3 class="loop">ROSTER: ${escapeHtml(pick(c.label, lang) || 'Items')} ${
            c.countVariableRef ? `(repeat ×${escapeHtml(c.countVariableRef)})` : c.loopWhile ? '(while…)' : ''
          }</h3>
          ${cond('Visible when', c.visibleWhen)}
        </div>
        ${c.children.map((ch) => constructHtml(ch, instrument, lang, depth + 1, numberRef)).join('')}
      `;
    case 'question': {
      numberRef.n += 1;
      const num = numberRef.n;
      const editsHtml =
        c.edits && c.edits.length
          ? `<div class="meta" ${indent}><em>Edits:</em><ul class="edits">${c.edits
              .map(
                (e) =>
                  `<li><span class="sev sev-${e.type}">${e.type}</span> fires when <code>${escapeHtml(
                    e.when,
                  )}</code> — “${escapeHtml(pick(e.message, lang))}”</li>`,
              )
              .join('')}</ul></div>`
          : '';
      return `
        <div class="block question" ${indent}>
          <div class="q-head"><span class="q-num">Q${num}</span>
            <span class="q-var">${escapeHtml(c.variableRef || '—')}</span>
            ${c.required ? '<span class="req">required</span>' : ''}
          </div>
          <div class="q-text">${escapeHtml(pick(c.text, lang))}</div>
          ${c.instruction ? `<div class="meta" ${indent}><em>Instruction:</em> ${escapeHtml(pick(c.instruction, lang))}</div>` : ''}
          <div class="meta" ${indent}><em>Answer:</em> ${escapeHtml(domainText(c.responseDomain))}</div>
          ${cond('Visible when', c.visibleWhen)}
          ${editsHtml}
        </div>
      `;
    }
  }
}

function schemesHtml(instrument: Instrument, lang: LanguageCode): string {
  if (!instrument.categorySchemes.length) return '';
  return `
    <h2>Code lists</h2>
    ${instrument.categorySchemes
      .map(
        (s) => `
        <h3 class="scheme">${escapeHtml(s.id)} — ${escapeHtml(pick(s.label, lang))}</h3>
        <table class="codes"><thead><tr><th>Code</th><th>Label</th></tr></thead><tbody>
          ${s.categories
            .map((cat) => `<tr><td><code>${escapeHtml(cat.code)}</code></td><td>${escapeHtml(pick(cat.label, lang))}</td></tr>`)
            .join('')}
        </tbody></table>`,
      )
      .join('')}
  `;
}

function variablesHtml(instrument: Instrument, lang: LanguageCode): string {
  return `
    <h2>Variables (${instrument.variables.length})</h2>
    <table class="vars"><thead><tr><th>Name</th><th>Kind</th><th>Type</th><th>Label</th><th>Compute</th></tr></thead><tbody>
      ${instrument.variables
        .map(
          (v) =>
            `<tr><td><code>${escapeHtml(v.name)}</code></td><td>${v.kind}</td><td>${v.representation}</td><td>${escapeHtml(
              pick(v.label, lang),
            )}</td><td>${v.compute ? `<code>${escapeHtml(v.compute)}</code>` : ''}</td></tr>`,
        )
        .join('')}
    </tbody></table>`;
}

export function buildSpecReportHtml(instrument: Instrument, lang: LanguageCode): string {
  const numberRef = { n: 0 };
  const body = instrument.sequence.children
    .map((c) => constructHtml(c, instrument, lang, 0, numberRef))
    .join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8" />
  <title>${escapeHtml(pick(instrument.metadata.title, lang))} — Specification</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1b2733; margin: 32px; line-height: 1.45; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { font-size: 18px; border-bottom: 2px solid #1f5fae; padding-bottom: 4px; margin: 28px 0 12px; }
    h3 { font-size: 14px; margin: 14px 0 4px; }
    h3.page { color: #1f5fae; text-transform: uppercase; letter-spacing: .04em; }
    h3.section { color: #5b6b7b; text-transform: uppercase; font-size: 12px; }
    h3.loop { color: #7a3fae; }
    h3.scheme { color: #1f5fae; }
    .sub { color: #5b6b7b; margin: 0 0 4px; font-size: 13px; }
    .block { margin: 8px 0; }
    .question { border-left: 3px solid #1f5fae; padding: 4px 0 4px 10px; margin: 12px 0; page-break-inside: avoid; }
    .q-head { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
    .q-num { font-weight: bold; color: #1f5fae; }
    .q-var { font-family: ui-monospace, Consolas, monospace; color: #5b6b7b; }
    .req { color: #b3261e; font-size: 11px; text-transform: uppercase; }
    .q-text { font-weight: bold; margin: 2px 0; }
    .statement { background: #eef3f8; padding: 6px 10px; border-radius: 4px; }
    .branch { color: #8a5a00; }
    .compute { color: #7a3fae; }
    .lbl { color: #5b6b7b; }
    .meta { font-size: 12px; color: #33404d; margin: 2px 0; }
    code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; background: #f4f6f9; padding: 0 3px; border-radius: 3px; }
    ul.edits { margin: 2px 0 2px 4px; padding-left: 16px; }
    .sev { font-size: 10px; text-transform: uppercase; padding: 0 4px; border-radius: 3px; margin-right: 4px; }
    .sev-hard { background: #fdeceb; color: #b3261e; }
    .sev-soft { background: #fff6e0; color: #8a5a00; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0 16px; }
    th, td { border: 1px solid #d7dee6; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f6f9; }
    .foot { margin-top: 32px; color: #5b6b7b; font-size: 11px; border-top: 1px solid #d7dee6; padding-top: 8px; }
    @media print { body { margin: 12mm; } h2 { page-break-after: avoid; } }
  </style></head><body>
    <h1>${escapeHtml(pick(instrument.metadata.title, lang))}</h1>
    <p class="sub">${escapeHtml(instrument.metadata.agency ?? '')} · version ${escapeHtml(
      instrument.version,
    )} · ${escapeHtml(instrument.ddiProfile)}</p>
    <p class="sub">Languages: ${instrument.languages.join(', ')} · Generated ${new Date().toLocaleString()}</p>
    ${instrument.metadata.description ? `<p>${escapeHtml(pick(instrument.metadata.description, lang))}</p>` : ''}

    <h2>Questionnaire</h2>
    ${body}
    ${variablesHtml(instrument, lang)}
    ${schemesHtml(instrument, lang)}
    <div class="foot">mobilesurvey specification export · ${escapeHtml(instrument.id)}</div>
  </body></html>`;
}

/** Open the spec report in a new window and trigger the print dialog (Save as PDF). */
export function printSpec(instrument: Instrument, lang: LanguageCode): void {
  const html = buildSpecReportHtml(instrument, lang);
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to print the specification.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the new document a tick to lay out before printing.
  setTimeout(() => w.print(), 300);
}
