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
import type { RecognitionItem, RenderItem, SensorServices } from '@mobilesurvey/runtime-engine';
import { ConsentCard } from './ConsentCard.jsx';
import { EditList } from './EditList.jsx';
import { reencodePhoto } from './photoProcess.js';

type PhotoItem = Extract<RenderItem, { kind: 'photo' }>;
type DraftItem = { label: string; qty: string; unit: 'g' | 'ml' | 'serving'; confidence: number };

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
    recognizing: 'Analyzing photo…',
    suggested: 'Suggested items — please check and correct before saving:',
    manualItems: 'List the items in your photo:',
    recognitionFailed: 'Automatic analysis was unavailable — enter the items yourself.',
    itemLabel: 'Item',
    qty: 'Qty',
    unitG: 'g',
    unitMl: 'ml',
    unitServing: 'serving(s)',
    addItem: '+ Add item',
    removeItem: 'Remove',
    confirmItems: 'Save items',
    confirmedItems: 'Saved items:',
    editItems: 'Edit items',
    confidence: 'model confidence',
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
    recognizing: 'Analyse de la photo…',
    suggested: 'Éléments suggérés — vérifiez et corrigez avant d’enregistrer :',
    manualItems: 'Énumérez les éléments de votre photo :',
    recognitionFailed: 'L’analyse automatique était indisponible — saisissez les éléments vous-même.',
    itemLabel: 'Élément',
    qty: 'Qté',
    unitG: 'g',
    unitMl: 'ml',
    unitServing: 'portion(s)',
    addItem: '+ Ajouter un élément',
    removeItem: 'Retirer',
    confirmItems: 'Enregistrer les éléments',
    confirmedItems: 'Éléments enregistrés :',
    editItems: 'Modifier les éléments',
    confidence: 'confiance du modèle',
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
  const [busy, setBusy] = useState<'processing' | 'uploading' | 'recognizing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local preview of the processed blob for this session; a resumed session shows the
  // stored ref textually instead (the private bucket has no public URL to re-fetch).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Item list being confirmed/corrected (recognition suggestions or manual entry).
  // null = closed; a resumed session with storedItems shows the confirmed summary instead.
  const [draft, setDraft] = useState<DraftItem[] | null>(null);
  const [recognitionNote, setRecognitionNote] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const hasHardEdit = item.firedEdits.some((e) => e.type === 'hard');
  const errId = hasHardEdit ? `${item.key}-err` : undefined;
  const undeclared = item.purpose === '';
  const rec = item.recognition;

  const itemKey = (name: string) => `${name}@${rec?.scopeSuffix ?? ''}`;

  const toDraft = (items: RecognitionItem[]): DraftItem[] =>
    items.map((i) => ({
      label: i.label,
      qty: i.qty !== undefined ? String(i.qty) : '',
      unit: i.unit ?? 'serving',
      confidence: i.confidence,
    }));

  const handleFile = async (file: File | undefined, source: 'camera' | 'library') => {
    if (!file) return;
    setError(null);
    setRecognitionNote(null);
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
    if (!res.ok) {
      setBusy(null);
      setError(t.errUpload);
      return;
    }
    onAnswer(item.instanceKey, res.ref);
    onAnswer(item.subKeys.ts, new Date(res.ts).toISOString());
    onAnswer(item.subKeys.src, source);
    if (rec) {
      setBusy('recognizing');
      const recRes = await sensors.recognizePhoto(blob, rec.profile, { maxItems: rec.maxItems });
      if (recRes.ok) {
        setDraft(toDraft(recRes.result.items.slice(0, rec.maxItems)));
      } else {
        // Graceful absence/failure: same list UI, manual entry (D5).
        setDraft([{ label: '', qty: '', unit: 'serving', confidence: 1 }]);
        setRecognitionNote(t.recognitionFailed);
      }
    }
    setBusy(null);
  };

  /** Write the confirmed item list into the generated variables (the ONLY storage path). */
  const confirmDraft = () => {
    if (!rec || !draft) return;
    const kept = draft.filter((d) => d.label.trim() !== '');
    onAnswer(itemKey(`${rec.variablePrefix}_N_ITEMS`), kept.length);
    kept.forEach((d, idx) => {
      const i = idx + 1;
      onAnswer(itemKey(`${rec.variablePrefix}_I${i}_LABEL`), d.label.trim());
      onAnswer(itemKey(`${rec.variablePrefix}_I${i}_QTY`), d.qty === '' ? undefined : Number(d.qty));
      onAnswer(itemKey(`${rec.variablePrefix}_I${i}_UNIT`), d.unit);
      onAnswer(itemKey(`${rec.variablePrefix}_I${i}_CONF`), d.confidence);
    });
    setDraft(null);
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
              {busy === 'processing'
                ? t.processing
                : busy === 'uploading'
                  ? t.uploading
                  : busy === 'recognizing'
                    ? t.recognizing
                    : item.value
                      ? t.retake
                      : t.take}
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
          {recognitionNote && !busy && draft && (
            <p className="eq__sensor-error" role="status">
              {recognitionNote}
            </p>
          )}

          {rec && draft && !busy && (
            <div className="eq__recog" data-testid="recog-draft">
              <p className="eq__recog-heading">{recognitionNote ? t.manualItems : t.suggested}</p>
              {draft.map((d, idx) => (
                <div key={idx} className="eq__recog-row">
                  {rec.itemOptions ? (
                    <select
                      aria-label={`${t.itemLabel} ${idx + 1}`}
                      value={d.label}
                      onChange={(e) =>
                        setDraft(draft.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)))
                      }
                    >
                      <option value="">—</option>
                      {rec.itemOptions.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      aria-label={`${t.itemLabel} ${idx + 1}`}
                      value={d.label}
                      placeholder={t.itemLabel}
                      onChange={(e) =>
                        setDraft(draft.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)))
                      }
                    />
                  )}
                  <input
                    type="number"
                    min={0}
                    aria-label={`${t.qty} ${idx + 1}`}
                    value={d.qty}
                    placeholder={t.qty}
                    onChange={(e) =>
                      setDraft(draft.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)))
                    }
                  />
                  <select
                    aria-label={`Unit ${idx + 1}`}
                    value={d.unit}
                    onChange={(e) =>
                      setDraft(
                        draft.map((x, j) =>
                          j === idx ? { ...x, unit: e.target.value as DraftItem['unit'] } : x,
                        ),
                      )
                    }
                  >
                    <option value="g">{t.unitG}</option>
                    <option value="ml">{t.unitMl}</option>
                    <option value="serving">{t.unitServing}</option>
                  </select>
                  {d.confidence < 1 && (
                    <span className="eq__recog-conf" title={t.confidence}>
                      {Math.round(d.confidence * 100)}%
                    </span>
                  )}
                  <button
                    type="button"
                    className="eq__recog-remove"
                    onClick={() => setDraft(draft.filter((_, j) => j !== idx))}
                  >
                    {t.removeItem}
                  </button>
                </div>
              ))}
              <div className="eq__consent-actions">
                {draft.length < rec.maxItems && (
                  <button
                    type="button"
                    className="eq__consent-decline"
                    onClick={() => setDraft([...draft, { label: '', qty: '', unit: 'serving', confidence: 1 }])}
                  >
                    {t.addItem}
                  </button>
                )}
                <button type="button" className="eq__consent-allow" onClick={confirmDraft}>
                  {t.confirmItems}
                </button>
              </div>
            </div>
          )}

          {rec && !draft && !busy && rec.storedItems.length > 0 && (
            <div className="eq__recog" data-testid="recog-confirmed">
              <p className="eq__recog-heading">{t.confirmedItems}</p>
              <ul className="eq__recog-list">
                {rec.storedItems.map((s, i) => (
                  <li key={i}>
                    {s.label}
                    {s.qty !== undefined ? ` — ${s.qty} ${s.unit ?? ''}` : ''}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="eq__consent-decline"
                onClick={() =>
                  setDraft(
                    rec.storedItems.map((s) => ({
                      label: s.label,
                      qty: s.qty !== undefined ? String(s.qty) : '',
                      unit: (s.unit as DraftItem['unit']) ?? 'serving',
                      confidence: s.conf ?? 1,
                    })),
                  )
                }
              >
                {t.editItems}
              </button>
            </div>
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
