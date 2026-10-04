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
import { LanguageSwitch, useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import { bundledSurvey, isLocalSurvey, surveyCollectsData, type Instrument } from '@mobilesurvey/instrument-schema';
import {
  createMockSensorServices,
  type ParadataEvent,
  type RuntimeState,
  type SampleUnit,
} from '@mobilesurvey/runtime-engine';
import { AccessGate } from './components/AccessGate.jsx';
import { SurveyRunner } from './components/SurveyRunner.jsx';
import { Completion } from './components/Completion.jsx';
import { createBackend, ensureSurveyRow, fetchSurvey, submitResponse, type Backend } from './integrations/api.js';
import { createBrowserSensorServices } from './integrations/sensors.js';

interface SavedSession {
  runtimeState: RuntimeState;
  currentPage: number;
}

interface LoadedSurvey {
  instrument: Instrument;
  /** The survey row id / alias (surveys.id) — the FK target for sessions, paradata, responses. */
  surveyId: string;
  requiresAccessCode: boolean;
  anonymized?: boolean;
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
  const uiLanguage = useUiLanguage();
  const l = (en: string, fr: string) => uiText(uiLanguage, en, fr);
  useEffect(() => { document.documentElement.lang = uiLanguage === 'fr' ? 'fr-CA' : 'en-CA'; }, [uiLanguage]);
  const [phase, setPhase] = useState<'gate' | 'survey' | 'done' | 'already_completed'>('gate');
  const [completedInfo, setCompletedInfo] = useState<{ timestamp: string | null } | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [survey, setSurvey] = useState<SurveyContext | null>(null);
  const [done, setDone] = useState<DoneContext | null>(null);

  const [backend, setBackend] = useState<Backend | null>(null);
  const [loaded, setLoaded] = useState<LoadedSurvey | null>(null);
  // Set when an explicit ?survey=<id> matches neither a served nor a bundled survey.
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const surveyStartedAt = useRef<number | null>(null);

  // Notice banner text depends on whether the survey actually persists responses.
  const noticeFor = (collects: boolean, isLocal?: boolean): LoadedSurvey['notice'] => {
    if (isLocal) {
      return { kind: 'demo-saves', text: '🔒 Private Local Sandbox — responses you submit stay on your device with zero cloud storage.' };
    }
    return collects
      ? { kind: 'demo-saves', text: 'This is a demonstration survey — responses you submit will be saved to illustrate the data collection dashboard.' }
      : { kind: 'demo-no-save', text: 'This is a demo survey. Do not submit real personal information — responses are not saved.' };
  };

  // Load the backend and the survey (by ?survey=<id>, else the bundled fallback).
  useEffect(() => {
    let active = true;
    (async () => {
      const surveyId = new URLSearchParams(window.location.search).get('survey');
      // No ?survey param falls back to the bundled Household & Employment demo.
      const effectiveId = surveyId ?? 'lfs';
      const isLocal = isLocalSurvey(effectiveId);
      const collects = isLocal || surveyCollectsData(effectiveId);
      // Registry-driven: bundled demos and local surveys keep the Completion inspection panel
      const isDemo = isLocal || bundledSurvey(effectiveId) !== undefined;
      // Exploration-only surveys get a mock backend so nothing reaches Supabase.
      const b = await createBackend({ collectsData: collects, surveyId: effectiveId });

      let loadedSurvey: LoadedSurvey;
      const served = surveyId ? await fetchSurvey(surveyId) : null;
      if (served?.instrument) {
        loadedSurvey = {
          instrument: served.instrument as Instrument,
          requiresAccessCode: served.requiresAccessCode,
          anonymized: served.anonymized ?? false,
          surveyId: effectiveId,
          collectsData: collects,
          isDemo,
          notice: noticeFor(collects, isLocal),
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
          anonymized: false,
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

  // Auto-start token-authenticated or anonymous surveys once everything is loaded.
  useEffect(() => {
    if (!backend || !loaded || phase !== 'gate' || survey) return;
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token') ?? urlParams.get('code');
    if (token) {
      void authenticate(token, true);
    } else if (!loaded.requiresAccessCode) {
      void startAnonymous(backend, loaded);
    }
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
  const authenticate = async (code: string, fromUrl = false): Promise<{ ok: boolean; error?: string }> => {
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
        resolved = { caseId, sample: { id: caseId, fields: { name: demo.name } }, status: 'ready' };
      }
    }
    if (!resolved) {
      if (fromUrl) {
        setGateError('That invitation link or code was not recognized. Please check your link or enter your access code below.');
      }
      return { ok: false, error: 'That access code was not recognized. Please check and try again.' };
    }

    if (resolved.status === 'completed' || resolved.completedAt) {
      setCompletedInfo({ timestamp: resolved.completedAt ?? null });
      setPhase('already_completed');
      return { ok: true };
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

    const effectiveRespondentId = loaded.anonymized
      ? `anon-${Math.abs(now ^ (performance.now() | 0)).toString(36)}`
      : caseId;

    const submitResult = (surveyId && loaded.collectsData)
      ? await submitResponse(surveyId, effectiveRespondentId, responses, {
          instrument: loaded.instrument,
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
            <LanguageSwitch />
            <div className="gate__brand">{l('Electronic Questionnaire', 'Questionnaire électronique')}</div>
            <h1 className="gate__title" style={{ marginTop: 12 }}>{l('Survey not found', 'Enquête introuvable')}</h1>
            <p className="gate__sub" style={{ marginTop: 8 }}>
              {uiLanguage === 'fr' ? <>Nous n’avons pas trouvé l’enquête « {notFoundId} ». Vérifiez le lien de votre invitation ou communiquez avec la personne qui vous l’a envoyé.</> : <>We couldn’t find a survey for “{notFoundId}”. Please check the link from your invitation, or contact whoever sent it to you.</>}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'already_completed') {
    return (
      <div className="app">
        <div className="gate">
          <div className="gate__card">
            <LanguageSwitch />
            <div className="gate__brand">{l('Electronic Questionnaire', 'Questionnaire électronique')}</div>
            <div style={{ textAlign: 'center', margin: '24px 0 16px' }}>
              <div style={{ fontSize: '42px', lineHeight: 1, marginBottom: '12px', color: '#16a34a' }}>✓</div>
              <h1 className="gate__title">{l('Survey already completed', 'Enquête déjà remplie')}</h1>
              <p className="gate__sub" style={{ marginTop: 12 }}>
                {l('Thank you! Your response for this survey has already been received', 'Merci! Votre réponse à cette enquête a déjà été reçue')}
                {completedInfo?.timestamp
                  ? ` on ${new Date(completedInfo.timestamp).toLocaleDateString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`
                  : ''}.
              </p>
              <div className="gate__hint" style={{ marginTop: 20 }}>
                {l('This invitation link is single-use and your response has been recorded. If you have any questions, please contact your survey coordinator.', 'Ce lien d’invitation ne peut servir qu’une fois et votre réponse a été enregistrée. Pour toute question, communiquez avec la personne responsable de l’enquête.')}
              </div>
            </div>
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
            <LanguageSwitch />
            <div className="gate__brand">{l('Electronic Questionnaire', 'Questionnaire électronique')}</div>
            <p className="gate__sub" style={{ marginTop: 12 }}>{l('Loading…', 'Chargement…')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#eq-main">{l('Skip to main content', 'Aller au contenu principal')}</a>
      {phase === 'gate' && loaded.requiresAccessCode && (
        <AccessGate onAuthenticate={authenticate} initialError={gateError} />
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
          sensors={
            // Same split as the backend: exploration-only surveys never touch real sensors.
            loaded.collectsData
              ? createBrowserSensorServices(backend.paradata, {
                  surveyId: loaded.surveyId,
                  respondentId: survey.caseId,
                })
              : createMockSensorServices()
          }
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
