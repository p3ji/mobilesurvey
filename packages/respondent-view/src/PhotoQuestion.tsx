/**
 * Consent-gated camera question (sensor module, docs/sensor-module-plan.md).
 *
 * Flow: consent card → capture (camera input; optional library picker) → client-side
 * downscale + EXIF strip (`reencodePhoto`) → upload via `SensorServices.storePhoto` → the
 * attachment ref lands in the base variable (never image bytes), `_TS`/`_SRC` alongside.
 * The respondent sees the processed photo before anything else happens and can retake;
 * nothing uploads silently. Upload failure surfaces inline and simply leaves the question
 * unanswered (retry = capture again).
 */
import { useRef, useState } from 'react';
import type { RenderItem, SensorServices } from '@mobilesurvey/runtime-engine';
import { ConsentCard } from './ConsentCard.jsx';
import { EditList } from './EditList.jsx';
import { reencodePhoto } from './photoProcess.js';

type PhotoItem = Extract<RenderItem, { kind: 'photo' }>;

const T = {
  en: {
    allow: 'Allow',
    decline: 'Decline',
    consentHeading: 'This question asks to use your camera',
    retention: 'Retention:',
    browserNote:
      'Your browser will also ask for permission. The photo is shown to you first, downscaled, and stripped of hidden metadata (like embedded GPS) before it is uploaded.',
    take: 'Take a photo',
    retake: 'Retake photo',
    library: 'Choose from library',
    processing: 'Processing…',
    uploading: 'Uploading…',
    uploaded: 'Photo uploaded',
    declined: 'Camera use declined — you can skip this question.',
    undeclared: 'This survey did not declare camera use, so capture is disabled.',
    errUpload: 'Upload failed. Check your connection and try again.',
    errProcess: 'Could not read that image. Try another photo.',
    previewAlt: 'Your photo (as it will be uploaded)',
  },
  fr: {
    allow: 'Autoriser',
    decline: 'Refuser',
    consentHeading: 'Cette question demande à utiliser votre appareil photo',
    retention: 'Conservation :',
    browserNote:
      'Votre navigateur demandera aussi la permission. La photo vous est d’abord montrée, réduite et débarrassée des métadonnées cachées (comme le GPS intégré) avant d’être téléversée.',
    take: 'Prendre une photo',
    retake: 'Reprendre la photo',
    library: 'Choisir dans la galerie',
    processing: 'Traitement…',
    uploading: 'Téléversement…',
    uploaded: 'Photo téléversée',
    declined: 'Utilisation de l’appareil photo refusée — vous pouvez sauter cette question.',
    undeclared: 'Ce sondage n’a pas déclaré l’utilisation de l’appareil photo; la capture est désactivée.',
    errUpload: 'Échec du téléversement. Vérifiez votre connexion et réessayez.',
    errProcess: 'Impossible de lire cette image. Essayez une autre photo.',
    previewAlt: 'Votre photo (telle qu’elle sera téléversée)',
  },
} as const;

export function PhotoQuestion({
  item,
  qNum,
  wrapperId,
  lang,
  sensors,
  onAnswer,
}: {
  item: PhotoItem;
  qNum: number | null;
  wrapperId?: string;
  lang: string;
  sensors: SensorServices;
  onAnswer: (instanceKey: string, value: unknown) => void;
}) {
  const t = lang === 'fr' ? T.fr : T.en;
  const [busy, setBusy] = useState<'processing' | 'uploading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local preview of the processed blob for this session; a resumed session shows the
  // stored ref textually instead (the private bucket has no public URL to re-fetch).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const hasHardEdit = item.firedEdits.some((e) => e.type === 'hard');
  const errId = hasHardEdit ? `${item.key}-err` : undefined;
  const undeclared = item.purpose === '';

  const handleFile = async (file: File | undefined, source: 'camera' | 'library') => {
    if (!file) return;
    setError(null);
    setBusy('processing');
    let blob: Blob;
    try {
      blob = await reencodePhoto(file, item.maxEdgePx);
    } catch {
      setBusy(null);
      setError(t.errProcess);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(blob));
    setBusy('uploading');
    const res = await sensors.storePhoto(blob, { questionId: item.constructId });
    setBusy(null);
    if (!res.ok) {
      setError(t.errUpload);
      return;
    }
    onAnswer(item.instanceKey, res.ref);
    onAnswer(item.subKeys.ts, new Date(res.ts).toISOString());
    onAnswer(item.subKeys.src, source);
  };

  const captureInput = (ref: React.RefObject<HTMLInputElement>, capture: boolean, source: 'camera' | 'library') => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(capture ? { capture: item.facing } : {})}
      style={{ display: 'none' }}
      onChange={(e) => {
        void handleFile(e.target.files?.[0], source);
        e.target.value = ''; // allow re-selecting the same file
      }}
    />
  );

  return (
    <div id={wrapperId} className="eq__question" style={{ marginInlineStart: item.depth * 8 }}>
      <p className="eq__q-text">
        {qNum != null && <span className="eq__q-num">Q{qNum}.</span>}
        {item.questionText}
        {item.required && (
          <span aria-hidden="true" className="eq__req">
            {' '}
            *
          </span>
        )}
      </p>
      {item.instruction && <p className="eq__instruction">{item.instruction}</p>}

      {undeclared ? (
        <p className="eq__sensor-error" role="alert">
          {t.undeclared}
        </p>
      ) : item.consent === undefined ? (
        <ConsentCard
          heading={t.consentHeading}
          purpose={item.purpose}
          retention={item.retention}
          retentionLabel={t.retention}
          note={t.browserNote}
          allowLabel={t.allow}
          declineLabel={t.decline}
          onDecide={(d) => onAnswer(item.consentKey, d)}
        />
      ) : item.consent === 'granted' ? (
        <div className="eq__sensor" aria-describedby={errId}>
          {captureInput(cameraInput, true, 'camera')}
          {item.allowLibrary && captureInput(libraryInput, false, 'library')}
          <div className="eq__consent-actions">
            <button
              type="button"
              className="eq__sensor-capture"
              disabled={busy !== null}
              onClick={() => cameraInput.current?.click()}
            >
              {busy === 'processing' ? t.processing : busy === 'uploading' ? t.uploading : item.value ? t.retake : t.take}
            </button>
            {item.allowLibrary && (
              <button
                type="button"
                className="eq__consent-decline"
                disabled={busy !== null}
                onClick={() => libraryInput.current?.click()}
              >
                {t.library}
              </button>
            )}
          </div>
          {previewUrl && <img className="eq__photo-preview" src={previewUrl} alt={t.previewAlt} />}
          {item.value && !busy && (
            <span className="eq__sensor-result" data-testid="photo-result">
              ✓ {t.uploaded}: <code>{item.value}</code>
            </span>
          )}
          {error && (
            <p className="eq__sensor-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="eq__sensor" aria-describedby={errId}>
          <p className="eq__sensor-declined">{t.declined}</p>
        </div>
      )}

      <EditList edits={item.firedEdits} id={errId} />
    </div>
  );
}
