/**
 * Test Error Survey — demonstrates issues that the Questionnaire Tester bot should catch.
 *
 * Includes:
 * - Textual errors (typos, inconsistencies)
 * - Logical errors (dead-end flows, unreachable questions)
 * - Soft edit violations (validation rules)
 * - Spec mismatches (intentional differences from design)
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr?: string): InternationalString => ({ en, fr: fr ?? en });

export const testErrorsInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:test-errors:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Test Error Survey'),
    description: s(
      'Demonstrates intentional errors for bot testing: typos, dead-end flows, validation issues, and spec mismatches.',
    ),
  },

  concepts: [],
  universes: [],

  categorySchemes: [
    {
      id: 'cs.yesno',
      label: s('Yes / No'),
      categories: [
        { code: 'yes', label: s('Yes') },
        { code: 'no', label: s('No') },
      ],
    },
    {
      id: 'cs.satisfaction',
      label: s('Satisfaction'),
      categories: [
        { code: 'very_satisfied', label: s('Very satisfied') },
        { code: 'satisfied', label: s('Satisfied') },
        { code: 'neutral', label: s('Neutral') },
        { code: 'dissatisfied', label: s('Dissatisfied') },
        { code: 'very_dissatisfied', label: s('Very dissatisfied') },
      ],
    },
  ],

  variables: [
    {
      id: 'v.intro_seen',
      name: 'intro_seen',
      kind: 'hidden',
      label: s('Intro seen'),
      representation: 'boolean',
      compute: 'true',
    },
    {
      id: 'v.has_account',
      name: 'has_account',
      kind: 'collected',
      label: s('Do you have an acount with us?'), // TYPO: "acount" should be "account"
      representation: 'code',
      categorySchemeRef: 'cs.yesno',
    },
    {
      id: 'v.account_age',
      name: 'account_age',
      kind: 'collected',
      label: s('How long have you been a member?'),
      representation: 'numeric',
    },
    {
      id: 'v.satisfaction',
      name: 'satisfaction',
      kind: 'collected',
      label: s('How satisfied are you with our service?'),
      representation: 'code',
      categorySchemeRef: 'cs.satisfaction',
    },
    {
      id: 'v.nps',
      name: 'nps',
      kind: 'collected',
      label: s('How likely are you to recommend us? (0-10)'),
      representation: 'numeric',
    },
    {
      id: 'v.comments',
      name: 'comments',
      kind: 'collected',
      label: s('Additional comments'),
      representation: 'text',
    },
    {
      id: 'v.dead_end_question',
      name: 'dead_end_question',
      kind: 'collected',
      label: s('This question only appears when has_account=maybe (which does not exist)'),
      representation: 'text',
    },
    {
      id: 'v.soft_edit_triggered',
      name: 'soft_edit_triggered',
      kind: 'collected',
      label: s('Age (20-65 recommended)'),
      representation: 'numeric',
    },
  ],

  prefillMappings: [],

  sequence: {
    type: 'sequence',
    id: 'root',
    children: [
      {
        type: 'statement',
        id: 'stmt.intro',
        text: s(
          'Welcome to our survey. Please answer the following questions about your experiance with us.', // TYPO: "experiance" should be "experience"
        ),
      },

      // Question 1: account status
      {
        type: 'question',
        id: 'c.has_account',
        variableRef: 'has_account',
        text: s('Do you have an acount with us?'), // INTENTIONAL TYPO (matches variable label)
        responseDomain: { type: 'code', categorySchemeRef: 'cs.yesno', selection: 'single' },
        required: true,
      },

      // Question 2: account age (only if has_account = yes)
      {
        type: 'ifThenElse',
        id: 'if.has_account_yes',
        condition: '$has_account == "yes"',
        then: [
          {
            type: 'question',
            id: 'c.account_age',
            variableRef: 'account_age',
            text: s('How long have you been a member (in years)?'),
            responseDomain: { type: 'numeric', min: 0, max: 100 },
            required: true,
          },
        ],
      },

      // Question 3: satisfaction
      {
        type: 'question',
        id: 'c.satisfaction',
        variableRef: 'satisfaction',
        text: s('How satisfied are you with our service?'),
        responseDomain: { type: 'code', categorySchemeRef: 'cs.satisfaction', selection: 'single' },
        required: true,
      },

      // Question 4: NPS (only if satisfaction is not very_dissatisfied)
      {
        type: 'ifThenElse',
        id: 'if.nps_eligible',
        condition: '$satisfaction != "very_dissatisfied"',
        then: [
          {
            type: 'question',
            id: 'c.nps',
            variableRef: 'nps',
            text: s('How likely are you to recommend us? (0=not at all, 10=very likely)'),
            responseDomain: { type: 'numeric', min: 0, max: 10 },
            required: true,
            edits: [
              {
                id: 'edit.nps_range',
                type: 'hard',
                when: '$nps < 0 || $nps > 10',
                message: s('Please enter a score between 0 and 10.'),
              },
            ],
          },
        ],
      },

      // DEAD END FLOW: This question references a code value "maybe" that does not exist in has_account
      {
        type: 'ifThenElse',
        id: 'if.dead_end',
        condition: '$has_account == "maybe"',
        then: [
          {
            type: 'question',
            id: 'c.dead_end_question',
            variableRef: 'dead_end_question',
            text: s('This question is unreachable (condition can never be true).'),
            responseDomain: { type: 'text' },
          },
        ],
      },

      // Question 5: soft edit testing
      {
        type: 'question',
        id: 'c.soft_edit_triggered',
        variableRef: 'soft_edit_triggered',
        text: s('What is your age? (Recommended: 20–65)'),
        responseDomain: { type: 'numeric', min: 0, max: 120 },
        edits: [
          {
            id: 'edit.age_soft',
            type: 'soft',
            when: '$soft_edit_triggered < 20 || $soft_edit_triggered > 65',
            message: s('This age is outside our typical range. Continue?'),
          },
        ],
      },

      // Question 6: comments
      {
        type: 'question',
        id: 'c.comments',
        variableRef: 'comments',
        text: s('Any other comments or feedback?'),
        responseDomain: { type: 'text', multiline: true },
      },

      // SPEC MISMATCH: Design says "Thank you for completing the survey"
      // but implementation says "Thank you for your time"
      {
        type: 'statement',
        id: 'stmt.thankyou',
        text: s('Thank you for your time.'),
      },
    ],
  },
};
