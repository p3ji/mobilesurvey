/** JSON specification panel: live validation, export/download, and import. */
import { useMemo, useState } from 'react';
import {
  getInstrumentJsonSchema,
  validateInstrument,
  type ValidationIssue,
} from '@mobilesurvey/instrument-schema';
import { useDesigner } from '../store/instrumentStore.js';

export function SpecPanel() {
  const instrument = useDesigner((s) => s.instrument);
  const load = useDesigner((s) => s.load);
  const [importText, setImportText] = useState('');
  const [importIssues, setImportIssues] = useState<ValidationIssue[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const json = useMemo(() => JSON.stringify(instrument, null, 2), [instrument]);
  // Live validation of the current document (catches referential-integrity issues while editing).
  const liveResult = useMemo(() => validateInstrument(instrument), [instrument]);

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    setImportError(null);
    setImportIssues(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    const result = validateInstrument(parsed);
    if (result.ok) {
      load(result.instrument);
      setImportText('');
    } else {
      setImportIssues(result.issues);
    }
  };

  return (
    <div className="spec">
      <div className={liveResult.ok ? 'spec__status spec__status--ok' : 'spec__status spec__status--bad'}>
        {liveResult.ok ? '✓ Instrument is valid' : `✗ ${liveResult.issues.length} validation issue(s)`}
      </div>
      {!liveResult.ok && (
        <ul className="issues" aria-label="Validation issues">
          {liveResult.issues.map((issue, i) => (
            <li key={i}>
              <code>{issue.path || '(root)'}</code> — {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="spec__toolbar">
        <button type="button" onClick={() => download(json, 'instrument.json', 'application/json')}>
          ⬇ Download instrument.json
        </button>
        <button
          type="button"
          onClick={() =>
            download(
              JSON.stringify(getInstrumentJsonSchema(), null, 2),
              'instrument.schema.json',
              'application/json',
            )
          }
        >
          ⬇ JSON Schema
        </button>
      </div>

      <details className="spec__import">
        <summary>Import instrument JSON</summary>
        <textarea
          aria-label="Paste instrument JSON"
          rows={6}
          value={importText}
          placeholder="Paste an instrument.json here…"
          onChange={(e) => setImportText(e.target.value)}
        />
        <button type="button" onClick={handleImport} disabled={importText.trim() === ''}>
          Validate & load
        </button>
        {importError && <p className="expr__error" role="alert">{importError}</p>}
        {importIssues && (
          <ul className="issues" aria-label="Import issues">
            {importIssues.map((issue, i) => (
              <li key={i}>
                <code>{issue.path || '(root)'}</code> — {issue.message}
              </li>
            ))}
          </ul>
        )}
      </details>

      <h4>Live JSON</h4>
      <pre className="spec__json" aria-label="Instrument JSON">
        {json}
      </pre>
    </div>
  );
}
