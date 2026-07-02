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
import { bundledSurvey, surveyCollectsData, type Instrument } from '@mobilesurvey/instrument-schema';
import type { ParadataEvent, RuntimeState, SampleUnit } from '@mobilesurvey/runtime-engine';
import { AccessGate } from './components/AccessGate.jsx';
import { SurveyRunner } from './components/SurveyRunner.jsx';
import { Completion } from './components/Completion.jsx';
import { createBackend, ensureSurveyRow, fetchSurvey, submitResponse, type Backend } from './integrations/api.js';

interface SavedSession {
  runtimeState: RuntimeState;
  currentPage: number;
}

interface LoadedSurvey {
  instrument: Instrument;
  /** The survey row id / alias (surveys.id) — the FK target for sessions, paradata, responses. */
  surveyId: string;
  requiresAccessCode: boolean;
  /** Whether responses are persisted to the backend (false = exploration-only). */
  collectsData: boolean;
  /**
   * True for bundled teaching demos (registry-driven) — gates the Completion screen's
   * response/paradata/debug inspection panel. Real (user-created) surveys stay clean.
   */
  isDemo: boolean;
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
  saved: boolean;
  saveError?: string;
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
  // Set when an explicit ?survey=<id> matches neither a served nor a bundled survey.
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const surveyStartedAt = useRef<number | null>(null);

  // Notice banner text depends on whether the survey actually persists responses.
  const noticeFor = (collects: boolean): LoadedSurvey['notice'] =>
    collects
      ? { kind: 'demo-saves', text: 'This is a demonstration survey — responses you submit will be saved to illustrate the data collection dashboard.' }
      : { kind: 'demo-no-save', text: 'This is a demo survey. Do not submit real personal information — responses are not saved.' };

  // Load the backend and the survey (by ?survey=<id>, else the bundled fallback).
  useEffect(() => {
    let active = true;
    (async () => {
      const surveyId = new URLSearchParams(window.location.search).get('survey');
      // No ?survey param falls back to the bundled Household & Employment demo.
      const effectiveId = surveyId ?? 'lfs';
      const collects = surveyCollectsData(effectiveId);
      // Registry-driven: bundled demos keep the Completion inspection panel, even when the
      // demo row is served from the backend rather than loaded from the bundle.
      const isDemo = bundledSurvey(effectiveId) !== undefined;
      // Exploration-only surveys get a mock backend so nothing reaches Supabase.
      const b = await createBackend({ collectsData: collects });

      let loadedSurvey: LoadedSurvey;
      const served = surveyId ? await fetchSurvey(surveyId) : null;
      if (served?.instrument) {
        loadedSurvey = {
          instrument: served.instrument as Instrument,
          requiresAccessCode: served.requiresAccessCode,
          surveyId: effectiveId,
          collectsData: collects,
          isDemo,
          notice: noticeFor(collects),
        };
      } else {
        // Fall back to a bundled instrument (exploration-only demos are never in Supabase).
        // A missing ?survey param falls back to the bundled lfs demo; an *explicit* but unknown
        // id is a broken link — surface "not found" instead of silently serving the wrong survey.
        const bundled = bundledSurvey(effectiveId);
        if (!bundled) {
          if (!active) return;
          setBackend(b);
          setNotFoundId(surveyId ?? effectiveId);
          return;
        }
        loadedSurvey = {
          instrument: bundled.instrument,
          requiresAccessCode: bundled.requiresAccessCode,
          surveyId: effectiveId,
          collectsData: collects,
          isDemo,
          notice: noticeFor(collects),
        };
        // Seed the survey row (FK for responses) only for data-collecting surveys.
        if (collects && surveyId) {
          const title = bundled.instrument.metadata?.title as Record<string, string> | undefined;
          await ensureSurveyRow(
            surveyId,
            title ? (Object.values(title)[0] ?? surveyId) : surveyId,
            bundled.instrument,
            { requiresAccessCode: bundled.requiresAccessCode },
          );
        }
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
    const key = sessionKey(l.surveyId, caseId);
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

  /** Hardcoded demo access codes — used as fallback when Supabase has no matching row. */
  const DEMO_CODES: Record<string, { name: string }> = {
    ABC123: { name: 'Jordan Lee' },
    DEF456: { name: 'Marie Tremblay' },
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
    // Fall back to hardcoded demo codes if CMS has no matching row.
    if (!resolved) {
      const demo = DEMO_CODES[code.toUpperCase()];
      if (demo) {
        const caseId = `case-${code.toLowerCase()}`;
        resolved = { caseId, sample: { id: caseId, fields: { name: demo.name } } };
      }
    }
    if (!resolved) {
      return { ok: false, error: 'That access code was not recognized. Please check and try again.' };
    }
    const { caseId, sample } = resolved;
    const key = sessionKey(loaded.surveyId, caseId);
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
    void backend?.sessionStore.save(sessionKey(loaded.surveyId, caseId), { runtimeState, currentPage });
  };

  const submit = async (caseId: string, responses: Record<string, unknown>) => {
    if (!backend || !loaded) return;
    const now = Date.now();
    backend.paradata.emit({ ts: now, type: 'submit', payload: { caseId } });
    await backend.cms.reportStatus(caseId, 'completed');
    await backend.paradata.flush();
    const surveyId = new URLSearchParams(window.location.search).get('survey');
    const submitResult = (surveyId && loaded.collectsData)
      ? await submitResponse(surveyId, caseId, responses, {
          startedAt: surveyStartedAt.current ?? undefined,
          durationMs: surveyStartedAt.current ? now - surveyStartedAt.current : undefined,
        })
      : { saved: false as boolean, errorMsg: undefined };
    await backend.sessionStore.clear(sessionKey(loaded.surveyId, caseId));
    setDone({ caseId, responses, paradata: backend.paradata.buffer(), saved: submitResult.saved, saveError: submitResult.errorMsg });
    setPhase('done');
  };

  const restart = () => {
    if (done && loaded) void backend?.sessionStore.clear(sessionKey(loaded.surveyId, done.caseId));
    setSurvey(null);
    setDone(null);
    // Re-enter: anonymous surveys auto-start again; code-gated return to the gate.
    setPhase('gate');
  };

  if (notFoundId) {
    return (
      <div className="app">
        <div className="gate">
          <div className="gate__card">
            <div className="gate__brand">Electronic Questionnaire</div>
            <h1 className="gate__title" style={{ marginTop: 12 }}>Survey not found</h1>
            <p className="gate__sub" style={{ marginTop: 8 }}>
              We couldn’t find a survey for “{notFoundId}”. Please check the link from your invitation,
              or contact whoever sent it to you.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
      <a className="skip-link" href="#eq-main">Skip to main content</a>
      {phase === 'gate' && loaded.requiresAccessCode && (
        <AccessGate onAuthenticate={authenticate} />
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
        <Completion responses={done.responses} paradata={done.paradata} saved={done.saved} saveError={done.saveError} showDebug={loaded.isDemo} onRestart={restart} />
      )}
    </div>
  );
}
