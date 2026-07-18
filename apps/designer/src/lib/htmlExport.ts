/**
 * Generates a clean, printable standalone HTML questionnaire document.
 * Suitable for embedding between page banners (similar to StatCan instrument pages).
 * Includes question numbers, response options, instructions, and routing notes.
 */
import type { ControlConstruct, Instrument, ResponseDomain } from '@mobilesurvey/instrument-schema';
import { pick } from '@mobilesurvey/runtime-engine';

interface FlatQ {
  num: number;
  text: string;
  instruction?: string;
  domain: ResponseDomain;
  required: boolean;
  visibleWhen?: string;
}

type FlatItem =
  | { kind: 'pageHeading'; label: string }
  | { kind: 'sectionHeading'; label: string }
  | { kind: 'statement'; text: string }
  | { kind: 'question'; q: FlatQ };

function flatten(root: ControlConstruct, lang: string): FlatItem[] {
  const items: FlatItem[] = [];
  let num = 0;

  function walk(node: ControlConstruct) {
    switch (node.type) {
      case 'sequence': {
        const lbl = pick(node.label, lang);
        if (lbl) items.push({ kind: node.isPage ? 'pageHeading' : 'sectionHeading', label: lbl });
        node.children.forEach(walk);
        break;
      }
      case 'question':
        num++;
        items.push({
          kind: 'question',
          q: {
            num,
            text: pick(node.text, lang) || `Q${num}`,
            instruction: node.instruction ? (pick(node.instruction, lang) || undefined) : undefined,
            domain: node.responseDomain,
            required: node.required ?? false,
            visibleWhen: node.visibleWhen || undefined,
          },
        });
        break;
      case 'statement': {
        const t = pick(node.text, lang);
        if (t) items.push({ kind: 'statement', text: t });
        break;
      }
      case 'loop':
        node.children.forEach(walk);
        break;
      case 'ifThenElse':
        node.then.forEach(walk);
        (node.else ?? []).forEach(walk);
        break;
    }
  }

  walk(root);
  return items;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lbl(intl: Record<string, string>, lang: string): string {
  return intl[lang] ?? intl['en'] ?? Object.values(intl)[0] ?? '';
}

function domainHtml(domain: ResponseDomain, instrument: Instrument, lang: string): string {
  switch (domain.type) {
    case 'text':
      return `<div class="resp-open">${domain.multiline ? '▭ Paragraph text' : '▭ Short text'}</div>`;
    case 'numeric':
      return `<div class="resp-open">▭ Number${
        domain.min !== undefined || domain.max !== undefined
          ? ` (${domain.min ?? ''}–${domain.max ?? ''})`
          : ''
      }${domain.unit ? ' ' + esc(lbl(domain.unit as Record<string, string>, lang)) : ''}</div>`;
    case 'boolean':
      return `<ol class="resp-list"><li><span class="resp-code">1</span><span class="resp-marker">○</span> Yes</li><li><span class="resp-code">2</span><span class="resp-marker">○</span> No</li></ol>`;
    case 'datetime':
      return `<div class="resp-open">▭ ${
        domain.mode === 'date' ? 'Date (YYYY-MM-DD)' : domain.mode === 'time' ? 'Time (HH:MM)' : 'Date and time'
      }</div>`;
    case 'file':
      return `<div class="resp-open">▭ File upload${domain.accept ? ` (${domain.accept.map(esc).join(', ')})` : ''}</div>`;
    case 'code':
    case 'lookup':
    case 'markAll': {
      const scheme = instrument.categorySchemes.find((s) => s.id === domain.categorySchemeRef);
      const cats = scheme?.categories ?? [];
      const isMulti = (domain.type === 'code' && domain.selection === 'multiple') || domain.type === 'markAll';
      const marker = isMulti ? '☐' : '○';
      if (!cats.length) return `<div class="resp-open">(code list: ${esc(domain.categorySchemeRef)})</div>`;
      const items = cats
        .map(
          (c, i) =>
            `<li><span class="resp-code">${String(i + 1).padStart(2, '0')}</span><span class="resp-marker">${marker}</span> ${esc(lbl(c.label as Record<string, string>, lang))}</li>`,
        )
        .join('');
      return `<ol class="resp-list">${items}</ol>`;
    }
    case 'grid': {
      const rowScheme = instrument.categorySchemes.find((s) => s.id === domain.rowSchemeRef);
      const colScheme = instrument.categorySchemes.find((s) => s.id === domain.colSchemeRef);
      const rows = rowScheme?.categories ?? [];
      const cols = colScheme?.categories ?? [];
      if (!rows.length || !cols.length) return `<div class="resp-open">(grid: rows=${esc(domain.rowSchemeRef)}, cols=${esc(domain.colSchemeRef)})</div>`;
      const headerCells = cols.map((c) => `<th>${esc(lbl(c.label as Record<string, string>, lang))}</th>`).join('');
      const bodyRows = rows.map((r) => {
        const cells = cols.map(() => `<td style="text-align:center">○</td>`).join('');
        return `<tr><td><strong>${esc(lbl(r.label as Record<string, string>, lang))}</strong></td>${cells}</tr>`;
      }).join('');
      return `<table class="resp-grid"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
    case 'table': {
      const rowScheme = instrument.categorySchemes.find((s) => s.id === domain.rowSchemeRef);
      const colScheme = instrument.categorySchemes.find((s) => s.id === domain.colSchemeRef);
      const rows = rowScheme?.categories ?? [];
      const cols = colScheme?.categories ?? [];
      if (!rows.length || !cols.length) return `<div class="resp-open">(table: rows=${esc(domain.rowSchemeRef)}, cols=${esc(domain.colSchemeRef)})</div>`;
      const disabled = new Set(domain.disabledCells ?? []);
      const unitLine = domain.unit
        ? `<div class="resp-open" style="text-align:right;font-style:italic">${esc(lbl(domain.unit as Record<string, string>, lang))}</div>`
        : '';
      const headerCells = [
        ...cols.map((c) => `<th>${esc(lbl(c.label as Record<string, string>, lang))}</th>`),
        ...(domain.totalCol ? ['<th>Total</th>'] : []),
      ].join('');
      const bodyRows = rows.map((r) => {
        const cells = [
          ...cols.map((c) =>
            disabled.has(`${r.code}:${c.code}`)
              ? `<td style="background:#eee;text-align:center">—</td>`
              : `<td style="text-align:center">▭</td>`,
          ),
          ...(domain.totalCol ? [`<td style="text-align:center">Σ</td>`] : []),
        ].join('');
        return `<tr><td><strong>${esc(lbl(r.label as Record<string, string>, lang))}</strong></td>${cells}</tr>`;
      });
      if (domain.totalRow) {
        const totCells = [
          ...cols.map(() => `<td style="text-align:center">Σ</td>`),
          ...(domain.totalCol ? [`<td style="text-align:center">Σ</td>`] : []),
        ].join('');
        bodyRows.push(`<tr><td><strong>Total</strong></td>${totCells}</tr>`);
      }
      return `${unitLine}<table class="resp-grid"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`;
    }
    case 'geolocation': {
      // The paper artifact documents the sensor use (incl. consent text) for review boards.
      const decl = instrument.sensors?.sensors.find((s) => s.kind === 'geolocation');
      const purpose = decl ? esc(lbl(decl.purpose as Record<string, string>, lang)) : '';
      const retention = decl?.retention
        ? ` <em>Retention:</em> ${esc(lbl(decl.retention as Record<string, string>, lang))}`
        : '';
      return `<div class="resp-open">📍 [Location capture — respondent consent required]${
        purpose ? `<br><em>Consent text:</em> ${purpose}${retention}` : ''
      }<br><small>Precision: ${domain.precision ?? 3} decimals${
        domain.maxAccuracyM ? `, max ±${domain.maxAccuracyM} m` : ''
      }${domain.manualFallback !== false ? '; typed fallback offered on decline' : ''}</small></div>`;
    }
    case 'photo': {
      const decl = instrument.sensors?.sensors.find((s) => s.kind === 'camera');
      const purpose = decl ? esc(lbl(decl.purpose as Record<string, string>, lang)) : '';
      const retention = decl?.retention
        ? ` <em>Retention:</em> ${esc(lbl(decl.retention as Record<string, string>, lang))}`
        : '';
      return `<div class="resp-open">📷 [Photo capture — respondent consent required]${
        purpose ? `<br><em>Consent text:</em> ${purpose}${retention}` : ''
      }<br><small>Photos are downscaled (max edge ${domain.maxEdgePx ?? 1600}px) and EXIF-stripped before upload${
        domain.allowLibrary ? '; device-library picks allowed' : ''
      }.${
        domain.recognition
          ? ` ML-assisted coding (${esc(domain.recognition.profile)}): suggested items are always confirmed/corrected by the respondent before storage.`
          : ''
      }</small></div>`;
    }
  }
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13.5px; color: #1a1a1a; background: #fff; line-height: 1.5; }
  .container { max-width: 820px; margin: 0 auto; padding: 36px 48px; }
  .survey-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .survey-meta { font-size: 12px; color: #666; padding-bottom: 14px; margin-bottom: 28px; border-bottom: 2px solid #b00; }
  .page-heading { font-size: 16px; font-weight: 700; margin: 36px 0 16px; padding: 8px 14px; background: #f2f2f2; border-left: 4px solid #b00; }
  .section-heading { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  .statement { margin: 0 0 20px 0; padding: 10px 14px; background: #fffbe6; border-left: 3px solid #aaa; font-style: italic; color: #444; }
  .question { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #e4e4e4; }
  .q-head { display: flex; gap: 10px; align-items: baseline; margin-bottom: 5px; }
  .q-num { font-weight: 700; color: #b00; min-width: 2.8em; flex-shrink: 0; font-size: 14px; }
  .q-text { font-weight: 600; font-size: 14px; line-height: 1.4; }
  .req-badge { display: inline-block; font-size: 10.5px; font-weight: 700; background: #ffe0e0; color: #900; padding: 1px 7px; border-radius: 3px; vertical-align: middle; margin-left: 8px; letter-spacing: 0.02em; }
  .instruction { font-size: 12.5px; font-style: italic; color: #555; margin: 4px 0 8px 2.8em; }
  .resp-open { font-size: 13px; color: #555; margin: 8px 0 0 2.8em; }
  .resp-list { list-style: none; margin: 8px 0 0 2.8em; }
  .resp-list li { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .resp-code { min-width: 2.2em; text-align: right; font-size: 11.5px; font-weight: 600; color: #666; }
  .resp-marker { min-width: 1.2em; color: #444; }
  .routing { font-size: 12px; color: #777; margin: 6px 0 0 2.8em; font-style: italic; }
  .routing code { font-family: "Courier New", monospace; font-size: 11px; background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-style: normal; }
  @media print {
    .container { padding: 12px 18px; }
    .page-heading { break-before: page; }
    .question { break-inside: avoid; }
  }
`;

export function exportHtml(instrument: Instrument, lang: string): string {
  const title = pick(instrument.metadata.title as Record<string, string>, lang) ?? 'Survey';
  const agency = (instrument.metadata.agency as string | undefined) ?? '';
  const version = instrument.version ?? '';
  const items = flatten(instrument.sequence, lang);
  const totalQ = items.filter((i) => i.kind === 'question').length;

  const bodyParts = items.map((item) => {
    switch (item.kind) {
      case 'pageHeading':
        return `<h2 class="page-heading">${esc(item.label)}</h2>`;
      case 'sectionHeading':
        return `<h3 class="section-heading">${esc(item.label)}</h3>`;
      case 'statement':
        return `<div class="statement">${esc(item.text)}</div>`;
      case 'question': {
        const { q } = item;
        const reqHtml = q.required ? `<span class="req-badge">Required</span>` : '';
        const instrHtml = q.instruction ? `<p class="instruction">${esc(q.instruction)}</p>` : '';
        const routeHtml = q.visibleWhen
          ? `<p class="routing">▷ Show when: <code>${esc(q.visibleWhen)}</code></p>`
          : '';
        return `<div class="question" id="q${q.num}">
  <div class="q-head"><span class="q-num">Q${q.num}.</span><span class="q-text">${esc(q.text)}${reqHtml}</span></div>
  ${instrHtml}${domainHtml(q.domain, instrument, lang)}
  ${routeHtml}</div>`;
      }
    }
  });

  const metaParts = [agency, version ? `v${version}` : '', `${totalQ} questions`].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">
<h1 class="survey-title">${esc(title)}</h1>
<p class="survey-meta">${metaParts.map(esc).join(' · ')}</p>
${bodyParts.join('\n')}
</div>
</body>
</html>`;
}
