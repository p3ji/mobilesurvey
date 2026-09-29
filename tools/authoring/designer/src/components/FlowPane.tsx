/**
 * Flow tab: renders the instrument's flow logic as a Mermaid flowchart, with zoom and SVG export.
 * The graph is rebuilt from the live instrument whenever it (or the language) changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useDesigner } from '../store/instrumentStore.js';
import { buildFlowchart } from '../lib/flowchart.js';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  flowchart: { useMaxWidth: false, htmlLabels: true },
});

export function FlowPane() {
  const instrument = useDesigner((s) => s.instrument);
  const language = useDesigner((s) => s.language);

  const definition = useMemo(() => buildFlowchart(instrument, language), [instrument, language]);

  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const renderId = useRef(0);

  useEffect(() => {
    let active = true;
    const id = `flow-${++renderId.current}`;
    mermaid
      .render(id, definition)
      .then((res) => {
        if (active) {
          setSvg(res.svg);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [definition]);

  const downloadSvg = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instrument-flow.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flow">
      <div className="flow__toolbar">
        <span className="flow__hint">Flow logic — questions, pages, branches &amp; rosters</span>
        <span className="flow__spacer" />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} aria-label="Zoom out">
          −
        </button>
        <span className="flow__zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setZoom(1)}>Reset</button>
        <button type="button" onClick={downloadSvg} disabled={!svg}>
          ⬇ SVG
        </button>
      </div>

      {error ? (
        <div className="flow__error" role="alert">
          <strong>Could not render the flowchart.</strong>
          <p>{error}</p>
        </div>
      ) : (
        <div className="flow__canvas">
          <div
            className="flow__stage"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
}
