/** Access-code entry. Resolves the code against the (mock) CMS before entering the survey. */
import { useState, type FormEvent } from 'react';
import { LanguageSwitch, useUiLanguage, uiText } from '@mobilesurvey/ui-locale';

/** The respondent-app manual (GitHub renders the markdown). */
const HELP_URL =
  'https://github.com/p3ji/mobilesurvey/blob/main/docs/manuals/respondent-app.md';

export function AccessGate({
  onAuthenticate,
  initialError,
}: {
  onAuthenticate: (code: string) => Promise<{ ok: boolean; error?: string }>;
  initialError?: string | null;
}) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

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
        <LanguageSwitch />
        <div className="gate__brand">{l('Electronic Questionnaire', 'Questionnaire électronique')}</div>
        <h1 className="gate__title">{l('Household & Employment Survey', 'Enquête sur les ménages et l’emploi')}</h1>
        <p className="gate__sub">{l('Enter the access code from your invitation letter to begin.', 'Entrez le code d’accès figurant dans votre lettre d’invitation pour commencer.')}</p>

        <form onSubmit={handleSubmit}>
          <label className="gate__label" htmlFor="accessCode">
            {l('Access code', 'Code d’accès')}
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
            {busy ? l('Checking…', 'Vérification…') : l('Begin survey', 'Commencer l’enquête')}
          </button>
        </form>

        {error && (
          <div className="gate__error" role="alert">
            {error}
          </div>
        )}

        <div className="gate__hint">
          {language === 'fr' ? <>Codes de démonstration : <code>ABC123</code> (Jordan Lee) ou <code>DEF456</code> (Marie Tremblay). La progression est enregistrée automatiquement; entrez de nouveau le même code pour reprendre.</> : <>Demo codes: <code>ABC123</code> (Jordan Lee) or <code>DEF456</code> (Marie Tremblay). Progress is saved automatically — re-enter the same code to resume.</>}
        </div>

        <a
          className="gate__help"
          href={HELP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          ? {l('Need help completing the survey?', 'Besoin d’aide pour remplir l’enquête?')}
        </a>
      </div>
    </div>
  );
}
