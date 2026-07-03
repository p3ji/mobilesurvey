/**
 * "Business Operations Report (Demo)" — a bilingual (EN/FR) establishment-survey sample modeled
 * on statistical-agency operations reports (e.g. the StatCan Government Liquor Authority report):
 * numeric data tables with computed totals, a cross-section balance edit that references a table
 * total from an earlier section, disabled cells, units in thousands, variance remarks, and a
 * certification block.
 *
 * Exploration-only: registered with `collectsData: false`, so it never persists to any backend.
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const bizdemoInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:bizdemo:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Business Operations Report (Demo)', "Rapport d'exploitation d'entreprise (démo)"),
    agency: 'Example Statistical Agency',
    description: s(
      'A demo establishment survey: data tables with live totals, balance edits, and a certification block. Nothing is collected or stored.',
      "Un sondage-établissement de démonstration : tableaux de données avec totaux en direct, contrôles d'équilibre et bloc d'attestation. Rien n'est recueilli ni conservé.",
    ),
    created: '2026-07-03T00:00:00.000Z',
  },

  concepts: [
    { id: 'c.finances', label: s('Business finances', "Finances de l'entreprise") },
    { id: 'c.operations', label: s('Business operations', "Activités de l'entreprise") },
  ],
  universes: [],

  categorySchemes: [
    {
      id: 'cs.bevRows',
      label: s('Beverage types', 'Types de boissons'),
      categories: [
        { code: 'spirits', label: s('Spirits', 'Spiritueux') },
        { code: 'wine', label: s('Wine', 'Vin') },
        { code: 'beer', label: s('Beer', 'Bière') },
        { code: 'other', label: s('Ciders, coolers & other', 'Cidres, panachés et autres') },
      ],
    },
    {
      id: 'cs.salesCols',
      label: s('Sales measures', 'Mesures des ventes'),
      categories: [
        { code: 'vol', label: s('Volume (’000 litres)', 'Volume (litres, en milliers)') },
        { code: 'val', label: s('Value ($ ’000)', 'Valeur ($, en milliers)') },
      ],
    },
    {
      id: 'cs.originRows',
      label: s('Product origin', 'Origine du produit'),
      categories: [
        { code: 'dom', label: s('Domestic', 'Canadien') },
        { code: 'imp', label: s('Imported', 'Importé') },
      ],
    },
  ],

  variables: [
    // Page 1 — reporting period
    { id: 'v.bizName', name: 'bizName', kind: 'collected', label: s('Business name', "Nom de l'entreprise"), representation: 'text' },
    { id: 'v.fyEnd', name: 'fyEnd', kind: 'collected', label: s('Fiscal year end', "Fin de l'exercice"), representation: 'datetime' },
    // Page 2 — Section 1: outlets
    { id: 'v.outletsStores', name: 'outletsStores', kind: 'collected', label: s('Stores operated by the business', "Magasins exploités par l'entreprise"), representation: 'numeric', conceptRef: 'c.operations' },
    { id: 'v.outletsAgencies', name: 'outletsAgencies', kind: 'collected', label: s('Agency outlets', 'Points de vente agréés'), representation: 'numeric', conceptRef: 'c.operations' },
    { id: 'v.outletsTotal', name: 'outletsTotal', kind: 'derived', label: s('Total retail outlets (derived)', 'Total des points de vente (dérivé)'), representation: 'numeric', compute: '$outletsStores + $outletsAgencies' },
    // Page 3 — Section 2: income statement
    { id: 'v.revGross', name: 'revGross', kind: 'collected', label: s('Gross sales revenue ($ ’000)', "Revenus bruts des ventes ($, en milliers)"), representation: 'numeric', conceptRef: 'c.finances' },
    { id: 'v.costGoods', name: 'costGoods', kind: 'collected', label: s('Cost of goods sold ($ ’000)', 'Coût des marchandises vendues ($, en milliers)'), representation: 'numeric', conceptRef: 'c.finances' },
    { id: 'v.expOperating', name: 'expOperating', kind: 'collected', label: s('Operating expenses ($ ’000)', "Frais d'exploitation ($, en milliers)"), representation: 'numeric', conceptRef: 'c.finances' },
    { id: 'v.netIncome', name: 'netIncome', kind: 'derived', label: s('Net income (derived)', 'Revenu net (dérivé)'), representation: 'numeric', compute: '$revGross - $costGoods - $expOperating' },
    // Page 4 — table anchors (hidden; table cells generate their own variables)
    { id: 'v.salesTable', name: 'salesTable', kind: 'hidden', label: s('Sales by beverage type (table)', 'Ventes par type de boisson (tableau)'), representation: 'text' },
    { id: 'v.purchTable', name: 'purchTable', kind: 'hidden', label: s('Wine purchases by origin (table)', 'Achats de vin selon l’origine (tableau)'), representation: 'text' },
    // Page 5 — remarks & certification
    { id: 'v.remarks', name: 'remarks', kind: 'collected', label: s('Remarks', 'Remarques'), representation: 'text' },
    { id: 'v.certName', name: 'certName', kind: 'collected', label: s('Name of certifier', "Nom de l'attestataire"), representation: 'text', isPII: true },
    { id: 'v.certTitle', name: 'certTitle', kind: 'collected', label: s('Official position', 'Fonction officielle'), representation: 'text' },
    { id: 'v.certDate', name: 'certDate', kind: 'collected', label: s('Date certified', "Date de l'attestation"), representation: 'datetime' },
    { id: 'v.certAgree', name: 'certAgree', kind: 'collected', label: s('Certification', 'Attestation'), representation: 'boolean' },
  ],

  prefillMappings: [],

  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [
      // ── Page 1 — Reporting period ─────────────────────────────────────
      {
        type: 'sequence',
        id: 'pg.period',
        label: s('Reporting period', 'Période de référence'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.intro',
            text: s(
              'This demo shows how establishment surveys collect form/spreadsheet data from organizations: data tables with live totals, balance rules, and a certification block. Report all amounts in thousands.',
              'Cette démo montre comment les enquêtes-établissements recueillent des données de type formulaire/tableur auprès des organisations : tableaux avec totaux en direct, règles d’équilibre et bloc d’attestation. Déclarez tous les montants en milliers.',
            ),
          },
          {
            type: 'question',
            id: 'q.bizName',
            variableRef: 'bizName',
            text: s('Legal name of business or organization', "Raison sociale de l'entreprise ou de l'organisation"),
            responseDomain: { type: 'text' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.fyEnd',
            variableRef: 'fyEnd',
            text: s('For the fiscal year ended', "Pour l'exercice terminé le"),
            responseDomain: { type: 'datetime', mode: 'date' },
            required: true,
          },
        ],
      },

      // ── Page 2 — Section 1: Retail outlets ────────────────────────────
      {
        type: 'sequence',
        id: 'pg.outlets',
        label: s('Section 1 — Retail outlets at year end', 'Section 1 — Points de vente à la fin de l’exercice'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.outletsStores',
            variableRef: 'outletsStores',
            text: s('1. Stores operated by the business (number)', "1. Magasins exploités par l'entreprise (nombre)"),
            responseDomain: { type: 'numeric', min: 0, decimals: 0 },
            required: true,
          },
          {
            type: 'question',
            id: 'q.outletsAgencies',
            variableRef: 'outletsAgencies',
            text: s('2. Agency outlets (number)', '2. Points de vente agréés (nombre)'),
            responseDomain: { type: 'numeric', min: 0, decimals: 0 },
            required: true,
          },
          {
            type: 'statement',
            id: 'stmt.outletsTotal',
            text: s(
              'Total number of retail outlets: ${outletsTotal}',
              'Nombre total de points de vente : ${outletsTotal}',
            ),
          },
        ],
      },

      // ── Page 3 — Section 2: Finances (balance edit refers FORWARD to the Section 3 table) ──
      {
        type: 'sequence',
        id: 'pg.finances',
        label: s('Section 2 — Finances ($ ’000)', 'Section 2 — Finances ($, en milliers)'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.revGross',
            variableRef: 'revGross',
            text: s('1. Gross sales revenue', '1. Revenus bruts des ventes'),
            instruction: s(
              'Must equal Total – Value reported in Section 3.',
              'Doit être égal au Total – Valeur déclaré à la section 3.',
            ),
            responseDomain: { type: 'numeric', min: 0, unit: s('$ ’000', '$ (milliers)') },
            required: true,
            edits: [
              {
                id: 'edit.revGross.balance',
                type: 'hard',
                when: 'isAnswered($SALES_TOT_val) && $revGross != $SALES_TOT_val',
                message: s(
                  'Gross sales revenue must equal the Total – Value of sales reported in Section 3.',
                  'Les revenus bruts doivent être égaux au Total – Valeur des ventes déclaré à la section 3.',
                ),
                scope: ['revGross'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.costGoods',
            variableRef: 'costGoods',
            text: s('2. Cost of goods sold', '2. Coût des marchandises vendues'),
            responseDomain: { type: 'numeric', min: 0, unit: s('$ ’000', '$ (milliers)') },
            required: true,
          },
          {
            type: 'question',
            id: 'q.expOperating',
            variableRef: 'expOperating',
            text: s('3. Selling and administrative expenses', '3. Frais de vente et d’administration'),
            responseDomain: { type: 'numeric', min: 0, unit: s('$ ’000', '$ (milliers)') },
            required: true,
          },
          {
            type: 'statement',
            id: 'stmt.netIncome',
            text: s(
              '4. Net income [1 minus 2 minus 3]: ${netIncome}',
              '4. Revenu net [1 moins 2 moins 3] : ${netIncome}',
            ),
          },
        ],
      },

      // ── Page 4 — Section 3: Sales tables ──────────────────────────────
      {
        type: 'sequence',
        id: 'pg.sales',
        label: s('Section 3 — Sales by beverage type', 'Section 3 — Ventes par type de boisson'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.salesTable',
            variableRef: 'salesTable',
            text: s('1. Sales by beverage type', '1. Ventes par type de boisson'),
            instruction: s(
              'Exclude taxes and container value. Tip: copy a block of cells in a spreadsheet and paste it into the table.',
              'Excluez les taxes et la valeur des contenants. Astuce : copiez un bloc de cellules d’un tableur et collez-le dans le tableau.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.bevRows',
              colSchemeRef: 'cs.salesCols',
              variablePrefix: 'SALES',
              unit: s('in thousands', 'en milliers'),
              min: 0,
              decimals: 0,
              totalRow: true,
              disabledCells: ['other:vol'],
            },
            required: true,
            edits: [
              {
                id: 'edit.sales.large',
                type: 'soft',
                when: '$SALES_TOT_val > 100000',
                message: s(
                  'Total sales value exceeds $100 million — please confirm, or explain in the Remarks section.',
                  'La valeur totale des ventes dépasse 100 millions de dollars — veuillez confirmer ou expliquer dans la section Remarques.',
                ),
              },
            ],
          },
          {
            type: 'question',
            id: 'q.purchTable',
            variableRef: 'purchTable',
            text: s('2. Wine purchases for resale, by origin', '2. Achats de vin pour la revente, selon l’origine'),
            instruction: s(
              'Group subtotals are modeled as one table per group — this second table has its own Total row.',
              'Les sous-totaux de groupe sont modélisés par un tableau par groupe — ce second tableau a sa propre ligne Total.',
            ),
            responseDomain: {
              type: 'table',
              rowSchemeRef: 'cs.originRows',
              colSchemeRef: 'cs.salesCols',
              variablePrefix: 'PURCH',
              unit: s('in thousands', 'en milliers'),
              min: 0,
              decimals: 0,
              totalRow: true,
            },
          },
        ],
      },

      // ── Page 5 — Remarks & certification ──────────────────────────────
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
              'Remarks — reasons for significant changes from the previous reporting period',
              'Remarques — raisons des variations importantes par rapport à la période précédente',
            ),
            responseDomain: { type: 'text', multiline: true },
          },
          {
            type: 'question',
            id: 'q.certName',
            variableRef: 'certName',
            text: s('Name of person completing this report', 'Nom de la personne remplissant ce rapport'),
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
