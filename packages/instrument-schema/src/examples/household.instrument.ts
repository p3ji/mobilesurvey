/**
 * Bilingual (EN/FR) household survey demonstrating the full breadth of the schema:
 * a NESTED ROSTER (household members → each member's employers), hidden + derived variables,
 * a hard edit and soft edits, text piping, a mid-interview computation, and pre-fill mappings.
 *
 * Used by the designer as the default document and by the schema test-suite.
 */
import type { Instrument, InternationalString } from '../types.js';

/** Compact bilingual string helper. */
const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const householdInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:household:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Household & Employment Survey', "Enquête sur le ménage et l'emploi"),
    agency: 'Demo Statistical Agency',
    description: s(
      'A short demonstration instrument covering household composition and employment.',
      "Un court instrument de démonstration sur la composition du ménage et l'emploi.",
    ),
    created: '2026-06-24T00:00:00.000Z',
  },
  concepts: [
    { id: 'c.household', label: s('Household composition', 'Composition du ménage') },
    { id: 'c.employment', label: s('Employment', 'Emploi') },
  ],
  universes: [
    {
      id: 'u.adults',
      label: s('Members aged 15+', 'Membres âgés de 15 ans et plus'),
      clause: '$memberAge >= 15',
    },
  ],
  categorySchemes: [
    {
      id: 'cs.relationship',
      label: s('Relationship to respondent', 'Lien avec le répondant'),
      categories: [
        { code: 'self', label: s('Self', 'Soi-même') },
        { code: 'spouse', label: s('Spouse/partner', 'Conjoint(e)') },
        { code: 'child', label: s('Child', 'Enfant') },
        { code: 'parent', label: s('Parent', 'Parent') },
        { code: 'other', label: s('Other', 'Autre') },
      ],
    },
  ],
  variables: [
    // Pre-filled, respondent-invisible administrative values.
    {
      id: 'v.respondentName',
      name: 'respondentName',
      kind: 'hidden',
      label: s('Respondent name', 'Nom du répondant'),
      representation: 'text',
    },
    {
      id: 'v.region',
      name: 'region',
      kind: 'hidden',
      label: s('Region code', 'Code de région'),
      representation: 'text',
    },
    // Collected.
    {
      id: 'v.hhSize',
      name: 'hhSize',
      kind: 'collected',
      label: s('Household size', 'Taille du ménage'),
      representation: 'numeric',
      conceptRef: 'c.household',
    },
    {
      id: 'v.memberName',
      name: 'memberName',
      kind: 'collected',
      label: s('Member name', 'Nom du membre'),
      representation: 'text',
    },
    {
      id: 'v.memberAge',
      name: 'memberAge',
      kind: 'collected',
      label: s('Member age', 'Âge du membre'),
      representation: 'numeric',
    },
    {
      id: 'v.relationship',
      name: 'relationship',
      kind: 'collected',
      label: s('Relationship', 'Lien'),
      representation: 'code',
      categorySchemeRef: 'cs.relationship',
    },
    {
      id: 'v.employerCount',
      name: 'employerCount',
      kind: 'collected',
      label: s('Number of employers (past 12 months)', "Nombre d'employeurs (12 derniers mois)"),
      representation: 'numeric',
      conceptRef: 'c.employment',
    },
    {
      id: 'v.employerName',
      name: 'employerName',
      kind: 'collected',
      label: s('Employer name', "Nom de l'employeur"),
      representation: 'text',
    },
    {
      id: 'v.annualIncome',
      name: 'annualIncome',
      kind: 'collected',
      label: s('Annual income from employer', "Revenu annuel de l'employeur"),
      representation: 'numeric',
    },
    // Derived (auto-computed) and a flag set by an explicit computation construct.
    {
      id: 'v.largeHousehold',
      name: 'largeHousehold',
      kind: 'derived',
      label: s('Large household flag', 'Indicateur de grand ménage'),
      representation: 'boolean',
      compute: '$hhSize > 5',
    },
    {
      id: 'v.flagReview',
      name: 'flagReview',
      kind: 'hidden',
      label: s('Manual review flag', "Indicateur d'examen manuel"),
      representation: 'boolean',
    },
  ],
  prefillMappings: [
    { sampleField: 'contact_name', targetVariable: 'respondentName' },
    { sampleField: 'region_code', targetVariable: 'region' },
  ],
  sequence: {
    type: 'sequence',
    id: 'seq.root',
    label: s('Household survey', 'Enquête sur le ménage'),
    children: [
      {
        type: 'statement',
        id: 'stmt.intro',
        // Piping: respondentName is injected from the sample/CMS context.
        text: s(
          'Hello ${respondentName}, this survey asks about your household.',
          'Bonjour ${respondentName}, ce questionnaire porte sur votre ménage.',
        ),
      },
      {
        type: 'question',
        id: 'q.hhSize',
        variableRef: 'hhSize',
        text: s('How many people live in your household?', 'Combien de personnes vivent dans votre ménage ?'),
        responseDomain: { type: 'numeric', min: 1, max: 20, decimals: 0 },
        required: true,
        edits: [
          {
            id: 'edit.hhSize.range',
            type: 'hard',
            when: '$hhSize < 1 || $hhSize > 20',
            message: s(
              'Household size must be between 1 and 20.',
              'La taille du ménage doit être comprise entre 1 et 20.',
            ),
            scope: ['hhSize'],
          },
        ],
      },
      {
        // ROSTER 1 — one iteration per household member.
        type: 'loop',
        id: 'loop.members',
        label: s('Household members', 'Membres du ménage'),
        countVariableRef: 'hhSize',
        loopVariable: 'm',
        itemLabel: s('Member ${m}', 'Membre ${m}'),
        children: [
          {
            type: 'question',
            id: 'q.memberName',
            variableRef: 'memberName',
            text: s('Name of member ${m}', 'Nom du membre ${m}'),
            responseDomain: { type: 'text', maxLength: 80 },
            required: true,
          },
          {
            type: 'question',
            id: 'q.memberAge',
            variableRef: 'memberAge',
            text: s('Age of ${memberName}', 'Âge de ${memberName}'),
            responseDomain: { type: 'numeric', min: 0, max: 120, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.memberAge.high',
                type: 'soft',
                when: '$memberAge > 110',
                message: s(
                  'That age is unusually high — please confirm.',
                  'Cet âge est anormalement élevé — veuillez confirmer.',
                ),
                scope: ['memberAge'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.relationship',
            variableRef: 'relationship',
            text: s('Relationship of ${memberName} to you', 'Lien de ${memberName} avec vous'),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.relationship', selection: 'single' },
            required: true,
          },
          {
            type: 'question',
            id: 'q.employerCount',
            variableRef: 'employerCount',
            text: s(
              'How many employers did ${memberName} have in the past 12 months?',
              "Combien d'employeurs ${memberName} a-t-il eu au cours des 12 derniers mois ?",
            ),
            responseDomain: { type: 'numeric', min: 0, max: 10, decimals: 0 },
            visibleWhen: '$memberAge >= 15',
          },
          {
            // ROSTER 2 (NESTED) — one iteration per employer of the current member.
            type: 'loop',
            id: 'loop.employers',
            label: s('Employers', 'Employeurs'),
            countVariableRef: 'employerCount',
            loopVariable: 'e',
            itemLabel: s('Employer ${e}', 'Employeur ${e}'),
            visibleWhen: '$employerCount > 0',
            children: [
              {
                type: 'question',
                id: 'q.employerName',
                variableRef: 'employerName',
                text: s('Name of employer ${e}', "Nom de l'employeur ${e}"),
                responseDomain: { type: 'text', maxLength: 120 },
                required: true,
              },
              {
                type: 'question',
                id: 'q.annualIncome',
                variableRef: 'annualIncome',
                text: s('Annual income from this employer', 'Revenu annuel de cet employeur'),
                responseDomain: { type: 'numeric', min: 0, decimals: 0, unit: s('USD', 'USD') },
                edits: [
                  {
                    id: 'edit.income.high',
                    type: 'soft',
                    when: '$annualIncome > 1000000',
                    message: s(
                      'Income over 1,000,000 — please confirm this is correct.',
                      'Revenu supérieur à 1 000 000 — veuillez confirmer son exactitude.',
                    ),
                    scope: ['annualIncome'],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        // Mid-interview computation assigning a hidden review flag.
        type: 'computation',
        id: 'comp.flagReview',
        targetVariableRef: 'flagReview',
        expression: '$hhSize > 10',
      },
      {
        type: 'statement',
        id: 'stmt.thanks',
        text: s('Thank you for completing the survey.', "Merci d'avoir répondu au questionnaire."),
      },
    ],
  },
};
