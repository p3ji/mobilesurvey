/**
 * Consent-gated device-location question (sensor module, docs/sensor-module-plan.md).
 *
 * Flow: consent card (Allow/Decline, from the instrument's sensor declaration) → capture
 * button → rounded coordinates written to the generated sub-variables, pipeable summary to
 * the base variable. Declining (or a failed fix) falls back to a free-text description when
 * the domain allows it, so the survey stays completable. Consent itself is stored in the
 * session-global reserved variable via `onAnswer(item.consentKey, …)`.
 */
import { useState } from 'react';
import type { RenderItem, SensorServices } from '@mobilesurvey/runtime-engine';
import { EditList } from './EditList.jsx';

type GeolocationItem = Extract<RenderItem, { kind: 'geolocation' }>;

const T = {
  en: {
    allow: 'Allow',
    decline: 'Decline',
    consentHeading: 'This question asks for your device location',
    retention: 'Retention:',
    browserNote:
      'Your browser will also ask for permission. Nothing is captured until you press the button below.',
    capture: 'Use my location',
    recapture: 'Update location',
    capturing: 'Getting location…',
    captured: 'Location captured',
    manualLabel: 'Describe your location instead',
    manualPlaceholder: 'e.g. Home; Main St & 2nd Ave; Ottawa',
    declined: 'Location sharing declined.',
    undeclared: 'This survey did not declare location use, so capture is disabled.',
    errDenied: 'Location permission was refused by the browser.',
    errTimeout: 'Could not get a location fix in time.',
    errUnavailable: 'Location is not available on this device.',
    errAccuracy: (m: number) => `The fix was less accurate than the required ±${m} m. Try again outdoors or near a window.`,
  },
  fr: {
    allow: 'Autoriser',
    decline: 'Refuser',
    consentHeading: 'Cette question demande la position de votre appareil',
    retention: 'Conservation :',
    browserNote:
      'Votre navigateur demandera aussi la permission. Rien n’est capté avant que vous appuyiez sur le bouton ci-dessous.',
    capture: 'Utiliser ma position',
    recapture: 'Mettre à jour la position',
    capturing: 'Localisation en cours…',
    captured: 'Position captée',
    manualLabel: 'Décrivez plutôt votre emplacement',
    manualPlaceholder: 'p. ex. Domicile; rue Main et 2e Avenue; Ottawa',
    declined: 'Partage de position refusé.',
    undeclared: 'Ce sondage n’a pas déclaré l’utilisation de la position; la capture est désactivée.',
    errDenied: 'La permission de localisation a été refusée par le navigateur.',
    errTimeout: 'Impossible d’obtenir une position à temps.',
    errUnavailable: 'La localisation n’est pas disponible sur cet appareil.',
    errAccuracy: (m: number) => `La position était moins précise que le ±${m} m requis. Réessayez dehors ou près d’une fenêtre.`,
  },
} as const;

function tr(lang: string) {
  return lang === 'fr' ? T.fr : T.en;
}

export function GeolocationQuestion({
  item,
  qNum,
  wrapperId,
  lang,
  sensors,
  onAnswer,
}: {
  item: GeolocationItem;
  qNum: number | null;
  wrapperId?: string;
  lang: string;
  sensors: SensorServices;
  onAnswer: (instanceKey: string, value: unknown) => void;
}) {
  const t = tr(lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasHardEdit = item.firedEdits.some((e) => e.type === 'hard');
  const errId = hasHardEdit ? `${item.key}-err` : undefined;
  const inputId = `eq-ctrl-${item.key}`;
  const undeclared = item.purpose === '';

  const capture = async () => {
    setBusy(true);
    setError(null);
    const res = await sensors.captureLocation({ maxAccuracyM: item.maxAccuracyM });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === 'denied' ? t.errDenied : res.error === 'timeout' ? t.errTimeout : t.errUnavailable,
      );
      return;
    }
    if (item.maxAccuracyM !== undefined && res.fix.accuracyM > item.maxAccuracyM) {
      setError(t.errAccuracy(item.maxAccuracyM));
      return;
    }
    const f = 10 ** item.precision;
    const lat = Math.round(res.fix.lat * f) / f;
    const lon = Math.round(res.fix.lon * f) / f;
    const acc = Math.round(res.fix.accuracyM);
    onAnswer(item.subKeys.lat, lat);
    onAnswer(item.subKeys.lon, lon);
    onAnswer(item.subKeys.acc, acc);
    onAnswer(item.subKeys.ts, new Date(res.fix.ts).toISOString());
    onAnswer(item.subKeys.src, 'gps');
    onAnswer(item.instanceKey, `${lat}, ${lon} (±${acc} m)`);
  };

  const manual = (text: string) => {
    onAnswer(item.instanceKey, text);
    onAnswer(item.subKeys.src, item.consent === 'declined' ? 'declined' : 'manual');
  };

  return (
    <div
      id={wrapperId}
      className="eq__question"
      style={{ marginInlineStart: item.depth * 8 }}
    >
      <label className="eq__q-text" htmlFor={item.consent === 'granted' ? undefined : inputId}>
        {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
        {item.questionText}
        {item.required && (
          <span aria-hidden="true" className="eq__req">
            {' '}
            *
          </span>
        )}
      </label>
      {item.instruction && <p className="eq__instruction">{item.instruction}</p>}

      {undeclared ? (
        <p className="eq__sensor-error" role="alert">
          {t.undeclared}
        </p>
      ) : item.consent === undefined ? (
        <div className="eq__consent-card" role="group" aria-label={t.consentHeading}>
          <p className="eq__consent-heading">{t.consentHeading}</p>
          <p className="eq__consent-purpose">{item.purpose}</p>
          {item.retention && (
            <p className="eq__consent-retention">
              <strong>{t.retention}</strong> {item.retention}
            </p>
          )}
          <p className="eq__consent-note">{t.browserNote}</p>
          <div className="eq__consent-actions">
            <button type="button" className="eq__consent-allow" onClick={() => onAnswer(item.consentKey, 'granted')}>
              {t.allow}
            </button>
            <button type="button" className="eq__consent-decline" onClick={() => onAnswer(item.consentKey, 'declined')}>
              {t.decline}
            </button>
          </div>
        </div>
      ) : item.consent === 'granted' ? (
        <div className="eq__sensor" aria-describedby={errId}>
          <button type="button" className="eq__sensor-capture" disabled={busy} onClick={() => void capture()}>
            {busy ? t.capturing : item.src === 'gps' ? t.recapture : t.capture}
          </button>
          {item.src === 'gps' && item.value && (
            <span className="eq__sensor-result" data-testid="geo-result">
              ✓ {t.captured}: {item.value}
            </span>
          )}
          {error && (
            <p className="eq__sensor-error" role="alert">
              {error}
            </p>
          )}
          {error && item.manualFallback && (
            <ManualEntry
              inputId={inputId}
              label={t.manualLabel}
              placeholder={t.manualPlaceholder}
              value={item.src === 'gps' ? '' : (item.value ?? '')}
              onChange={manual}
            />
          )}
        </div>
      ) : (
        <div className="eq__sensor" aria-describedby={errId}>
          <p className="eq__sensor-declined">{t.declined}</p>
          {item.manualFallback && (
            <ManualEntry
              inputId={inputId}
              label={t.manualLabel}
              placeholder={t.manualPlaceholder}
              value={item.value ?? ''}
              onChange={manual}
            />
          )}
        </div>
      )}

      <EditList edits={item.firedEdits} id={errId} />
    </div>
  );
}

function ManualEntry({
  inputId,
  label,
  placeholder,
  value,
  onChange,
}: {
  inputId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <div className="eq__sensor-manual">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
