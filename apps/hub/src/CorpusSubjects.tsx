/**
 * The subject facet, as a sidebar (docs/metadata-repo-plan.md, M5).
 *
 * Modelled on Statistics Canada's own "Filter results by" rail, because a reader who arrives from
 * their site should find the same vocabulary in the same shape — the 31 subject names are theirs,
 * captured from their facet, not paraphrased.
 *
 * ### Two things it says out loud
 *
 * **Counts are variables, not surveys.** "Health (37,852)" tells a reader how far the filter
 * narrows things; "Health (22 surveys)" does not.
 *
 * **It states what it cannot reach.** 30% of the corpus sits in surveys with no subject assigned,
 * and a facet list that omitted them silently would read as a complete index of the corpus. The
 * footer names the shortfall, and the counts distinguish an assignment a person confirmed from one
 * derived from the survey's title — because those are different kinds of claim.
 */
import { useEffect, useState } from 'react';
import type { CorpusSubjectFacet, CorpusUnclassified, SupabaseCorpusSource } from '@mobilesurvey/metadata-registry';

const formatInt = (n: number): string => n.toLocaleString('en-CA');

/** Subjects shown before the list collapses, matching the length of StatCan's own rail. */
const SHOWN = 8;

export interface CorpusSubjectsProps {
  source: SupabaseCorpusSource;
  selected: string | null;
  onSelect: (subject: string | null) => void;
}

export function CorpusSubjects({ source, selected, onSelect }: CorpusSubjectsProps) {
  const [facets, setFacets] = useState<CorpusSubjectFacet[] | null>(null);
  const [gap, setGap] = useState<CorpusUnclassified | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    // The two calls are separate rather than a Promise.all: the facet list is the feature and the
    // shortfall note is commentary on it, so a slow or failing `unclassified` must not take the
    // whole rail down with it.
    source
      .subjects(controller.signal)
      .then(setFacets)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Reported, not swallowed. The first version set an empty list here, which renders as no
        // rail at all — indistinguishable from "this corpus has no subjects".
        setError(err instanceof Error ? err.message : String(err));
        setFacets([]);
      });
    source
      .unclassified(controller.signal)
      .then(setGap)
      .catch(() => {
        /* commentary only; the rail is still worth showing without it */
      });
    return () => controller.abort();
  }, [source]);

  if (facets === null) return <aside className="cf" aria-busy="true" />;
  if (error !== null) {
    return (
      <aside className="cf">
        <h2 className="cf__head">Filter results by</h2>
        <p className="cf__gap">Subjects unavailable — {error}</p>
      </aside>
    );
  }
  if (facets.length === 0) return null;

  const shown = expanded ? facets : facets.slice(0, SHOWN);
  const anyConfirmed = facets.some((f) => f.confirmed > 0);

  return (
    <aside className="cf" aria-label="Filter results by subject">
      <h2 className="cf__head">Filter results by</h2>
      <h3 className="cf__group">Subject</h3>

      <ul className="cf__list">
        <li>
          <button
            type="button"
            className={`cf__item${selected === null ? ' cf__item--on' : ''}`}
            onClick={() => onSelect(null)}
          >
            All subjects
          </button>
        </li>
        {shown.map((f) => (
          <li key={f.subject}>
            <button
              type="button"
              className={`cf__item${selected === f.subject ? ' cf__item--on' : ''}`}
              onClick={() => onSelect(selected === f.subject ? null : f.subject)}
              title={
                f.confirmed > 0
                  ? `${f.confirmed} of ${f.surveys} surveys confirmed by hand`
                  : 'Assigned from the survey title; not yet confirmed'
              }
            >
              {f.subject} <span className="cf__n">({formatInt(f.variables)})</span>
              {f.confirmed === 0 && <span className="cf__prov" aria-label="suggested">·</span>}
            </button>
          </li>
        ))}
      </ul>

      {facets.length > SHOWN && (
        <button type="button" className="cf__more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Less' : `More (${facets.length - SHOWN})`}
        </button>
      )}

      {gap !== null && gap.variables > 0 && (
        <p className="cf__gap">
          {formatInt(gap.variables)} variables ({Math.round((100 * gap.variables) / gap.totalVariables)}%)
          are in {formatInt(gap.surveys)} surveys with no subject assigned, and this filter cannot
          reach them.
          {!anyConfirmed && ' Subjects so far are derived from survey titles, not yet reviewed.'}
        </p>
      )}
    </aside>
  );
}
