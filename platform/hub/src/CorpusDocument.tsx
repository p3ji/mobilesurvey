/**
 * Reading the source document a record came from (docs/metadata-repo-plan.md, M4).
 *
 * A citation identifies a document; this opens it. The dictionary around a variable carries
 * context the variable's own block does not — derivation notes, universe definitions, the
 * appendices that explain a code — and for 95.5% of these documents there is no public URL to
 * link out to, so the text is served from the corpus's own Storage bucket.
 *
 * ### What is being shown, and what it is not
 *
 * This is the *reconstructed* text: pdfjs output with rows rebuilt from glyph geometry, not the
 * published PDF. It is close enough to read and is emphatically an adaptation, which the notice
 * says out loud — the Statistics Canada Open Licence requires adaptations to be identifiable, and
 * a page of text that looked like a facsimile would quietly fail that.
 *
 * ### Why it opens at the cited page
 *
 * Arriving at page 1 of a 3,567-page dictionary is the same as arriving nowhere. The fetch is
 * chunked at 100 pages, so opening "p. 176" costs one request of roughly 180 KB regardless of how
 * long the document is.
 */
import { useEffect, useState } from 'react';
import {
  CORPUS_ATTRIBUTION,
  corpusChunkStart,
  type CorpusDocument as CorpusDocumentMeta,
  type CorpusDocumentPage,
  type SupabaseCorpusSource,
} from '@mobilesurvey/metadata-registry';

const formatInt = (n: number): string => n.toLocaleString('en-CA');

export interface CorpusDocumentProps {
  source: SupabaseCorpusSource;
  bundle: string | null;
  path: string;
  /** The page the citation names; the reader opens here. */
  page: number;
  onClose: () => void;
}

export function CorpusDocumentReader({ source, bundle, path, page, onClose }: CorpusDocumentProps) {
  const [meta, setMeta] = useState<CorpusDocumentMeta | null | undefined>(undefined);
  const [pages, setPages] = useState<CorpusDocumentPage[] | null>(null);
  const [at, setAt] = useState(page);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMeta(undefined);
    setError(null);
    source
      .document(bundle ?? '', path, controller.signal)
      .then(setMeta)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [source, bundle, path]);

  useEffect(() => {
    if (meta === undefined || meta === null || !meta.hasText) return;
    const controller = new AbortController();
    setPages(null);
    source
      .documentPages(meta.documentId, at, controller.signal)
      .then(setPages)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [source, meta, at]);

  const chunkFrom = corpusChunkStart(at);
  const current = pages?.find((p) => p.page === at);

  return (
    <div className="cd">
      <div className="cd__head">
        <div className="cd__id">
          <h2 className="cd__title">{meta?.title ?? path.split('/').pop()}</h2>
          <p className="cd__meta">
            {meta === undefined
              ? 'Loading…'
              : meta === null
                ? 'This document has not been published.'
                : [
                    meta.surveyAcronym ?? meta.surveyGroup,
                    meta.year === null ? meta.cycle : String(meta.year),
                    `${formatInt(meta.pages)} pages`,
                    `${formatInt(meta.records)} variables extracted`,
                  ]
                    .filter((part) => part !== null && part !== undefined && part !== '')
                    .join(' · ')}
          </p>
          <p className="cd__path">{path}</p>
        </div>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="cd__notice">
        Reconstructed text, not the published PDF — rows are rebuilt from the document’s layout, so
        spacing and table alignment differ from the original. {CORPUS_ATTRIBUTION}
      </p>

      {error !== null && <div className="cs-error">{error}</div>}

      {meta === null && (
        <div className="cs-intro">
          <p>
            No published copy of this document. The record still cites it precisely — the path
            above locates it inside the delivery archive.
          </p>
        </div>
      )}

      {meta !== null && meta !== undefined && !meta.hasText && (
        <div className="cs-intro">
          <p>
            This document is recorded but its text was not published — most often an image-only
            scan, from which no text is recoverable.
          </p>
        </div>
      )}

      {meta !== null && meta !== undefined && meta.hasText && (
        <>
          <div className="cd__nav">
            <button
              type="button"
              className="btn btn--sm"
              disabled={at <= 1}
              onClick={() => setAt((n) => Math.max(1, n - 1))}
            >
              ← Page
            </button>
            <span className="cd__at">
              Page <strong>{at}</strong> of {formatInt(meta.pages)}
              {at !== page && (
                <button type="button" className="cs-link cd__back" onClick={() => setAt(page)}>
                  back to p. {page}
                </button>
              )}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              disabled={at >= meta.pages}
              onClick={() => setAt((n) => Math.min(meta.pages, n + 1))}
            >
              Page →
            </button>
          </div>

          {pages === null ? (
            <p className="hub__loading">Loading pages {chunkFrom}–{chunkFrom + 99}…</p>
          ) : current === undefined ? (
            <div className="cs-intro">
              <p>Page {at} is not in the published text.</p>
            </div>
          ) : (
            <pre className="cd__page">{current.text}</pre>
          )}
        </>
      )}
    </div>
  );
}
