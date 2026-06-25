/** Access-code entry. Resolves the code against the (mock) CMS before entering the survey. */
import { useState, type FormEvent } from 'react';

/** The respondent-app manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/respondent-app.md';

export function AccessGate({
  onAuthenticate,
  online,
}: {
  onAuthenticate: (code: string) => Promise<{ ok: boolean; error?: string }>;
  online: boolean;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await onAuthenticate(code);
    if (!result.ok) {
      setError(result.error ?? 'Unable to start the survey.');
      setBusy(false);
    }
    // On success the App unmounts this gate.
  };

  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__brand">Electronic Questionnaire</div>
        <h1 className="gate__title">Household &amp; Employment Survey</h1>
        <p className="gate__sub">Enter the access code from your invitation letter to begin.</p>

        <form onSubmit={handleSubmit}>
          <label className="gate__label" htmlFor="accessCode">
            Access code
          </label>
          <input
            id="accessCode"
            className="gate__code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXX"
            autoComplete="off"
            autoFocus
            disabled={busy}
          />

          <button type="submit" className="gate__btn" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Begin survey'}
          </button>
        </form>

        {error && (
          <div className="gate__error" role="alert">
            {error}
          </div>
        )}

        <div className="gate__hint">
          Demo codes: <code>ABC123</code> (Jordan Lee) or <code>DEF456</code> (Marie Tremblay).
          Progress is saved automatically — re-enter the same code to resume.
        </div>

        <a
          className="gate__help"
          href={HELP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          ? Need help completing the survey?
        </a>

        <div className={online ? 'gate__conn gate__conn--on' : 'gate__conn gate__conn--off'}>
          {online ? '● Connected to the survey service' : '● Offline — progress saved on this device'}
        </div>
      </div>
    </div>
  );
}
