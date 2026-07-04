/**
 * mobilesurvey hub — module selector home screen + Collector sub-view.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  FileInput,
  FlaskConical,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  Layers,
  Library,
  PenLine,
} from 'lucide-react';
import logo from './assets/logo.png';
import { blankInstrument, lfsInstrument, demoInstrument, BUNDLED_SURVEYS, redactResponses, piiVariableNames, type Instrument } from '@mobilesurvey/instrument-schema';
import { migrate, type MigrateResult } from '@mobilesurvey/questionnaire-migrator';
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
  RUNTIME_URL,
  designerLink,
  fetchAllInstruments,
  fetchCases,
  fetchInterviewers,
  fetchResponses,
  fetchSurveyInstrument,
  fetchSurveyParadata,
  listSurveys,
  pingApi,
  recordCaseOutcome,
  respondentLink,
  assignCaseToInterviewer,
  setSurveyConfig,
  upsertSurvey,
  type CaseDetail,
  type CaseStatus,
  type InstrumentSummary,
  type InterviewerRow,
  type ResponseRow,
  type SurveyParadataRow,
  type SurveySummary,
} from './api.js';
import { logAudit } from './audit.js';

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

type HubView = 'home' | 'collector' | 'searcher' | 'trainer' | 'migrator' | 'analyzer' | 'interviewer' | 'supervisor';

interface ModuleDef {
  id: string;
  icon: ReactNode;
  name: string;
  tagline: string;
  description: string;
  status: 'live' | 'coming-soon';
  tag?: string;
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

// ── Question completion funnel ────────────────────────────────────────────────

interface FunnelItem { id: string; varName: string; label: string; num: number; }

function flattenQuestionsForFunnel(instrument: Instrument): FunnelItem[] {
  const vars = new Map(instrument.variables.map((v) => [v.name, v]));
  const results: FunnelItem[] = [];
  let n = 0;
  function walk(node: { type?: string; id?: string; variableRef?: string; children?: unknown[]; then?: unknown[]; else?: unknown[]; body?: unknown[] }) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'question') {
      const variable = node.variableRef ? vars.get(node.variableRef) : undefined;
      if (variable) {
        n++;
        const lbl = variable.label as Record<string, string> | undefined;
        results.push({ id: node.id ?? '', varName: variable.name, num: n,
          label: lbl ? (lbl.en ?? lbl.fr ?? Object.values(lbl)[0] ?? variable.name) : variable.name });
      }
    }
    for (const arr of [node.children, node.then, node.else, node.body]) {
      if (Array.isArray(arr)) for (const c of arr) walk(c as never);
    }
  }
  walk(instrument.sequence as never);
  return results;
}

function CompletionFunnel({ instrument, rows }: { instrument: Instrument; rows: ResponseRow[] }) {
  const items = flattenQuestionsForFunnel(instrument);
  if (items.length === 0 || rows.length === 0) return null;
  const total = rows.length;
  return (
    <div className="dash__section">
      <h4 className="dash__section-title">Question completion</h4>
      <div className="dash__funnel">
        {items.map((item) => {
          const key = item.varName + '@';
          const answered = rows.filter((r) => r.answersJson[key] !== undefined && r.answersJson[key] !== null && r.answersJson[key] !== '').length;
          const pct = Math.round((answered / total) * 100);
          const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
          return (
            <div key={item.id} className="dash__funnel-row">
              <span className="dash__funnel-num">Q{item.num}</span>
              <span className="dash__funnel-label" title={item.label}>{item.label}</span>
              <div className="dash__funnel-track">
                <div className="dash__funnel-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="dash__funnel-pct" style={{ color }}>{pct}%</span>
            </div>
          );
        })}
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
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchResponses(surveyId), fetchSurveyParadata(surveyId), fetchSurveyInstrument(surveyId)])
      .then(([r, p, inst]) => { setRows(r); setParadata(p); setInstrument(inst); })
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

  const buildResponsesCsv = (rowsToExport: ResponseRow[]) => {
    const allKeys = new Set<string>();
    for (const row of rowsToExport) for (const k of Object.keys(row.answersJson)) allKeys.add(k);
    const answerCols = [...allKeys].sort();
    const header = ['respondent_id', 'submitted_at', 'duration_ms', 'completed', ...answerCols];
    const csvRows = rowsToExport.map((row) => [
      row.respondentId, row.submittedAt, row.durationMs ?? '', String(row.completed),
      ...answerCols.map((k) => row.answersJson[k] ?? ''),
    ]);
    return [header, ...csvRows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  };

  const exportResponsesCsv = () => {
    if (!r.length) return;
    const csv = buildResponsesCsv(r);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `responses-${surveyId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit('responses.export', 'responses', surveyId, { count: r.length });
  };

  const exportRedactedCsv = () => {
    if (!r.length || !instrument) return;
    const redacted = r.map((row) => ({
      ...row,
      answersJson: redactResponses(row.answersJson, instrument),
    }));
    const csv = buildResponsesCsv(redacted);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `responses-${surveyId}-redacted-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit('responses.export_redacted', 'responses', surveyId, {
      count: r.length,
      piiFields: [...piiVariableNames(instrument)],
    });
  };

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

      {instrument && <CompletionFunnel instrument={instrument} rows={r} />}

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
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={exportResponsesCsv} disabled={r.length === 0}>
              ↓ Responses CSV
            </button>
            <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
              title="Replace PII-tagged variable values with [REDACTED]"
              onClick={exportRedactedCsv} disabled={r.length === 0 || !instrument}>
              ↓ Redacted CSV
            </button>
            <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={exportCSV} disabled={p.length === 0}>
              ↓ Paradata CSV
            </button>
          </div>
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
    try {
      await setSurveyConfig(survey.id, config);
      if (config.status === 'published') logAudit('survey.publish', 'survey', survey.id);
      else if (config.status === 'draft') logAudit('survey.unpublish', 'survey', survey.id);
      onChange();
    } finally { setBusy(false); }
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
    try {
      await deleteSurvey(survey.id);
      logAudit('survey.delete', 'survey', survey.id, { title: survey.title });
      onChange();
    } finally { setBusy(false); }
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
        // Seed only data-collecting bundled surveys; exploration-only demos never touch Supabase.
        for (const s of BUNDLED_SURVEYS.filter((b) => b.collectsData)) {
          upsertSurvey(s.id, s.title, s.instrument, {
            requiresAccessCode: s.requiresAccessCode, status: 'published',
          }).catch(() => { /* best-effort */ });
        }
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
      logAudit('survey.create', 'survey', id, { title });
      window.open(designerLink(id), '_blank', 'noopener');
      await refresh();
    } catch {
      alert('Could not create the survey — check your Supabase connection.');
    } finally { setCreating(false); }
  };

  // Exploration-only bundled surveys are never in Supabase — surface them as read-only demo cards.
  const explorationDemos: SurveySummary[] = BUNDLED_SURVEYS
    .filter((b) => !b.collectsData)
    .map((b) => ({
      id: b.id,
      title: b.title,
      requiresAccessCode: b.requiresAccessCode,
      status: 'published' as const,
      questionCount: countQuestions(b.instrument),
      updatedAt: 0,
      responseCount: 0,
    }));
  const explorationIds = new Set(explorationDemos.map((s) => s.id));
  // Drop any stale exploration-only rows from the backend list; render the bundled cards instead.
  const backendSurveys = (surveys ?? []).filter((s) => !explorationIds.has(s.id));
  // Separate live (published + no code) from designer demos.
  const liveSurveys = backendSurveys.filter((s) => s.status === 'published' && !s.requiresAccessCode);
  const demoSurveys = [
    ...backendSurveys.filter((s) => !(s.status === 'published' && !s.requiresAccessCode)),
    ...explorationDemos,
  ];

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onBack}>
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Collector</strong>
          <span className="hub__sub">Manage surveys and track collection</span>
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
                    <SurveyCard key={s.id} survey={s} onChange={refresh} readOnly={demoMode || explorationIds.has(s.id)} />
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
          <button type="button" className="hub__back" onClick={onBack}>
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Searcher</strong>
          <span className="hub__sub">Find and reuse questions across surveys</span>
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
          {mod.tag && (
            <span className="module-tile__badge module-tile__badge--tag">{mod.tag}</span>
          )}
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

// ── Migrator view ─────────────────────────────────────────────────────────────

function MigratorView({ onBack }: { onBack: () => void }) {
  const [rawText, setRawText] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [agencyInput, setAgencyInput] = useState('');
  const [result, setResult] = useState<MigrateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') setRawText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleConvert() {
    if (!rawText.trim()) return;
    setBusy(true);
    setResult(null);
    setSaveState('idle');
    // Run in a timeout so the UI can render the busy state first
    setTimeout(() => {
      try {
        const r = migrate(rawText, {
          title: titleInput.trim() || undefined,
          agency: agencyInput.trim() || undefined,
        });
        setResult(r);
        if (!titleInput.trim() && r.instrument.metadata.title.en) {
          setTitleInput(r.instrument.metadata.title.en);
        }
      } catch (err) {
        alert(`Conversion error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    }, 0);
  }

  async function handleSave() {
    if (!result) return;
    setSaveState('saving');
    try {
      const finalTitle = titleInput.trim() || result.instrument.metadata.title.en || 'Migrated Survey';
      const updatedInstrument = {
        ...result.instrument,
        metadata: {
          ...result.instrument.metadata,
          title: { en: finalTitle },
        },
      };
      const id = await createSurvey(finalTitle, updatedInstrument);
      logAudit('survey.create', 'survey', id, { title: finalTitle, source: 'migrator' });
      setSaveState('done');
      window.open(designerLink(id), '_blank', 'noopener');
    } catch {
      setSaveState('error');
    }
  }

  function handleDownload() {
    if (!result) return;
    const finalTitle = titleInput.trim() || result.instrument.metadata.title.en || 'migrated';
    const slug = finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const blob = new Blob([JSON.stringify(result.instrument, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.instrument.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Gather question rows from all sections for the preview table
  const previewRows = useMemo(() => {
    if (!result) return [];
    const rows: { num: string; text: string; type: string; options: number; skipRules: number }[] = [];
    // Re-parse with the same text to get the raw IR for display
    // (result.sections gives us the summary — we reconstruct from the instrument variables)
    let qIdx = 0;
    for (const vars of (result?.instrument?.variables ?? [])) {
      qIdx++;
      rows.push({
        num: String(qIdx),
        text: vars.label.en ?? '',
        type: vars.representation === 'code'
          ? 'Single choice'
          : vars.representation === 'boolean'
            ? 'Yes / No'
            : vars.representation === 'numeric'
              ? 'Numeric'
              : vars.representation === 'datetime'
                ? 'Date'
                : 'Open text',
        options: 0,
        skipRules: 0,
      });
    }
    return rows;
  }, [result]);

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onBack}>
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Migrator</strong>
          <span className="hub__sub">Turn a text questionnaire into a live survey</span>
        </div>
      </header>

      <main className="hub__main migr__main">
        <div className="migr__intro">
          <p>
            Paste a plain-text questionnaire below (or upload a <code>.txt</code> file).
            The engine extracts questions, infers response types, and converts routing hints into
            skip logic — producing an instrument JSON you can open directly in the Designer.
          </p>
        </div>

        <div className="migr__body">
          {/* ── Left: input ─────────────────────────────────────────────── */}
          <div className="migr__panel migr__panel--input">
            <div className="migr__field-row">
              <label className="migr__label" htmlFor="migr-title">Survey title</label>
              <input
                id="migr-title"
                className="migr__text-input"
                type="text"
                placeholder="Auto-detected from text, or enter manually"
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
              />
            </div>
            <div className="migr__field-row">
              <label className="migr__label" htmlFor="migr-agency">Agency / organisation (optional)</label>
              <input
                id="migr-agency"
                className="migr__text-input"
                type="text"
                placeholder="e.g. Statistics Canada"
                value={agencyInput}
                onChange={e => setAgencyInput(e.target.value)}
              />
            </div>

            <div className="migr__field-row migr__field-row--grow">
              <div className="migr__label-row">
                <label className="migr__label" htmlFor="migr-text">Questionnaire text</label>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  onClick={() => fileRef.current?.click()}
                >
                  ⬆ Upload .txt
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.text,text/plain"
                  style={{ display: 'none' }}
                  onChange={handleFile}
                />
              </div>
              <textarea
                id="migr-text"
                className="migr__textarea"
                placeholder={`Paste your questionnaire here. For example:\n\nSECTION A: Demographic Information\n\n1. What is your age?\n   (Enter number)\n\n2. What is your sex?\n   1. Male\n   2. Female\n   3. Other / prefer not to say\n\n3. Are you currently employed?\n   [ ] Yes → Skip to Q5\n   [ ] No\n\n4. How many months have you been unemployed?\n   (Enter number, 0–120)\n\n5. What is your highest level of education?\n   1. No formal schooling\n   2. Primary school\n   3. Secondary school\n   4. Post-secondary`}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="migr__convert-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!rawText.trim() || busy}
                onClick={handleConvert}
              >
                {busy ? 'Converting…' : '⇄ Convert to survey'}
              </button>
              {rawText.trim() && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setRawText(''); setResult(null); setTitleInput(''); setSaveState('idle'); }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* ── Right: results ───────────────────────────────────────────── */}
          <div className="migr__panel migr__panel--results">
            {!result && !busy && (
              <div className="migr__empty">
                <span className="migr__empty-icon">⇄</span>
                <p>Converted survey will appear here.</p>
                <p className="migr__empty-hint">
                  Supported: numbered questions, option lists, section headers,<br />
                  Yes/No routing ("If Yes → Skip to Q5"), date / numeric hints.
                </p>
              </div>
            )}

            {busy && (
              <div className="migr__empty">
                <span className="migr__empty-icon">⇄</span>
                <p>Parsing…</p>
              </div>
            )}

            {result && !busy && (
              <>
                {/* Stats bar */}
                <div className="migr__stats">
                  <span className="migr__stat">
                    <strong>{result.questionCount}</strong> question{result.questionCount === 1 ? '' : 's'}
                  </span>
                  <span className="migr__stat-sep">·</span>
                  <span className="migr__stat">
                    <strong>{result.sectionCount}</strong> section{result.sectionCount === 1 ? '' : 's'}
                  </span>
                  {result.sections.filter(s => s.title).map((s, i) => (
                    <span key={i} className="migr__stat-section">{s.title}</span>
                  ))}
                </div>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="migr__warnings">
                    <strong className="migr__warn-title">Notices</strong>
                    <ul className="migr__warn-list">
                      {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {/* Preview table */}
                <div className="migr__preview">
                  <table className="migr__table">
                    <thead>
                      <tr>
                        <th className="migr__th migr__th--num">#</th>
                        <th className="migr__th">Question</th>
                        <th className="migr__th migr__th--type">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="migr__tr">
                          <td className="migr__td migr__td--num">{row.num}</td>
                          <td className="migr__td migr__td--text" title={row.text}>{row.text}</td>
                          <td className="migr__td migr__td--type">{row.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div className="migr__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleSave}
                    disabled={saveState === 'saving'}
                  >
                    {saveState === 'saving' ? 'Saving…'
                      : saveState === 'done' ? '✓ Saved — opening Designer'
                      : '↗ Save to Collector & open in Designer'}
                  </button>
                  <button type="button" className="btn" onClick={handleDownload}>
                    ↓ Download JSON
                  </button>
                  {saveState === 'error' && (
                    <span className="migr__save-error">Save failed — check Supabase connection.</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Format hints */}
        <details className="migr__hints">
          <summary>Supported input formats</summary>
          <div className="migr__hints-body">
            <div className="migr__hint-col">
              <strong>Questions</strong>
              <pre className="migr__hint-pre">{`1. Question text
Q1. Question text
1) Question text
1.1. Sub-question`}</pre>
            </div>
            <div className="migr__hint-col">
              <strong>Options</strong>
              <pre className="migr__hint-pre">{`1. Option text
a. Option text
[ ] Option text
□ Option text
○ Option text`}</pre>
            </div>
            <div className="migr__hint-col">
              <strong>Routing</strong>
              <pre className="migr__hint-pre">{`[ ] Yes → Skip to Q5
[ ] Yes (Go to Q5)
If Yes, go to Q7
If male, skip to Q10`}</pre>
            </div>
            <div className="migr__hint-col">
              <strong>Type hints</strong>
              <pre className="migr__hint-pre">{`(Enter number)
(Select all that apply)
(Enter date)
(Open text)
_____ years`}</pre>
            </div>
            <div className="migr__hint-col">
              <strong>Sections</strong>
              <pre className="migr__hint-pre">{`SECTION A: Demographics
Section 1: Background
PART I: Employment
--- Demographics ---`}</pre>
            </div>
          </div>
        </details>
      </main>
    </div>
  );
}

// ── Analyzer view ─────────────────────────────────────────────────────────────

function AnalyzerView({ onBack }: { onBack: () => void }) {
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listSurveys()
      .then((list) => {
        setSurveys(list);
        const first = list.find((s) => s.responseCount > 0) ?? list[0];
        if (first) setSelected(first.id);
      })
      .catch(() => setSurveys([]));
  }, []);

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <button type="button" className="hub__back" onClick={onBack}>
            <img src={logo} alt="Back to home" className="hub__back-logo" />
          </button>
          <strong>Analyzer</strong>
          <span className="hub__sub">Response quality and completion metrics</span>
        </div>
      </header>
      <main className="hub__main">
        {surveys === null ? (
          <p className="hub__loading">Loading surveys…</p>
        ) : surveys.length === 0 ? (
          <p className="hub__empty">No surveys found. Create and collect responses in the Collector first.</p>
        ) : (
          <>
            <div className="analyzer__tabs" role="tablist">
              {surveys.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={selected === s.id}
                  className={`analyzer__tab${selected === s.id ? ' analyzer__tab--active' : ''}`}
                  onClick={() => setSelected(s.id)}>
                  <span className="analyzer__tab-title">{s.title}</span>
                  <span className="analyzer__tab-count">{s.responseCount}</span>
                </button>
              ))}
            </div>
            {selected && <CollectionDashboard surveyId={selected} />}
          </>
        )}
      </main>
    </div>
  );
}

// ── Training hub ──────────────────────────────────────────────────────────────

interface TrainingResource {
  id: string;
  kind: 'video';
  title: string;
  description: string;
  duration: string;
  /** YouTube video id (for inline embed). */
  youtubeId?: string;
  /** Canonical watch URL (fallback link / "open on YouTube"). */
  url: string;
}

const TRAINING_RESOURCES: TrainingResource[] = [
  {
    id: 'intro-video',
    kind: 'video',
    title: 'Introduction to Modular Survey Tools',
    description:
      'A video overview of the platform — what each module does, how surveys are created and published, and how collection data flows into the analytics dashboard.',
    duration: '~10 min',
    youtubeId: 'xxosyO_ZHQc',
    url: 'https://youtu.be/xxosyO_ZHQc',
  },
];

function TrainingView({ onBack }: { onBack: () => void }) {
  return (
    <div className="hub">
      <header className="hub__header">
        <button type="button" className="hub__back" onClick={onBack}>
          ← Back
        </button>
        <div className="hub__brand">
          <img src={logo} alt="Modular Survey Tools" className="hub__logo" />
          <div className="hub__brand-text">
            <strong>Training Hub</strong>
            <span className="hub__sub">Videos, guides, and resources</span>
          </div>
        </div>
      </header>

      <main className="hub__main">
        <div className="train__grid">
          {TRAINING_RESOURCES.map((r) => (
            <div key={r.id} className="train__card">
              {r.youtubeId && (
                <div className="train__video">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${r.youtubeId}`}
                    title={r.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              )}
              <div className="train__card-body">
                <div className="train__card-meta">
                  <span className="train__badge train__badge--video">Video</span>
                  <span className="train__duration">{r.duration}</span>
                </div>
                <h2 className="train__card-title">{r.title}</h2>
                <p className="train__card-desc">{r.description}</p>
                <a
                  className="train__watch-link"
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Watch on YouTube ↗
                </a>
              </div>
            </div>
          ))}
        </div>

        <p className="train__coming-soon">
          Written guides, walkthroughs, and worked examples — coming soon.
        </p>
      </main>
    </div>
  );
}

// ── Home page ─────────────────────────────────────────────────────────────────

function HomePage({ onNavigate }: { onNavigate: (v: HubView) => void }) {
  const modules = useMemo((): ModuleDef[] => [
    {
      id: 'designer-pro',
      icon: <Layers size={22} />,
      name: 'Designer — Pro',
      tagline: 'Full-featured instrument authoring',
      description: 'Opens a blank instrument. Use "Try a demo survey" above to load an example. Tree editing, conditional routing, variables, expressions, and flowchart view.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?mode=pro`, '_blank', 'noopener'),
    },
    {
      id: 'designer-easy',
      icon: <PenLine size={22} />,
      name: 'Designer — Easy Mode',
      tagline: 'Build a questionnaire question by question',
      description: 'Opens a blank instrument. Use "Try a demo survey" above to load an example. Focused on questions, categories, and simple logic — good for quick questionnaire drafting.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?mode=easy`, '_blank', 'noopener'),
    },
    {
      id: 'collector',
      icon: <LayoutDashboard size={22} />,
      name: 'Collector',
      tagline: 'Manage live surveys and track who\'s responding',
      description: 'Create and publish surveys, share respondent links, track collection status, and view the response dashboard for each active survey.',
      status: 'live',
      action: () => onNavigate('collector'),
    },
    {
      id: 'searcher',
      icon: <Library size={22} />,
      name: 'Searcher',
      tagline: 'Find and reuse questions across every survey',
      description: 'Search questions, variables, and code lists from all surveys by keyword. One click to add a match to a new instrument.',
      status: 'live',
      action: () => onNavigate('searcher'),
    },
    {
      id: 'migrator',
      icon: <FileInput size={22} />,
      name: 'Migrator',
      tag: 'Testing',
      tagline: 'Turn a Word doc or text file into a live survey',
      description: 'Paste or upload any plain-text questionnaire. The engine extracts questions, infers response types, and converts routing hints into skip logic.',
      status: 'live',
      action: () => onNavigate('migrator'),
    },
    {
      id: 'trainer',
      icon: <GraduationCap size={22} />,
      name: 'Training Hub',
      tagline: 'Videos and guides to get you started fast',
      description: 'Video overviews, walkthroughs, and resources for learning Modular Survey Tools. Start with a 2-min intro, then explore from first survey to collection management.',
      status: 'live',
      action: () => onNavigate('trainer'),
    },
    {
      id: 'interviewer',
      icon: <Headphones size={22} />,
      name: 'Interviewer Mode',
      tagline: 'CATI case queue with call-back scheduling',
      description: 'View assigned cases, launch telephone interviews, and record call outcomes (complete, call-back, refused, non-contact). Schedules call-backs with date, time, and notes.',
      status: 'coming-soon',
    },
    {
      id: 'supervisor',
      icon: <Layers size={22} />,
      name: 'Supervisor Dashboard',
      tagline: 'Monitor interviewer progress and assign cases',
      description: 'See completion rates and outcome breakdowns by interviewer. Assign or reassign cases to balance workloads across your field team.',
      status: 'coming-soon',
    },
    {
      id: 'designer-business',
      icon: <Building2 size={22} />,
      name: 'Designer — Business Collection',
      tag: 'Testing',
      tagline: 'Structured forms for business data collection',
      description: "A form-first designer for establishment surveys — numeric data tables with live totals, paste-from-Excel entry, balance edits across sections, and a demo modeled on Statistics Canada's Federal Science Expenditures and Personnel (FSEP) questionnaire.",
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?survey=fsep&mode=pro`, '_blank', 'noopener'),
    },
    {
      id: 'analyzer',
      icon: <BarChart3 size={22} />,
      name: 'Analyzer',
      tag: 'Testing',
      tagline: 'Charts and tables for your collected data',
      description: 'Completion funnels, frequency distributions, and field-level charts built from live responses. Export responses or paradata as CSV.',
      status: 'live',
      action: () => onNavigate('analyzer'),
    },
    {
      id: 'tester',
      icon: <FlaskConical size={22} />,
      name: 'Questionnaire Tester',
      tagline: 'Catch routing errors before respondents do',
      description: 'Walks every path through a web survey automatically — catching dead ends, routing errors, and gaps between the designed instrument and the rendered form. Works on any survey platform.',
      status: 'coming-soon',
    },
  ], [onNavigate]);

  return (
    <div className="hub">
      <header className="hub__header hub__header--home">
        <div className="hub__brand">
          <img src={logo} alt="Modular Survey Tools" className="hub__logo" />
          <span className="hub__sub">Open-source survey platform</span>
        </div>
      </header>

      <main className="hub__main hub__main--home">
        <div className="hub__intro">
          <h1>Design, collect, and analyze surveys — end to end.</h1>
          <p>Pick a tool to get started, or try a demo survey below.</p>
        </div>

        <DemoSurveyPicker />

        <div className="module-grid">
          {modules.filter(m => m.status === 'live').map((m) => <ModuleTile key={m.id} mod={m} />)}
        </div>
        <p className="module-section-label">On the roadmap</p>
        <div className="module-grid module-grid--roadmap">
          {modules.filter(m => m.status === 'coming-soon').map((m) => <ModuleTile key={m.id} mod={m} />)}
        </div>
      </main>
    </div>
  );
}

// ── CATI: Interviewer Mode ────────────────────────────────────────────────────

const STATUS_LABELS: Record<CaseStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  complete: 'Complete',
  callback: 'Callback',
  refused: 'Refused',
  non_contact: 'Non-contact',
};
const STATUS_COLORS: Record<CaseStatus, string> = {
  new: '#3b82f6',
  in_progress: '#f59e0b',
  complete: '#10b981',
  callback: '#8b5cf6',
  refused: '#ef4444',
  non_contact: '#6b7280',
};
const STATUS_ORDER: Record<CaseStatus, number> = {
  callback: 0, new: 1, in_progress: 2, complete: 3, refused: 4, non_contact: 5,
};

function InterviewerView({ onBack }: { onBack: () => void }) {
  const [interviewers, setInterviewers] = useState<InterviewerRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [cases, setCases] = useState<CaseDetail[]>([]);
  const [surveyId, setSurveyId] = useState('lfs');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<CaseStatus>('new');
  const [callbackAt, setCallbackAt] = useState('');
  const [callbackNote, setCallbackNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInterviewers()
      .then((rows) => {
        setInterviewers(rows);
        if (rows.length > 0) setSelectedId(rows[0]!.id);
      })
      .catch(() => setError('Local API not reachable — run: pnpm --filter @mobilesurvey/api dev'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchCases(selectedId)
      .then(setCases)
      .catch(() => setError('Failed to load cases'))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function saveOutcome(caseId: string) {
    await recordCaseOutcome(caseId, {
      status: outcomeStatus,
      callbackAt: callbackAt ? new Date(callbackAt).getTime() : undefined,
      callbackNote: callbackNote || undefined,
    });
    setEditingId(null);
    const refreshed = await fetchCases(selectedId);
    setCases(refreshed);
  }

  function openInterview(c: CaseDetail) {
    const url = c.accessCode
      ? `${RUNTIME_URL}/?survey=${encodeURIComponent(surveyId)}&code=${encodeURIComponent(c.accessCode)}`
      : `${RUNTIME_URL}/?survey=${encodeURIComponent(surveyId)}`;
    window.open(url, '_blank', 'noopener');
  }

  const sortedCases = [...cases].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );

  return (
    <div className="hub">
      <header className="hub__header">
        <button onClick={onBack} className="hub__back">← Home</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Interviewer Mode</h1>
      </header>
      <main className="hub__main" style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
        {error && <p className="cati__error">{error}</p>}

        <div className="cati__controls">
          <label className="cati__label">Interviewer</label>
          <select className="cati__select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {interviewers.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <label className="cati__label">Survey</label>
          <input
            className="cati__select"
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            placeholder="survey id (e.g. lfs)"
            style={{ minWidth: 120 }}
          />
        </div>

        {loading ? (
          <p className="cati__empty">Loading cases…</p>
        ) : sortedCases.length === 0 ? (
          <p className="cati__empty">No cases assigned to this interviewer.</p>
        ) : (
          <div className="cati__list">
            {sortedCases.map((c) => {
              const cbDate = c.callbackAt ? new Date(c.callbackAt) : null;
              const isEditing = editingId === c.id;
              const contact = (c.fields.contact_name as string | undefined) || c.id;
              const region = c.fields.region_code as string | undefined;
              return (
                <div key={c.id} className={`cati__case${c.status === 'callback' && cbDate ? ' cati__case--due' : ''}`}>
                  <div className="cati__case-header">
                    <span className="cati__case-id">{c.id}</span>
                    <span className="cati__badge" style={{ background: STATUS_COLORS[c.status] ?? '#6b7280' }}>
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                    <span className="cati__contact">{contact}{region ? ` · ${region}` : ''}</span>
                    {cbDate && (
                      <span className="cati__callback-time cati__callback-time--due">
                        Callback: {cbDate.toLocaleDateString()} {cbDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  {c.callbackNote && <p className="cati__note">{c.callbackNote}</p>}
                  <div className="cati__actions">
                    <button className="cati__btn cati__btn--primary" onClick={() => openInterview(c)}>
                      ▶ Launch Interview
                    </button>
                    <button
                      className="cati__btn"
                      onClick={() => {
                        if (isEditing) { setEditingId(null); return; }
                        setEditingId(c.id);
                        setOutcomeStatus(c.status);
                        setCallbackAt(c.callbackAt ? new Date(c.callbackAt).toISOString().slice(0, 16) : '');
                        setCallbackNote(c.callbackNote ?? '');
                      }}
                    >
                      {isEditing ? 'Cancel' : 'Record Outcome'}
                    </button>
                  </div>
                  {isEditing && (
                    <div className="cati__outcome-form">
                      <label className="cati__label">Outcome</label>
                      <select
                        className="cati__select"
                        value={outcomeStatus}
                        onChange={(e) => setOutcomeStatus(e.target.value as CaseStatus)}
                      >
                        {(Object.keys(STATUS_LABELS) as CaseStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      {outcomeStatus === 'callback' && (
                        <>
                          <label className="cati__label">Callback date / time</label>
                          <input
                            type="datetime-local"
                            className="cati__select"
                            value={callbackAt}
                            onChange={(e) => setCallbackAt(e.target.value)}
                          />
                          <label className="cati__label">Note</label>
                          <textarea
                            className="cati__textarea"
                            value={callbackNote}
                            rows={2}
                            placeholder="e.g. Call back after 6 pm"
                            onChange={(e) => setCallbackNote(e.target.value)}
                          />
                        </>
                      )}
                      <div>
                        <button className="cati__btn cati__btn--primary" onClick={() => void saveOutcome(c.id)}>
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ── CATI: Supervisor Dashboard ────────────────────────────────────────────────

function SupervisorView({ onBack }: { onBack: () => void }) {
  const [interviewers, setInterviewers] = useState<InterviewerRow[]>([]);
  const [cases, setCases] = useState<CaseDetail[]>([]);
  const [assignCaseId, setAssignCaseId] = useState('');
  const [assignIntId, setAssignIntId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [ints, cs] = await Promise.all([fetchInterviewers(), fetchCases()]);
      setInterviewers(ints);
      setCases(cs);
    } catch {
      setError('Local API not reachable — run: pnpm --filter @mobilesurvey/api dev');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function doAssign() {
    if (!assignCaseId || !assignIntId) return;
    await assignCaseToInterviewer(assignCaseId, assignIntId);
    setAssignCaseId('');
    setAssignIntId('');
    void load();
  }

  const totals = useMemo(() => {
    const counts: Partial<Record<CaseStatus, number>> = {};
    for (const c of cases) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return counts;
  }, [cases]);

  const byInterviewer = useMemo(() => {
    const m = new Map<string, { int: InterviewerRow; counts: Partial<Record<CaseStatus, number>> }>();
    for (const i of interviewers) m.set(i.id, { int: i, counts: {} });
    for (const c of cases) {
      if (c.interviewerId && m.has(c.interviewerId)) {
        const entry = m.get(c.interviewerId)!;
        entry.counts[c.status] = (entry.counts[c.status] ?? 0) + 1;
      }
    }
    return [...m.values()];
  }, [interviewers, cases]);

  const STAT_KEYS: CaseStatus[] = ['new', 'in_progress', 'complete', 'callback', 'refused', 'non_contact'];

  return (
    <div className="hub">
      <header className="hub__header">
        <button onClick={onBack} className="hub__back">← Home</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Supervisor Dashboard</h1>
      </header>
      <main className="hub__main" style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
        {error && <p className="cati__error">{error}</p>}
        {loading ? (
          <p className="cati__empty">Loading…</p>
        ) : (
          <>
            {/* Summary stats */}
            <div className="cati__stats">
              <div className="cati__stat">
                <span className="cati__stat-val">{cases.length}</span>
                <span className="cati__stat-label">Total</span>
              </div>
              {STAT_KEYS.map((k) => (
                <div key={k} className="cati__stat">
                  <span className="cati__stat-val" style={{ color: STATUS_COLORS[k] }}>
                    {totals[k] ?? 0}
                  </span>
                  <span className="cati__stat-label">{STATUS_LABELS[k]}</span>
                </div>
              ))}
            </div>

            {/* Per-interviewer breakdown */}
            <h2 className="cati__section-title">Interviewers</h2>
            <table className="cati__table">
              <thead>
                <tr>
                  <th>Interviewer</th>
                  {STAT_KEYS.map((k) => <th key={k}>{STATUS_LABELS[k]}</th>)}
                  <th>Completion rate</th>
                </tr>
              </thead>
              <tbody>
                {byInterviewer.map(({ int, counts }) => {
                  const total = STAT_KEYS.reduce((s, k) => s + (counts[k] ?? 0), 0);
                  const done = counts.complete ?? 0;
                  const rate = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <tr key={int.id}>
                      <td style={{ fontWeight: 500 }}>{int.name}</td>
                      {STAT_KEYS.map((k) => (
                        <td key={k} style={{ color: (counts[k] ?? 0) > 0 ? STATUS_COLORS[k] : undefined, fontWeight: (counts[k] ?? 0) > 0 ? 600 : undefined }}>
                          {counts[k] ?? 0}
                        </td>
                      ))}
                      <td>{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Case assignment */}
            <h2 className="cati__section-title">Assign Case</h2>
            <div className="cati__controls">
              <label className="cati__label">Case</label>
              <select
                className="cati__select"
                value={assignCaseId}
                onChange={(e) => setAssignCaseId(e.target.value)}
                style={{ minWidth: 220 }}
              >
                <option value="">Select a case…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {(c.fields.contact_name as string | undefined) ?? '?'} [{STATUS_LABELS[c.status] ?? c.status}]
                  </option>
                ))}
              </select>
              <label className="cati__label">Interviewer</label>
              <select
                className="cati__select"
                value={assignIntId}
                onChange={(e) => setAssignIntId(e.target.value)}
              >
                <option value="">Select interviewer…</option>
                {interviewers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <button
                className="cati__btn cati__btn--primary"
                disabled={!assignCaseId || !assignIntId}
                onClick={() => void doAssign()}
              >
                Assign
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  const [view, setView] = useState<HubView>('home');
  if (view === 'collector') return <CollectorView onBack={() => setView('home')} />;
  if (view === 'searcher') return <SearcherView onBack={() => setView('home')} />;
  if (view === 'trainer') return <TrainingView onBack={() => setView('home')} />;
  if (view === 'migrator') return <MigratorView onBack={() => setView('home')} />;
  if (view === 'analyzer') return <AnalyzerView onBack={() => setView('home')} />;
  if (view === 'interviewer') return <InterviewerView onBack={() => setView('home')} />;
  if (view === 'supervisor') return <SupervisorView onBack={() => setView('home')} />;
  return <HomePage onNavigate={setView} />;
}
