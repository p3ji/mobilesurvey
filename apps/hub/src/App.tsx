/**
 * Survey management hub — the home screen. Lists surveys from the backend and offers the central
 * actions: create, edit (in the designer), set up / publish (require an access code or not), copy
 * the respondent link, launch, and delete. The metadata registry is reached from inside the
 * designer's Library tab.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { blankInstrument } from '@mobilesurvey/instrument-schema';
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

function SurveyCard({
  survey,
  onChange,
}: {
  survey: SurveySummary;
  onChange: () => void;
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
    if (!confirm(`Delete “${survey.title}”? This cannot be undone.`)) return;
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
        <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSurveys(await listSurveys());
      setOnline(true);
    } catch {
      setOnline(false);
      setSurveys([]);
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
        <span className={online === false ? 'hub__conn hub__conn--off' : 'hub__conn hub__conn--on'}>
          {online === false ? '● Backend offline' : '● Connected'}
        </span>
        <button type="button" className="btn btn--primary" onClick={newSurvey} disabled={creating}>
          + New survey
        </button>
      </header>

      <main className="hub__main">
        <div className="hub__intro">
          <h1>Your surveys</h1>
          <p>
            {counts.total} survey{counts.total === 1 ? '' : 's'} · {counts.published} published.
            Edit a survey in the designer (reuse questions from the Library tab there), set whether
            it needs an access code, then share its respondent link.
          </p>
        </div>

        {online === false && (
          <div className="hub__alert">
            The backend API isn’t reachable. Start it with
            <code> pnpm --filter @mobilesurvey/api dev</code> and refresh.
          </div>
        )}

        {surveys === null ? (
          <p className="hub__loading">Loading…</p>
        ) : surveys.length === 0 && online !== false ? (
          <p className="hub__loading">No surveys yet — create one to get started.</p>
        ) : (
          <div className="hub__grid">
            {surveys.map((s) => (
              <SurveyCard key={s.id} survey={s} onChange={refresh} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
