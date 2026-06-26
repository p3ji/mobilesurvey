/** Submission confirmation: collected response data (schema form) plus the paradata trail. */
import { useState } from 'react';
import type { ParadataEvent } from '@mobilesurvey/runtime-engine';

export function Completion({
  responses,
  paradata,
  saved,
  saveError,
  onRestart,
}: {
  responses: Record<string, unknown>;
  paradata: ParadataEvent[];
  saved: boolean;
  saveError?: string;
  onRestart: () => void;
}) {
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
        <div className="done__icon" aria-hidden="true">
          ✓
        </div>
        <h1 className="done__title">Survey submitted</h1>
        <p className="done__sub">
          {saved
            ? 'Thank you. Your responses have been saved to the collection dashboard.'
            : 'Thank you. Your responses were collected in this session but were not saved to a server.'}
        </p>
        {!saved && saveError && (
          <p style={{ marginTop: 8, fontSize: '0.75rem', color: '#b91c1c', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            Debug: {saveError}
          </p>
        )}

        <div className="done__section">
          <div className="done__section-head">
            <strong>Response data ({Object.keys(filled).length} values)</strong>
            <button type="button" onClick={copy}>
              {copied ? '✓ Copied' : '⎘ Copy JSON'}
            </button>
          </div>
          <pre className="done__json">{json}</pre>
        </div>

        <div className="done__section">
          <div className="done__section-head">
            <strong>Paradata trail ({paradata.length} events)</strong>
          </div>
          <div className="done__paradata">
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

        <div className="done__actions">
          <button type="button" className="done__restart" onClick={onRestart}>
            ↺ Start a new session
          </button>
        </div>
      </div>
    </div>
  );
}
