/**
 * Sensor consent card (docs/sensor-module-plan.md D3) — shown before any sensor fires, with
 * the instrument-declared purpose/retention text verbatim. Shared by every sensor question
 * type; callers pass already-localized strings.
 */
export function ConsentCard({
  heading,
  purpose,
  retention,
  retentionLabel,
  note,
  allowLabel,
  declineLabel,
  onDecide,
}: {
  heading: string;
  purpose: string;
  retention?: string;
  retentionLabel: string;
  note: string;
  allowLabel: string;
  declineLabel: string;
  onDecide: (decision: 'granted' | 'declined') => void;
}) {
  return (
    <div className="eq__consent-card" role="group" aria-label={heading}>
      <p className="eq__consent-heading">{heading}</p>
      <p className="eq__consent-purpose">{purpose}</p>
      {retention && (
        <p className="eq__consent-retention">
          <strong>{retentionLabel}</strong> {retention}
        </p>
      )}
      <p className="eq__consent-note">{note}</p>
      <div className="eq__consent-actions">
        <button type="button" className="eq__consent-allow" onClick={() => onDecide('granted')}>
          {allowLabel}
        </button>
        <button type="button" className="eq__consent-decline" onClick={() => onDecide('declined')}>
          {declineLabel}
        </button>
      </div>
    </div>
  );
}
