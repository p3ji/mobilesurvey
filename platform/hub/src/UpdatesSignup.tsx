import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import { subscribeToUpdates } from './api.js';

export function UpdatesSignup() {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || !email.trim() || busy) return;
    setBusy(true);
    setStatus('idle');
    try {
      await subscribeToUpdates(email, language);
      setStatus('success');
      setEmail('');
      setConsent(false);
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="updates-signup">
      <a href="#updates-signup" aria-expanded={open} onClick={(event) => {
        event.preventDefault();
        setOpen((value) => !value);
        setStatus('idle');
        if (!open) window.setTimeout(() => emailRef.current?.focus(), 0);
      }}>
        {l('Sign up for updates', 'S’inscrire aux mises à jour')} ↗
      </a>
      {open && (
        <form id="updates-signup" className="updates-signup__form" onSubmit={(event) => void submit(event)}>
          <button className="updates-signup__close" type="button" aria-label={l('Close signup', 'Fermer le formulaire')} onClick={() => setOpen(false)}>×</button>
          <label htmlFor="updates-email">{l('Email address', 'Adresse courriel')}</label>
          <div className="updates-signup__row">
            <input
              ref={emailRef}
              id="updates-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              maxLength={254}
              placeholder={l('you@example.com', 'vous@exemple.ca')}
            />
            <button type="submit" disabled={busy || !consent}>{busy ? l('Joining…', 'Inscription…') : l('Join list', 'S’inscrire')}</button>
          </div>
          <label className="updates-signup__consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
            <span>{l('I agree to receive occasional Modular Survey Tools updates by email. I can unsubscribe at any time.', 'J’accepte de recevoir par courriel des nouvelles occasionnelles de Modular Survey Tools. Je peux me désabonner en tout temps.')}</span>
          </label>
          <p className="updates-signup__note">{l('We use your email only for these updates.', 'Nous utilisons votre adresse courriel uniquement pour ces mises à jour.')}</p>
          <div role="status" aria-live="polite">
            {status === 'success' && l('You’re on the updates list. Thank you!', 'Vous êtes inscrit à la liste de mises à jour. Merci!')}
            {status === 'error' && l('Signup could not be saved. Please try again later.', 'L’inscription n’a pas pu être enregistrée. Veuillez réessayer plus tard.')}
          </div>
        </form>
      )}
    </div>
  );
}
