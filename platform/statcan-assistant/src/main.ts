import { StatCanAgentRunner, AgentEvent } from './agent/agent-runner.js';
import { buildVegaLiteSpec } from './charts/chart-spec.js';
import type { ObservationRow, ChartIntent, ProvenanceMetadata, StructuredResult } from './types.js';

declare const vegaEmbed: any;

let currentResult: StructuredResult | null = null;
let currentRows: ObservationRow[] = [];

const form = document.getElementById('chat-form') as HTMLFormElement;
const input = document.getElementById('user-input') as HTMLInputElement;
const messagesContainer = document.getElementById('messages-container') as HTMLDivElement;
const warningBanner = document.getElementById('warning-banner') as HTMLDivElement;
const provenanceCard = document.getElementById('provenance-card') as HTMLDivElement;
const provenanceContent = document.getElementById('provenance-content') as HTMLDivElement;
const chartCard = document.getElementById('chart-card') as HTMLDivElement;
const chartTitle = document.getElementById('chart-title') as HTMLDivElement;
const tableCard = document.getElementById('table-card') as HTMLDivElement;
const tableTitle = document.getElementById('table-title') as HTMLDivElement;
const tableHead = document.getElementById('table-head') as HTMLTableSectionElement;
const tableBody = document.getElementById('table-body') as HTMLTableSectionElement;
const downloadBtn = document.getElementById('download-csv-btn') as HTMLButtonElement;

function appendMessage(text: string, role: 'user' | 'assistant'): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = text;
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return div;
}

function renderProvenance(provenance: ProvenanceMetadata) {
  provenanceContent.innerHTML = `
    <div class="prov-row">
      <span class="prov-label">Official Table:</span>
      <span class="prov-val"><a href="${provenance.tableUrl}" target="_blank" style="color: var(--primary); text-decoration: none; font-weight: 700;">PID ${provenance.productId} (StatCan Browser)</a></span>
    </div>
    <div class="prov-row">
      <span class="prov-label">WDS Coordinate:</span>
      <span class="prov-val">${provenance.coordinate}</span>
    </div>
    <div class="prov-row">
      <span class="prov-label">Vector Series ID(s):</span>
      <span class="prov-val">${provenance.vectorIds.length > 0 ? provenance.vectorIds.map(v => `v${v}`).join(', ') : 'Derived coordinate slice'}</span>
    </div>
    <div class="prov-row">
      <span class="prov-label">Frequency & Adjustment:</span>
      <span class="prov-val">${provenance.frequency || 'Unspecified'} &bull; ${provenance.seasonalStatus || 'Standard'}</span>
    </div>
    <div class="prov-row">
      <span class="prov-label">Extracted Timestamp:</span>
      <span class="prov-val">${provenance.extractedAt.replace('T', ' ').slice(0, 19)} UTC</span>
    </div>
  `;
  provenanceCard.style.display = 'block';
}

function renderTable(rows: ObservationRow[], title: string) {
  if (!rows || rows.length === 0) return;
  tableTitle.textContent = title;
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const displayCols = ['period', 'value', 'status', 'scaleFactorDesc'];
  const dimKeys = Object.keys(rows[0] || {}).filter(
    (k) => !displayCols.includes(k) && !['rawValue', 'isSuppressed', 'isHighVariability', 'vectorId', 'coordinate', 'decimals', 'qualityDesc'].includes(k)
  );

  const columns = [...dimKeys, 'period', 'value', 'status'];

  const trHead = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col === 'status' ? 'QUALITY' : col.replace(/_/g, ' ').toUpperCase();
    trHead.appendChild(th);
  }
  tableHead.appendChild(trHead);

  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      if (col === 'value') {
        if (row.isSuppressed) {
          td.innerHTML = `<span style="color: var(--muted); font-style: italic;">[Suppressed ${row.status}]</span>`;
        } else {
          td.textContent = row.value != null ? row.value.toLocaleString('en-CA') : '—';
        }
      } else if (col === 'status') {
        const symbol = row.status || '';
        if (symbol) {
          td.innerHTML = `<span class="badge-symbol badge-symbol-${symbol}" title="${row.qualityDesc || ''}">${symbol}</span>`;
        } else {
          td.innerHTML = `<span style="color: var(--muted); font-size: 0.75rem;">—</span>`;
        }
      } else {
        td.textContent = row[col] != null ? String(row[col]) : '—';
      }
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  tableCard.style.display = 'block';
}

function renderChart(rows: ObservationRow[], chart: ChartIntent, title: string) {
  chartTitle.textContent = chart.title || title;
  chartCard.style.display = 'block';
  const validChartRows = rows.filter((r) => !r.isSuppressed && r.value != null);
  const spec = buildVegaLiteSpec(validChartRows, chart, title);
  if (typeof vegaEmbed !== 'undefined') {
    vegaEmbed('#chart-view', spec, { actions: false });
  }
}

downloadBtn.addEventListener('click', () => {
  if (currentRows.length === 0) return;
  const columns = Object.keys(currentRows[0] || {});
  const csvLines = [
    columns.join(','),
    ...currentRows.map((row) =>
      columns.map((c) => JSON.stringify(row[c] ?? '')).join(',')
    ),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `statcan_data_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  appendMessage(query, 'user');
  input.value = '';

  warningBanner.style.display = 'none';
  const statusMsg = appendMessage('Connecting to Statistics Canada WDS engine...', 'assistant');

  const runner = new StatCanAgentRunner({
    onEvent: (event: AgentEvent) => {
      if (event.type === 'tool_call' && event.call) {
        if (event.phase === 'started') {
          statusMsg.innerHTML = `<em>Running: <code>${event.call.name}</code>...</em>`;
        } else if (event.phase === 'completed') {
          statusMsg.innerHTML = `<em>Completed: <code>${event.call.name}</code> (${event.call.durationMs}ms)</em>`;
        }
      }
    },
  });

  try {
    const outcome = await runner.run(query, { lastResult: currentResult });

    statusMsg.innerHTML = outcome.answer.replace(/\n/g, '<br/>');

    if (outcome.result) {
      currentResult = outcome.result;
      currentRows = outcome.result.rows;

      if (outcome.result.warnings && outcome.result.warnings.length > 0) {
        warningBanner.innerHTML = `<strong>Gate 0 Verification:</strong><br/>• ${outcome.result.warnings.join('<br/>• ')}`;
        warningBanner.style.display = 'block';
      }

      renderProvenance(outcome.result.provenance);

      if (outcome.result.chart) {
        renderChart(currentRows, outcome.result.chart, outcome.result.dataset.title);
      }
      renderTable(currentRows, outcome.result.dataset.title);
    }
  } catch (err: any) {
    statusMsg.innerHTML = `<span style="color: #c0262d;">Error: ${err.message}</span>`;
  }
});
