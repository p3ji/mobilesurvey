/**
 * Respondent runtime orchestrator. Phases:
 *   gate    — enter an access code (resolved against the CMS) → case + pre-fills (code-gated surveys)
 *   survey  — page-by-page questionnaire with resume + paradata
 *   done    — submission confirmation, response data, and the paradata trail
 *
 * Which survey runs is chosen by a `?survey=<id>` link from the hub (loaded from the backend).
 * If the survey is published without an access code, the gate is skipped and an anonymous session
 * starts immediately. Without a `?survey` param it falls back to the bundled Labour Force survey.
 */
import { useEffect, useRef, useState } from 'react';
import { lfsInstrument, demoInstrument, type Instrument } from '@mobilesurvey/instrument-schema';
import type { ParadataEvent, RuntimeState, SampleUnit } from '@mobilesurvey/runtime-engine';
import { AccessGate } from './components/AccessGate.jsx';
import { SurveyRunner } from './components/SurveyRunner.jsx';
import { Completion } from './components/Completion.jsx';
import { createBackend, fetchSurvey, submitResponse, type Backend } from './integrations/api.js';

interface SavedSession {
  runtimeState: RuntimeState;
  currentPage: number;
}

interface LoadedSurvey {
  instrument: Instrument;
  requiresAccessCode: boolean;
  /** undefined = no notice; present = show banner on every page */
  notice?: { kind: 'demo-no-save' | 'demo-saves'; text: string };
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

const sessionKey = (instrumentId: string, caseId: string) => `${instrumentId}::${caseId}`;

/** A stable per-browser id so anonymous respondents can resume on the same device. */
function anonId(): string {
  const KEY = 'eq:anonId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `anon-${Math.abs(Date.now() ^ (performance.now() | 0)).toString(36)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function App() {
  const [phase, setPhase] = useState<'gate' | 'survey' | 'done'>('gate');
  const [survey, setSurvey] = useState<SurveyContext | null>(null);
  const [done, setDone] = useState<DoneContext | null>(null);

  const [backend, setBackend] = useState<Backend | null>(null);
  const [loaded, setLoaded] = useState<LoadedSurvey | null>(null);
  const surveyStartedAt = useRef<number | null>(null);

  // Bundled instruments served by short alias (used when Supabase has no matching row).
  const BUNDLED: Record<string, LoadedSurvey> = {
    lfs: {
      instrument: lfsInstrument,
      requiresAccessCode: true,
      notice: { kind: 'demo-no-save', text: 'This is a demo survey. Do not submit real personal information — responses are not saved.' },
    },
    demo: {
      instrument: demoInstrument,
      requiresAccessCode: false,
      notice: { kind: 'demo-saves', text: 'This is a demonstration survey — responses you submit will be saved to illustrate the data collection dashboard.' },
    },
  };

  // Load the backend and the survey (by ?survey=<id>, else the bundled fallback).
  useEffect(() => {
    let active = true;
    (async () => {
      const b = await createBackend();
      const surveyId = new URLSearchParams(window.location.search).get('survey');
      let loadedSurvey: LoadedSurvey;
      if (surveyId) {
        const served = await fetchSurvey(surveyId);
        if (served?.instrument) {
          loadedSurvey = {
            instrument: served.instrument as Instrument,
            requiresAccessCode: served.requiresAccessCode,
            notice: { kind: 'demo-saves', text: 'This is a demonstration survey — responses you submit will be saved to illustrate the data collection dashboard.' },
          };
        } else {
          // Fall back to a bundled instrument if the id matches a known alias.
          loadedSurvey = BUNDLED[surveyId] ?? BUNDLED.lfs!;
        }
      } else {
        loadedSurvey = BUNDLED.lfs!;
      }
      if (!active) return;
      setBackend(b);
      setLoaded(loadedSurvey);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Update the browser tab title to the loaded survey's name.
  useEffect(() => {
    if (!loaded) return;
    const title = loaded.instrument.metadata?.title as Record<string, string> | undefined;
    const name = title?.[loaded.instrument.defaultLanguage ?? 'en'] ?? title?.en ?? 'Survey';
    document.title = `${name} — mobilesurvey`;
  }, [loaded]);

  // Auto-start anonymous surveys (no access code) once everything is loaded.
  useEffect(() => {
    if (!backend || !loaded || loaded.requiresAccessCode || phase !== 'gate' || survey) return;
    void startAnonymous(backend, loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, loaded]);

  const startAnonymous = async (b: Backend, l: LoadedSurvey) => {
    const caseId = anonId();
    const key = sessionKey(l.instrument.id, caseId);
    const saved = (await b.sessionStore.load(key)) as SavedSession | null;
    const resumed = Boolean(saved);
    b.paradata.setSessionKey?.(key);
    b.paradata.emit({ ts: Date.now(), type: resumed ? 'session_resume' : 'session_start', payload: { caseId } });
    if (!resumed) surveyStartedAt.current = Date.now();
    setSurvey({
      caseId,
      sample: { id: caseId, fields: {} },
      restore: saved?.runtimeState,
      initialPage: saved?.currentPage ?? 0,
      resumed,
    });
    setPhase('survey');
  };

  /** Code-gated path: resolve a code, load any saved session, and enter the survey. */
  const authenticate = async (code: string): Promise<{ ok: boolean; error?: string }> => {
    if (!backend || !loaded) return { ok: false, error: 'Still connecting — please try again.' };
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
    const key = sessionKey(loaded.instrument.id, caseId);
    const saved = (await backend.sessionStore.load(key)) as SavedSession | null;
    const resumed = Boolean(saved);

    backend.paradata.setSessionKey?.(key);
    backend.paradata.emit({
      ts: Date.now(),
      type: resumed ? 'session_resume' : 'session_start',
      payload: { caseId },
    });
    if (!resumed) surveyStartedAt.current = Date.now();
    await backend.cms.reportStatus(caseId, resumed ? 'resumed' : 'started');

    setSurvey({ caseId, sample, restore: saved?.runtimeState, initialPage: saved?.currentPage ?? 0, resumed });
    setPhase('survey');
    return { ok: true };
  };

  const persist = (caseId: string, runtimeState: RuntimeState, currentPage: number) => {
    if (!loaded) return;
    void backend?.sessionStore.save(sessionKey(loaded.instrument.id, caseId), { runtimeState, currentPage });
  };

  const submit = async (caseId: string, responses: Record<string, unknown>) => {
    if (!backend || !loaded) return;
    const now = Date.now();
    backend.paradata.emit({ ts: now, type: 'submit', payload: { caseId } });
    await backend.cms.reportStatus(caseId, 'completed');
    await backend.paradata.flush();
    // Only persist to Supabase for real surveys (not bundled demo fallbacks)
    const surveyId = new URLSearchParams(window.location.search).get('survey');
    if (surveyId && loaded.notice?.kind !== 'demo-no-save') {
      void submitResponse(surveyId, caseId, responses, {
        startedAt: surveyStartedAt.current ?? undefined,
        durationMs: surveyStartedAt.current ? now - surveyStartedAt.current : undefined,
      });
    }
    await backend.sessionStore.clear(sessionKey(loaded.instrument.id, caseId));
    setDone({ caseId, responses, paradata: backend.paradata.buffer() });
    setPhase('done');
  };

  const restart = () => {
    if (done && loaded) void backend?.sessionStore.clear(sessionKey(loaded.instrument.id, done.caseId));
    setSurvey(null);
    setDone(null);
    // Re-enter: anonymous surveys auto-start again; code-gated return to the gate.
    setPhase('gate');
  };

  if (!backend || !loaded) {
    return (
      <div className="app">
        <div className="gate">
          <div className="gate__card">
            <div className="gate__brand">Electronic Questionnaire</div>
            <p className="gate__sub" style={{ marginTop: 12 }}>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {phase === 'gate' && loaded.requiresAccessCode && (
        <AccessGate onAuthenticate={authenticate} online={backend.online} />
      )}

      {phase === 'survey' && survey && (
        <SurveyRunner
          instrument={loaded.instrument}
          caseId={survey.caseId}
          sample={survey.sample}
          restore={survey.restore}
          initialPage={survey.initialPage}
          resumed={survey.resumed}
          paradata={backend.paradata}
          notice={loaded.notice}
          onPersist={(state, page) => persist(survey.caseId, state, page)}
          onSubmit={(responses) => submit(survey.caseId, responses)}
        />
      )}

      {phase === 'done' && done && (
        <Completion responses={done.responses} paradata={done.paradata} onRestart={restart} />
      )}
    </div>
  );
}
