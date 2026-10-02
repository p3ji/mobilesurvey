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

function extractSentence(passage: string, matchIndex: number, matchLength: number): string {
  // Find sentence start (period followed by space, or newline, or start of string)
  let start = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    if ((passage[i] === '.' || passage[i] === '!' || passage[i] === '?') && (passage[i + 1] === ' ' || passage[i + 1] === '\n')) {
      start = i + 2;
      break;
    }
    if (passage[i] === '\n') {
      start = i + 1;
      break;
    }
  }

  // Find sentence end
  let end = passage.length;
  for (let i = matchIndex + matchLength; i < passage.length; i++) {
    if ((passage[i] === '.' || passage[i] === '!' || passage[i] === '?') && (i + 1 === passage.length || passage[i + 1] === ' ' || passage[i + 1] === '\n')) {
      end = i + 1;
      break;
    }
    if (passage[i] === '\n') {
      end = i;
      break;
    }
  }

  return passage.slice(start, end).trim();
}

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
      if (
        quoteLower.includes('questions from') ||
        quoteLower.includes('items from') ||
        quoteLower.includes('adapted from') ||
        quoteLower.includes('scale of the') ||
        quoteLower.includes('items of the') ||
        quoteLower.includes('measured using questions from')
      ) {
        role = 'background_mention';
      } else if (quoteLower.includes('compared to') || quoteLower.includes('consistent with')) {
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
        // Look for 4-digit years between 1990 and 2030 in quote
        const yearMatches = [...quote.matchAll(/\b(199\d|20[0-3]\d)\b/g)];
        const candidateYears = yearMatches.map(m => m[1]).filter(Boolean) as string[];
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
