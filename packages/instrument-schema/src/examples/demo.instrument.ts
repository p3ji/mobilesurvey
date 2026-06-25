/**
 * "Feature Demo Survey" — a bilingual (EN/FR) sample that collects **no personal information** and
 * exercises **every response-domain type** plus every construct (pages, a section, a branch, a
 * roster, a computation, a derived variable, statements, edits, piping).
 *
 * It is a teaching survey: show how to edit a survey (and reuse questions from the registry),
 * render & launch it, complete it, and view the collected data in analytics. Anonymous by design —
 * no name/contact/demographic fields, no pre-fill mappings.
 */
import type { Instrument, InternationalString } from '../types.js';

const s = (en: string, fr: string): InternationalString => ({ en, fr });

export const demoInstrument: Instrument = {
  id: 'urn:ddi:mobilesurvey:demo:1.0',
  version: '1.0.0',
  ddiProfile: 'ddi-lifecycle-3.3',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  metadata: {
    title: s('Feature Demo Survey', 'Sondage de démonstration'),
    agency: 'Example Org',
    description: s(
      'An anonymous demo that showcases every question type. No personal information is collected.',
      "Une démonstration anonyme qui présente chaque type de question. Aucun renseignement personnel n'est recueilli.",
    ),
    created: '2026-06-24T00:00:00.000Z',
  },

  concepts: [
    { id: 'c.experience', label: s('Product experience', 'Expérience du produit') },
    { id: 'c.usage', label: s('Usage', 'Utilisation') },
  ],
  universes: [],

  categorySchemes: [
    {
      id: 'cs.color',
      label: s('Accent colour', "Couleur d'accent"),
      categories: [
        { code: 'blue', label: s('Blue', 'Bleu') },
        { code: 'green', label: s('Green', 'Vert') },
        { code: 'purple', label: s('Purple', 'Violet') },
        { code: 'orange', label: s('Orange', 'Orange') },
        { code: 'other', label: s('Other', 'Autre') },
      ],
    },
    {
      id: 'cs.devices',
      label: s('Devices', 'Appareils'),
      categories: [
        { code: 'phone', label: s('Phone', 'Téléphone') },
        { code: 'tablet', label: s('Tablet', 'Tablette') },
        { code: 'laptop', label: s('Laptop', 'Ordinateur portable') },
        { code: 'desktop', label: s('Desktop', 'Ordinateur de bureau') },
      ],
    },
    {
      id: 'cs.frequency',
      label: s('Frequency', 'Fréquence'),
      categories: [
        { code: 'daily', label: s('Daily', 'Tous les jours') },
        { code: 'weekly', label: s('Weekly', 'Chaque semaine') },
        { code: 'monthly', label: s('Monthly', 'Chaque mois') },
        { code: 'rarely', label: s('Rarely', 'Rarement') },
      ],
    },
    {
      id: 'cs.topics',
      label: s('Topics', 'Sujets'),
      categories: [
        { code: 'design', label: s('Design tools', 'Outils de conception') },
        { code: 'logic', label: s('Skip logic & routing', 'Logique de saut et routage') },
        { code: 'i18n', label: s('Translations', 'Traductions') },
        { code: 'analytics', label: s('Analytics', 'Analytique') },
        { code: 'accessibility', label: s('Accessibility', 'Accessibilité') },
        { code: 'offline', label: s('Offline support', 'Prise en charge hors ligne') },
        { code: 'export', label: s('Data export', 'Exportation des données') },
      ],
    },
    {
      id: 'cs.features',
      label: s('Features', 'Fonctionnalités'),
      categories: [
        { code: 'preview', label: s('Live preview', 'Aperçu en direct') },
        { code: 'flow', label: s('Flowchart', 'Organigramme') },
        { code: 'pdf', label: s('PDF export', 'Exportation PDF') },
        { code: 'reuse', label: s('Question reuse', 'Réutilisation des questions') },
        { code: 'resume', label: s('Resume later', 'Reprendre plus tard') },
      ],
    },
  ],

  variables: [
    { id: 'v.nps', name: 'nps', kind: 'collected', label: s('Recommendation score', 'Score de recommandation'), representation: 'numeric', conceptRef: 'c.experience' },
    { id: 'v.recommend', name: 'recommend', kind: 'collected', label: s('Would recommend', 'Recommanderait'), representation: 'boolean', conceptRef: 'c.experience' },
    { id: 'v.freq', name: 'freq', kind: 'collected', label: s('Usage frequency', "Fréquence d'utilisation"), representation: 'code', categorySchemeRef: 'cs.frequency', conceptRef: 'c.usage' },
    { id: 'v.favColor', name: 'favColor', kind: 'collected', label: s('Preferred accent colour', "Couleur d'accent préférée"), representation: 'code', categorySchemeRef: 'cs.color' },
    { id: 'v.devices', name: 'devices', kind: 'collected', label: s('Devices used', 'Appareils utilisés'), representation: 'code', categorySchemeRef: 'cs.devices', conceptRef: 'c.usage' },
    { id: 'v.topic', name: 'topic', kind: 'collected', label: s('Topic of interest', "Sujet d'intérêt"), representation: 'code', categorySchemeRef: 'cs.topics' },
    { id: 'v.usedFeatures', name: 'usedFeatures', kind: 'collected', label: s('Features tried', 'Fonctionnalités essayées'), representation: 'code', categorySchemeRef: 'cs.features' },
    { id: 'v.lastUsedDate', name: 'lastUsedDate', kind: 'collected', label: s('Date last used', "Date de dernière utilisation"), representation: 'datetime' },
    { id: 'v.bestTime', name: 'bestTime', kind: 'collected', label: s('Best time of day', 'Meilleur moment de la journée'), representation: 'datetime' },
    { id: 'v.reminderAt', name: 'reminderAt', kind: 'collected', label: s('Reminder moment', 'Moment du rappel'), representation: 'datetime' },
    { id: 'v.oneWord', name: 'oneWord', kind: 'collected', label: s('One-word reaction', 'Réaction en un mot'), representation: 'text' },
    { id: 'v.comments', name: 'comments', kind: 'collected', label: s('Comments', 'Commentaires'), representation: 'text' },
    { id: 'v.screenshot', name: 'screenshot', kind: 'collected', label: s('Screenshot', "Capture d'écran"), representation: 'file' },
    { id: 'v.featureCount', name: 'featureCount', kind: 'collected', label: s('Number of features to rate', 'Nombre de fonctionnalités à évaluer'), representation: 'numeric' },
    { id: 'v.ratedFeature', name: 'ratedFeature', kind: 'collected', label: s('Feature name', 'Nom de la fonctionnalité'), representation: 'text' },
    { id: 'v.featureRating', name: 'featureRating', kind: 'collected', label: s('Feature rating', 'Évaluation de la fonctionnalité'), representation: 'numeric' },
    { id: 'v.loveMost', name: 'loveMost', kind: 'collected', label: s('What you loved', 'Ce que vous avez aimé'), representation: 'text' },
    { id: 'v.improve', name: 'improve', kind: 'collected', label: s('What to improve', 'À améliorer'), representation: 'text' },
    { id: 'v.reviewFlag', name: 'reviewFlag', kind: 'hidden', label: s('Follow-up flag', 'Indicateur de suivi'), representation: 'boolean' },
    { id: 'v.npsPositive', name: 'npsPositive', kind: 'derived', label: s('Positive score (derived)', 'Score positif (dérivé)'), representation: 'boolean', compute: '$nps >= 7' },
  ],

  prefillMappings: [],

  sequence: {
    type: 'sequence',
    id: 'seq.root',
    children: [
      // ── Page 1 — Overall ──────────────────────────────────────────────
      {
        type: 'sequence',
        id: 'pg.overall',
        label: s('Your overall impression', 'Votre impression générale'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.intro',
            text: s(
              'Thanks for trying the demo! This short, anonymous survey shows off every question type. No personal information is collected.',
              "Merci d'essayer la démo ! Ce court sondage anonyme présente chaque type de question. Aucun renseignement personnel n'est recueilli.",
            ),
          },
          {
            type: 'question',
            id: 'q.nps',
            variableRef: 'nps',
            text: s(
              'How likely are you to recommend this tool? (0–10)',
              'Quelle est la probabilité que vous recommandiez cet outil ? (0–10)',
            ),
            instruction: s('0 = not at all, 10 = extremely likely.', '0 = pas du tout, 10 = extrêmement probable.'),
            responseDomain: { type: 'numeric', min: 0, max: 10, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.nps.range',
                type: 'hard',
                when: '$nps < 0 || $nps > 10',
                message: s('Please enter a score between 0 and 10.', 'Veuillez saisir un score entre 0 et 10.'),
                scope: ['nps'],
              },
              {
                id: 'edit.nps.low',
                type: 'soft',
                when: '$nps <= 3',
                message: s('Sorry to hear that — your comments later will help.', 'Désolé de l’apprendre — vos commentaires plus loin nous aideront.'),
                scope: ['nps'],
              },
            ],
          },
          {
            type: 'question',
            id: 'q.recommend',
            variableRef: 'recommend',
            text: s('Would you recommend it to a colleague?', 'Le recommanderiez-vous à un collègue ?'),
            responseDomain: { type: 'boolean' },
            required: true,
          },
        ],
      },

      // ── Page 2 — Usage (contains a section + choice/lookup/markAll) ─────
      {
        type: 'sequence',
        id: 'pg.usage',
        label: s('How you use it', 'Comment vous l’utilisez'),
        isPage: true,
        children: [
          {
            type: 'sequence',
            id: 'sec.habits',
            label: s('Your habits', 'Vos habitudes'),
            children: [
              {
                type: 'question',
                id: 'q.freq',
                variableRef: 'freq',
                text: s('How often do you use it?', 'À quelle fréquence l’utilisez-vous ?'),
                responseDomain: { type: 'code', categorySchemeRef: 'cs.frequency', selection: 'single' },
                required: true,
              },
              {
                type: 'question',
                id: 'q.devices',
                variableRef: 'devices',
                text: s('Which devices do you use it on?', 'Sur quels appareils l’utilisez-vous ?'),
                instruction: s('Select all that apply.', 'Sélectionnez tout ce qui s’applique.'),
                responseDomain: { type: 'code', categorySchemeRef: 'cs.devices', selection: 'multiple' },
              },
            ],
          },
          {
            type: 'question',
            id: 'q.favColor',
            variableRef: 'favColor',
            text: s('Pick a preferred accent colour', "Choisissez une couleur d'accent préférée"),
            responseDomain: { type: 'code', categorySchemeRef: 'cs.color', selection: 'single' },
          },
          {
            type: 'question',
            id: 'q.topic',
            variableRef: 'topic',
            text: s('What topic interests you most?', 'Quel sujet vous intéresse le plus ?'),
            instruction: s('Start typing to search.', 'Commencez à taper pour rechercher.'),
            responseDomain: { type: 'lookup', categorySchemeRef: 'cs.topics' },
          },
          {
            type: 'question',
            id: 'q.usedFeatures',
            variableRef: 'usedFeatures',
            text: s('Which features have you tried?', 'Quelles fonctionnalités avez-vous essayées ?'),
            instruction: s('Mark all that apply.', 'Cochez tout ce qui s’applique.'),
            responseDomain: { type: 'markAll', categorySchemeRef: 'cs.features', variablePrefix: 'feat' },
          },
        ],
      },

      // ── Page 3 — Dates & times (date / time / datetime) ────────────────
      {
        type: 'sequence',
        id: 'pg.timing',
        label: s('Timing', 'Horaires'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.lastUsedDate',
            variableRef: 'lastUsedDate',
            text: s('When did you last use it?', 'Quand l’avez-vous utilisé pour la dernière fois ?'),
            responseDomain: { type: 'datetime', mode: 'date' },
          },
          {
            type: 'question',
            id: 'q.bestTime',
            variableRef: 'bestTime',
            text: s('Best time of day to use it?', 'Meilleur moment de la journée pour l’utiliser ?'),
            responseDomain: { type: 'datetime', mode: 'time' },
          },
          {
            type: 'question',
            id: 'q.reminderAt',
            variableRef: 'reminderAt',
            text: s('When should a demo reminder pop up?', 'Quand un rappel de démo devrait-il apparaître ?'),
            responseDomain: { type: 'datetime', mode: 'datetime' },
          },
        ],
      },

      // ── Page 4 — Open text & file ──────────────────────────────────────
      {
        type: 'sequence',
        id: 'pg.open',
        label: s('In your words', 'Dans vos mots'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.oneWord',
            variableRef: 'oneWord',
            text: s('Describe the tool in one word', 'Décrivez l’outil en un mot'),
            responseDomain: { type: 'text', maxLength: 20 },
          },
          {
            type: 'question',
            id: 'q.comments',
            variableRef: 'comments',
            text: s('Any other comments?', 'D’autres commentaires ?'),
            responseDomain: { type: 'text', multiline: true, maxLength: 500 },
          },
          {
            type: 'question',
            id: 'q.screenshot',
            variableRef: 'screenshot',
            text: s('Optionally attach a screenshot', 'Joignez éventuellement une capture d’écran'),
            responseDomain: { type: 'file', accept: ['image/*'] },
          },
        ],
      },

      // ── Page 5 — Rate a few features (roster) ──────────────────────────
      {
        type: 'sequence',
        id: 'pg.rate',
        label: s('Rate some features', 'Évaluez quelques fonctionnalités'),
        isPage: true,
        children: [
          {
            type: 'question',
            id: 'q.featureCount',
            variableRef: 'featureCount',
            text: s('How many features would you like to rate? (0–5)', 'Combien de fonctionnalités souhaitez-vous évaluer ? (0–5)'),
            responseDomain: { type: 'numeric', min: 0, max: 5, decimals: 0 },
            required: true,
            edits: [
              {
                id: 'edit.featureCount.range',
                type: 'hard',
                when: '$featureCount < 0 || $featureCount > 5',
                message: s('Please enter a number from 0 to 5.', 'Veuillez saisir un nombre de 0 à 5.'),
                scope: ['featureCount'],
              },
            ],
          },
          {
            type: 'loop',
            id: 'loop.features',
            label: s('Feature ratings', 'Évaluations des fonctionnalités'),
            countVariableRef: 'featureCount',
            loopVariable: 'f',
            itemLabel: s('Feature ${f}', 'Fonctionnalité ${f}'),
            visibleWhen: '$featureCount > 0',
            children: [
              {
                type: 'question',
                id: 'q.ratedFeature',
                variableRef: 'ratedFeature',
                text: s('Name of feature ${f}', 'Nom de la fonctionnalité ${f}'),
                responseDomain: { type: 'text', maxLength: 40 },
              },
              {
                type: 'question',
                id: 'q.featureRating',
                variableRef: 'featureRating',
                text: s('Rate ${ratedFeature} (1–5)', 'Évaluez ${ratedFeature} (1–5)'),
                responseDomain: { type: 'numeric', min: 1, max: 5, decimals: 0 },
              },
            ],
          },
        ],
      },

      // ── Page 6 — Branch on the recommendation score ────────────────────
      {
        type: 'sequence',
        id: 'pg.followup',
        label: s('One last thing', 'Une dernière chose'),
        isPage: true,
        children: [
          {
            type: 'ifThenElse',
            id: 'if.nps',
            condition: '$nps >= 9',
            then: [
              {
                type: 'question',
                id: 'q.loveMost',
                variableRef: 'loveMost',
                text: s('What did you love most?', 'Qu’avez-vous le plus aimé ?'),
                responseDomain: { type: 'text', multiline: true, maxLength: 300 },
              },
            ],
            else: [
              {
                type: 'question',
                id: 'q.improve',
                variableRef: 'improve',
                text: s('What is the one thing we should improve?', 'Quelle est la seule chose à améliorer ?'),
                responseDomain: { type: 'text', multiline: true, maxLength: 300 },
              },
            ],
          },
        ],
      },

      // ── Computation: flag low scores for follow-up ─────────────────────
      {
        type: 'computation',
        id: 'comp.reviewFlag',
        targetVariableRef: 'reviewFlag',
        expression: '$nps <= 6',
      },

      // ── Closing ────────────────────────────────────────────────────────
      {
        type: 'sequence',
        id: 'pg.thanks',
        label: s('Done', 'Terminé'),
        isPage: true,
        children: [
          {
            type: 'statement',
            id: 'stmt.thanks',
            text: s(
              'That’s every question type! Submit to see your responses as data. Thanks for exploring the demo.',
              'C’était tous les types de questions ! Soumettez pour voir vos réponses sous forme de données. Merci d’avoir exploré la démo.',
            ),
          },
        ],
      },
    ],
  },
};
