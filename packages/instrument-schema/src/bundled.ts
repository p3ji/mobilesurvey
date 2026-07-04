/**
 * Registry of the bundled example surveys shipped with the apps.
 *
 * This is the single source of truth for *which* bundled surveys exist (by their
 * short alias id used in `?survey=<id>` links and as the Supabase row id) and,
 * critically, whether each one is connected to live data collection.
 *
 * `collectsData: false` means the survey is exploration-only: it must NEVER be
 * persisted to the backend — no survey row, responses, sessions, or paradata.
 * It still loads in the designer/runtime and can be launched as a demo (running
 * entirely on local mocks). Drive all seeding/persistence decisions from here
 * rather than hard-coding id checks in each app.
 */
import type { Instrument } from './types.js';
import { lfsInstrument } from './examples/lfs.instrument.js';
import { demoInstrument } from './examples/demo.instrument.js';
import { fsepInstrument } from './examples/fsep.instrument.js';

export interface BundledSurvey {
  /** Short alias used in `?survey=<id>` URLs and as the Supabase row id. */
  id: string;
  title: string;
  instrument: Instrument;
  requiresAccessCode: boolean;
  /** When false, exploration-only: never written to the backend. */
  collectsData: boolean;
}

export const BUNDLED_SURVEYS: BundledSurvey[] = [
  {
    id: 'lfs',
    title: 'Household & Employment Survey',
    instrument: lfsInstrument,
    requiresAccessCode: true,
    collectsData: false,
  },
  {
    id: 'demo',
    title: 'Feature Demo Survey',
    instrument: demoInstrument,
    requiresAccessCode: false,
    collectsData: true,
  },
  {
    id: 'fsep',
    title: 'Federal Science Expenditures and Personnel (Demo)',
    instrument: fsepInstrument,
    requiresAccessCode: false,
    collectsData: false,
  },
];

const BY_ID = new Map(BUNDLED_SURVEYS.map((s) => [s.id, s]));

/** Look up a bundled survey by its short alias id. */
export function bundledSurvey(id: string | null | undefined): BundledSurvey | undefined {
  return id == null ? undefined : BY_ID.get(id);
}

/**
 * Whether a survey id should persist data to the backend. False when no survey
 * is selected, and false for bundled surveys explicitly marked exploration-only.
 * Unknown ids (real, user-created surveys) collect data.
 */
export function surveyCollectsData(id: string | null | undefined): boolean {
  if (id == null) return false;
  const b = bundledSurvey(id);
  return b ? b.collectsData : true;
}
