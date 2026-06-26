/**
 * mobilesurvey hub — module selector home screen + Collector sub-view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { blankInstrument, lfsInstrument, demoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import {
  createSurvey,
  deleteSurvey,
  DESIGNER_URL,
  designerLink,
  fetchResponses,
  listSurveys,
  pingApi,
  respondentLink,
  setSurveyConfig,
  type ResponseRow,
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

type HubView = 'home' | 'collector';

interface ModuleDef {
  id: string;
  icon: string;
  name: string;
  tagline: string;
  description: string;
  status: 'live' | 'coming-soon';
  action?: () => void;
}

// ── Responses panel ───────────────────────────────────────────────────────────

function ResponsesPanel({ surveyId }: { surveyId: string }) {
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResponses(surveyId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [surveyId]);

  if (loading) return <p className="responses__loading">Loading responses…</p>;
  if (!rows || rows.length === 0) return <p className="responses__empty">No responses yet.</p>;

  return (
    <table className="responses__table">
      <thead>
        <tr>
          <th>Respondent</th>
          <th>Submitted</th>
          <th>Duration</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="responses__id">{r.respondentId.slice(0, 18)}…</td>
            <td>{new Date(r.submittedAt).toLocaleString()}</td>
            <td>{r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : '—'}</td>
            <td>
              <span className={`badge badge--${r.completed ? 'published' : 'draft'}`}>
                {r.completed ? 'Complete' : 'Partial'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <div className={`card${isLive ? ' card--live' : ''}`}>
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
          <ResponsesPanel surveyId={survey.id} />
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
    pingApi().then(setOnline);
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
          <button type="button" className="hub__back" onClick={onBack}>← Hub</button>
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
      description: 'Build complex survey instruments with a tree editor, conditional routing, variables, expressions, flowchart view, and multi-language support.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/?mode=pro`, '_blank', 'noopener'),
    },
    {
      id: 'designer-easy',
      icon: '✏',
      name: 'Designer — Easy Mode',
      tagline: 'Simple question-by-question editor',
      description: 'Add and arrange questions in a flat list with inline category editing and routing conditions. Best for straightforward questionnaires.',
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
      description: 'Discover existing questions, variables, and code lists across all surveys. Search by keyword or concept, preview, and insert directly into your instrument.',
      status: 'live',
      action: () => window.open(`${DESIGNER_URL}/`, '_blank', 'noopener'),
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
          <strong className="hub__wordmark">mobilesurvey</strong>
          <span className="hub__sub">Open survey platform</span>
        </div>
      </header>

      <main className="hub__main hub__main--home">
        <div className="hub__intro">
          <h1>What would you like to do?</h1>
          <p>Select a module to get started. Modules marked "Coming soon" are on the roadmap.</p>
        </div>

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
  return view === 'home'
    ? <HomePage onNavigate={setView} />
    : <CollectorView onBack={() => setView('home')} />;
}
