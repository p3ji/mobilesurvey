/**
 * Respondent runtime orchestrator. Three phases:
 *   gate    — enter an access code (resolved against the mock CMS) → case + pre-fills
 *   survey  — page-by-page questionnaire with resume + paradata
 *   done    — submission confirmation, response data, and the paradata trail
 *
 * A real deployment swaps the mocks for a CMS API, an encrypted server session store, and a
 * paradata sink; the engine and UI are untouched.
 */
import { useEffect, useState } from 'react';
import { lfsInstrument } from '@mobilesurvey/instrument-schema';
import type { ParadataEvent, RuntimeState, SampleUnit } from '@mobilesurvey/runtime-engine';
import { AccessGate } from './components/AccessGate.jsx';
import { SurveyRunner } from './components/SurveyRunner.jsx';
import { Completion } from './components/Completion.jsx';
import { createBackend, type Backend } from './integrations/api.js';

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

  // Backend (API service or local-mock fallback), chosen once at startup.
  const [backend, setBackend] = useState<Backend | null>(null);
  useEffect(() => {
    let active = true;
    createBackend().then((b) => {
      if (active) setBackend(b);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Resolve a code, load any saved session, and enter the survey. */
  const authenticate = async (code: string): Promise<{ ok: boolean; error?: string }> => {
    if (!backend) return { ok: false, error: 'Still connecting — please try again.' };
    let resolved;
    try {
      resolved = await backend.cms.resolveAccessCode(code);
    } catch {
      return { ok: false, error: 'Could not reach the survey service. Please try again.' };
    }
    if (!resolved) {
      return { ok: false, error: 'That access code was not recognized. Please check and try again.' };
    }
    const { caseId, sample } = resolved;
    const key = sessionKey(caseId);

    const saved = (await backend.sessionStore.load(key)) as SavedSession | null;
    const resumed = Boolean(saved);

    backend.paradata.setSessionKey?.(key);
    backend.paradata.emit({
      ts: Date.now(),
      type: resumed ? 'session_resume' : 'session_start',
      payload: { caseId },
    });
    await backend.cms.reportStatus(caseId, resumed ? 'resumed' : 'started');

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
    void backend?.sessionStore.save(sessionKey(caseId), { runtimeState, currentPage });
  };

  /** Final submit: report to CMS, flush paradata, clear the resumable cache. */
  const submit = async (caseId: string, responses: Record<string, unknown>) => {
    if (!backend) return;
    backend.paradata.emit({ ts: Date.now(), type: 'submit', payload: { caseId } });
    await backend.cms.reportStatus(caseId, 'completed');
    await backend.paradata.flush();
    await backend.sessionStore.clear(sessionKey(caseId));
    setDone({ caseId, responses, paradata: backend.paradata.buffer() });
    setPhase('done');
  };

  /** Start over from the access-code gate (clears the saved session for the case). */
  const restart = () => {
    if (done) void backend?.sessionStore.clear(sessionKey(done.caseId));
    setSurvey(null);
    setDone(null);
    setPhase('gate');
  };

  if (!backend) {
    return (
      <div className="app">
        <div className="gate">
          <div className="gate__card">
            <div className="gate__brand">Electronic Questionnaire</div>
            <p className="gate__sub" style={{ marginTop: 12 }}>Connecting…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {phase === 'gate' && <AccessGate onAuthenticate={authenticate} online={backend.online} />}

      {phase === 'survey' && survey && (
        <SurveyRunner
          instrument={INSTRUMENT}
          caseId={survey.caseId}
          sample={survey.sample}
          restore={survey.restore}
          initialPage={survey.initialPage}
          resumed={survey.resumed}
          paradata={backend.paradata}
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
