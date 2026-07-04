/**
 * "Federal Science Expenditures and Personnel (Demo)" — a bilingual (EN/FR) establishment-survey
 * sample modeled on Statistics Canada's real Federal Science Expenditures and Personnel (FSEP)
 * questionnaire (survey 4212): expenditure tables split by activity (R&D / RSA) and performer
 * (intramural vs. extramural sectors), an FTE personnel table, a sources-of-funds section with a
 * cross-section hard balance edit, and a 13-region expenditure table with a cross-section soft
 * edit — mirroring the real form's "must equal" footnotes.
 *
 * Simplified from the real survey for a single reference year (the real FSEP collects three) and
 * omits some breakdowns (personnel by gender, socio-economic objective, extramural payee listing)
 * to keep the demo a manageable teaching example. Not an official government collection.
 *
 * Exploration-only: registered with `collectsData: false`, so it never persists to any backend.
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const fsepInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:fsep:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s(
      'Federal Science Expenditures and Personnel (Demo)',
      'Dépenses fédérales au titre des sciences et personnel scientifique (démo)',
    ),
    agency: 'Statistics Canada (Demo — not an official government collection)',
    description: s(
      "A demo modeled on Statistics Canada's Federal Science Expenditures and Personnel (FSEP) survey: expenditure and personnel tables with computed subtotals, cross-section balance edits, and a certification block. Simplified to one reference year. Nothing is collected or stored.",
      "Une démo inspirée de l'enquête sur les dépenses fédérales au titre des sciences et le personnel scientifique (DFSPS) de Statistique Canada : tableaux de dépenses et de personnel avec sous-totaux calculés, contrôles d'équilibre entre sections et bloc d'attestation. Simplifiée à une seule année de référence. Rien n'est recueilli ni conservé.",
    ),
    created: '2026-07-03T00:00:00.000Z',
  },

  concepts: [
    { id: 'c.expenditures', label: s('Science expenditures', 'Dépenses en sciences') },
    { id: 'c.personnel', label: s('Science personnel', 'Personnel scientifique') },
  ],
  universes: [],

  categorySchemes: [
    {
      id: 'cs.perfCols',
      label: s('Performer', 'Exécutant'),
      categories: [
        { code: 'intra', label: s('Intramural', 'Intra-muros') },
        { code: 'be', label: s('Business enterprise', 'Entreprises commerciales') },
        { code: 'he', label: s('Higher education', 'Enseignement supérieur') },
        { code: 'np', label: s('Canadian non-profit institutions', 'Institutions canadiennes sans but lucratif') },
        { code: 'gov', label: s('Provincial, territorial and municipal governments', 'Administrations provinciales, territoriales et municipales') },
        { code: 'fp', label: s('Foreign performers', 'Exécutants étrangers') },
      ],
    },
    {
      id: 'cs.rdRows',
      label: s('R&D activity', 'Activité de R-D'),
      categories: [
        { code: 'inhouse', label: s('In-house R&D', 'R-D interne') },
        { code: 'contracts', label: s('R&D contracts', 'Contrats de R-D') },
        { code: 'grants', label: s('R&D grants, contributions and fellowships', 'Subventions, contributions et bourses de R-D') },
        { code: 'fellows', label: s('Research fellowships', 'Bourses de recherche') },
        { code: 'admin', label: s('Administration of extramural programs', 'Administration des programmes extra-muros') },
        { code: 'capital', label: s('Capital expenditures', 'Dépenses en immobilisations') },
      ],
    },
    {
      id: 'cs.rsaRows',
      label: s('RSA activity', 'Activité d’ASC'),
      categories: [
        { code: 'inhouse', label: s('In-house RSA', 'ASC interne') },
        { code: 'contracts', label: s('RSA contracts', "Contrats d'ASC") },
        { code: 'grants', label: s('RSA grants and contributions', "Subventions et contributions d'ASC") },
        { code: 'admin', label: s('Administration of extramural programs', 'Administration des programmes extra-muros') },
        { code: 'capital', label: s('Capital expenditures', 'Dépenses en immobilisations') },
      ],
    },
    {
      id: 'cs.personnelRows',
      label: s('Personnel category', 'Catégorie de personnel'),
      categories: [
        { code: 'sciprof', label: s('Scientific and professional (include executive)', 'Personnel scientifique et professionnel (y compris les cadres)') },
        { code: 'tech', label: s('Technical', 'Personnel technique') },
        { code: 'other', label: s('Other', 'Autre personnel') },
      ],
    },
    {
      id: 'cs.personnelCols',
      label: s('Personnel focus', 'Champ d’activité du personnel'),
      categories: [
        { code: 'rd', label: s('Personnel engaged in R&D (A)', 'Personnel affecté à la R-D (A)') },
        { code: 'rsa', label: s('Personnel engaged in RSA (B)', 'Personnel affecté aux ASC (B)') },
        { code: 'adminrd', label: s('Personnel engaged in the administration of extramural R&D programs (C)', "Personnel affecté à l'administration des programmes de R-D extra-muros (C)") },
        { code: 'adminrsa', label: s('Personnel engaged in the administration of extramural RSA programs (D)', "Personnel affecté à l'administration des programmes d'ASC extra-muros (D)") },
      ],
    },
    {
      id: 'cs.regionRows',
      label: s('Region', 'Région'),
      categories: [
        { code: 'nl', label: s('Newfoundland and Labrador', 'Terre-Neuve-et-Labrador') },
        { code: 'pe', label: s('Prince Edward Island', "Île-du-Prince-Édouard") },
        { code: 'ns', label: s('Nova Scotia', 'Nouvelle-Écosse') },
        { code: 'nb', label: s('New Brunswick', 'Nouveau-Brunswick') },
        { code: 'qc', label: s('Quebec (excl. NCR)', 'Québec (excl. RCN)') },
        { code: 'qcncr', label: s('National Capital Region (Quebec)', 'Région de la capitale nationale (Québec)') },
        { code: 'on', label: s('Ontario (excl. NCR)', 'Ontario (excl. RCN)') },
        { code: 'oncr', label: s('National Capital Region (Ontario)', 'Région de la capitale nationale (Ontario)') },
        { code: 'mb', label: s('Manitoba', 'Manitoba') },
        { code: 'sk', label: s('Saskatchewan', 'Saskatchewan') },
        { code: 'ab', label: s('Alberta', 'Alberta') },
        { code: 'bc', label: s('British Columbia', 'Colombie-Britannique') },
        { code: 'yt', label: s('Yukon, Northwest Territories and Nunavut', 'Yukon, Territoires du Nord-Ouest et Nunavut') },
      ],
    },
    {
      id: 'cs.regionCols',
      label: s('Expenditure type', 'Type de dépense'),
      categories: [
        { code: 'curRd', label: s('Current R&D', 'R-D courante') },
        { code: 'capRd', label: s('Capital R&D', 'R-D en immobilisations') },
        { code: 'curRsa', label: s('Current RSA', 'ASC courante') },
        { code: 'capRsa', label: s('Capital RSA', 'ASC en immobilisations') },
      ],
    },
  ],

  variables: [
    // Page 1 — respondent information
    { id: 'v.deptName', name: 'deptName', kind: 'collected', label: s('Department or agency name', "Nom du ministère ou de l'organisme"), representation: 'text' },
    { id: 'v.contactName', name: 'contactName', kind: 'collected', label: s('Name of person to contact for enquiries', 'Nom de la personne-ressource'), representation: 'text', isPII: true },
    { id: 'v.contactEmail', name: 'contactEmail', kind: 'collected', label: s('Contact email address', 'Adresse courriel de la personne-ressource'), representation: 'text', isPII: true },
    // Page 2 — table anchors (hidden; table cells generate their own variables)
    { id: 'v.expRdTable', name: 'expRdTable', kind: 'hidden', label: s('R&D expenditures (table)', 'Dépenses de R-D (tableau)'), representation: 'text' },
    { id: 'v.expRsaTable', name: 'expRsaTable', kind: 'hidden', label: s('RSA expenditures (table)', "Dépenses d'ASC (tableau)"), representation: 'text' },
    // Page 3 — personnel table anchor
    { id: 'v.personnelTable', name: 'personnelTable', kind: 'hidden', label: s('Personnel FTE (table)', 'Personnel en ETP (tableau)'), representation: 'text' },
    // Page 4 — Section 3A(ii): sources of funds
    { id: 'v.deptBudget', name: 'deptBudget', kind: 'collected', label: s('Departmental S&T budget', 'Budget ministériel en S-T'), representation: 'numeric', conceptRef: 'c.expenditures' },
    { id: 'v.netOtherFed', name: 'netOtherFed', kind: 'collected', label: s('Net revenues to/from other federal departments and agencies', "Revenus nets provenant d'autres ministères et organismes fédéraux"), representation: 'numeric', conceptRef: 'c.expenditures' },
    { id: 'v.provincial', name: 'provincial', kind: 'collected', label: s('Provincial government departments', 'Ministères des gouvernements provinciaux'), representation: 'numeric', conceptRef: 'c.expenditures' },
    { id: 'v.business', name: 'business', kind: 'collected', label: s('Business enterprises', 'Entreprises commerciales'), representation: 'numeric', conceptRef: 'c.expenditures' },
    { id: 'v.otherFunds', name: 'otherFunds', kind: 'collected', label: s('Other funding sources', 'Autres sources de financement'), representation: 'numeric', conceptRef: 'c.expenditures' },
    { id: 'v.fundsTotal', name: 'fundsTotal', kind: 'derived', label: s('Total sources of funds (derived)', 'Total des sources de financement (dérivé)'), representation: 'numeric', compute: 'sum($deptBudget, $netOtherFed, $provincial, $business, $otherFunds)' },
    // Page 5 — region table anchor
    { id: 'v.regionTable', name: 'regionTable', kind: 'hidden', label: s('Expenditures by region (table)', 'Dépenses par région (tableau)'), representation: 'text' },
    // Page 6 — remarks & certification
    { id: 'v.remarks', name: 'remarks', kind: 'collected', label: s('Remarks', 'Remarques'), representation: 'text' },
    { id: 'v.certName', name: 'certName', kind: 'collected', label: s('Name of person who approved the data reported', 'Nom de la personne qui a approuvé les données déclarées'), representation: 'text', isPII: true },
    { id: 'v.certTitle', name: 'certTitle', kind: 'collected', label: s('Official position', 'Fonction officielle'), representation: 'text' },
    { id: 'v.certDate', name: 'certDate', kind: 'collected', label: s('Date certified', "Date de l'attestation"), representation: 'datetime' },
    { id: 'v.certAgree', name: 'certAgree', kind: 'collected', label: s('Certification', 'Attestation'), representation: 'boolean' },
  ],

  prefillMappings: [],

  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [
      // ── Page 1 — Respondent information ───────────────────────────────
      {
        type: 'sequence',
        id: 'pg.cover',
        label: s('Respondent information', 'Renseignements sur le répondant'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.intro',
            text: s(
              "This demo is modeled on Statistics Canada's Federal Science Expenditures and Personnel (FSEP) survey, which collects federal departments' spending and staffing on science and technology activities. To keep the demo short, it covers a single reference year (the real survey collects three) and omits some breakdowns (e.g. personnel by gender, socio-economic objective). Report all dollar amounts in thousands.",
              "Cette démo s'inspire de l'enquête sur les dépenses fédérales au titre des sciences et le personnel scientifique (DFSPS) de Statistique Canada, qui recueille les dépenses et les effectifs des ministères fédéraux consacrés aux activités scientifiques et technologiques. Pour simplifier la démo, une seule année de référence est couverte (l'enquête réelle en couvre trois) et certaines ventilations sont omises (p. ex. le personnel selon le genre, l'objectif socio-économique). Déclarez tous les montants en milliers de dollars.",
            ),
          },
          {
            type: 'question',
            id: 'q.deptName',
            variableRef: 'deptName',
            text: s('Department or agency name', "Nom du ministère ou de l'organisme"),
            responseDomain: { type: 'text' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.contactName',
            variableRef: 'contactName',
            text: s('Name of person to contact for enquiries', 'Nom de la personne-ressource'),
            responseDomain: { type: 'text' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.contactEmail',
            variableRef: 'contactEmail',
            text: s('Contact email address', 'Adresse courriel de la personne-ressource'),
            responseDomain: { type: 'text' },
            required: true,
          },
        ],
      },

      // ── Page 2 — Section 1: Expenditures by activity and performer ────
      {
        type: 'sequence',
        id: 'pg.section1',
        label: s(
          'Section 1 — Expenditures by activity and performer (fiscal year 2026/2027)',
          'Section 1 — Dépenses selon l’activité et l’exécutant (exercice 2026-2027)',
        ),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.expRdTable',
            variableRef: 'expRdTable',
            text: s(
              'I. Research and experimental development (R&D)',
              'I. Recherche et développement expérimental (R-D)',
            ),
            instruction: s(
              'Creative, systematic work aimed at new findings. In-house activities are intramural; contracts, grants, fellowships and extramural program administration are paid to outside performers. The Total row and Total column are calculated automatically.',
              'Travaux créatifs et systématiques visant de nouvelles découvertes. Les activités internes sont intra-muros; les contrats, subventions, bourses et l’administration des programmes extra-muros sont versés à des exécutants externes. La ligne Total et la colonne Total sont calculées automatiquement.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.rdRows',
              colSchemeRef: 'cs.perfCols',
              variablePrefix: 'RD',
              unit: s('CAN$ ’000', 'k$ CAN'),
              min: 0,
              decimals: 0,
              totalRow: true,
              totalCol: true,
              disabledCells: [
                'inhouse:be', 'inhouse:he', 'inhouse:np', 'inhouse:gov', 'inhouse:fp',
                'contracts:intra', 'grants:intra', 'fellows:intra', 'admin:intra', 'capital:intra',
              ],
            },
            required: true,
          },
          {
            type: 'question',
            id: 'q.expRsaTable',
            variableRef: 'expRsaTable',
            text: s(
              'II. Related scientific activities (RSA)',
              'II. Activités scientifiques connexes (ASC)',
            ),
            instruction: s(
              'Systematic activities such as data collection, information services, and testing and standardization, that support but are distinct from R&D.',
              'Activités systématiques telles que la collecte de données, les services d’information ainsi que les essais et la normalisation, qui appuient la R-D sans en faire partie.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.rsaRows',
              colSchemeRef: 'cs.perfCols',
              variablePrefix: 'RSA',
              unit: s('CAN$ ’000', 'k$ CAN'),
              min: 0,
              decimals: 0,
              totalRow: true,
              totalCol: true,
              disabledCells: [
                'inhouse:be', 'inhouse:he', 'inhouse:np', 'inhouse:gov', 'inhouse:fp',
                'contracts:intra', 'grants:intra', 'admin:intra', 'capital:intra',
              ],
            },
            required: true,
          },
          {
            type: 'statement',
            id: 'stmt.sttotal',
            text: s(
              'III. Total scientific and technological (S&T) expenditures [I a) + II a)]: ${sum($RD_TOT_TOT, $RSA_TOT_TOT)} ’000',
              'III. Dépenses totales en sciences et technologie (S-T) [I a) + II a)] : ${sum($RD_TOT_TOT, $RSA_TOT_TOT)} k$',
            ),
          },
        ],
      },

      // ── Page 3 — Section 2: Personnel (FTE) ───────────────────────────
      {
        type: 'sequence',
        id: 'pg.section2',
        label: s(
          'Section 2 — Personnel (FTE) for intramural S&T activities',
          'Section 2 — Personnel (ETP) pour les activités de S-T intra-muros',
        ),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.personnelTable',
            variableRef: 'personnelTable',
            text: s(
              'Personnel in full-time equivalent for intramural scientific and technological activities',
              'Personnel en équivalent temps plein pour les activités scientifiques et technologiques intra-muros',
            ),
            instruction: s(
              'Report personnel in full-time equivalents (FTE) working on intramural scientific and technological activities. Fractional FTEs (e.g. 2.5) are accepted.',
              'Déclarez le personnel en équivalents temps plein (ETP) travaillant sur des activités scientifiques et technologiques intra-muros. Les ETP fractionnaires (p. ex. 2,5) sont acceptés.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.personnelRows',
              colSchemeRef: 'cs.personnelCols',
              variablePrefix: 'FTE',
              unit: s('Number of full-time equivalents (FTE)', 'Nombre d’équivalents temps plein (ETP)'),
              min: 0,
              decimals: 1,
              totalRow: true,
              totalCol: true,
            },
            required: true,
          },
        ],
      },

      // ── Page 4 — Section 3A(ii): Sources of funds ─────────────────────
      {
        type: 'sequence',
        id: 'pg.section3',
        label: s(
          'Section 3A (ii) — Sources of funds for total S&T activities',
          'Section 3A (ii) — Sources de financement des activités totales en S-T',
        ),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.fundsIntro',
            text: s(
              'Report the sources of funds for total S&T activities. The total must equal the S&T expenditures reported in Section 1.',
              'Déclarez les sources de financement des activités totales en S-T. Le total doit correspondre aux dépenses en S-T déclarées à la section 1.',
            ),
          },
          {
            type: 'question',
            id: 'q.deptBudget',
            variableRef: 'deptBudget',
            text: s(
              '1. Departmental S&T budget (operating, capital, and grants and contributions)',
              '1. Budget ministériel en S-T (fonctionnement, immobilisations, subventions et contributions)',
            ),
            responseDomain: { type: 'numeric', min: 0, unit: s('CAN$ ’000', 'k$ CAN') },
            required: true,
          },
          {
            type: 'question',
            id: 'q.netOtherFed',
            variableRef: 'netOtherFed',
            text: s(
              '2. Net revenues to/from other federal departments and agencies',
              "2. Revenus nets provenant d'autres ministères et organismes fédéraux",
            ),
            responseDomain: { type: 'numeric', unit: s('CAN$ ’000', 'k$ CAN') },
            required: true,
          },
          {
            type: 'question',
            id: 'q.provincial',
            variableRef: 'provincial',
            text: s('3. Provincial government departments', '3. Ministères des gouvernements provinciaux'),
            responseDomain: { type: 'numeric', min: 0, unit: s('CAN$ ’000', 'k$ CAN') },
            required: true,
          },
          {
            type: 'question',
            id: 'q.business',
            variableRef: 'business',
            text: s('4. Business enterprises', '4. Entreprises commerciales'),
            responseDomain: { type: 'numeric', min: 0, unit: s('CAN$ ’000', 'k$ CAN') },
            required: true,
          },
          {
            type: 'question',
            id: 'q.otherFunds',
            variableRef: 'otherFunds',
            text: s('5. Other (please specify in Remarks)', '5. Autres (précisez dans les remarques)'),
            responseDomain: { type: 'numeric', min: 0, unit: s('CAN$ ’000', 'k$ CAN') },
            required: true,
            edits: [
              {
                id: 'edit.funds.balance',
                type: 'hard',
                when: 'isAnswered($deptBudget) && isAnswered($RD_TOT_TOT) && isAnswered($RSA_TOT_TOT) && $fundsTotal != ($RD_TOT_TOT + $RSA_TOT_TOT)',
                message: s(
                  'Total sources of funds must equal the total S&T expenditures reported in Section 1.',
                  'Le total des sources de financement doit correspondre aux dépenses totales en S-T déclarées à la section 1.',
                ),
                scope: ['deptBudget', 'netOtherFed', 'provincial', 'business', 'otherFunds'],
              },
            ],
          },
          {
            type: 'statement',
            id: 'stmt.fundsTotal',
            text: s(
              'Total sources of funds: ${fundsTotal} ’000',
              'Total des sources de financement : ${fundsTotal} k$',
            ),
          },
        ],
      },

      // ── Page 5 — Section 5: Expenditures by region ────────────────────
      {
        type: 'sequence',
        id: 'pg.section5',
        label: s('Section 5 — Expenditures by region', 'Section 5 — Dépenses par région'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.regionTable',
            variableRef: 'regionTable',
            text: s(
              'Expenditures on intramural scientific and technological activities by region',
              'Dépenses au titre des activités scientifiques et technologiques intra-muros par région',
            ),
            instruction: s(
              'Report intramural R&D and RSA expenditures by region where the work was performed. The full FSEP survey also collects personnel by region; omitted here for brevity.',
              'Déclarez les dépenses de R-D et d’ASC intra-muros par région où les travaux ont été exécutés. L’enquête complète recueille aussi le personnel par région; omis ici par souci de concision.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.regionRows',
              colSchemeRef: 'cs.regionCols',
              variablePrefix: 'REG',
              unit: s('CAN$ ’000', 'k$ CAN'),
              min: 0,
              decimals: 0,
              totalRow: true,
              totalCol: true,
            },
            edits: [
              {
                id: 'edit.region.check',
                type: 'soft',
                when: 'isAnswered($REG_TOT_curRd) && isAnswered($RD_inhouse_intra) && $REG_TOT_curRd != $RD_inhouse_intra',
                message: s(
                  'Total current R&D across all regions should equal the in-house R&D (Intramural) amount reported in Section 1. Please review if these do not match.',
                  'Le total de la R-D courante pour l’ensemble des régions devrait correspondre au montant de la R-D interne (intra-muros) déclaré à la section 1. Veuillez vérifier si ces montants ne correspondent pas.',
                ),
              },
            ],
          },
        ],
      },

      // ── Page 6 — Remarks & certification ──────────────────────────────
      {
        type: 'sequence',
        id: 'pg.certify',
        label: s('Remarks and certification', 'Remarques et attestation'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.remarks',
            variableRef: 'remarks',
            text: s(
              'Remarks — reasons for significant changes from the previous reporting period (the FSEP “change report”)',
              'Remarques — raisons des changements importants par rapport à la période de référence précédente (le « rapport des changements » de l’enquête)',
            ),
            responseDomain: { type: 'text', multiline: true },
          },
          {
            type: 'question',
            id: 'q.certName',
            variableRef: 'certName',
            text: s('Name of person who approved the data reported', 'Nom de la personne qui a approuvé les données déclarées'),
            responseDomain: { type: 'text' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.certTitle',
            variableRef: 'certTitle',
            text: s('Official position', 'Fonction officielle'),
            responseDomain: { type: 'text' },
          },
          {
            type: 'question',
            id: 'q.certDate',
            variableRef: 'certDate',
            text: s('Date', 'Date'),
            responseDomain: { type: 'datetime', mode: 'date' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.certAgree',
            variableRef: 'certAgree',
            text: s(
              'I certify that the information reported is accurate to the best of my knowledge.',
              'J’atteste que les renseignements déclarés sont exacts au meilleur de ma connaissance.',
            ),
            responseDomain: { type: 'boolean' },
            required: true,
          },
        ],
      },
    ],
  },
};
