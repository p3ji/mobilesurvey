/**
 * Representative census questionnaire (short-form) for library re-use.
 *
 * Modelled on standard census programs (e.g. Statistics Canada 3901_Q2_V8) — covers the
 * standard census domains: dwelling, household, demographics, language, identity, citizenship,
 * education, labour-force status, occupation, and income. All questions are bilingual EN/FR.
 *
 * Included in the Library panel as a catalogue of reusable census questions/sections.
 * NOT used as a default survey.
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const censusInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:census-short-form:1.0.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Census Short-Form (Representative)', 'Recensement court (représentatif)'),
    agency: 'Example Org',
    description: s(
      'Representative census questions adapted from standard census programs for library re-use.',
      'Questions de recensement représentatives adaptées des programmes de recensement standard.',
    ),
  },
  concepts: [
    { id: 'con.dwelling',   label: s('Dwelling',              'Logement') },
    { id: 'con.household',  label: s('Household composition', 'Composition du ménage') },
    { id: 'con.demography', label: s('Demographics',          'Démographie') },
    { id: 'con.language',   label: s('Language',              'Langue') },
    { id: 'con.identity',   label: s('Identity',              'Identité') },
    { id: 'con.migration',  label: s('Citizenship & migration', 'Citoyenneté et migration') },
    { id: 'con.education',  label: s('Education',             'Éducation') },
    { id: 'con.labour',     label: s('Labour force',          'Population active') },
    { id: 'con.occupation', label: s('Occupation',            'Profession') },
    { id: 'con.income',     label: s('Income',                'Revenu') },
  ],
  universes: [
    { id: 'uni.person',   label: s('All persons',           'Toutes les personnes') },
    { id: 'uni.dwelling', label: s('All private dwellings', 'Tous les logements privés') },
  ],
  categorySchemes: [
    {
      id: 'cs.cen.dwellingType',
      label: s('Type of dwelling', 'Type de logement'),
      categories: [
        { code: 'detached', label: s('Single detached house',   'Maison individuelle non attenante') },
        { code: 'semi',     label: s('Semi-detached house',     'Maison jumelée') },
        { code: 'row',      label: s('Row house',               'Maison en rangée') },
        { code: 'apt_low',  label: s('Apartment (< 5 storeys)', 'Appartement (< 5 étages)') },
        { code: 'apt_high', label: s('Apartment (5+ storeys)',  'Appartement (5+ étages)') },
        { code: 'mobile',   label: s('Movable dwelling',        'Logement mobile') },
        { code: 'other',    label: s('Other',                   'Autre') },
      ],
    },
    {
      id: 'cs.cen.tenure',
      label: s('Tenure type', "Mode d'occupation"),
      categories: [
        { code: 'owned',  label: s('Owned (with or without mortgage)', 'Propriété (avec ou sans hypothèque)') },
        { code: 'rented', label: s('Rented',       'Loué') },
        { code: 'band',   label: s('Band housing', 'Logement de bande') },
      ],
    },
    {
      id: 'cs.cen.sex',
      label: s('Sex', 'Sexe'),
      categories: [
        { code: 'm',   label: s('Male',                   'Masculin') },
        { code: 'f',   label: s('Female',                 'Féminin') },
        { code: 'int', label: s('Intersex / Another sex', 'Intersexe / Autre sexe') },
      ],
    },
    {
      id: 'cs.cen.marital',
      label: s('Marital status', 'État matrimonial'),
      categories: [
        { code: 'married',   label: s('Married',                'Marié(e)') },
        { code: 'commonLaw', label: s('Living common-law',      'En union libre') },
        { code: 'widowed',   label: s('Widowed',                'Veuf/veuve') },
        { code: 'separated', label: s('Separated',              'Séparé(e)') },
        { code: 'divorced',  label: s('Divorced',               'Divorcé(e)') },
        { code: 'single',    label: s('Single (never married)', 'Célibataire (jamais marié(e))') },
      ],
    },
    {
      id: 'cs.cen.relation',
      label: s('Relationship to Person 1', 'Lien avec la Personne 1'),
      categories: [
        { code: 'self',       label: s('Person 1',          'Personne 1') },
        { code: 'spouse',     label: s('Spouse or partner', 'Époux/épouse ou partenaire') },
        { code: 'child',      label: s('Son or daughter',   'Fils ou fille') },
        { code: 'parent',     label: s('Father or mother',  'Père ou mère') },
        { code: 'sibling',    label: s('Brother or sister', 'Frère ou sœur') },
        { code: 'grandchild', label: s('Grandchild',        'Petit-enfant') },
        { code: 'other',      label: s('Other',             'Autre') },
      ],
    },
    {
      id: 'cs.cen.yesNo',
      label: s('Yes / No', 'Oui / Non'),
      categories: [
        { code: 'yes', label: s('Yes', 'Oui') },
        { code: 'no',  label: s('No',  'Non') },
      ],
    },
    {
      id: 'cs.cen.officialLang',
      label: s('Official language ability', 'Connaissance des langues officielles'),
      categories: [
        { code: 'enOnly', label: s('English only',            'Anglais seulement') },
        { code: 'frOnly', label: s('French only',             'Français seulement') },
        { code: 'both',   label: s('Both English and French', 'Anglais et français') },
        { code: 'neither',label: s('Neither',                 "Ni l'un ni l'autre") },
      ],
    },
    {
      id: 'cs.cen.schoolAttend',
      label: s('School attendance', 'Fréquentation scolaire'),
      categories: [
        { code: 'fulltime', label: s('Full-time', 'À temps plein') },
        { code: 'parttime', label: s('Part-time', 'À temps partiel') },
        { code: 'no',       label: s('No',        'Non') },
      ],
    },
    {
      id: 'cs.cen.highestCert',
      label: s('Highest certificate/diploma/degree', 'Plus haut certificat/diplôme/grade'),
      categories: [
        { code: 'none',      label: s('No certificate, diploma or degree', 'Aucun certificat, diplôme ou grade') },
        { code: 'secondary', label: s('High school diploma/equivalency',   "Diplôme d'études secondaires") },
        { code: 'trade',     label: s('Trades certificate',                'Certificat de métier') },
        { code: 'college',   label: s('College / CEGEP diploma',           'Diplôme collégial') },
        { code: 'bachelor',  label: s("Bachelor's degree",                 'Baccalauréat') },
        { code: 'above',     label: s("Degree above bachelor's",           'Grade supérieur au baccalauréat') },
      ],
    },
    {
      id: 'cs.cen.labourActivity',
      label: s('Labour force activity', 'Activité de la population active'),
      categories: [
        { code: 'employed',    label: s('Employed (worked last week)',   'Occupé (a travaillé la semaine dernière)') },
        { code: 'absent',      label: s("Employed (absent from job)",    "Occupé (absent de l'emploi)") },
        { code: 'unemployed',  label: s('Unemployed (looking for work)', "En chômage (à la recherche d'un emploi)") },
        { code: 'notInLabour', label: s('Not in the labour force',       'Inactif') },
      ],
    },
    {
      id: 'cs.cen.classWorker',
      label: s('Class of worker', 'Classe de travailleur'),
      categories: [
        { code: 'paid',        label: s('Paid worker',                   'Salarié') },
        { code: 'selfNoEmp',   label: s('Self-employed (no employees)',   'Travailleur autonome (sans employé)') },
        { code: 'selfWithEmp', label: s('Self-employed (with employees)', 'Travailleur autonome (avec employés)') },
        { code: 'unpaid',      label: s('Unpaid family worker',          'Travailleur familial non rémunéré') },
      ],
    },
  ],
  variables: [
    // Dwelling
    { id: 'var.cen.dwellingType',    name: 'cen_dwellingType',    kind: 'collected', label: s('Type of dwelling',        'Type de logement'),              representation: 'code',     conceptRef: 'con.dwelling',   categorySchemeRef: 'cs.cen.dwellingType' },
    { id: 'var.cen.tenure',          name: 'cen_tenure',          kind: 'collected', label: s('Tenure',                  "Mode d'occupation"),             representation: 'code',     conceptRef: 'con.dwelling',   categorySchemeRef: 'cs.cen.tenure' },
    { id: 'var.cen.numRooms',        name: 'cen_numRooms',        kind: 'collected', label: s('Number of rooms',         'Nombre de pièces'),              representation: 'numeric',  conceptRef: 'con.dwelling' },
    { id: 'var.cen.numBedrooms',     name: 'cen_numBedrooms',     kind: 'collected', label: s('Number of bedrooms',      'Nombre de chambres'),            representation: 'numeric',  conceptRef: 'con.dwelling' },
    { id: 'var.cen.yearBuilt',       name: 'cen_yearBuilt',       kind: 'collected', label: s('Year built',              'Année de construction'),         representation: 'numeric',  conceptRef: 'con.dwelling' },
    // Household
    { id: 'var.cen.numPersons',      name: 'cen_numPersons',      kind: 'collected', label: s('Number of persons',       'Nombre de personnes'),           representation: 'numeric',  conceptRef: 'con.household' },
    { id: 'var.cen.relation',        name: 'cen_relation',        kind: 'collected', label: s('Relationship to Person 1','Lien avec la Personne 1'),       representation: 'code',     conceptRef: 'con.household',  categorySchemeRef: 'cs.cen.relation' },
    // Demographics
    { id: 'var.cen.lastName',        name: 'cen_lastName',        kind: 'collected', label: s('Family name',             'Nom de famille'),                representation: 'text',     conceptRef: 'con.demography' },
    { id: 'var.cen.firstName',       name: 'cen_firstName',       kind: 'collected', label: s('Given name',              'Prénom'),                        representation: 'text',     conceptRef: 'con.demography' },
    { id: 'var.cen.dateOfBirth',     name: 'cen_dateOfBirth',     kind: 'collected', label: s('Date of birth',           'Date de naissance'),             representation: 'datetime', conceptRef: 'con.demography' },
    { id: 'var.cen.age',             name: 'cen_age',             kind: 'collected', label: s('Age',                     'Âge'),                           representation: 'numeric',  conceptRef: 'con.demography' },
    { id: 'var.cen.sex',             name: 'cen_sex',             kind: 'collected', label: s('Sex',                     'Sexe'),                          representation: 'code',     conceptRef: 'con.demography', categorySchemeRef: 'cs.cen.sex' },
    { id: 'var.cen.marital',         name: 'cen_marital',         kind: 'collected', label: s('Marital status',          'État matrimonial'),               representation: 'code',     conceptRef: 'con.demography', categorySchemeRef: 'cs.cen.marital' },
    // Language
    { id: 'var.cen.motherTongue',    name: 'cen_motherTongue',    kind: 'collected', label: s('Mother tongue',           'Langue maternelle'),             representation: 'text',     conceptRef: 'con.language' },
    { id: 'var.cen.langAtHome',      name: 'cen_langAtHome',      kind: 'collected', label: s('Language spoken at home', 'Langue parlée à la maison'),     representation: 'text',     conceptRef: 'con.language' },
    { id: 'var.cen.officialLang',    name: 'cen_officialLang',    kind: 'collected', label: s('Official language(s)',    "Langue(s) officielle(s)"),       representation: 'code',     conceptRef: 'con.language',   categorySchemeRef: 'cs.cen.officialLang' },
    // Identity
    { id: 'var.cen.indigenous',      name: 'cen_indigenous',      kind: 'collected', label: s('Indigenous identity',     'Identité autochtone'),           representation: 'code',     conceptRef: 'con.identity',   categorySchemeRef: 'cs.cen.yesNo' },
    { id: 'var.cen.ethnic',          name: 'cen_ethnic',          kind: 'collected', label: s('Ethnic/cultural origin',  'Origine ethnique ou culturelle'), representation: 'text',    conceptRef: 'con.identity' },
    // Migration
    { id: 'var.cen.birthplace',      name: 'cen_birthplace',      kind: 'collected', label: s('Place of birth',          'Lieu de naissance'),             representation: 'text',     conceptRef: 'con.migration' },
    { id: 'var.cen.citizen',         name: 'cen_citizen',         kind: 'collected', label: s('Canadian citizen',        'Citoyen(ne) canadien(ne)'),      representation: 'code',     conceptRef: 'con.migration',  categorySchemeRef: 'cs.cen.yesNo' },
    { id: 'var.cen.yearImmigration', name: 'cen_yearImmigration', kind: 'collected', label: s('Year of immigration',     "Année d'immigration"),           representation: 'numeric',  conceptRef: 'con.migration' },
    { id: 'var.cen.mobility5yr',     name: 'cen_mobility5yr',     kind: 'collected', label: s('Residence 5 years ago',   'Résidence il y a 5 ans'),        representation: 'text',     conceptRef: 'con.migration' },
    // Education
    { id: 'var.cen.schoolAttend',    name: 'cen_schoolAttend',    kind: 'collected', label: s('School attendance',       'Fréquentation scolaire'),        representation: 'code',     conceptRef: 'con.education',  categorySchemeRef: 'cs.cen.schoolAttend' },
    { id: 'var.cen.highestCert',     name: 'cen_highestCert',     kind: 'collected', label: s('Highest credential',      'Plus haut diplôme'),             representation: 'code',     conceptRef: 'con.education',  categorySchemeRef: 'cs.cen.highestCert' },
    { id: 'var.cen.fieldOfStudy',    name: 'cen_fieldOfStudy',    kind: 'collected', label: s("Field of study",          "Domaine d'études"),              representation: 'text',     conceptRef: 'con.education' },
    // Labour
    { id: 'var.cen.labourActivity',  name: 'cen_labourActivity',  kind: 'collected', label: s('Labour force activity',   'Activité de la population active'), representation: 'code',  conceptRef: 'con.labour',     categorySchemeRef: 'cs.cen.labourActivity' },
    { id: 'var.cen.weeksWorked',     name: 'cen_weeksWorked',     kind: 'collected', label: s('Weeks worked',            'Semaines travaillées'),          representation: 'numeric',  conceptRef: 'con.labour' },
    { id: 'var.cen.hoursTypical',    name: 'cen_hoursTypical',    kind: 'collected', label: s('Usual hours/week',        'Heures habituelles/semaine'),    representation: 'numeric',  conceptRef: 'con.labour' },
    { id: 'var.cen.classWorker',     name: 'cen_classWorker',     kind: 'collected', label: s('Class of worker',         'Classe de travailleur'),         representation: 'code',     conceptRef: 'con.labour',     categorySchemeRef: 'cs.cen.classWorker' },
    // Occupation
    { id: 'var.cen.occupTitle',      name: 'cen_occupTitle',      kind: 'collected', label: s('Job title / occupation',  "Titre d'emploi / profession"),   representation: 'text',     conceptRef: 'con.occupation' },
    { id: 'var.cen.jobDuties',       name: 'cen_jobDuties',       kind: 'collected', label: s('Main job duties',         'Principales fonctions'),         representation: 'text',     conceptRef: 'con.occupation' },
    { id: 'var.cen.industry',        name: 'cen_industry',        kind: 'collected', label: s("Employer's industry",     "Industrie de l'employeur"),      representation: 'text',     conceptRef: 'con.occupation' },
    // Income
    { id: 'var.cen.totalIncome',     name: 'cen_totalIncome',     kind: 'collected', label: s('Total income',           'Revenu total'),                   representation: 'numeric',  conceptRef: 'con.income' },
    { id: 'var.cen.employIncome',    name: 'cen_employIncome',    kind: 'collected', label: s('Employment income',      "Revenu d'emploi"),                representation: 'numeric',  conceptRef: 'con.income' },
    { id: 'var.cen.govtTransfers',   name: 'cen_govtTransfers',   kind: 'collected', label: s('Government transfers',   'Transferts gouvernementaux'),     representation: 'numeric',  conceptRef: 'con.income' },
  ],
  prefillMappings: [],
  sequence: {
    type: 'sequence',
    id: 'seq.census',
    children: [

      // ── Page A: Dwelling ─────────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.dwelling', isPage: true,
        label: s('A — Your Dwelling', 'A — Votre logement'),
        children: [
          {
            type: 'question', id: 'q.cen.dwellingType', variableRef: 'cen_dwellingType',
            text: s('What type of dwelling is this?', 'Quel est le type de logement ?'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.dwellingType', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.tenure', variableRef: 'cen_tenure',
            text: s('Is this dwelling owned or rented?', "Est-ce que ce logement est propriété ou location ?"),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.tenure', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.numRooms', variableRef: 'cen_numRooms',
            text: s(
              'How many rooms are in this dwelling? (Do not count bathrooms, halls, vestibules.)',
              'Combien de pièces y a-t-il dans ce logement ? (Ne pas compter les salles de bains, halls, vestibules.)',
            ),
            responseDomain: { type: 'numeric', min: 1, max: 50 },
          },
          {
            type: 'question', id: 'q.cen.numBedrooms', variableRef: 'cen_numBedrooms',
            text: s('How many bedrooms are in this dwelling?', 'Combien de chambres à coucher y a-t-il dans ce logement ?'),
            responseDomain: { type: 'numeric', min: 0, max: 20 },
          },
          {
            type: 'question', id: 'q.cen.yearBuilt', variableRef: 'cen_yearBuilt',
            text: s(
              'When was this building originally constructed? (Enter 4-digit year)',
              "Quand ce bâtiment a-t-il été construit à l'origine ? (Entrez l'année en 4 chiffres)",
            ),
            responseDomain: { type: 'numeric', min: 1600, max: 2030 },
          },
        ],
      },

      // ── Page B: Household composition ───────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.household', isPage: true,
        label: s('B — Household Composition', 'B — Composition du ménage'),
        children: [
          {
            type: 'question', id: 'q.cen.numPersons', variableRef: 'cen_numPersons',
            text: s(
              'How many people live at this address? Include everyone who usually lives here.',
              'Combien de personnes habitent à cette adresse ? Incluez toutes les personnes qui y résident habituellement.',
            ),
            responseDomain: { type: 'numeric', min: 1, max: 50 },
          },
          {
            type: 'question', id: 'q.cen.relation', variableRef: 'cen_relation',
            text: s(
              "What is this person's relationship to Person 1?",
              'Quel est le lien de cette personne avec la Personne 1 ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.relation', selection: 'single' },
          },
        ],
      },

      // ── Page C: Personal information ────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.person', isPage: true,
        label: s('C — Personal Information', 'C — Renseignements personnels'),
        children: [
          {
            type: 'question', id: 'q.cen.lastName', variableRef: 'cen_lastName',
            text: s("What is this person's family name?", 'Quel est le nom de famille de cette personne ?'),
            responseDomain: { type: 'text', maxLength: 100 },
          },
          {
            type: 'question', id: 'q.cen.firstName', variableRef: 'cen_firstName',
            text: s("What is this person's given name?", 'Quel est le prénom de cette personne ?'),
            responseDomain: { type: 'text', maxLength: 100 },
          },
          {
            type: 'question', id: 'q.cen.dateOfBirth', variableRef: 'cen_dateOfBirth',
            text: s("What is this person's date of birth?", 'Quelle est la date de naissance de cette personne ?'),
            responseDomain: { type: 'datetime', mode: 'date' },
          },
          {
            type: 'question', id: 'q.cen.age', variableRef: 'cen_age',
            text: s(
              "What is this person's age (as of Census Day)?",
              "Quel est l'âge de cette personne (au Jour du recensement) ?",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 150 },
          },
          {
            type: 'question', id: 'q.cen.sex', variableRef: 'cen_sex',
            text: s("What is this person's sex?", 'Quel est le sexe de cette personne ?'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.sex', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.marital', variableRef: 'cen_marital',
            text: s(
              "What is this person's marital or common-law status?",
              "Quel est l'état matrimonial ou de l'union libre de cette personne ?",
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.marital', selection: 'single' },
          },
        ],
      },

      // ── Page D: Language ─────────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.language', isPage: true,
        label: s('D — Language', 'D — Langue'),
        children: [
          {
            type: 'question', id: 'q.cen.motherTongue', variableRef: 'cen_motherTongue',
            text: s(
              'What is the language that this person first learned at home in childhood and still understands?',
              "Quelle est la langue que cette personne a apprise en premier lieu à la maison dans son enfance et qu'elle comprend encore ?",
            ),
            responseDomain: { type: 'text', maxLength: 100 },
          },
          {
            type: 'question', id: 'q.cen.langAtHome', variableRef: 'cen_langAtHome',
            text: s(
              'What language does this person speak most often at home?',
              'Quelle langue cette personne parle-t-elle le plus souvent à la maison ?',
            ),
            responseDomain: { type: 'text', maxLength: 100 },
          },
          {
            type: 'question', id: 'q.cen.officialLang', variableRef: 'cen_officialLang',
            text: s(
              'Can this person speak English or French well enough to conduct a conversation?',
              'Cette personne peut-elle soutenir une conversation en anglais ou en français ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.officialLang', selection: 'single' },
          },
        ],
      },

      // ── Page E: Identity ─────────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.identity', isPage: true,
        label: s('E — Ethnic & Cultural Identity', 'E — Identité ethnique et culturelle'),
        children: [
          {
            type: 'question', id: 'q.cen.indigenous', variableRef: 'cen_indigenous',
            text: s(
              "Is this person an Indigenous person — First Nations, Métis or Inuk (Inuit)?",
              "Cette personne est-elle une personne autochtone — Première Nation, Métis ou Inuk (Inuit) ?",
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.yesNo', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.ethnic', variableRef: 'cen_ethnic',
            text: s(
              "What were the ethnic or cultural origins of this person's ancestors?",
              'Quelles sont les origines ethniques ou culturelles des ancêtres de cette personne ?',
            ),
            responseDomain: { type: 'text', maxLength: 200 },
          },
        ],
      },

      // ── Page F: Citizenship & migration ──────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.migration', isPage: true,
        label: s('F — Citizenship & Migration', 'F — Citoyenneté et migration'),
        children: [
          {
            type: 'question', id: 'q.cen.birthplace', variableRef: 'cen_birthplace',
            text: s('In what country was this person born?', 'Dans quel pays cette personne est-elle née ?'),
            responseDomain: { type: 'text', maxLength: 100 },
          },
          {
            type: 'question', id: 'q.cen.citizen', variableRef: 'cen_citizen',
            text: s('Is this person a Canadian citizen?', 'Cette personne est-elle citoyen(ne) canadien(ne) ?'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.yesNo', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.yearImmigration', variableRef: 'cen_yearImmigration',
            text: s(
              'In what year did this person first become a landed immigrant or permanent resident of Canada? (4-digit year)',
              "En quelle année cette personne est-elle devenue pour la première fois immigrant reçu du Canada ? (Année en 4 chiffres)",
            ),
            responseDomain: { type: 'numeric', min: 1800, max: 2030 },
          },
          {
            type: 'question', id: 'q.cen.mobility5yr', variableRef: 'cen_mobility5yr',
            text: s('Where did this person live 5 years ago?', 'Où cette personne habitait-elle il y a 5 ans ?'),
            responseDomain: { type: 'text', maxLength: 200 },
          },
        ],
      },

      // ── Page G: Education ────────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.education', isPage: true,
        label: s('G — Education', 'G — Éducation'),
        children: [
          {
            type: 'question', id: 'q.cen.schoolAttend', variableRef: 'cen_schoolAttend',
            text: s(
              'Did this person attend a school, college, CEGEP or university in the past 9 months?',
              'Cette personne a-t-elle fréquenté une école, un collège, un cégep ou une université au cours des 9 derniers mois ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.schoolAttend', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.highestCert', variableRef: 'cen_highestCert',
            text: s(
              'What is the highest certificate, diploma or degree that this person has completed?',
              'Quel est le plus haut certificat, diplôme ou grade que cette personne a obtenu ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.highestCert', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.fieldOfStudy', variableRef: 'cen_fieldOfStudy',
            text: s(
              'What was the major field of study of the highest certificate, diploma or degree?',
              "Quel était le principal domaine d'études du plus haut certificat, diplôme ou grade ?",
            ),
            responseDomain: { type: 'text', maxLength: 200 },
          },
        ],
      },

      // ── Page H: Labour force ─────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.labour', isPage: true,
        label: s('H — Labour Force Activity', 'H — Activité de la population active'),
        children: [
          {
            type: 'question', id: 'q.cen.labourActivity', variableRef: 'cen_labourActivity',
            text: s(
              'Which of the following best describes what this person was doing last week?',
              'Lequel des énoncés suivants décrit le mieux ce que cette personne faisait la semaine dernière ?',
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.labourActivity', selection: 'single' },
          },
          {
            type: 'question', id: 'q.cen.weeksWorked', variableRef: 'cen_weeksWorked',
            text: s(
              'During the past 12 months, how many weeks did this person work?',
              'Au cours des 12 derniers mois, combien de semaines cette personne a-t-elle travaillé ?',
            ),
            responseDomain: { type: 'numeric', min: 0, max: 52 },
          },
          {
            type: 'question', id: 'q.cen.hoursTypical', variableRef: 'cen_hoursTypical',
            text: s(
              'During the past 12 months, how many hours per week did this person usually work?',
              "Au cours des 12 derniers mois, combien d'heures par semaine cette personne a-t-elle habituellement travaillé ?",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 168 },
          },
          {
            type: 'question', id: 'q.cen.classWorker', variableRef: 'cen_classWorker',
            text: s(
              'In this job, was this person a paid worker, self-employed or an unpaid family worker?',
              "Dans cet emploi, cette personne était-elle un salarié, un travailleur autonome ou un travailleur familial non rémunéré ?",
            ),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.cen.classWorker', selection: 'single' },
          },
        ],
      },

      // ── Page I: Occupation ───────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.occupation', isPage: true,
        label: s('I — Occupation', 'I — Profession'),
        children: [
          {
            type: 'question', id: 'q.cen.occupTitle', variableRef: 'cen_occupTitle',
            text: s(
              "What is the title of this person's job or occupation?",
              'Quel est le titre du poste ou de la profession de cette personne ?',
            ),
            responseDomain: { type: 'text', maxLength: 200 },
          },
          {
            type: 'question', id: 'q.cen.jobDuties', variableRef: 'cen_jobDuties',
            text: s(
              "What were the main activities or duties in this person's job?",
              "Quelles étaient les principales activités ou fonctions dans l'emploi de cette personne ?",
            ),
            responseDomain: { type: 'text', multiline: true, maxLength: 500 },
          },
          {
            type: 'question', id: 'q.cen.industry', variableRef: 'cen_industry',
            text: s(
              "What was the main activity of the business, farm or organization where this person worked?",
              "Quelle était la principale activité de l'entreprise, de la ferme ou de l'organisation où cette personne travaillait ?",
            ),
            responseDomain: { type: 'text', maxLength: 200 },
          },
        ],
      },

      // ── Page J: Income ───────────────────────────────────────────────────
      {
        type: 'sequence', id: 'pg.cen.income', isPage: true,
        label: s('J — Income', 'J — Revenu'),
        children: [
          {
            type: 'statement', id: 'stmt.cen.incomeIntro',
            text: s(
              'Report income amounts in Canadian dollars for the reference year. Round to the nearest dollar.',
              "Déclarez les montants en dollars canadiens pour l'année de référence. Arrondissez au dollar près.",
            ),
          },
          {
            type: 'question', id: 'q.cen.totalIncome', variableRef: 'cen_totalIncome',
            text: s(
              'What was the total income received by this person in the reference year, from all sources, before taxes and deductions?',
              "Quel était le revenu total reçu par cette personne au cours de l'année de référence, de toutes sources, avant impôts et déductions ?",
            ),
            responseDomain: { type: 'numeric', min: -999999, max: 9999999 },
          },
          {
            type: 'question', id: 'q.cen.employIncome', variableRef: 'cen_employIncome',
            text: s(
              'Employment income: wages, salaries and commissions from all jobs before deductions.',
              "Revenu d'emploi : traitements, salaires et commissions de tous les emplois avant retenues.",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 9999999 },
          },
          {
            type: 'question', id: 'q.cen.govtTransfers', variableRef: 'cen_govtTransfers',
            text: s(
              "Government transfer payments (OAS, CPP/QPP, EI, social assistance, child benefits, worker's compensation, etc.).",
              "Paiements de transfert gouvernementaux (SV, RPC/RRQ, AE, aide sociale, allocations pour enfants, indemnisation des accidents du travail, etc.).",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 9999999 },
          },
        ],
      },
    ],
  },
};
