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

function isStatisticsCanadaPublication(work: ReviewedWork): boolean {
  const hostname = new URL(work.url).hostname.toLowerCase();
  return hostname === 'statcan.gc.ca' || hostname.endsWith('.statcan.gc.ca') ||
    /^(statistics canada|statistique canada)$/i.test(work.issuingOrganization?.trim() ?? '');
}

/** A deliberately small, rights-safe browser snapshot of human-approved facts. */
export function publicPreview(rows: object[]): PublicPilotWork[] {
  return (rows as ReviewedWork[]).filter(work => !isStatisticsCanadaPublication(work)).map(work => ({
    id: work.id,
    title: work.title,
    doi: work.doi,
    url: work.url,
    year: work.year,
    workType: work.workType,
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
  })).filter(work => work.uses.length > 0);
}
