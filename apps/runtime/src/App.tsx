/**
 * Respondent runtime orchestrator. Three phases:
 *   gate    — enter an access code (resolved against the mock CMS) → case + pre-fills
 *   survey  — page-by-page questionnaire with resume + paradata
 *   done    — submission confirmation, response data, and the paradata trail
 *
 * A real deployment swaps the mocks for a CMS API, an encrypted server session store, and a
 * paradata sink; the engine and UI are untouched.
 */
import { useMemo, useState } from 'react';
import { lfsInstrument } from '@mobilesurvey/instrument-schema';
import type { ParadataEvent, RuntimeState, SampleUnit } from '@mobilesurvey/runtime-engine';
import { AccessGate } from './components/AccessGate.jsx';
import { SurveyRunner } from './components/SurveyRunner.jsx';
import { Completion } from './components/Completion.jsx';
import { createMockParadataSink, localSessionStore, mockCmsClient } from './integrations/mocks.js';

/** The deployed questionnaire (in production the case/CMS determines which instrument to serve). */
const INSTRUMENT = lfsInstrument;

/** Persisted session shape (responses + the screen the respondent was on). */
interface SavedSession {
  runtimeState: RuntimeState;
  currentPage: number;
}

function sessionKey(caseId: string): string {
  return `${INSTRUMENT.id}::${caseId}`;
}

interface SurveyContext {
  caseId: string;
  sample: SampleUnit;
  restore?: RuntimeState;
  initialPage: number;
  resumed: boolean;
}

interface DoneContext {
  caseId: string;
  responses: Record<string, unknown>;
  paradata: ParadataEvent[];
}

export function App() {
  const [phase, setPhase] = useState<'gate' | 'survey' | 'done'>('gate');
  const [survey, setSurvey] = useState<SurveyContext | null>(null);
  const [done, setDone] = useState<DoneContext | null>(null);

  // One paradata sink for the whole session.
  const paradata = useMemo(() => createMockParadataSink(), []);

  /** Resolve a code, load any saved session, and enter the survey. */
  const authenticate = async (code: string): Promise<{ ok: boolean; error?: string }> => {
    const resolved = await mockCmsClient.resolveAccessCode(code);
    if (!resolved) {
      return { ok: false, error: 'That access code was not recognized. Please check and try again.' };
    }
    const { caseId, sample } = resolved;

    const saved = (await localSessionStore.load(sessionKey(caseId))) as SavedSession | null;
    const resumed = Boolean(saved);

    paradata.emit({
      ts: Date.now(),
      type: resumed ? 'session_resume' : 'session_start',
      payload: { caseId },
    });
    await mockCmsClient.reportStatus(caseId, resumed ? 'resumed' : 'started');

    setSurvey({
      caseId,
      sample,
      restore: saved?.runtimeState,
      initialPage: saved?.currentPage ?? 0,
      resumed,
    });
    setPhase('survey');
    return { ok: true };
  };

  /** Persist progress after each change so a reload / network drop can resume. */
  const persist = (caseId: string, runtimeState: RuntimeState, currentPage: number) => {
    void localSessionStore.save(sessionKey(caseId), { runtimeState, currentPage });
  };

  /** Final submit: report to CMS, flush paradata, clear the resumable cache. */
  const submit = async (caseId: string, responses: Record<string, unknown>) => {
    paradata.emit({ ts: Date.now(), type: 'submit', payload: { caseId } });
    await mockCmsClient.reportStatus(caseId, 'completed');
    await paradata.flush();
    await localSessionStore.clear(sessionKey(caseId));
    setDone({ caseId, responses, paradata: paradata.buffer() });
    setPhase('done');
  };

  /** Start over from the access-code gate (clears the saved session for the case). */
  const restart = () => {
    if (done) void localSessionStore.clear(sessionKey(done.caseId));
    setSurvey(null);
    setDone(null);
    setPhase('gate');
  };

  return (
    <div className="app">
      {phase === 'gate' && <AccessGate onAuthenticate={authenticate} />}

      {phase === 'survey' && survey && (
        <SurveyRunner
          instrument={INSTRUMENT}
          caseId={survey.caseId}
          sample={survey.sample}
          restore={survey.restore}
          initialPage={survey.initialPage}
          resumed={survey.resumed}
          paradata={paradata}
          onPersist={(state, page) => persist(survey.caseId, state, page)}
          onSubmit={(responses) => submit(survey.caseId, responses)}
        />
      )}

      {phase === 'done' && done && (
        <Completion
          responses={done.responses}
          paradata={done.paradata}
          onRestart={restart}
        />
      )}
    </div>
  );
}
