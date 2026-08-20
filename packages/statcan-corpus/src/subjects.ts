/**
 * Statistics Canada's subject taxonomy, and the mapping of our surveys onto it
 * (docs/metadata-repo-plan.md, M5).
 *
 * ### The taxonomy is theirs; the assignment is ours
 *
 * {@link STATCAN_SUBJECTS} is captured verbatim from the subject facet on
 * `www150.statcan.gc.ca/n1/en/type/data`, so the vocabulary a reader filters by is the one
 * Statistics Canada publishes. Which of our 186 survey groups belongs to which subject is not
 * published in any form that could be fetched — the data portal's facet counts are not
 * subject-conditional, and the IMDB survey pages do not carry it — so the assignment is inference,
 * and it lives in a hand-editable file rather than in code. Same reason concept clustering is kept
 * apart from the occurrence records: it will sometimes be wrong, and being wrong should be
 * correctable by editing one line.
 *
 * ### Why the inference is not pre-filled as the answer
 *
 * Two attempts at deriving subjects from variable text were measurably wrong. Keyword presence
 * filed the Canadian *Health* Measures Survey under "Languages", because any large survey mentions
 * every subject's vocabulary somewhere. Lift over the corpus baseline fixed most of that and still
 * tagged CCHS "Transportation" and left CHMS with nothing at all — its variables are lab values
 * and physical measurements, so health *words* are rare in it.
 *
 * A survey's *name* is a better witness: "Canadian Community Health Survey" says Health outright.
 * So {@link subjectsFromName} is offered as a suggestion, the content-based guess is offered
 * beside it, and the column that counts starts empty. An untagged survey renders as unclassified,
 * which is true, rather than as a confident wrong answer.
 */

/** The 31 subjects, exactly as Statistics Canada lists them. */
export const STATCAN_SUBJECTS = [
  'Agriculture and food',
  'Business and consumer services and culture',
  'Business performance and ownership',
  'Children and youth',
  'Construction',
  'Crime and justice',
  'Digital economy and society',
  'Economic accounts',
  'Education, training and learning',
  'Energy',
  'Environment',
  'Families, households and marital status',
  'Government',
  'Health',
  'Housing',
  'Immigration and ethnocultural diversity',
  'Income, pensions, spending and wealth',
  'Indigenous peoples',
  'International trade',
  'Labour',
  'Languages',
  'Manufacturing',
  'Older adults and population aging',
  'Population and demography',
  'Prices and price indexes',
  'Retail and wholesale',
  'Science and technology',
  'Society and community',
  'Statistical methods',
  'Transportation',
  'Travel and tourism',
] as const;

export type StatCanSubject = (typeof STATCAN_SUBJECTS)[number];

const SUBJECT_SET = new Set<string>(STATCAN_SUBJECTS);

/** Is this one of Statistics Canada's subjects, spelled their way? */
export function isStatCanSubject(value: string): value is StatCanSubject {
  return SUBJECT_SET.has(value);
}

/**
 * Words in a survey *title* that identify its subject.
 *
 * Keyed on the title rather than the variable text because a title is a deliberate label. Its
 * variables mention transport, income and education too; its name does not. Precision over recall
 * — a title with no match yields nothing rather than a guess.
 */
const TITLE_HINTS: Array<[StatCanSubject, RegExp]> = [
  ['Health', /health|nutrition|mental|tobacco|smok|alcohol|cannabis|opioid|disabilit/i],
  ['Labour', /labour|labor|employment|workplace|apprentice|job vacanc/i],
  ['Education, training and learning', /education|school|student|postsecondary|graduat|learning|literacy|training/i],
  ['Income, pensions, spending and wealth', /income|pension|wealth|spending|expenditure|financial security|earnings/i],
  ['Housing', /housing|dwelling|shelter|mortgage/i],
  ['Indigenous peoples', /aboriginal|indigenous|inuit|metis|first nations/i],
  ['Immigration and ethnocultural diversity', /immigrant|immigration|ethnocultural|newcomer|diversity/i],
  ['Crime and justice', /crim|victim|justice|polic|court|correction/i],
  ['Children and youth', /child|youth|infant|early learning|daycare/i],
  ['Older adults and population aging', /ageing|aging|senior|older adult|retirement/i],
  ['Languages', /language|minority population/i],
  ['Families, households and marital status', /famil|household|marital|marriage/i],
  ['Transportation', /transport|vehicle|commut|aviation|trucking/i],
  ['Travel and tourism', /tourism|visitor|travel/i],
  ['Agriculture and food', /agricultur|farm|crop|livestock|food/i],
  ['Environment', /environment|climate|water|waste|greenhouse/i],
  ['Energy', /energy|electric|petroleum|natural gas|fuel/i],
  ['Science and technology', /science|research and development|innovation|technolog/i],
  ['Digital economy and society', /digital|internet|cyber|e-commerce/i],
  ['Construction', /construction|building permit/i],
  ['Manufacturing', /manufactur/i],
  ['Retail and wholesale', /retail|wholesale/i],
  ['International trade', /import|export|international trade/i],
  ['Prices and price indexes', /price index|consumer price/i],
  ['Economic accounts', /national accounts|gross domestic|economic accounts|input-output/i],
  ['Business performance and ownership', /business|enterprise|establishment|ownership/i],
  ['Government', /government|public sector|municipal/i],
  ['Society and community', /social|volunt|charitab|giving|community|well-being/i],
  ['Population and demography', /demograph|population|vital statistics|birth|death|migration/i],
];

/**
 * Subjects suggested by a survey title. May be empty, and may return more than one — Statistics
 * Canada files one program under several subjects, so a single answer would be the wrong shape.
 */
export function subjectsFromName(title: string): StatCanSubject[] {
  const out: StatCanSubject[] = [];
  for (const [subject, pattern] of TITLE_HINTS) {
    if (pattern.test(title) && !out.includes(subject)) out.push(subject);
  }
  return out;
}

/** One row of the hand-edited mapping. */
export interface SurveySubjectRow {
  surveyGroup: string;
  /** Subjects assigned by a person. Empty means unclassified, and is shown as unclassified. */
  subjects: StatCanSubject[];
}

/** Column index of the editable `subjects` cell in the TSV. */
const SUBJECTS_COLUMN = 5;

/**
 * Parse the tab-separated mapping file.
 *
 * Tolerant by design: it is edited by hand in a spreadsheet, so blank lines, stray whitespace and
 * a trailing newline are normal rather than errors. A subject that is not one of Statistics
 * Canada's is *reported* rather than dropped silently, because a typo there would create a facet
 * nobody can ever select and nothing else would notice.
 */
export function parseSurveySubjects(tsv: string): {
  rows: SurveySubjectRow[];
  unknownSubjects: string[];
} {
  const rows: SurveySubjectRow[] = [];
  const unknown = new Set<string>();
  for (const line of tsv.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const cells = line.split('\t');
    const surveyGroup = cells[0]?.trim();
    if (surveyGroup === undefined || surveyGroup === '' || surveyGroup === 'survey_group') continue;
    const raw = (cells[SUBJECTS_COLUMN] ?? '').trim();
    if (raw === '') continue;
    const subjects: StatCanSubject[] = [];
    for (const part of raw.split('|').map((p) => p.trim()).filter((p) => p !== '')) {
      if (isStatCanSubject(part)) {
        if (!subjects.includes(part)) subjects.push(part);
      } else {
        unknown.add(part);
      }
    }
    if (subjects.length > 0) rows.push({ surveyGroup, subjects });
  }
  return { rows, unknownSubjects: [...unknown].sort() };
}
