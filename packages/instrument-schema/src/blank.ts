/** Factory for a minimal, valid empty instrument — used when creating a new survey. */
import type { Instrument } from './types.js';

export function blankInstrument(title = 'Untitled survey', stamp = Date.now().toString(36)): Instrument {
  return {
    id: `urn:ddi:mobilesurvey:custom:${stamp}`,
    version: '1.0.0',
    ddiProfile: 'ddi-lifecycle-3.3',
    languages: ['en'],
    defaultLanguage: 'en',
    metadata: {
      title: { en: title },
      created: new Date().toISOString(),
    },
    concepts: [],
    universes: [],
    categorySchemes: [],
    variables: [],
    prefillMappings: [],
    sequence: {
      type: 'sequence',
      id: `seq.${stamp}`,
      children: [
        {
          type: 'sequence',
          id: `pg.${stamp}`,
          isPage: true,
          label: { en: 'Page 1' },
          children: [],
        },
      ],
    },
  };
}
