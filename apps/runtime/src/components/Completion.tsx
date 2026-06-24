/** Submission confirmation: collected response data (schema form) plus the paradata trail. */
import { useState } from 'react';
import type { ParadataEvent } from '@mobilesurvey/runtime-engine';

export function Completion({
  responses,
  paradata,
  onRestart,
}: {
  responses: Record<string, unknown>;
  paradata: ParadataEvent[];
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
          Thank you. Your responses were collected in this session (in data-schema form — not saved
          to any server in this demo).
        </p>

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
