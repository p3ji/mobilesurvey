/**
 * Survey management hub — the home screen. Lists surveys from the backend and offers the central
 * actions: create, edit (in the designer), set up / publish (require an access code or not), copy
 * the respondent link, launch, and delete. The metadata registry is reached from inside the
 * designer's Library tab.
 *
 * When the backend is unreachable and we're not on localhost (e.g. GitHub Pages static deploy),
 * the hub falls back to a read-only demo mode showing the two bundled example surveys.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { blankInstrument, lfsInstrument, demoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import {
  createSurvey,
  deleteSurvey,
  designerLink,
  listSurveys,
  pingApi,
  respondentLink,
  setSurveyConfig,
  type SurveySummary,
} from './api.js';

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
  },
  {
    id: 'demo',
    title: 'Feature Demo Survey',
    requiresAccessCode: false,
    status: 'published',
    questionCount: countQuestions(demoInstrument),
    updatedAt: 0,
  },
];

function SurveyCard({
  survey,
  onChange,
  readOnly,
}: {
  survey: SurveySummary;
  onChange: () => void;
  readOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = respondentLink(survey.id);

  const patch = async (config: Parameters<typeof setSurveyConfig>[1]) => {
    setBusy(true);
    try {
      await setSurveyConfig(survey.id, config);
      onChange();
    } finally {
      setBusy(false);
    }
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
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title">{survey.title}</h3>
        <span className={`badge badge--${survey.status}`}>{survey.status}</span>
      </div>

      <div className="card__meta">
        <span>{survey.questionCount} questions</span>
        <span>·</span>
        <span>{survey.requiresAccessCode ? '🔒 access code required' : '🌐 open (no code)'}</span>
      </div>

      {!readOnly && (
        <div className="card__row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={survey.requiresAccessCode}
              disabled={busy}
              onChange={(e) => patch({ requiresAccessCode: e.target.checked })}
            />
            Require access code
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={survey.status === 'published'}
              disabled={busy}
              onChange={(e) => patch({ status: e.target.checked ? 'published' : 'draft' })}
            />
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
          <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
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
      if (!isLocalhost()) {
        // Static deploy (e.g. GitHub Pages) — show bundled demo surveys.
        setSurveys(DEMO_SURVEYS);
        setDemoMode(true);
      } else {
        setSurveys([]);
        setDemoMode(false);
      }
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
      alert('Could not create the survey — is the backend running?');
    } finally {
      setCreating(false);
    }
  };

  const counts = useMemo(() => {
    const list = surveys ?? [];
    return {
      total: list.length,
      published: list.filter((s) => s.status === 'published').length,
    };
  }, [surveys]);

  return (
    <div className="hub">
      <header className="hub__header">
        <div className="hub__brand">
          <strong>mobilesurvey</strong>
          <span className="hub__sub">Survey hub</span>
        </div>
        {demoMode ? (
          <span className="hub__conn hub__conn--demo">● Demo mode</span>
        ) : (
          <span className={online === false ? 'hub__conn hub__conn--off' : 'hub__conn hub__conn--on'}>
            {online === false ? '● Backend offline' : '● Connected'}
          </span>
        )}
        {!demoMode && (
          <button type="button" className="btn btn--primary" onClick={newSurvey} disabled={creating}>
            + New survey
          </button>
        )}
      </header>

      <main className="hub__main">
        <div className="hub__intro">
          <h1>Your surveys</h1>
          <p>
            {counts.total} survey{counts.total === 1 ? '' : 's'} · {counts.published} published.
            {demoMode
              ? ' Running in demo mode — edit in the designer or launch a survey below.'
              : ' Edit a survey in the designer (reuse questions from the Library tab there), set whether it needs an access code, then share its respondent link.'}
          </p>
        </div>

        {online === false && !demoMode && (
          <div className="hub__alert">
            The backend API isn't reachable. Start it with
            <code> pnpm --filter @mobilesurvey/api dev</code> and refresh.
          </div>
        )}

        {demoMode && (
          <div className="hub__notice">
            This is a live demo — the surveys below are built-in examples. Edit them in the designer
            or launch them as a respondent. To manage your own surveys, run the backend locally.
          </div>
        )}

        {surveys === null ? (
          <p className="hub__loading">Loading…</p>
        ) : surveys.length === 0 && online !== false ? (
          <p className="hub__loading">No surveys yet — create one to get started.</p>
        ) : (
          <div className="hub__grid">
            {surveys.map((s) => (
              <SurveyCard key={s.id} survey={s} onChange={refresh} readOnly={demoMode} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
