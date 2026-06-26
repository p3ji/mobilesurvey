/**
 * mobilesurvey hub — module selector home screen + Collector sub-view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blankInstrument, lfsInstrument, demoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import {
  buildCatalog,
  buildSearchIndex,
  search,
  type ComponentType,
  type SearchIndex,
  type SearchHit,
} from '@mobilesurvey/metadata-registry';
import {
  createSurvey,
  deleteSurvey,
  DESIGNER_URL,
  designerLink,
  fetchAllInstruments,
  fetchResponses,
  fetchSurveyParadata,
  listSurveys,
  pingApi,
  respondentLink,
  setSurveyConfig,
  upsertSurvey,
  type InstrumentSummary,
  type ResponseRow,
  type SurveyParadataRow,
  type SurveySummary,
} from './api.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

function countQuestions(instrument: Instrument): number {
  let n = 0;
  const visit = (node: { type?: string; children?: unknown[]; then?: unknown[]; else?: unknown[] }) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'question') n += 1;
    for (const arr of [node.children, node.then, node.else]) {
      if (Array.isArray(arr)) for (const c of arr) visit(c as never);
    }
  };
  visit(instrument.sequence as never);
  return n;
}

const DEMO_SURVEYS: SurveySummary[] = [
  {
    id: 'lfs',
    title: 'Household & Employment Survey',
    requiresAccessCode: true,
    status: 'published',
    questionCount: countQuestions(lfsInstrument),
    updatedAt: 0,
    responseCount: 0,
  },
  {
    id: 'demo',
    title: 'Feature Demo Survey',
    requiresAccessCode: false,
    status: 'published',
    questionCount: countQuestions(demoInstrument),
    updatedAt: 0,
    responseCount: 0,
  },
];

// ── Module definitions ────────────────────────────────────────────────────────

type HubView = 'home' | 'collector' | 'searcher';

interface ModuleDef {
  id: string;
  icon: string;
  name: string;
  tagline: string;
  description: string;
  status: 'live' | 'coming-soon';
  action?: () => void;
}

// ── Collection dashboard ──────────────────────────────────────────────────────

/** Group responses by day and return cumulative chart points. */
function buildChartPoints(rows: ResponseRow[]): { x: number; y: number; label: string }[] {
  if (rows.length === 0) return [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.submittedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  let cum = 0;
  return sorted.map(([day, count]) => {
    cum += count;
    return { x: new Date(day + 'T12:00:00').getTime(), y: cum, label: day };
  });
}

type FieldType = 'numeric' | 'boolean' | 'categorical';
interface FieldAnalysis {
  key: string; label: string; type: FieldType; values: unknown[];
  avg?: number; min?: number; max?: number; bins?: number[];
  pctTrue?: number;
  freqs?: [string, number][];
}

function slugToLabel(key: string): string {
  return key.replace(/@.*$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || key;
}

function detectFields(rows: ResponseRow[]): FieldAnalysis[] {
  if (rows.length === 0) return [];
  const raw = new Map<string, unknown[]>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row.answersJson ?? {})) {
      if (!raw.has(k)) raw.set(k, []);
      if (v !== null && v !== undefined && v !== '') raw.get(k)!.push(v);
    }
  }
  const scored: (FieldAnalysis & { score: number })[] = [];
  for (const [key, vals] of raw.entries()) {
    if (vals.length === 0) continue;
    const label = slugToLabel(key);
    const nums = vals.filter((v) => typeof v === 'number') as number[];
    const bools = vals.filter((v) => typeof v === 'boolean') as boolean[];
    const strs = vals.filter((v) => typeof v === 'string') as string[];
    if (nums.length / vals.length > 0.8) {
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      const min = Math.min(...nums), max = Math.max(...nums);
      const buckets = 10, binSize = (max - min) / buckets || 1;
      const bins = Array(buckets).fill(0);
      for (const n of nums) bins[Math.min(buckets - 1, Math.floor((n - min) / binSize))]++;
      scored.push({ key, label, type: 'numeric', values: vals, avg, min, max, bins, score: vals.length * 3 });
    } else if (bools.length / vals.length > 0.8) {
      const pctTrue = (bools.filter((v) => v).length / bools.length) * 100;
      scored.push({ key, label, type: 'boolean', values: vals, pctTrue, score: vals.length * 2 });
    } else if (strs.length > 0) {
      const dist = new Map<string, number>();
      for (const s of strs) dist.set(s, (dist.get(s) ?? 0) + 1);
      const d = dist.size;
      if (d > 1 && d <= 12) {
        const freqs = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        scored.push({ key, label, type: 'categorical', values: vals, freqs, score: vals.length + (10 - d) });
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

function ResponseChart({ rows }: { rows: ResponseRow[] }) {
  const pts = buildChartPoints(rows);
  if (pts.length === 0) return null;
  const W = 480, H = 110, PL = 28, PR = 8, PT = 8, PB = 22;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const xs = pts.map((p) => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs), rangeX = maxX - minX || 1;
  const maxY = Math.max(...pts.map((p) => p.y));
  const px = (x: number) => PL + ((x - minX) / rangeX) * plotW;
  const py = (y: number) => PT + plotH - (y / maxY) * plotH;
  const linePts = pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ');
  const area = pts.length > 1
    ? `M${px(minX)},${PT + plotH} ${pts.map((p) => `L${px(p.x)},${py(p.y)}`).join(' ')} L${px(maxX)},${PT + plotH}Z`
    : '';
  return (
    <div className="dash__chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="dash__svg" aria-hidden="true">
        <defs>
          <linearGradient id="dash-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PL} y1={py(maxY * f)} x2={W - PR} y2={py(maxY * f)}
            stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
        ))}
        {[0, Math.round(maxY / 2), maxY].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
          <text key={v} x={PL - 4} y={py(v) + 3} textAnchor="end" fontSize="9"
            fill="currentColor" fillOpacity="0.45">{v}</text>
        ))}
        {area && <path d={area} fill="url(#dash-area-grad)" />}
        {pts.length > 1 && (
          <polyline points={linePts} fill="none" stroke="var(--brand)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {pts.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3.5" fill="var(--brand)" />)}
        <text x={px(minX)} y={H - 4} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.45">
          {pts[0]?.label.slice(5)}
        </text>
        {maxX !== minX && (
          <text x={px(maxX)} y={H - 4} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.45">
            {pts[pts.length - 1]?.label.slice(5)}
          </text>
        )}
      </svg>
      <p className="dash__chart-caption">Cumulative submissions over time</p>
    </div>
  );
}

function FieldCard({ field }: { field: FieldAnalysis }) {
  const n = field.values.length;
  if (field.type === 'numeric') {
    const maxBin = Math.max(...(field.bins ?? [1]));
    return (
      <div className="dash__field">
        <span className="dash__field-name">{field.label}</span>
        <span className="dash__field-value">{field.avg!.toFixed(1)}</span>
        <span className="dash__field-sub">avg · {field.min}–{field.max} range · n={n}</span>
        <div className="dash__hist">
          {(field.bins ?? []).map((b, i) => (
            <div key={i} className={`dash__hist-bar${b === maxBin ? ' dash__hist-bar--peak' : ''}`}
              style={{ height: `${Math.max(3, (b / maxBin) * 36)}px` }} />
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'boolean') {
    const pct = Math.round(field.pctTrue!);
    return (
      <div className="dash__field">
        <span className="dash__field-name">{field.label}</span>
        <span className="dash__field-value">{pct}%</span>
        <span className="dash__field-sub">answered yes · n={n}</span>
        <div className="dash__bool-bar"><div className="dash__bool-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }
  const maxCount = Math.max(...(field.freqs ?? []).map(([, c]) => c), 1);
  return (
    <div className="dash__field">
      <span className="dash__field-name">{field.label}</span>
      <span className="dash__field-sub">n={n}</span>
      <div className="dash__bars">
        {(field.freqs ?? []).map(([lbl, count]) => (
          <div key={lbl} className="dash__bar-row">
            <span className="dash__bar-label" title={lbl}>{lbl}</span>
            <div className="dash__bar-track">
              <div className="dash__bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
            <span className="dash__bar-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Demo survey analyzer ──────────────────────────────────────────────────────

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', rarely: 'Rarely',
};
const TOPIC_LABELS: Record<string, string> = {
  design: 'Design tools', logic: 'Skip logic', i18n: 'Translations',
  analytics: 'Analytics', accessibility: 'Accessibility', offline: 'Offline support', export: 'Data export',
};
const FEATURE_LABELS: Record<string, string> = {
  preview: 'Live preview', flow: 'Flowchart', pdf: 'PDF export',
  reuse: 'Question reuse', resume: 'Resume later',
};
const PIE_COLORS = ['#1f5fae', '#4a90d9', '#7bbff0', '#b8daf7', '#daeef8'];

function PieChart({ title, data }: { title: string; data: [string, number][] }) {
  if (data.length === 0) return (
    <div className="dash__field"><span className="dash__field-name">{title}</span>
      <span className="dash__empty" style={{ marginTop: 8 }}>No responses yet.</span></div>
  );
  const total = data.reduce((s, [, n]) => s + n, 0);
  const CX = 60, CY = 62, R = 52;
  let cumAngle = -Math.PI / 2;
  const slices = data.map(([label, count], i) => {
    const angle = (count / total) * 2 * Math.PI;
    const sa = cumAngle; cumAngle += angle;
    const ea = cumAngle;
    const x1 = CX + R * Math.cos(sa), y1 = CY + R * Math.sin(sa);
    const x2 = CX + R * Math.cos(ea), y2 = CY + R * Math.sin(ea);
    const large = angle > Math.PI ? 1 : 0;
    const d = data.length === 1
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
    return { d, color: PIE_COLORS[i % PIE_COLORS.length], label, count };
  });
  return (
    <div className="dash__field">
      <span className="dash__field-name">{title}</span>
      <svg viewBox="0 0 220 130" className="dash__pie-svg">
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} stroke="white" strokeWidth="1.5" />
        ))}
        {slices.map((s, i) => (
          <g key={i} transform={`translate(132, ${12 + i * 22})`}>
            <rect width="10" height="10" rx="2" fill={s.color} />
            <text x="14" y="9" fontSize="10" fill="var(--ink)">
              {s.label}{' '}
              <tspan fill="var(--ink-soft)">({s.count})</tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function WordCloud({ title, data }: { title: string; data: [string, number][] }) {
  if (data.length === 0) return (
    <div className="dash__field"><span className="dash__field-name">{title}</span>
      <span className="dash__empty" style={{ marginTop: 8 }}>No responses yet.</span></div>
  );
  const maxN = Math.max(...data.map(([, n]) => n));
  return (
    <div className="dash__field">
      <span className="dash__field-name">{title}</span>
      <div className="dash__wordcloud">
        {data.map(([word, count]) => {
          const t = count / maxN;
          return (
            <span key={word} className="dash__wc-word" style={{
              fontSize: Math.round(12 + t * 14),
              fontWeight: t > 0.6 ? 700 : t > 0.3 ? 600 : 400,
              opacity: 0.4 + t * 0.6,
            }}>{word}</span>
          );
        })}
      </div>
    </div>
  );
}

function HBarChart({ title, data }: { title: string; data: [string, number][] }) {
  if (data.length === 0) return (
    <div className="dash__field"><span className="dash__field-name">{title}</span>
      <span className="dash__empty" style={{ marginTop: 8 }}>No responses yet.</span></div>
  );
  const maxN = Math.max(...data.map(([, n]) => n), 1);
  return (
    <div className="dash__field">
      <span className="dash__field-name">{title}</span>
      <div className="dash__hbars">
        {data.map(([label, count]) => (
          <div key={label} className="dash__hbar-row">
            <span className="dash__hbar-label" title={label}>{label}</span>
            <div className="dash__bar-track">
              <div className="dash__bar-fill" style={{ width: `${(count / maxN) * 100}%` }} />
            </div>
            <span className="dash__bar-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoAnalyzer({ rows }: { rows: ResponseRow[] }) {
  // Q3 — usage frequency
  const freqMap = new Map<string, number>();
  for (const r of rows) {
    const v = r.answersJson['freq@'];
    if (typeof v === 'string') freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
  }
  const freqData: [string, number][] = [...freqMap.entries()]
    .map(([c, n]): [string, number] => [FREQ_LABELS[c] ?? c, n])
    .sort((a, b) => b[1] - a[1]);

  // Q6 — topic of interest
  const topicMap = new Map<string, number>();
  for (const r of rows) {
    const v = r.answersJson['topic@'];
    if (typeof v === 'string') topicMap.set(v, (topicMap.get(v) ?? 0) + 1);
  }
  const topicData: [string, number][] = [...topicMap.entries()]
    .map(([c, n]): [string, number] => [TOPIC_LABELS[c] ?? c, n])
    .sort((a, b) => b[1] - a[1]);

  // Q7 — features tried (markAll → feat_<code>@ keys)
  const featureData: [string, number][] = (['preview', 'flow', 'pdf', 'reuse', 'resume'] as const)
    .map((code): [string, number] => {
      const count = rows.filter((r) => r.answersJson[`feat_${code}@`] === 1).length;
      return [FEATURE_LABELS[code] ?? code, count];
    })
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="dash__section">
      <h4 className="dash__section-title">Analyzer preview</h4>
      <div className="dash__fields dash__fields--wide">
        <PieChart title="Q3 — Usage frequency" data={freqData} />
        <WordCloud title="Q6 — Topic of interest" data={topicData} />
        <HBarChart title="Q7 — Features tried" data={featureData} />
      </div>
    </div>
  );
}

function SubmissionRow({ row, events }: { row: ResponseRow; events: SurveyParadataRow[] }) {
  const dur = row.durationMs != null ? `${Math.round(row.durationMs / 1000)}s` : '—';
  const ts = new Date(row.submittedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    <details className="dash__submission">
      <summary>
        <span className="dash__sub-id">{row.respondentId.slice(0, 14)}</span>
        <span className="dash__sub-ts">{ts}</span>
        <span className="dash__sub-dur">{dur}</span>
        <span className={`badge badge--${row.completed ? 'published' : 'draft'}`} style={{ marginLeft: 'auto' }}>
          {row.completed ? 'Complete' : 'Partial'}
        </span>
      </summary>
      <div className="dash__sub-events">
        {events.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 12, margin: '4px 0' }}>No paradata recorded.</p>
        ) : (
          <table className="dash__event-table">
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="dash__event-ts">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td className="dash__event-type">{e.type}</td>
                  <td className="dash__event-payload">
                    {e.payloadJson ? JSON.stringify(e.payloadJson) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function CollectionDashboard({ surveyId }: { surveyId: string }) {
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [paradata, setParadata] = useState<SurveyParadataRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchResponses(surveyId), fetchSurveyParadata(surveyId)])
      .then(([r, p]) => { setRows(r); setParadata(p); })
      .catch(() => { setRows([]); setParadata([]); })
      .finally(() => setLoading(false));
  }, [surveyId]);

  if (loading) return <p className="dash__empty">Loading…</p>;
  const r = rows ?? [], p = paradata ?? [];

  const total = r.length;
  const durations = r.filter((x) => x.durationMs != null).map((x) => x.durationMs!);
  const avgDurationSec = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : null;
  const completionPct = total > 0
    ? Math.round(r.filter((x) => x.completed).length / total * 100) : null;

  const analyzerFields = detectFields(r);

  const byRespondent = new Map<string, SurveyParadataRow[]>();
  for (const e of p) {
    if (!e.respondentId) continue;
    if (!byRespondent.has(e.respondentId)) byRespondent.set(e.respondentId, []);
    byRespondent.get(e.respondentId)!.push(e);
  }

  const exportCSV = () => {
    if (!p.length) return;
    const header = ['id', 'session_key', 'respondent_id', 'ts', 'type', 'payload_json'];
    const body = p.map((e) => [
      String(e.id), e.sessionKey ?? '', e.respondentId ?? '',
      e.ts, e.type, e.payloadJson ? JSON.stringify(e.payloadJson) : '',
    ]);
    const csv = [header, ...body]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `paradata-${surveyId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dash">
      <div className="dash__kpis">
        <div className="dash__kpi">
          <span className="dash__kpi-value">{total}</span>
          <span className="dash__kpi-label">Respondents</span>
        </div>
        <div className="dash__kpi">
          <span className="dash__kpi-value">{avgDurationSec != null ? `${avgDurationSec}s` : '—'}</span>
          <span className="dash__kpi-label">Avg duration</span>
        </div>
        <div className="dash__kpi">
          <span className="dash__kpi-value">{completionPct != null ? `${completionPct}%` : '—'}</span>
          <span className="dash__kpi-label">Completion rate</span>
        </div>
      </div>

      <ResponseChart rows={r} />

      {surveyId === 'demo' ? (
        <DemoAnalyzer rows={r} />
      ) : analyzerFields.length > 0 && (
        <div className="dash__section">
          <h4 className="dash__section-title">Analyzer preview</h4>
          <div className="dash__fields">
            {analyzerFields.map((f) => <FieldCard key={f.key} field={f} />)}
          </div>
        </div>
      )}

      <div className="dash__section">
        <div className="dash__section-head">
          <h4 className="dash__section-title">Recent submissions</h4>
          <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={exportCSV} disabled={p.length === 0}>
            ↓ Export paradata CSV
          </button>
        </div>
        {total === 0 ? (
          <p className="dash__empty">No submissions yet.</p>
        ) : (
          <div className="dash__submissions">
            {r.slice(0, 10).map((row) => (
              <SubmissionRow key={row.id} row={row} events={byRespondent.get(row.respondentId) ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Survey card ───────────────────────────────────────────────────────────────

function SurveyCard({
  survey,
  isLive,
  onChange,
  readOnly,
}: {
  survey: SurveySummary;
  isLive?: boolean;
  onChange: () => void;
  readOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showResponses, setShowResponses] = useState(false);
  const link = respondentLink(survey.id);

  const patch = async (config: Parameters<typeof setSurveyConfig>[1]) => {
    setBusy(true);
    try { await setSurveyConfig(survey.id, config); onChange(); }
    finally { setBusy(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const remove = async () => {
    if (!confirm(`Delete "${survey.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteSurvey(survey.id); onChange(); }
    finally { setBusy(false); }
  };

  return (
    <div className={`card${isLive ? ' card--live' : ''}${showResponses ? ' card--expanded' : ''}`}>
      <div className="card__head">
        <h3 className="card__title">{survey.title}</h3>
        <div className="card__badges">
          {isLive && <span className="badge badge--live">● Live</span>}
          <span className={`badge badge--${survey.status}`}>{survey.status}</span>
        </div>
      </div>

      <div className="card__meta">
        <span>{survey.questionCount} questions</span>
        <span>·</span>
        <span>{survey.requiresAccessCode ? '🔒 access code' : '🌐 open'}</span>
        <span>·</span>
        <span>{survey.responseCount} response{survey.responseCount === 1 ? '' : 's'}</span>
      </div>

      {!readOnly && (
        <div className="card__row">
          <label className="toggle">
            <input type="checkbox" checked={survey.requiresAccessCode} disabled={busy}
              onChange={(e) => patch({ requiresAccessCode: e.target.checked })} />
            Require access code
          </label>
          <label className="toggle">
            <input type="checkbox" checked={survey.status === 'published'} disabled={busy}
              onChange={(e) => patch({ status: e.target.checked ? 'published' : 'draft' })} />
            Published
          </label>
        </div>
      )}

      <div className="card__link">
        <span className="card__link-label">Respondent link</span>
        <code className="card__link-url">{link}</code>
        <div className="card__link-actions">
          <button type="button" onClick={copyLink}>{copied ? '✓ Copied' : '⎘ Copy'}</button>
          <a className="btn-link" href={link} target="_blank" rel="noopener noreferrer">Launch ↗</a>
        </div>
      </div>

      <div className="card__actions">
        <a className="btn btn--primary" href={designerLink(survey.id)} target="_blank" rel="noopener noreferrer">
          ✎ Edit in Designer
        </a>
        {!readOnly && (
          <>
            <button type="button"
              className={`btn ${showResponses ? 'btn--active' : ''}`}
              onClick={() => setShowResponses((v) => !v)}>
              {showResponses ? '▲ Hide responses' : `▼ Responses (${survey.responseCount})`}
            </button>
            <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          </>
        )}
      </div>

      {showResponses && !readOnly && (
        <div className="card__responses">
          <CollectionDashboard surveyId={survey.id} />
        </div>
      )}
    </div>
  );
}

// ── Collector view ────────────────────────────────────────────────────────────

function CollectorView({ onBack }: { onBack: () => void }) {
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSurveys(await listSurveys());
      setOnline(true);
      setDemoMode(false);
    } catch {
      setOnline(false);
      if (!isLocalhost()) { setSurveys(DEMO_SURVEYS); setDemoMode(true); }
      else { setSurveys([]); setDemoMode(false); }
    }
  }, []);

  useEffect(() => {
    pingApi().then((connected) => {
      setOnline(connected);
      if (connected) {
        // Seed bundled surveys so designer links and response storage work.
        upsertSurvey('demo', 'Feature Demo Survey', demoInstrument, {
          requiresAccessCode: false, status: 'published',
        }).catch(() => { /* best-effort */ });
        upsertSurvey('lfs', 'Household & Employment Survey', lfsInstrument, {
          requiresAccessCode: true, status: 'published',
        }).catch(() => { /* best-effort */ });
      }
    });
    refresh();
  }, [refresh]);

  const newSurvey = async () => {
    const title = prompt('Name your new survey', 'Untitled survey');
    if (!title) return;
    setCreating(true);
    try {
      const id = await createSurvey(title, blankInstrument(title));
      window.open(designerLink(id), '_blank', 'noopener');
      await refresh();
    } catch {
      alert('Could not create the survey — check your Supabase connection.');
    } finally { setCreating(false); }
  };

  // Separate live (published + no code) from designer demos
  const liveSurveys = (surveys ?? []).filter((s) => s.status === 'published' && !s.requiresAccessCode);
  const demoSurveys = (surveys ?? []).filter((s) => !(s.status === 'published' && !s.requiresAccessCode));

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onBack}>← Modular Survey Tools</button>
          <strong>Collector</strong>
          <span className="hub__sub">Manage surveys · monitor collection</span>
        </div>
        <div className="hub__header-right">
          {demoMode ? (
            <span className="hub__conn hub__conn--demo">● Demo mode</span>
          ) : (
            <span className={online === false ? 'hub__conn hub__conn--off' : 'hub__conn hub__conn--on'}>
              {online === false ? '● Offline' : '● Supabase connected'}
            </span>
          )}
          {!demoMode && (
            <button type="button" className="btn btn--primary" onClick={newSurvey} disabled={creating}>
              + New survey
            </button>
          )}
        </div>
      </header>

      <main className="hub__main">
        {online === false && !demoMode && (
          <div className="hub__alert">
            Supabase is not reachable. Check that <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set and the migration has been run.
          </div>
        )}
        {demoMode && (
          <div className="hub__notice">
            Demo mode — showing bundled example surveys. Set Supabase env vars and run the SQL migration to manage your own surveys.
          </div>
        )}

        {surveys === null ? (
          <p className="hub__loading">Loading…</p>
        ) : (
          <>
            {/* Live surveys */}
            <section className="hub__section">
              <h2 className="hub__section-title">
                ● Live surveys
                <span className="hub__section-sub">Open to respondents via the link below</span>
              </h2>
              {liveSurveys.length === 0 ? (
                <p className="hub__empty">No published open surveys yet. Publish a survey and set it to "open" to launch it.</p>
              ) : (
                <div className="hub__grid">
                  {liveSurveys.map((s) => (
                    <SurveyCard key={s.id} survey={s} isLive onChange={refresh} readOnly={demoMode} />
                  ))}
                </div>
              )}
            </section>

            {/* Designer demo surveys */}
            {demoSurveys.length > 0 && (
              <section className="hub__section">
                <h2 className="hub__section-title">
                  Designer demos
                  <span className="hub__section-sub">Draft or code-gated — use to explore the designer</span>
                </h2>
                <div className="hub__grid">
                  {demoSurveys.map((s) => (
                    <SurveyCard key={s.id} survey={s} onChange={refresh} readOnly={demoMode} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Searcher view ─────────────────────────────────────────────────────────────

const BUILTIN: InstrumentSummary[] = [
  { id: lfsInstrument.id, title: 'Household & Employment Survey', instrument: lfsInstrument },
  { id: demoInstrument.id, title: 'Feature Demo Survey', instrument: demoInstrument },
];

const TYPE_LABELS: Record<ComponentType | 'all', string> = {
  all: 'All',
  instrument: 'Instruments',
  question: 'Questions',
  variable: 'Variables',
  codeList: 'Code Lists',
  section: 'Sections',
  page: 'Pages',
};

const TYPE_ICON: Record<ComponentType, string> = {
  instrument: '📄',
  question: '❓',
  variable: '📐',
  codeList: '📋',
  section: '§',
  page: '📑',
};

function lbl(intl: Record<string, string> | undefined): string {
  if (!intl) return '';
  return intl.en ?? intl.fr ?? Object.values(intl)[0] ?? '';
}

function HitCard({ hit, surveyTitles }: { hit: SearchHit; surveyTitles: Record<string, string> }) {
  const { entry, matched } = hit;
  const label = lbl(entry.ddi.label as Record<string, string> | undefined) || entry.searchText.slice(0, 80);
  const source = entry.registry.provenance ? (surveyTitles[entry.registry.provenance] ?? entry.registry.provenance) : null;
  const surveyId = entry.registry.provenance;
  const codeList = entry.componentType === 'codeList'
    ? (entry.payload as { categories?: Array<{ code: string; label?: Record<string, string> }> }).categories?.slice(0, 5)
    : null;

  return (
    <div className="sr-hit">
      <div className="sr-hit__head">
        <span className={`sr-hit__type sr-hit__type--${entry.componentType}`}>
          {TYPE_ICON[entry.componentType]} {entry.componentType}
        </span>
        {source && <span className="sr-hit__source">{source}</span>}
        {entry.registry.usageCount > 0 && (
          <span className="sr-hit__usage">used {entry.registry.usageCount}×</span>
        )}
      </div>

      <p className="sr-hit__label">{label}</p>

      {codeList && codeList.length > 0 && (
        <div className="sr-hit__codes">
          {codeList.map((c) => (
            <span key={c.code} className="sr-hit__code">
              <strong>{c.code}</strong> {lbl(c.label)}
            </span>
          ))}
          {((entry.payload as { categories?: unknown[] }).categories?.length ?? 0) > 5 && (
            <span className="sr-hit__code sr-hit__code--more">
              +{((entry.payload as { categories?: unknown[] }).categories?.length ?? 0) - 5} more
            </span>
          )}
        </div>
      )}

      {matched.length > 0 && (
        <div className="sr-hit__matched">
          {matched.map((m) => <span key={m} className="sr-hit__term">{m}</span>)}
        </div>
      )}

      {surveyId && (
        <div className="sr-hit__actions">
          <a className="btn btn--sm" href={designerLink(surveyId)} target="_blank" rel="noopener noreferrer">
            Open in Designer ↗
          </a>
        </div>
      )}
    </div>
  );
}

function SearcherView({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ComponentType | 'all'>('all');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [surveyTitles, setSurveyTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [surveyCount, setSurveyCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      let remote: InstrumentSummary[] = [];
      try { remote = await fetchAllInstruments(); } catch { /* offline — use builtins only */ }

      const seen = new Set<string>();
      const all = [...remote, ...BUILTIN].filter((s) => {
        if (seen.has(s.instrument.id)) return false;
        seen.add(s.instrument.id);
        return true;
      });

      const titles: Record<string, string> = {};
      for (const s of all) titles[s.instrument.id] = s.title;
      setSurveyTitles(titles);
      setSurveyCount(all.length);
      setIndex(buildSearchIndex(buildCatalog(all.map((s) => s.instrument))));
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    })();
  }, []);

  const FILTER_TYPES: Array<ComponentType | 'all'> = ['all', 'question', 'variable', 'codeList', 'instrument'];

  const hits = useMemo(() => {
    if (!index) return [];
    if (query.trim()) {
      return search(index, query, {
        limit: 50,
        type: typeFilter === 'all' ? undefined : typeFilter,
      });
    }
    // Browse: return all entries of the selected type, capped at 100
    return index.entries
      .filter((e) => typeFilter === 'all' || e.componentType === typeFilter)
      .slice(0, 100)
      .map((e) => ({ entry: e, score: 0, matched: [] as string[] }));
  }, [index, query, typeFilter]);

  const typeCounts = useMemo(() => {
    if (!index) return {} as Record<string, number>;
    const counts: Record<string, number> = { all: index.entries.length };
    for (const e of index.entries) counts[e.componentType] = (counts[e.componentType] ?? 0) + 1;
    return counts;
  }, [index]);

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onBack}>← Modular Survey Tools</button>
          <strong>Searcher</strong>
          <span className="hub__sub">Discover · reuse · extend metadata</span>
        </div>
        <div className="hub__header-right">
          {!loading && (
            <span className="hub__conn hub__conn--on">
              ● {surveyCount} survey{surveyCount === 1 ? '' : 's'} indexed
            </span>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.open(`${DESIGNER_URL}/?mode=pro`, '_blank', 'noopener')}
          >
            + New survey
          </button>
        </div>
      </header>

      <main className="hub__main sr-main">
        {/* Search bar */}
        <div className="sr-search">
          <input
            ref={inputRef}
            className="sr-search__input"
            type="search"
            placeholder={'Search questions, variables, code lists… (e.g. “employment”, “age”, “income”)'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Type filter tabs */}
        <div className="sr-filters" role="group" aria-label="Filter by component type">
          {FILTER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`sr-filter ${typeFilter === t ? 'sr-filter--active' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABELS[t]}
              {typeCounts[t] != null && (
                <span className="sr-filter__count">{typeCounts[t]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Results */}
        {loading ? (
          <p className="hub__loading">Building search index…</p>
        ) : hits.length === 0 ? (
          <div className="sr-empty">
            <p>No results for <strong>"{query}"</strong>.</p>
            <p>Try a broader term, or <a href={`${DESIGNER_URL}/?mode=pro`} target="_blank" rel="noopener noreferrer">create a new survey</a> to add new metadata.</p>
          </div>
        ) : (
          <>
            <p className="sr-count">
              {query.trim()
                ? `${hits.length} result${hits.length === 1 ? '' : 's'} for "${query}"`
                : `Browsing ${hits.length} ${typeFilter === 'all' ? 'entries' : TYPE_LABELS[typeFilter].toLowerCase()}`}
            </p>
            <div className="sr-results">
              {hits.map((h) => (
                <HitCard key={h.entry.entryId} hit={h} surveyTitles={surveyTitles} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Demo survey picker ────────────────────────────────────────────────────────

const DEMO_OPTIONS = [
  { id: 'lfs',  label: 'Household & Employment Survey', live: false },
  { id: 'demo', label: 'Feature Demo Survey',            live: true  },
];

function DemoSurveyPicker() {
  const [selected, setSelected] = useState('demo');
  return (
    <div className="demo-picker">
      <div className="demo-picker__head">
        <h2 className="demo-picker__title">Try a demo survey</h2>
        <p className="demo-picker__sub">
          Load a bundled survey into the designer to explore its features.
          Only the <strong>Feature Demo Survey</strong> is connected to live data collection — responses are saved to the Collector dashboard.
          The Household &amp; Employment Survey is for designer exploration only.
        </p>
      </div>
      <div className="demo-picker__options">
        {DEMO_OPTIONS.map((s) => (
          <label
            key={s.id}
            className={`demo-picker__option${selected === s.id ? ' demo-picker__option--selected' : ''}`}
          >
            <input
              type="radio"
              name="demo-survey"
              value={s.id}
              checked={selected === s.id}
              onChange={() => setSelected(s.id)}
            />
            <span className="demo-picker__option-label">{s.label}</span>
            {s.live && <span className="badge badge--live">● Live</span>}
          </label>
        ))}
      </div>
      <div className="demo-picker__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => window.open(`${DESIGNER_URL}/?survey=${selected}&mode=pro`, '_blank', 'noopener')}
        >
          Open in Pro Mode
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => window.open(`${DESIGNER_URL}/?survey=${selected}&mode=easy`, '_blank', 'noopener')}
        >
          Open in Easy Mode
        </button>
      </div>
    </div>
  );
}

// ── Module tile ───────────────────────────────────────────────────────────────

function ModuleTile({ mod }: { mod: ModuleDef }) {
  return (
    <button
      type="button"
      className={`module-tile ${mod.status === 'coming-soon' ? 'module-tile--soon' : ''}`}
      onClick={mod.status === 'live' ? mod.action : undefined}
      disabled={mod.status === 'coming-soon'}
    >
      <span className="module-tile__icon" aria-hidden="true">{mod.icon}</span>
      <div className="module-tile__body">
        <div className="module-tile__head">
          <span className="module-tile__name">{mod.name}</span>
          {mod.status === 'coming-soon' && (
            <span className="module-tile__badge">Coming soon</span>
          )}
        </div>
        <p className="module-tile__tagline">{mod.tagline}</p>
        <p className="module-tile__desc">{mod.description}</p>
      </div>
    </button>
  );
}

// ── Home page ─────────────────────────────────────────────────────────────────

function HomePage({ onNavigate }: { onNavigate: (v: HubView) => void }) {
  const modules = useMemo((): ModuleDef[] => [
    {
      id: 'designer-pro',
      icon: '⚙',
      name: 'Designer — Pro',
      tagline: 'Full-featured instrument authoring',
      description: 'Opens a blank instrument. Use "Try a demo survey" above to load an example. Supports tree editing, conditional routing, variables, expressions, and flowchart view.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?mode=pro`, '_blank', 'noopener'),
    },
    {
      id: 'designer-easy',
      icon: '✏',
      name: 'Designer — Easy Mode',
      tagline: 'Simple question-by-question editor',
      description: 'Opens a blank instrument. Use "Try a demo survey" above to load an example. Focusing on questions, categories, and simple logic — best for quick questionnaire testing.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?mode=easy`, '_blank', 'noopener'),
    },
    {
      id: 'designer-business',
      icon: '🏢',
      name: 'Designer — Business Collection',
      tagline: 'Optimized for business data collection',
      description: 'A form-first designer tuned for collecting data from businesses — structured inputs, validation rules, and integration with business registers.',
      status: 'coming-soon',
    },
    {
      id: 'collector',
      icon: '📋',
      name: 'Collector',
      tagline: 'Manage surveys · monitor collection',
      description: 'Create and publish surveys, share respondent links, track collection status, and view the response dashboard for each active survey.',
      status: 'live',
      action: () => onNavigate('collector'),
    },
    {
      id: 'searcher',
      icon: '🔍',
      name: 'Searcher',
      tagline: 'Search and reuse survey metadata',
      description: 'Discover existing questions, variables, and code lists across all surveys. Add to the repo with new metadata sources.',
      status: 'live',
      action: () => onNavigate('searcher'),
    },
    {
      id: 'analyzer',
      icon: '📊',
      name: 'Analyzer',
      tagline: 'Descriptive stats · future: full analysis',
      description: 'Explore collected data with descriptive statistics, frequency tables, and charts. Advanced statistical analysis — cross-tabs, regression — coming in a future release.',
      status: 'coming-soon',
    },
  ], [onNavigate]);

  return (
    <div className="hub">
      <header className="hub__header hub__header--home">
        <div className="hub__brand">
          <strong className="hub__wordmark">Modular Survey Tools</strong>
          <span className="hub__sub">Open survey platform</span>
        </div>
      </header>

      <main className="hub__main hub__main--home">
        <div className="hub__intro">
          <h1>What would you like to do?</h1>
          <p>Select a module to get started. Modules marked "Coming soon" are on the roadmap.</p>
        </div>

        <DemoSurveyPicker />

        <div className="module-grid">
          {modules.map((m) => <ModuleTile key={m.id} mod={m} />)}
        </div>
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  const [view, setView] = useState<HubView>('home');
  if (view === 'collector') return <CollectorView onBack={() => setView('home')} />;
  if (view === 'searcher') return <SearcherView onBack={() => setView('home')} />;
  return <HomePage onNavigate={setView} />;
}
