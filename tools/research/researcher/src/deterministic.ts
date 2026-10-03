import {
  THEMES,
  validateExtraction,
  isCanadianGrounded,
  hasForeignDisqualifier,
  type Extraction,
  type Claim,
  type SourceWork,
} from './model.js';

const SURVEY_CONTEXT_PATTERN = /\b(?:survey|surveys|data|microdata|sample|respondents?|cycles?|waves?|panel|longitudinal|cross-sectional|coefficients?|regression|estimates?|weighted|variables?|tabulations?|pumf|rdc|cohort|questionnaire|enquête|enquêtes|données|échantillons?|vagues?|statistiques?|pondération|cohorte)\b/iu;

const THEME_KEYWORDS: Record<string, string[]> = {
  health: [
    'health', 'medical', 'disease', 'patient', 'disability', 'mortality', 'nutrition',
    'vitamin', 'diet', 'chronic', 'pain', 'drinking', 'alcohol', 'cancer', 'clinical',
    'bmi', 'hypertension', 'arthritis', 'nurse', 'cardio', 'sleep', 'psychological',
    'distress', 'depression', 'mental health', 'vaccine', 'vaccination', 'covid',
  ],
  'digital society': [
    'internet', 'digital', 'broadband', 'online', 'website', 'technology', 'social networking',
    'e-mental', 'ehealth', 'ai', 'artificial intelligence', 'misinformation', 'bot', 'cyber',
    'media', 'screen time', 'device', 'e-commerce',
  ],
  labour: [
    'labour', 'labor', 'worker', 'employment', 'wage', 'job', 'workplace', 'occupation',
    'pharmacist', 'productivity', 'unemployment', 'career', 'profession', 'salary',
  ],
  'income and inequality': [
    'income', 'poverty', 'wealth', 'inequality', 'socioeconomic', 'low-income', 'earnings',
    'economic status', 'deprivation',
  ],
  education: [
    'education', 'school', 'student', 'youth', 'literacy', 'university', 'college',
    'academic', 'training', 'ell', 'learning',
  ],
  immigration: [
    'immigrant', 'immigration', 'newcomer', 'refugee', 'migration', 'ethnic', 'cultural',
    'foreign-born', 'racialized',
  ],
  families: [
    'family', 'parent', 'child', 'children', 'maternal', 'paternal', 'household',
    'marriage', 'divorce', 'caregiver', 'infant',
  ],
  housing: [
    'housing', 'shelter', 'rent', 'homeless', 'homeowner', 'residential', 'tenant',
  ],
  environment: [
    'environment', 'climate', 'pollution', 'air quality', 'particulate', 'water',
    'contaminant', 'exposure', 'toxic', 'arsenic', 'lead',
  ],
  'Indigenous peoples': [
    'indigenous', 'first nations', 'métis', 'metis', 'inuit', 'aboriginal',
  ],
  aging: [
    'older adult', 'seniors', 'elderly', 'aging', 'ageing', 'dementia', 'retirement',
    'geriatric', 'long-term care',
  ],
  'crime and justice': [
    'crime', 'police', 'victimization', 'justice', 'violence', 'assault', 'harassment',
    'safety', 'court', 'offense',
  ],
};

function isSentenceBoundary(passage: string, index: number): boolean {
  const char = passage[index];
  if (char !== '.' && char !== '!' && char !== '?') return false;

  // Decimal numbers like 3.14 or DOIs like 10.55016
  if (index > 0 && /\d/.test(passage[index - 1]!) && index + 1 < passage.length && /\d/.test(passage[index + 1]!)) {
    return false;
  }

  // Common abbreviation checks
  const preceding = passage.slice(Math.max(0, index - 8), index + 1).toLowerCase();
  if (preceding.endsWith('et al.') || preceding.endsWith('e.g.') || preceding.endsWith('i.e.') || preceding.endsWith('vs.')) {
    return false;
  }
  if (preceding.endsWith('dr.') || preceding.endsWith('mr.') || preceding.endsWith('ms.') || preceding.endsWith('mrs.') || preceding.endsWith('prof.')) {
    return false;
  }
  if (preceding.endsWith('vol.') || preceding.endsWith('no.') || preceding.endsWith('pp.') || preceding.endsWith('p.')) {
    return false;
  }

  // Acronyms or single letter initials: e.g. U.S. or J. Smith
  if (index > 0 && /[A-Z]/.test(passage[index - 1]!)) {
    if (index + 2 < passage.length && /[A-Z]/.test(passage[index + 1]!) && passage[index + 2] === '.') {
      return false;
    }
    if (index >= 2 && passage[index - 2] === '.' && /[A-Z]/.test(passage[index - 1]!)) {
      return false;
    }
  }

  // Look ahead past closing quotation marks or brackets: e.g. .", .), .)
  let k = index + 1;
  while (k < passage.length && ['"', "'", ')', ']', '”', '’'].includes(passage[k]!)) {
    k++;
  }

  // Valid boundary if at end of string, followed by whitespace, or followed by uppercase letter
  if (k >= passage.length || /\s/.test(passage[k]!) || /[A-Z]/.test(passage[k]!)) {
    return true;
  }

  return false;
}

function extractSentence(passage: string, matchIndex: number, matchLength: number): string {
  let start = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    if (passage[i] === '\n') {
      start = i + 1;
      break;
    }
    if (isSentenceBoundary(passage, i)) {
      let k = i + 1;
      while (k < passage.length && ['"', "'", ')', ']', '”', '’'].includes(passage[k]!)) {
        k++;
      }
      while (k < passage.length && /\s/.test(passage[k]!)) {
        k++;
      }
      start = k;
      break;
    }
  }

  let end = passage.length;
  for (let i = matchIndex + matchLength; i < passage.length; i++) {
    if (passage[i] === '\n') {
      end = i;
      break;
    }
    if (isSentenceBoundary(passage, i)) {
      let k = i + 1;
      while (k < passage.length && ['"', "'", ')', ']', '”', '’'].includes(passage[k]!)) {
        k++;
      }
      end = k;
      break;
    }
  }

  return passage.slice(start, end).trim();
}

const BACKGROUND_MENTION_PATTERNS: RegExp[] = [
  // Survey is the subject of a reporting/finding verb
  /\b(?:the\s+)?(?:[\w\s\x27-]{0,40})?(?:survey|microdata|rdc|pumf|statcan|statistics\s+canada|statistique\s+canada|cchs|chms|cius|cis|csd|gss|lfs|shs|ecui|escc|ecms|esg|epa|ecr)\s+(?:reveals?|revealed|shows?|showed|reported?|indicates?|indicated|found|finds|estimated?|estimates|demonstrates?|demonstrated|suggests?|suggested)\s+that\b/i,
  // External attribution phrases
  /\b(?:according\s+to|d\x27après|selon)\s+(?:the\s+|les?\s+|l\x27)?(?:[\w\s\x27-]{0,30})?(?:survey|enquête|statcan|statistics\s+canada|statistique\s+canada|[A-Z]{3,5})\b/i,
  // Question or module adaptation
  /\b(?:questions?|items?|scales?|modules?|subscales?)\s+(?:from|of|adapted\s+from|in)\s+the\b/i,
  /\b(?:adapted|drawn|measured)\s+(?:from|using\s+questions?\s+from)\s+the\b/i,
  // Introduction examples or non-publication
  /\b(?:e\.g\.|for\s+example|such\s+as)\s*,?\s*(?:the\s+)?(?:[\w\s\x27-]{0,20})?(?:survey|enquête|[A-Z]{3,5})\b/i,
  /\bhave\s+not\s+(?:yet\s+)?published\s+data\b/i,
  /\b(?:as\s+reported|as\s+noted|as\s+documented|as\s+estimated)\s+by\b/i,
  /\b(?:see|cf\.)\s+(?:also\s+)?(?:statistics\s+canada|statistique\s+canada|statcan)\b/i,
  /\b(?:cited|referenced)\s+in\b/i,
];

const ACTIVE_ANALYSIS_PATTERNS: RegExp[] = [
  /\b(?:we|i|our\s+study|this\s+study|this\s+paper|this\s+article|this\s+report|this\s+dissertation|the\s+present\s+study|the\s+present\s+paper|our\s+analysis|our\s+research)\s+(?:analyz|analys|examin|investigat|us|utiliz|utilis|model|estimat|evaluat|explor|draw|drew|rel|assess|employ|construct|perform|show|find)/i,
  /\b(?:were|was|are|is)\s+(?:obtained|drawn|derived|taken|collected|extracted)\s+from\b/i,
  /\b(?:data|samples?)\s+(?:were|was|are|is)\s+(?:combined|merged|pooled|used|analyzed|analysed)\b/i,
  /\b(?:sample|cohort)\s+(?:was|is|were)\s+drawn\s+from\b/i,
  /\b(?:utilizing|using)\s+(?:data|microdata|variables?|information|a\s+sample)\b/i,
  /\busing\s+(?:the\s+)?(?:[\d]{4}|cycle\s+\d+|annual\s+component|pumf|rdc)?\s*(?:canadian|statcan|statistics\s+canada|[A-Z]{3,5})/i,
  /\b(?:pumf|rdc|research\s+data\s+centre|centre\s+de\s+donn[ée]es\s+de\s+recherche|custom\s+tabulations?|tabulations?\s+sp[ée]ciales?)\b/i,
  /\b(?:regression\s+analysis\s+of\s+data\s+from|logistic\s+regression|proportional\s+hazards|econometric\s+model|ols\s+regression)\b/i,
  /\b(?:linked\s+respondents\s+of\s+the|cohort\s+that\s+linked|were\s+linked\s+to)\b/i,
  /\b(?:relies\s+on\s+the|makes?\s+use\s+of|based\s+on\s+data\s+from|draws?\s+(?:up)?on\s+data\s+from|exploiting)\b/i,
  /\b(?:utilisons|analysons|examinons|cette\s+[ée]tude\s+(?:utilise|analyse|examine)|les\s+donn[ée]es\s+proviennent|analyse\s+les\s+donn[ée]es)\b/i,
];

export function extractDeterministic(
  source: SourceWork,
  passage: string
): { value: Extraction; issues: string[] } {
  const claims: Claim[] = [];
  const passageLower = passage.toLowerCase();

  for (const candidate of source.surveyCandidates) {
    // Find aliases sorted by longest first to avoid substring confusion
    const sortedAliases = [...candidate.aliases].sort((a, b) => b.length - a.length);

    for (const alias of sortedAliases) {
      // Whole-word boundary search using Unicode property escapes
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isShortAcronym = alias.length <= 4 && alias === alias.toUpperCase();
      const flags = isShortAcronym ? 'u' : 'iu';
      const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})([^\\p{L}\\p{N}_]|$)`, flags);
      const match = regex.exec(passage);
      if (!match) continue;

      const prefix = match[1] ?? '';
      const matchedAlias = match[2];
      if (!matchedAlias) continue;
      const matchIndex = match.index + prefix.length;
      const quote = extractSentence(passage, matchIndex, matchedAlias.length);
      const quoteLower = quote.toLowerCase();

      // For short acronyms, require survey/data context words in the quote
      if (isShortAcronym && !SURVEY_CONTEXT_PATTERN.test(quote)) {
        continue;
      }

      // Check Canadian grounding and foreign disqualifiers for generic aliases
      const isExplicitlyCanadian = /canad|statcan|statistics\s+canada|statistique\s+canada/iu.test(alias);
      if (!isExplicitlyCanadian) {
        const fullGroundingText = `${source.title ?? ''} ${passage} ${quote}`;
        if (!isCanadianGrounded(fullGroundingText)) {
          continue;
        }
        if (hasForeignDisqualifier(quote) && !isCanadianGrounded(quote)) {
          continue;
        }
        if (hasForeignDisqualifier(source.title ?? '') && !isCanadianGrounded(source.title ?? '')) {
          continue;
        }
      }

      // Determine role
      let role: Claim['role'] = 'analyzed';
      const isMention = BACKGROUND_MENTION_PATTERNS.some(p => p.test(quote));
      const titleHasSurvey = source.title ? candidate.aliases.some(a => source.title.toLowerCase().includes(a.toLowerCase())) : false;
      const isActive = ACTIVE_ANALYSIS_PATTERNS.some(p => p.test(quote)) || (titleHasSurvey && ACTIVE_ANALYSIS_PATTERNS.some(p => p.test(source.title ?? '')));

      if (isMention && !isActive) {
        role = 'background_mention';
      } else if (
        /\b(?:our\s+(?:findings|results|sample|cohort|data)|we\s+found)\b/i.test(quote) &&
        (quoteLower.includes('compared to') || quoteLower.includes('consistent with'))
      ) {
        role = 'comparison';
      }

      // Determine precision and cycles
      let precision: Claim['precision'] = 'program_only';
      let cycleText = '';
      const exactCycles: string[] = [];

      // Check for range patterns: e.g. "cycle 1 to 4", "2015-2018", "2017 to 2018"
      const rangeMatch = quote.match(/\b(cycle\s+\d+\s+to\s+\d+|cycle\s+\d+-\d+|20\d\d\s*(?:to|-)\s*20\d\d)\b/i);
      if (rangeMatch) {
        precision = 'range';
        cycleText = rangeMatch[0];
      } else {
        // Strip parenthetical author citations: e.g. (Statistics Canada, 2013) or (Gür et al., 2015)
        const strippedQuote = quote.replace(
          /\((?:(?:[A-Za-z\s,&.-]+)?(?:Statistics\s+Canada|Statistique\s+Canada|StatCan|[A-Z][a-z]+(?:\s+et\s+al\.?)?))(?:\s*[,&]\s*[A-Za-z\s.-]+)*,\s*(?:199\d|20[0-3]\d)[^)]*?\)/gi,
          ''
        );

        // Associated cycle patterns near the survey or cycle markers
        const cyclePatterns = [
          new RegExp(`\\b(199\\d|20[0-3]\\d)(?:\\s*,\\s*(199\\d|20[0-3]\\d))*(?:\\s+and\\s+(199\\d|20[0-3]\\d))?\\s+(?:cycles?\\s+(?:of|from|in)\\s+)?(?:the\\s+)?(?:[A-Z]{2,6}\\s*(?:\\([^)]*?\\))?\\s*)?(?:${escaped})\\b`, 'i'),
          new RegExp(`\\b(?:${escaped})\\s*(?:\\([^)]*?\\))?\\s*(?:in\\s+|from\\s+|cycles?\\s+(?:of\\s+)?|\\()?\\s*(199\\d|20[0-3]\\d)(?:\\s*,\\s*(199\\d|20[0-3]\\d))*(?:\\s+and\\s+(199\\d|20[0-3]\\d))?\\b`, 'i'),
          /\b(199\d|20[0-3]\d)(?:\s*(?:,|and)\s*(199\d|20[0-3]\d))*\s+cycles?\b/i,
          /\bcycles?\s+(?:of|from|in)\s+(199\d|20[0-3]\d)(?:\s*(?:,|and)\s*(199\d|20[0-3]\d))*/i,
          /\b(?:cycle|cycle\s+de|wave|vague)\s+\d+(?:\.\d+)?\s*(?:\((199\d|20[0-3]\d)\))?/i,
          /\b(?:conducted|collected|fielded|administered)\s+in\s+(199\d|20[0-3]\d)\b/i,
          /\bfrom\s+the\s+(199\d|20[0-3]\d)\s+(?:survey|microdata|sample|data|cycle)\b/i,
          /\b(199\d|20[0-3]\d)\s+annual\s+component\b/i,
        ];

        const matchedYears = new Set<string>();
        for (const pattern of cyclePatterns) {
          const m = pattern.exec(strippedQuote);
          if (m) {
            const yearsInMatch = [...m[0].matchAll(/\b(199\d|20[0-3]\d)\b/g)].map(y => y[1]);
            for (const y of yearsInMatch) {
              if (y) matchedYears.add(y);
            }
          }
        }

        const validCyclesSet = candidate.validCycles && candidate.validCycles.length > 0
          ? new Set(candidate.validCycles)
          : null;

        const candidateYears = [...matchedYears]
          .filter(y => !validCyclesSet || validCyclesSet.has(y))
          .sort();

        if (candidateYears.length > 0) {
          precision = 'exact_cycles';
          exactCycles.push(...candidateYears);
          cycleText = candidateYears.join(', ');
        }
      }

      claims.push({
        surveyText: matchedAlias,
        program: candidate.program,
        role,
        cycleText,
        precision,
        exactCycles,
        quote,
        location: source.passageLocation,
      });

      break; // Found best matching alias for this program
    }
  }

  // Deduplicate claims by program
  const uniqueClaims: Claim[] = [];
  const seenPrograms = new Set<string>();
  for (const c of claims) {
    if (!seenPrograms.has(c.program)) {
      seenPrograms.add(c.program);
      uniqueClaims.push(c);
    }
  }

  // Theme scoring
  const scores = new Map<string, number>();
  for (const [theme, kws] of Object.entries(THEME_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      if (passageLower.includes(kw)) score++;
    }
    if (score > 0) scores.set(theme, score);
  }

  const sortedThemes = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0])
    .filter(t => (THEMES as readonly string[]).includes(t));

  const primaryTheme = sortedThemes[0] ?? 'other';
  const additionalThemes = sortedThemes.slice(1, 4);
  const themeRationale = `Extracted from terms matching ${primaryTheme}${additionalThemes.length ? ` and ${additionalThemes.join(', ')}` : ''}`;

  const extraction: Extraction = {
    claims: uniqueClaims,
    primaryTheme,
    additionalThemes,
    themeRationale,
    variables: [],
  };

  return validateExtraction(extraction, passage, source.surveyCandidates, source.title);
}
