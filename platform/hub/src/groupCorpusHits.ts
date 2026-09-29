import type { CorpusMeta, SearchHit } from '@mobilesurvey/metadata-registry';

export interface CorpusHitGroup {
  question: string | null;
  hits: SearchHit[];
}

/** Group repeated variable columns for the same published question on the current result page. */
export function groupCorpusHits(hits: SearchHit[]): CorpusHitGroup[] {
  const groups: CorpusHitGroup[] = [];
  const byQuestion = new Map<string, CorpusHitGroup>();

  for (const hit of hits) {
    const meta = hit.entry.corpus as CorpusMeta | undefined;
    const question = (hit.entry.ddi.description as Record<string, string> | undefined)?.[
      meta?.lang === 'fr' ? 'fr' : 'en'
    ]?.trim();
    const normalized = question?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!meta || !normalized || normalized.length < 15) {
      groups.push({ question: null, hits: [hit] });
      continue;
    }

    const key = [meta.surveyGroup, meta.cycle ?? meta.year ?? '', meta.lang, normalized].join('\u001f');
    let group = byQuestion.get(key);
    if (!group) {
      group = { question: question ?? null, hits: [] };
      byQuestion.set(key, group);
      groups.push(group);
    }
    group.hits.push(hit);
  }

  return groups;
}
