/**
 * Spec Mismatch Survey — demonstrates discrepancies between design spec and implementation.
 *
 * This instrument is paired with a design spec document (SPEC.md in the project root).
 * The bot should flag differences in:
 * - Question text/wording
 * - Response options (missing, extra, reordered)
 * - Required/optional status
 * - Validation rules
 * - Routing logic
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string): InternationalString => ({ en });

export const specMismatchInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:spec-mismatch:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Product Feedback Survey (with Spec Mismatches)'),
    description: s(
      'Intentionally implements a survey differently from the design spec to demonstrate bot detection of mismatches.',
    ),
  },

  concepts: [],
  universes: [],

  categorySchemes: [
    {
      id: 'cs.products',
      label: s('Products'),
      categories: [
        { code: 'A', label: s('Product A') },
        { code: 'B', label: s('Product B') },
        // SPEC MISMATCH: Design spec includes Product C, but implementation omits it
        // { code: 'C', label: s('Product C') },
      ],
    },
    {
      id: 'cs.rating',
      label: s('Rating Scale'),
      categories: [
        { code: '1', label: s('Poor') },
        { code: '2', label: s('Fair') },
        // SPEC MISMATCH: Design spec uses 1-5; implementation uses 1-4 (swapped 4,5)
        { code: '3', label: s('Excellent') },
        { code: '4', label: s('Good') },
      ],
    },
    {
      id: 'cs.features',
      label: s('Features'),
      categories: [
        { code: 'perf', label: s('Performance') },
        { code: 'ease', label: s('Ease of use') },
        // SPEC MISMATCH: Design spec includes "Documentation", implementation omits
        { code: 'cost', label: s('Price / Cost') },
      ],
    },
  ],

  variables: [
    {
      id: 'v.product',
      name: 'product',
      kind: 'collected',
      label: s('Which product did you use?'),
      representation: 'code',
      categorySchemeRef: 'cs.products',
    },
    {
      id: 'v.rating',
      name: 'rating',
      kind: 'collected',
      label: s('Please rate the product (1=poor, 5=excellent)'), // SPEC MISMATCH: says 1-5, but only 1-4 in categories
      representation: 'code',
      categorySchemeRef: 'cs.rating',
    },
    {
      id: 'v.used_before',
      name: 'used_before',
      kind: 'collected',
      label: s('Have you used this product before?'),
      representation: 'boolean',
    },
    {
      id: 'v.purchase_intent',
      name: 'purchase_intent',
      kind: 'collected',
      label: s('Would you purchase this product?'), // SPEC MISMATCH: Design says optional, implementation marks required
      representation: 'code',
      categorySchemeRef: 'cs.products', // WRONG SCHEME
    },
    {
      id: 'v.improvement',
      name: 'improvement',
      kind: 'collected',
      label: s('What could we improve?'),
      representation: 'text',
    },
    {
      id: 'v.feature_priority',
      name: 'feature_priority',
      kind: 'collected',
      label: s('Which feature matters most to you?'),
      representation: 'code',
      categorySchemeRef: 'cs.features',
      // SPEC MISMATCH: Design says allow multiple, implementation is single
    },
  ],

  prefillMappings: [],

  sequence: {
    type: 'sequence',
    id: 'root',
    children: [
      {
        type: 'statement',
        id: 'stmt.welcome',
        // SPEC MISMATCH: Design says "Quick survey" (3 mins), implementation says "brief" (no time estimate)
        text: s('Thank you for trying our products. This brief survey will help us improve.'),
      },

      // Q1: Product selection
      {
        type: 'question',
        id: 'c.product',
        variableRef: 'product',
        text: s('Which of our products have you used?'),
        // SPEC MISMATCH: Design includes Product C, implementation doesn't
        responseDomain: { type: 'code', categorySchemeRef: 'cs.products', selection: 'single' },
        required: true,
      },

      // Q2: Prior use
      {
        type: 'question',
        id: 'c.used_before',
        variableRef: 'used_before',
        text: s('Is this your first time using this product?'),
        // SPEC MISMATCH: Design says "Have you used before?", implementation says "Is this first time?"
        responseDomain: { type: 'boolean' },
      },

      // Q3: Rating
      {
        type: 'question',
        id: 'c.rating',
        variableRef: 'rating',
        text: s('Rate this product (1=poor, 5=excellent)'),
        // SPEC MISMATCH: Implementation only has 1-4, but text says 1-5
        responseDomain: { type: 'code', categorySchemeRef: 'cs.rating', selection: 'single' },
        required: true,
      },

      // Q4: Purchase intent (visible only if used_before = true)
      // SPEC MISMATCH: Design says always visible, implementation makes it conditional
      {
        type: 'ifThenElse',
        id: 'if.used_before',
        condition: '$used_before == true',
        then: [
          {
            type: 'question',
            id: 'c.purchase_intent',
            variableRef: 'purchase_intent',
            text: s('Would you purchase this product again?'),
            responseDomain: {
              type: 'code',
              categorySchemeRef: 'cs.products', // WRONG: should be yesno scheme, not products
              selection: 'single',
            },
            required: true,
          },
        ],
      },

      // Q5: Feature priority
      {
        type: 'question',
        id: 'c.feature_priority',
        variableRef: 'feature_priority',
        text: s('Which feature matters most to you?'),
        // SPEC MISMATCH: Design says "select all", implementation is single
        responseDomain: { type: 'code', categorySchemeRef: 'cs.features', selection: 'single' },
      },

      // Q6: Improvement
      {
        type: 'question',
        id: 'c.improvement',
        variableRef: 'improvement',
        text: s('Please describe one improvement we could make.'),
        // SPEC MISMATCH: Design says optional, implementation marks required
        responseDomain: { type: 'text', multiline: true },
        required: true,
      },

      {
        type: 'statement',
        id: 'stmt.thanks',
        // SPEC MISMATCH: Design says "Your responses are valuable…", implementation says just "Thank you"
        text: s('Thank you for your feedback!'),
      },
    ],
  },
};
