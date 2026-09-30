import type { CorpusLineageEdge } from '@mobilesurvey/metadata-registry';

/** Distinguishes an exact note citation from a published column mapped from note wording or deterministic rule. */
export function lineageEvidence(
  edge: Pick<CorpusLineageEdge, 'sourceVarName' | 'statcanNote' | 'reviewStatus'> & { derivationType?: string },
): 'named' | 'mapped' | 'provisional' | 'deterministic' {
  if (edge.derivationType === 'counterpart' || edge.derivationType === 'collapse') return 'deterministic';
  if (edge.reviewStatus === 'needs_review') return 'provisional';
  const citedNames = edge.statcanNote.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return citedNames.some((name) => name.toLocaleUpperCase() === edge.sourceVarName.toLocaleUpperCase())
    ? 'named'
    : 'mapped';
}
