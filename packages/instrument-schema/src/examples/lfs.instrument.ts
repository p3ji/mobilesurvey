/**
 * Bilingual (EN/FR) household & labour force survey — the designer's default document.
 *
 * Covers demographics, labour force status, and conditional sections for employed,
 * unemployed, and not-in-labour-force respondents. Uses pages, skip logic via
 * `visibleWhen`, a markAll question, hard/soft edits, piping, and a derived variable.
 *
 * Kept under the "Household & Employment Survey" title to avoid any official association.
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const lfsInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:household-lfs:2.0',
  version: '2.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Household & Employment Survey', "Enquête sur le ménage et l'emploi"),
    agency: 'Example Org',
    description: s(
      'Demonstration instrument covering household demographics and labour force activity.',
      "Instrument de démonstration sur la démographie des ménages et l'activité de la population active.",
    ),
    created: '2026-06-24T00:00:00.000Z',
  },

  concepts: [
    { id: 'c.demo',       label: s('Demographics',            'Démographie') },
    { id: 'c.employment', label: s('Employment',              'Emploi') },
    { id: 'c.lfActivity', label: s('Labour force activity',   'Activité de la population active') },
  ],

  universes: [
    {
      id: 'u.adults',
      label: s('Usual residents aged 15 and over', 'Résidents habituels âgés de 15 ans et plus'),
      clause: '$age >= 15',
    },
  ],

  categorySchemes: [
    {
      id: 'cs.sex',
      label: s('Sex', 'Sexe'),
      categories: [
        { code: 'M', label: s('Male',             'Masculin') },
        { code: 'F', label: s('Female',           'Féminin') },
        { code: 'X', label: s('Gender diverse',   'Genre non-binaire') },
        { code: '9', label: s('Prefer not to answer', 'Je préfère ne pas répondre') },
      ],
    },
    {
      id: 'cs.marStat',
      label: s('Marital status', 'État civil'),
      categories: [
        { code: '1', label: s('Never married',          'Célibataire') },
        { code: '2', label: s('Married or common-law',  'Marié(e) ou conjoint(e) de fait') },
        { code: '3', label: s('Separated',              'Séparé(e)') },
        { code: '4', label: s('Divorced',               'Divorcé(e)') },
        { code: '5', label: s('Widowed',                'Veuf / veuve') },
      ],
    },
    {
      id: 'cs.lfStatus',
      label: s('Labour force status', "Statut d'activité"),
      categories: [
        { code: 'emp',   label: s('Employed — worked last week',             'Employé(e) — a travaillé la semaine dernière') },
        { code: 'abs',   label: s('Employed — absent from job last week',    'Employé(e) — absent(e) du travail la semaine dernière') },
        { code: 'unemp', label: s('Unemployed — looking for work',           'En chômage — cherche un emploi') },
        { code: 'nilf',  label: s('Not in the labour force',                 'Inactif / inactive') },
      ],
    },
    {
      id: 'cs.empType',
      label: s("Type of employment", "Type d'emploi"),
      categories: [
        { code: 'privEmp', label: s('Private sector employee',         'Salarié(e) du secteur privé') },
        { code: 'pubEmp',  label: s('Public sector employee',          'Salarié(e) du secteur public') },
        { code: 'seInc',   label: s('Self-employed — incorporated',    'Travailleur autonome — constitué en société') },
        { code: 'seUni',   label: s('Self-employed — unincorporated',  'Travailleur autonome — non constitué en société') },
      ],
    },
    {
      id: 'cs.ftPt',
      label: s('Full-time / Part-time', 'Plein temps / Temps partiel'),
      categories: [
        { code: 'ft', label: s('Full-time (30 or more hours per week)', 'Plein temps (30 heures ou plus par semaine)') },
        { code: 'pt', label: s('Part-time (fewer than 30 hours per week)', 'Temps partiel (moins de 30 heures par semaine)') },
      ],
    },
    {
      id: 'cs.industry',
      label: s('Industry', 'Industrie'),
      categories: [
        { code: '11', label: s('Agriculture, forestry, fishing and hunting',                          'Agriculture, foresterie, pêche et chasse') },
        { code: '23', label: s('Construction',                                                         'Construction') },
        { code: '31', label: s('Manufacturing',                                                        'Fabrication') },
        { code: '44', label: s('Retail trade',                                                         'Commerce de détail') },
        { code: '48', label: s('Transportation and warehousing',                                       'Transport et entreposage') },
        { code: '51', label: s('Information and cultural industries',                                  "Industries de l'information et industrie culturelle") },
        { code: '52', label: s('Finance and insurance',                                                'Finance et assurances') },
        { code: '54', label: s('Professional, scientific and technical services',                      'Services professionnels, scientifiques et techniques') },
        { code: '61', label: s('Educational services',                                                 "Services d'enseignement") },
        { code: '62', label: s('Health care and social assistance',                                    'Soins de santé et assistance sociale') },
        { code: '91', label: s('Public administration',                                                'Administration publique') },
        { code: '99', label: s('Other services',                                                       'Autres services') },
      ],
    },
    {
      id: 'cs.absReason',
      label: s('Reason for absence', "Raison de l'absence"),
      categories: [
        { code: 'vac',   label: s('Vacation or holiday',                               'Vacances ou congé') },
        { code: 'ill',   label: s('Own illness, injury or disability',                 'Maladie, blessure ou invalidité personnelle') },
        { code: 'fam',   label: s('Family or personal responsibilities',               'Responsabilités familiales ou personnelles') },
        { code: 'leave', label: s('Maternity, paternity or parental leave',            'Congé de maternité, de paternité ou parental') },
        { code: 'wkdsr', label: s('Work disruption (e.g. strike or lockout)',          'Perturbation du travail (p.ex. grève ou lock-out)') },
        { code: 'oth',   label: s('Other reason',                                      'Autre raison') },
      ],
    },
    {
      id: 'cs.nilfReason',
      label: s('Reason for not looking for work', "Raison de ne pas chercher d'emploi"),
      categories: [
        { code: 'stu',  label: s('Going to school',                             'Aux études') },
        { code: 'ret',  label: s('Retired',                                     'À la retraite') },
        { code: 'ill',  label: s('Own illness or disability (long-term)',       'Maladie ou invalidité personnelle (à long terme)') },
        { code: 'fam',  label: s('Caring for children or family',               'Soins aux enfants ou à la famille') },
        { code: 'disc', label: s("Discouraged — believes no work available",    "Découragement — croit qu'il n'y a pas d'emploi disponible") },
        { code: 'oth',  label: s('Other reason',                                'Autre raison') },
      ],
    },
    {
      id: 'cs.searchMethods',
      label: s('Job search methods', "Méthodes de recherche d'emploi"),
      categories: [
        { code: 'net',    label: s('Internet job sites or company websites',            "Sites d'emploi ou sites Web d'entreprises") },
        { code: 'cntEmp', label: s('Contacted employers directly',                      'Communiqué directement avec des employeurs') },
        { code: 'agcy',   label: s('Used a public or private employment agency',        'Utilisé un bureau de placement public ou privé') },
        { code: 'netw',   label: s('Asked friends, relatives or professional contacts', 'Demandé à des amis, parents ou contacts professionnels') },
        { code: 'ads',    label: s('Responded to job advertisements',                   "Répondu à des offres d'emploi") },
        { code: 'oth',    label: s('Other methods',                                     'Autres méthodes') },
      ],
    },
  ],

  variables: [
    // Hidden / pre-filled
    {
      id: 'v.respondentName',
      name: 'respondentName',
      kind: 'hidden',
      label: s('Respondent name', 'Nom du répondant'),
      representation: 'text',
    },
    // ── Demographics ──────────────────────────────────────────────
    {
      id: 'v.age',
      name: 'age',
      kind: 'collected',
      label: s('Age', 'Âge'),
      representation: 'numeric',
      conceptRef: 'c.demo',
    },
    {
      id: 'v.sex',
      name: 'sex',
      kind: 'collected',
      label: s('Sex', 'Sexe'),
      representation: 'code',
      categorySchemeRef: 'cs.sex',
      conceptRef: 'c.demo',
    },
    {
      id: 'v.marStat',
      name: 'marStat',
      kind: 'collected',
      label: s('Marital status', 'État civil'),
      representation: 'code',
      categorySchemeRef: 'cs.marStat',
      conceptRef: 'c.demo',
    },
    // ── Labour force ──────────────────────────────────────────────
    {
      id: 'v.lfStatus',
      name: 'lfStatus',
      kind: 'collected',
      label: s('Labour force status', "Statut d'activité"),
      representation: 'code',
      categorySchemeRef: 'cs.lfStatus',
      conceptRef: 'c.lfActivity',
    },
    // ── Employment ────────────────────────────────────────────────
    {
      id: 'v.empType',
      name: 'empType',
      kind: 'collected',
      label: s("Type of employment", "Type d'emploi"),
      representation: 'code',
      categorySchemeRef: 'cs.empType',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.jobTitle',
      name: 'jobTitle',
      kind: 'collected',
      label: s("Job title / occupation", "Titre d'emploi / profession"),
      representation: 'text',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.industry',
      name: 'industry',
      kind: 'collected',
      label: s('Industry', 'Industrie'),
      representation: 'code',
      categorySchemeRef: 'cs.industry',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.ftPt',
      name: 'ftPt',
      kind: 'collected',
      label: s('Full-time or part-time', 'Plein temps ou temps partiel'),
      representation: 'code',
      categorySchemeRef: 'cs.ftPt',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.hoursUsual',
      name: 'hoursUsual',
      kind: 'collected',
      label: s('Usual hours worked per week at all jobs', 'Heures habituelles travaillées par semaine à tous les emplois'),
      representation: 'numeric',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.hoursActual',
      name: 'hoursActual',
      kind: 'collected',
      label: s('Actual hours worked last week at all jobs', 'Heures réelles travaillées la semaine dernière à tous les emplois'),
      representation: 'numeric',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.absReason',
      name: 'absReason',
      kind: 'collected',
      label: s('Main reason for absence from work', 'Principale raison de l\'absence au travail'),
      representation: 'code',
      categorySchemeRef: 'cs.absReason',
      conceptRef: 'c.employment',
    },
    // ── Unemployment ─────────────────────────────────────────────
    {
      id: 'v.weeksLooking',
      name: 'weeksLooking',
      kind: 'collected',
      label: s("Number of weeks looking for work", "Nombre de semaines de recherche d'emploi"),
      representation: 'numeric',
      conceptRef: 'c.lfActivity',
    },
    {
      id: 'v.searchMethods',
      name: 'searchMethods',
      kind: 'collected',
      label: s("Job search methods used (mark all)", "Méthodes de recherche utilisées (cocher tout ce qui s'applique)"),
      representation: 'code',
      categorySchemeRef: 'cs.searchMethods',
      conceptRef: 'c.lfActivity',
    },
    // ── Not in labour force ────────────────────────────────────────
    {
      id: 'v.nilfReason',
      name: 'nilfReason',
      kind: 'collected',
      label: s('Main reason for not looking for work', "Principale raison de ne pas chercher d'emploi"),
      representation: 'code',
      categorySchemeRef: 'cs.nilfReason',
      conceptRef: 'c.lfActivity',
    },
    // ── Derived ───────────────────────────────────────────────────
    {
      id: 'v.isEmployed',
      name: 'isEmployed',
      kind: 'derived',
      label: s('Is employed (derived)', 'Est employé(e) (dérivé)'),
      representation: 'boolean',
      conceptRef: 'c.lfActivity',
      compute: '$lfStatus == "emp" || $lfStatus == "abs"',
    },
  ],

  prefillMappings: [
    { sampleField: 'contact_name', targetVariable: 'respondentName' },
  ],

  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [

      // ═══════════════════════════════════════════════════════════════
      // PAGE 1 — Respondent information (demographics)
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.demo',
        label: s('Respondent Information', 'Renseignements sur le répondant'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.intro',
            text: s(
              'Hello ${respondentName}. This survey collects information about labour market activities. All responses are kept strictly confidential.',
              "Bonjour ${respondentName}. Ce questionnaire recueille des renseignements sur les activités du marché du travail. Toutes les réponses sont gardées strictement confidentielles.",
            ),
          },
          {
            type: 'question',
            id: 'q.age',
            variableRef: 'age',
            text: s('What is your age?', 'Quel est votre âge ?'),
            responseDomain: { type: 'numeric', min: 15, max: 105, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.age.min',
                type: 'hard',
                when: '$age < 15',
                message: s(
                  'This survey is for persons aged 15 and over.',
                  'Ce questionnaire est destiné aux personnes de 15 ans et plus.',
                ),
                scope: ['age'],
              },
              {
                id: 'edit.age.high',
                type: 'soft',
                when: '$age > 99',
                message: s('Age over 99 — please confirm.', 'Âge supérieur à 99 — veuillez confirmer.'),
                scope: ['age'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.sex',
            variableRef: 'sex',
            text: s('What is your sex?', 'Quel est votre sexe ?'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.sex', selection: 'single' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.marStat',
            variableRef: 'marStat',
            text: s('What is your marital status?', 'Quel est votre état civil ?'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.marStat', selection: 'single' },
            required: true,
          },
        ],
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 2 — Labour force status
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.lfStatus',
        label: s('Work Activity', 'Activité professionnelle'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.lfIntro',
            text: s(
              'The following questions are about your work activities during the last week (Sunday to Saturday).',
              'Les questions suivantes portent sur vos activités professionnelles au cours de la dernière semaine (du dimanche au samedi).',
            ),
          },
          {
            type: 'question',
            id: 'q.lfStatus',
            variableRef: 'lfStatus',
            text: s(
              'Which of the following best describes your situation last week?',
              'Laquelle des situations suivantes décrit le mieux votre situation la semaine dernière ?',
            ),
            instruction: s(
              'Include all work for pay or profit, including self-employment and part-time work.',
              'Incluez tout travail rémunéré ou pour profit, y compris le travail à son compte et à temps partiel.',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.lfStatus', selection: 'single' },
            required: true,
          },
        ],
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 3 — Employment details  (employed only)
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.empDetails',
        label: s('Employment Details', "Détails de l'emploi"),
        isPage: true,
        visibleWhen: '$lfStatus == "emp" || $lfStatus == "abs"',
        children: [
          {
            type: 'question',
            id: 'q.empType',
            variableRef: 'empType',
            text: s(
              'In your main job last week, were you…',
              'Dans votre emploi principal la semaine dernière, étiez-vous…',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.empType', selection: 'single' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.jobTitle',
            variableRef: 'jobTitle',
            text: s('What was your job title?', "Quel était votre titre d'emploi ?"),
            instruction: s(
              'Be as specific as possible (e.g. "registered nurse", "retail cashier", "software developer").',
              'Soyez aussi précis(e) que possible (p.ex. « infirmier(ère) autorisé(e) », « caissier(ère) au détail », « développeur(se) de logiciels »).',
            ),
            responseDomain: { type: 'text', maxLength: 100 },
            required: true,
          },
          {
            type: 'question',
            id: 'q.industry',
            variableRef: 'industry',
            text: s(
              'What industry or business did you work in?',
              'Dans quelle industrie ou entreprise travailliez-vous ?',
            ),
            instruction: s(
              'Select the option that best describes the main activity of the business.',
              "Sélectionnez l'option qui décrit le mieux l'activité principale de l'entreprise.",
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.industry', selection: 'single' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.ftPt',
            variableRef: 'ftPt',
            text: s(
              'Do you usually work full-time or part-time at this job?',
              'Travaillez-vous habituellement à temps plein ou à temps partiel à cet emploi ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.ftPt', selection: 'single' },
            required: true,
          },
        ],
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 4 — Hours of work  (employed only)
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.hours',
        label: s('Hours of Work', 'Heures de travail'),
        isPage: true,
        visibleWhen: '$lfStatus == "emp" || $lfStatus == "abs"',
        children: [
          {
            type: 'question',
            id: 'q.hoursUsual',
            variableRef: 'hoursUsual',
            text: s(
              'How many hours do you usually work per week at all jobs?',
              'Combien d\'heures travaillez-vous habituellement par semaine à tous vos emplois ?',
            ),
            responseDomain: { type: 'numeric', min: 0, max: 168, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.hoursUsual.high',
                type: 'soft',
                when: '$hoursUsual > 80',
                message: s(
                  'More than 80 usual hours per week — please confirm.',
                  'Plus de 80 heures habituelles par semaine — veuillez confirmer.',
                ),
                scope: ['hoursUsual'],
              },
              {
                id: 'edit.ftPt.consistency',
                type: 'soft',
                when: '$ftPt == "pt" && $hoursUsual >= 30',
                message: s(
                  'You indicated part-time but entered 30 or more usual hours — please confirm.',
                  'Vous avez indiqué temps partiel mais saisi 30 heures habituelles ou plus — veuillez confirmer.',
                ),
                scope: ['ftPt', 'hoursUsual'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.hoursActual',
            variableRef: 'hoursActual',
            text: s(
              'How many hours did you actually work last week at all jobs?',
              'Combien d\'heures avez-vous réellement travaillé la semaine dernière à tous vos emplois ?',
            ),
            instruction: s(
              'If you were absent from work all of last week, enter 0.',
              "Si vous étiez absent(e) toute la semaine, inscrivez 0.",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 168, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.hoursActual.high',
                type: 'soft',
                when: '$hoursActual > 80',
                message: s(
                  'More than 80 actual hours last week — please confirm.',
                  'Plus de 80 heures réelles la semaine dernière — veuillez confirmer.',
                ),
                scope: ['hoursActual'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.absReason',
            variableRef: 'absReason',
            text: s(
              'What was the main reason you were absent from work last week?',
              "Quelle était la principale raison de votre absence du travail la semaine dernière ?",
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.absReason', selection: 'single' },
            visibleWhen: '$lfStatus == "abs" || $hoursActual < $hoursUsual',
            required: false,
          },
        ],
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 5 — Job search  (unemployed only)
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.unemp',
        label: s('Job Search', "Recherche d'emploi"),
        isPage: true,
        visibleWhen: '$lfStatus == "unemp"',
        children: [
          {
            type: 'statement',
            id: 'stmt.unempIntro',
            text: s(
              'The following questions are about your job search activities.',
              "Les questions suivantes portent sur vos activités de recherche d'emploi.",
            ),
          },
          {
            type: 'question',
            id: 'q.weeksLooking',
            variableRef: 'weeksLooking',
            text: s(
              'For how many weeks have you been looking for work?',
              "Depuis combien de semaines cherchez-vous un emploi ?",
            ),
            responseDomain: { type: 'numeric', min: 1, max: 520, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.weeksLooking.high',
                type: 'soft',
                when: '$weeksLooking > 260',
                message: s(
                  'More than 5 years searching — please confirm.',
                  'Plus de 5 ans de recherche — veuillez confirmer.',
                ),
                scope: ['weeksLooking'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.searchMethods',
            variableRef: 'searchMethods',
            text: s(
              'Which of the following methods did you use to look for work in the past four weeks?',
              'Parmi les méthodes suivantes, lesquelles avez-vous utilisées pour chercher un emploi au cours des quatre dernières semaines ?',
            ),
            instruction: s('Mark all that apply.', "Cochez tout ce qui s'applique."),
            responseDomain: {
              type: 'markAll',
              categorySchemeRef: 'cs.searchMethods',
              variablePrefix: 'srch',
            },
          },
        ],
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 6 — Not in labour force
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.nilf',
        label: s('Labour Force Inactivity', 'Inactivité'),
        isPage: true,
        visibleWhen: '$lfStatus == "nilf"',
        children: [
          {
            type: 'question',
            id: 'q.nilfReason',
            variableRef: 'nilfReason',
            text: s(
              'What is the main reason you were not looking for work last week?',
              "Quelle est la principale raison pour laquelle vous ne cherchiez pas d'emploi la semaine dernière ?",
            ),
            responseDomain: {
              type: 'code',
              categorySchemeRef: 'cs.nilfReason',
              selection: 'single',
            },
            required: true,
          },
        ],
      },

      // ── Derived computation ──────────────────────────────────────
      {
        type: 'computation',
        id: 'comp.isEmployed',
        targetVariableRef: 'isEmployed',
        expression: '$lfStatus == "emp" || $lfStatus == "abs"',
      },

      // ═══════════════════════════════════════════════════════════════
      // PAGE 7 — Closing
      // ═══════════════════════════════════════════════════════════════
      {
        type: 'sequence',
        id: 'pg.closing',
        label: s('Closing', 'Clôture'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.thanks',
            text: s(
              'Thank you, ${respondentName}. You have reached the end of the survey. Please click Submit to send your responses.',
              "Merci, ${respondentName}. Vous avez atteint la fin du questionnaire. Cliquez sur Soumettre pour envoyer vos réponses.",
            ),
          },
        ],
      },
    ],
  },
};
