import { isDataArtifactOrPackage, isStatisticsCanadaPublication } from './model.js';

interface ReviewedClaim {
  program: string;
  role: 'analyzed' | 'comparison' | 'background_mention';
  precision: 'exact_cycles' | 'range' | 'program_only';
  exactCycles: string[];
  cycleText: string;
  location: string;
  quote: string;
}

interface ReviewedWork {
  id: string;
  title: string;
  doi: string | null;
  url: string;
  year: number | null;
  workType: string | null;
  issuingOrganization?: string | null;
  sources: Array<{ source: string; url: string }>;
  claims: ReviewedClaim[];
  themes: Array<{ primary: string | null }>;
}

export interface PublicPilotWork {
  id: string;
  title: string;
  doi: string | null;
  url: string;
  year: number | null;
  workType: string | null;
  issuingOrganization: string | null;
  sources: string[];
  theme: string | null;
  uses: Array<{
    program: string;
    precision: ReviewedClaim['precision'];
    cycles: string[];
    cycleText: string;
    evidenceLocation: string;
  }>;
  mentions: Array<{ program: string; evidenceLocation: string }>;
}

/** A deliberately small, rights-safe browser snapshot of human-approved facts (2015+ cutoff). */
export function publicPreview(rows: object[], minYear: number = 2015): PublicPilotWork[] {
  return (rows as ReviewedWork[])
    .filter(work => !isStatisticsCanadaPublication(work) && !isDataArtifactOrPackage(work) && (work.year === null || work.year >= minYear))
    .map(work => {
      let normType = work.workType ?? 'article';
      if (normType === 'journal article' || normType === 'review' || normType === 'editorial' || normType === 'research summary') {
        normType = 'article';
      } else if (normType === 'conference-abstract') {
        normType = 'conference-paper';
      } else if (normType === 'other') {
        normType = 'preprint';
      }

      return {
        id: work.id,
        title: work.title,
        doi: work.doi,
        url: work.url,
        year: work.year,
        workType: normType,
        issuingOrganization: work.issuingOrganization ?? null,
        sources: [...new Set(work.sources.map(source => source.source))],
        theme: work.themes[0]?.primary ?? null,
        uses: work.claims.filter(claim => claim.role === 'analyzed' && !(
          claim.precision === 'program_only' && work.claims.some(other =>
            other.role === 'analyzed' && other.program === claim.program && other.precision !== 'program_only'
          )
        )).map(claim => ({
          program: claim.program,
          precision: claim.precision,
          cycles: claim.exactCycles,
          cycleText: claim.cycleText,
          evidenceLocation: claim.location,
        })),
        mentions: work.claims.filter(claim => claim.role === 'background_mention').map(claim => ({
          program: claim.program,
          evidenceLocation: claim.location,
        })),
      };
    }).filter(work => work.uses.length > 0);
}
