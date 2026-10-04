/**
 * Submission confirmation. For bundled teaching demos (`showDebug`), it also shows the collected
 * response data (schema form), the paradata trail, and raw save errors — that inspection panel is
 * the demo's teaching point. Real (user-created) surveys get a clean thank-you screen: no data
 * echo, no paradata, no raw error text in front of a respondent.
 */
import { useState } from 'react';
import { LanguageSwitch, useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import type { ParadataEvent } from '@mobilesurvey/runtime-engine';

export function Completion({
  responses,
  paradata,
  saved,
  saveError,
  showDebug,
  onRestart,
}: {
  responses: Record<string, unknown>;
  paradata: ParadataEvent[];
  saved: boolean;
  saveError?: string;
  /** True only for bundled demo surveys — gates the data/paradata/debug inspection panel. */
  showDebug: boolean;
  onRestart: () => void;
}) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const [copied, setCopied] = useState(false);

  const filled = Object.fromEntries(
    Object.entries(responses).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const json = JSON.stringify(filled, null, 2);

  const copy = () => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="done">
      <div className="done__card">
        <LanguageSwitch />
        <div className="done__icon" aria-hidden="true">
          ✓
        </div>
        <h1 className="done__title">{l('Survey submitted', 'Enquête soumise')}</h1>
        <p className="done__sub">
          {saved
            ? showDebug
              ? l('Thank you. Your responses have been saved to the collection dashboard.', 'Merci. Vos réponses ont été enregistrées dans le tableau de bord de collecte.')
              : l('Thank you. Your response has been submitted.', 'Merci. Votre réponse a été soumise.')
            : showDebug
              ? l('Thank you. Your responses were collected in this session but were not saved to a server.', 'Merci. Vos réponses ont été recueillies pendant cette session, mais n’ont pas été enregistrées sur un serveur.')
              : l('Thank you for completing the survey. Your response could not be saved to the server — please contact the survey organiser.', 'Merci d’avoir rempli l’enquête. Votre réponse n’a pas pu être enregistrée sur le serveur; veuillez communiquer avec la personne responsable de l’enquête.')}
        </p>
        {showDebug && !saved && saveError && (
          <p style={{ marginTop: 8, fontSize: '0.75rem', color: '#b91c1c', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            Debug: {saveError}
          </p>
        )}

        {showDebug && (
          <>
            <div className="done__section">
              <div className="done__section-head">
                <strong>{l('Response data', 'Données de réponse')} ({Object.keys(filled).length} {l('values', 'valeurs')})</strong>
                <button type="button" onClick={copy}>
                  {copied ? l('✓ Copied', '✓ Copié') : l('⎘ Copy JSON', '⎘ Copier le JSON')}
                </button>
              </div>
              <pre className="done__json" tabIndex={0}>{json}</pre>
            </div>

            <div className="done__section">
              <div className="done__section-head">
                <strong>{l('Paradata trail', 'Historique des paradonnées')} ({paradata.length} {l('events', 'événements')})</strong>
              </div>
              <div className="done__paradata" tabIndex={0}>
                {paradata.map((e, i) => (
                  <div key={i} className="done__pd-row">
                    <span className="done__pd-type">{e.type}</span>
                    <span className="done__pd-payload">
                      {e.payload ? JSON.stringify(e.payload) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="done__actions">
          <button type="button" className="done__restart" onClick={onRestart}>
            ↺ {l('Start a new session', 'Démarrer une nouvelle session')}
          </button>
        </div>
      </div>
    </div>
  );
}
