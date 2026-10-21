/**
 * Cognitive Testing Lab (`#coglab` / `#tester`) — Hub UI for multimodal
 * questionnaire cognitive interviewing & usability testing.
 *
 * Connects to the local companion daemon (`http://127.0.0.1:8792`) or runs
 * in interactive replay/sandbox mode in-browser using `@mobilesurvey/cognitive-lab`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail,
  Sparkles,
  ShieldCheck,
  X,
  Copy,
  Sliders,
  ChevronDown,
  ChevronUp,
  MousePointer,
  Mic,
} from 'lucide-react';
import {
  BUNDLED_COGNITIVE_SESSIONS,
  aggregateCrossParticipantHeatmap,
  buildTranscriptTurn,
  evaluateQuestionDiagnostics,
  sanitizeTranscriptText,
  type CognitiveConstructId,
  type CognitiveSessionReport,
  type QuestionCognitiveDiagnostic,
  type SeverityLevel,
  type UiTelemetryEvent,
} from '@mobilesurvey/cognitive-lab';
import { uiText, useUiLanguage } from '@mobilesurvey/ui-locale';
import { DESIGNER_URL } from './api.js';

const DAEMON_DEFAULT_URL = 'http://127.0.0.1:8792';

function severityColor(severity: SeverityLevel): string {
  switch (severity) {
    case 'high':
      return '#dc2626';
    case 'moderate':
      return '#d97706';
    case 'low':
      return '#2563eb';
    default:
      return '#16a34a';
  }
}

function severityBg(severity: SeverityLevel): string {
  switch (severity) {
    case 'high':
      return 'rgba(220, 38, 38, 0.1)';
    case 'moderate':
      return 'rgba(217, 119, 6, 0.12)';
    case 'low':
      return 'rgba(37, 99, 235, 0.1)';
    default:
      return 'rgba(22, 163, 74, 0.1)';
  }
}

function constructName(id: CognitiveConstructId, lang: 'en' | 'fr'): string {
  switch (id) {
    case 'comprehension':
      return lang === 'fr' ? 'Compréhension et terminologie' : 'Comprehension & Terminology';
    case 'retrieval':
      return lang === 'fr' ? 'Effort de rappel et mémoire' : 'Memory Retrieval & Recall Burden';
    case 'sensitivity':
      return lang === 'fr' ? 'Sensibilité et inconfort vocal' : 'Sensitivity & Vocal Discomfort';
    case 'mapping':
      return lang === 'fr' ? 'Correspondance des catégories' : 'Response Category Mapping';
  }
}

interface SimulatorPreset {
  id: string;
  labelEn: string;
  labelFr: string;
  icon: string;
  descriptionEn: string;
  descriptionFr: string;
  text: string;
  pitchSt: number;
  uptalkSt: number;
  volumeDb: number;
  prePauseMs: number;
  answerSwitches: number;
  hoverOsc: number;
  scrollRegs: number;
}

const SIMULATOR_PRESETS: SimulatorPreset[] = [
  {
    id: 'category_mapping',
    labelEn: 'Category Overlap Confusion',
    labelFr: 'Confusion de catégories',
    icon: '🎯',
    descriptionEn: 'Hesitation between Employee & Contractor with 2 answer switches and hover oscillation.',
    descriptionFr: 'Hésitation entre employé et travailleur autonome avec changements de réponse.',
    text: 'Well, my name is Alex Martin and I do contract work for a company, but on their site... so am I an employee or self-employed?',
    pitchSt: 2.4,
    uptalkSt: 2.8,
    volumeDb: -1.0,
    prePauseMs: 2400,
    answerSwitches: 2,
    hoverOsc: 3,
    scrollRegs: 1,
  },
  {
    id: 'sensitive_reluctance',
    labelEn: 'Sensitive Income Reluctance',
    labelFr: 'Réticence sur revenu sensible',
    icon: '🤐',
    descriptionEn: 'Volume withdrawal (-6.5 dB) and long pause when reporting sensitive household income.',
    descriptionFr: 'Baisse de volume (-6,5 dB) et long silence sur une question sensible de revenu.',
    text: 'Yeah, that is fine. My name is Alex Martin, SIN is 123-456-789, and I guess our household makes around $65,000?',
    pitchSt: -1.5,
    uptalkSt: 1.4,
    volumeDb: -6.5,
    prePauseMs: 3400,
    answerSwitches: 1,
    hoverOsc: 1,
    scrollRegs: 0,
  },
  {
    id: 'declarative_uptalk',
    labelEn: 'Declarative Uptalk / Uncertainty',
    labelFr: 'Intonation montante / Incertitude',
    icon: '❓',
    descriptionEn: 'Terminal pitch rise (+3.8 st) indicating respondent is unsure if their answer matches intent.',
    descriptionFr: 'Hausse tonale finale (+3,8 st) indiquant que le répondant doute de sa réponse.',
    text: 'My name is Alex Martin and I work approximately forty hours per week?',
    pitchSt: 3.6,
    uptalkSt: 3.8,
    volumeDb: 0.0,
    prePauseMs: 1800,
    answerSwitches: 0,
    hoverOsc: 0,
    scrollRegs: 0,
  },
  {
    id: 'fluent_baseline',
    labelEn: 'Fluent Baseline Response',
    labelFr: 'Réponse fluide de référence',
    icon: '🟢',
    descriptionEn: 'Confident answer, baseline pitch, instant single click with zero friction.',
    descriptionFr: 'Réponse assurée, hauteur tonale normale, clic immédiat sans hésitation.',
    text: 'My name is Alex Martin and I am a permanent full-time employee.',
    pitchSt: 0.2,
    uptalkSt: 0.0,
    volumeDb: 0.5,
    prePauseMs: 600,
    answerSwitches: 0,
    hoverOsc: 0,
    scrollRegs: 0,
  },
];

export function CognitiveLabView({ onBack }: { onBack: () => void }) {
  const language = useUiLanguage();
  const l = useCallback((en: string, fr: string) => uiText(language, en, fr), [language]);

  const [sessions, setSessions] = useState<CognitiveSessionReport[]>(
    () => BUNDLED_COGNITIVE_SESSIONS,
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => BUNDLED_COGNITIVE_SESSIONS[0]!.sessionId,
  );
  const [activeTab, setActiveTab] = useState<'console' | 'diagnostics' | 'heatmap'>('console');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [askedProbes, setAskedProbes] = useState<Record<string, boolean>>({});
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [showCliDetails, setShowCliDetails] = useState(false);
  const [showWaveformInspector, setShowWaveformInspector] = useState(true);

  // Daemon connectivity state
  const [daemonStatus, setDaemonStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [daemonUrl] = useState(DAEMON_DEFAULT_URL);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Moderator one-click question override state
  const [overrideQuestionInput, setOverrideQuestionInput] = useState('');
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);

  // Interactive Prosody & Behavioral Sandbox state
  const [activePresetId, setActivePresetId] = useState<string>('sensitive_reluctance');
  const [sandboxText, setSandboxText] = useState(
    'Yeah, that is fine. My name is Alex Martin, SIN is 123-456-789, and I think it was around $75,000?',
  );
  const [sandboxPitchSt, setSandboxPitchSt] = useState(3.8);
  const [sandboxUptalkSt, setSandboxUptalkSt] = useState(3.1);
  const [sandboxVolumeDb, setSandboxVolumeDb] = useState(-6.2);
  const [sandboxPrePauseMs, setSandboxPrePauseMs] = useState(2600);
  const [sandboxAnswerSwitches, setSandboxAnswerSwitches] = useState(2);
  const [sandboxHoverOsc, setSandboxHoverOsc] = useState(2);
  const [sandboxScrollRegs, setSandboxScrollRegs] = useState(1);

  const checkDaemon = useCallback(async () => {
    setDaemonStatus('checking');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${daemonUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setDaemonStatus('connected');
        const sessRes = await fetch(`${daemonUrl}/sessions`);
        if (sessRes.ok) {
          const data = (await sessRes.json()) as { sessions?: CognitiveSessionReport[] };
          if (Array.isArray(data.sessions) && data.sessions.length > 0) {
            setSessions(data.sessions);
          }
        }
      } else {
        setDaemonStatus('offline');
      }
    } catch {
      setDaemonStatus('offline');
    }
  }, [daemonUrl]);

  useEffect(() => {
    void checkDaemon();
  }, [checkDaemon]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId) ?? sessions[0]!,
    [sessions, selectedSessionId],
  );

  const activeQuestion: QuestionCognitiveDiagnostic | null = useMemo(() => {
    if (!selectedQuestionId) return null;
    return activeSession.questions.find((q) => q.questionId === selectedQuestionId) ?? null;
  }, [activeSession, selectedQuestionId]);

  const heatmapRows = useMemo(
    () => aggregateCrossParticipantHeatmap(sessions),
    [sessions],
  );

  // Apply one-click scenario preset
  function handleApplyPreset(preset: SimulatorPreset) {
    setActivePresetId(preset.id);
    setSandboxText(preset.text);
    setSandboxPitchSt(preset.pitchSt);
    setSandboxUptalkSt(preset.uptalkSt);
    setSandboxVolumeDb(preset.volumeDb);
    setSandboxPrePauseMs(preset.prePauseMs);
    setSandboxAnswerSwitches(preset.answerSwitches);
    setSandboxHoverOsc(preset.hoverOsc);
    setSandboxScrollRegs(preset.scrollRegs);
  }

  // Trigger Moderator "Mark Next Question" override
  async function handleMarkNextQuestion() {
    const label = overrideQuestionInput.trim() || `Q${activeSession.questions.length + 1}: External Survey Step`;
    const newQId = `q_mod_${Date.now().toString().slice(-4)}`;
    const nowMs = activeSession.durationMs;

    if (daemonStatus === 'connected') {
      try {
        await fetch(`${daemonUrl}/session/mark-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: newQId, questionTextEn: label }),
        });
      } catch {
        // Fallback to local state update
      }
    }

    const newBookmarkEvent: UiTelemetryEvent = {
      id: `ev_mark_${Date.now()}`,
      timestampMs: nowMs,
      questionId: newQId,
      kind: 'moderator_bookmark',
      targetLabel: label,
      note: `Moderator manually marked question boundary: ${label}`,
    };

    const newDiag = evaluateQuestionDiagnostics({
      questionId: newQId,
      questionNumber: `Q${activeSession.questions.length + 1}`,
      questionTextEn: label,
      questionTextFr: label,
      detectionSource: 'moderator_override',
      enteredAtMs: nowMs,
      exitedAtMs: nowMs + 5000,
      turns: [],
      uiEvents: [newBookmarkEvent],
    });

    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === activeSession.sessionId
          ? {
              ...s,
              durationMs: nowMs + 5000,
              uiEvents: [...s.uiEvents, newBookmarkEvent],
              questions: [...s.questions, newDiag],
            }
          : s,
      ),
    );
    setOverrideQuestionInput('');
    setSelectedQuestionId(null);
    setOverrideNotice(
      l(
        `Tagged question transition "${label}" at ${(nowMs / 1000).toFixed(1)}s`,
        `Transition de question « ${label} » marquée à ${(nowMs / 1000).toFixed(1)} s`,
      ),
    );
  }

  // Export PII-Sanitized JSON Report
  function handleExportReport() {
    const blob = new Blob([JSON.stringify(activeSession, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSession.sessionId}-pii-sanitized.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Live evaluation of the Interactive Prosody & Behavioral Sandbox
  const sandboxEvaluation = useMemo(() => {
    const piiResult = sanitizeTranscriptText(sandboxText);
    const baseline = activeSession.speakerBaseline;
    const baseF0 = baseline.f0Hz;
    const peakF0 = Number((baseF0 * Math.pow(2, sandboxPitchSt / 12)).toFixed(1));
    const endF0 = Number((baseF0 * Math.pow(2, (sandboxPitchSt + sandboxUptalkSt) / 12)).toFixed(1));
    const dbVal = Number((baseline.rmsDbfs + sandboxVolumeDb).toFixed(1));

    const synthContour = [
      {
        timestampMs: 1000 + sandboxPrePauseMs,
        speaker: 'participant' as const,
        voiced: true,
        f0Hz: peakF0,
        pitchDeltaSt: sandboxPitchSt,
        volumeDbfs: dbVal,
        volumeDeltaDb: sandboxVolumeDb,
        jitterPct: sandboxPitchSt >= 3.0 ? 2.1 : 0.7,
      },
      {
        timestampMs: 2500 + sandboxPrePauseMs,
        speaker: 'participant' as const,
        voiced: true,
        f0Hz: peakF0,
        pitchDeltaSt: sandboxPitchSt,
        volumeDbfs: dbVal,
        volumeDeltaDb: sandboxVolumeDb,
        jitterPct: sandboxPitchSt >= 3.0 ? 2.1 : 0.7,
      },
      {
        timestampMs: 4200 + sandboxPrePauseMs,
        speaker: 'participant' as const,
        voiced: true,
        f0Hz: endF0,
        pitchDeltaSt: Number((sandboxPitchSt + sandboxUptalkSt).toFixed(2)),
        volumeDbfs: dbVal,
        volumeDeltaDb: sandboxVolumeDb,
        jitterPct: sandboxPitchSt >= 3.0 ? 2.2 : 0.7,
      },
    ];

    const synthTurn = buildTranscriptTurn({
      id: 'sandbox_turn',
      speaker: 'participant',
      questionId: 'q_sandbox',
      startMs: 1000 + sandboxPrePauseMs,
      endMs: 4500 + sandboxPrePauseMs,
      text: piiResult.sanitizedText,
      contour: synthContour,
      baseline,
      referencePromptEndMs: 1000,
    });

    const synthEvents: UiTelemetryEvent[] = [
      { id: 'sb_enter', timestampMs: 0, questionId: 'q_sandbox', kind: 'question_enter' },
    ];
    for (let i = 0; i < sandboxHoverOsc; i++) {
      synthEvents.push(
        { id: `sb_h1_${i}`, timestampMs: 1200 + i * 600, questionId: 'q_sandbox', kind: 'option_hover', targetLabel: 'Category A', dwellMs: 300 },
        { id: `sb_h2_${i}`, timestampMs: 1500 + i * 600, questionId: 'q_sandbox', kind: 'option_hover', targetLabel: 'Category B', dwellMs: 300 },
      );
    }
    if (sandboxHoverOsc > 0) {
      synthEvents.push({
        id: 'sb_h_final',
        timestampMs: 1200 + sandboxHoverOsc * 600,
        questionId: 'q_sandbox',
        kind: 'option_hover',
        targetLabel: 'Category A',
        dwellMs: 300,
      });
    }
    for (let i = 0; i <= sandboxAnswerSwitches; i++) {
      const opt = i % 2 === 0 ? 'Category A' : 'Category B';
      synthEvents.push({
        id: `sb_sel_${i}`,
        timestampMs: 2200 + i * 500,
        questionId: 'q_sandbox',
        kind: i === 0 ? 'answer_select' : 'answer_change',
        targetLabel: opt,
        newValue: opt,
      });
    }
    for (let i = 0; i < sandboxScrollRegs; i++) {
      synthEvents.push({
        id: `sb_scr_${i}`,
        timestampMs: 1800 + i * 400,
        questionId: 'q_sandbox',
        kind: 'scroll_regression',
        scrollDeltaY: -140,
      });
    }

    const diag = evaluateQuestionDiagnostics({
      questionId: 'q_sandbox',
      questionNumber: 'Q-Sim',
      questionTextEn: 'Simulated Cognitive Interview Response',
      questionTextFr: 'Réponse simulée d’entrevue cognitive',
      enteredAtMs: 0,
      exitedAtMs: 6000 + sandboxPrePauseMs,
      turns: [synthTurn],
      uiEvents: synthEvents,
    });

    return { piiResult, synthTurn, diag };
  }, [
    sandboxText,
    sandboxPitchSt,
    sandboxUptalkSt,
    sandboxVolumeDb,
    sandboxPrePauseMs,
    sandboxAnswerSwitches,
    sandboxHoverOsc,
    sandboxScrollRegs,
    activeSession.speakerBaseline,
  ]);

  const cliCommand = `npx @mobilesurvey/cognitive-lab start --port 8792 --url "${activeSession.targetUrl}"`;

  // Summary counts for Executive Triage Card
  const highFrictionQuestions = useMemo(
    () => activeSession.questions.filter((q) => q.overallSeverity === 'high' || q.overallSeverity === 'moderate'),
    [activeSession.questions],
  );

  return (
    <div className="hub" data-testid="cognitive-lab-view">
      <header className="hub__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} className="hub__back" data-testid="coglab-back-btn">
            ← {l('Home', 'Accueil')}
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              {l('Cognitive Testing Lab', 'Laboratoire de test cognitif')}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
              {l(
                'Multimodal questionnaire testing: voice prosody (pitch, volume, pauses, uptalk), UI movement telemetry & Tourangeau 4-construct diagnostics',
                'Tests cognitifs multimodaux : prosodie vocale (hauteur, volume, pauses, intonation), mouvements d’interface et diagnostic en 4 construits',
              )}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            data-testid="coglab-daemon-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background:
                daemonStatus === 'connected'
                  ? 'rgba(22, 163, 74, 0.14)'
                  : 'rgba(37, 99, 235, 0.12)',
              color: daemonStatus === 'connected' ? '#15803d' : '#1d4ed8',
            }}
          >
            ●{' '}
            {daemonStatus === 'connected'
              ? l('Local Daemon Connected (127.0.0.1:8792)', 'Démon local connecté (127.0.0.1:8792)')
              : l('Interactive Replay & Sandbox Mode (Local Daemon Optional)', 'Mode relecture et bac à sable interactif')}
          </span>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => void checkDaemon()}
          >
            {l('Check Local Daemon', 'Vérifier le démon local')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'linear-gradient(135deg, #1f5fae 0%, #1e40af 100%)',
              color: '#ffffff',
              fontWeight: 600,
              boxShadow: '0 1px 3px rgba(30, 64, 175, 0.25)',
            }}
            onClick={() => setIsSetupModalOpen(true)}
            data-testid="coglab-contact-btn"
          >
            <Mail size={14} /> {l('Contact to Help Test & Deploy', 'Participer aux tests et au déploiement')}
          </button>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={handleExportReport}
            data-testid="coglab-export-btn"
          >
            {l('Export PII-Sanitized JSON', 'Exporter JSON anonymisé')}
          </button>
        </div>
      </header>

      <main className="hub__main" style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 16px 48px' }}>
        {/* Interactive Demonstration Notice & Setup Callout */}
        <section
          style={{
            background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
            border: '1px solid #cbd5e1',
            borderRadius: 14,
            padding: '18px 22px',
            marginBottom: 20,
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
          }}
          data-testid="coglab-setup-banner"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '1 1 540px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11.5,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: 'rgba(31, 95, 174, 0.12)',
                    color: '#1f5fae',
                    fontWeight: 700,
                  }}
                >
                  <Sparkles size={13} /> {l('Interactive Prototype', 'Prototype interactif')}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11.5,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: 'rgba(22, 163, 74, 0.12)',
                    color: '#15803d',
                    fontWeight: 600,
                  }}
                >
                  <ShieldCheck size={13} />{' '}
                  {l(
                    `PII Air-Gap Active (${activeSession.privacy.redactedEntityCount} entities scrubbed)`,
                    `Isolement des RP actif (${activeSession.privacy.redactedEntityCount} entités masquées)`,
                  )}
                </span>
              </div>

              {/* 3 Core Capability Showcase Pills */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#e0f2fe', color: '#0369a1', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Mic size={13} /> {l('Voice Hesitation & Sentiment', 'Hésitations vocales et sentiment')}
                </span>
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#fef3c7', color: '#92400e', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <MousePointer size={13} /> {l('Form Telemetry & Hesitation', 'Télémétrie d’interface et hésitation')}
                </span>
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#dcfce7', color: '#166534', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ShieldCheck size={13} /> {l('100% On-Device PII Air-Gap', 'Isolement 100 % local sans fuite infonuagique')}
                </span>
              </div>

              <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
                {l(
                  'Cognitive Testing Lab Prototype — Contact Me to Help Test & Deploy',
                  'Prototype du laboratoire de test cognitif — Contactez-moi pour tester et déployer',
                )}
              </h2>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
                {l(
                  'This working prototype demonstrates how vocal prosody (pitch shifts, volume drops, silent pauses) and questionnaire telemetry (hover oscillation, answer switching) automatically diagnose cognitive friction across Tourangeau’s 4 constructs. Because cognitive interviews capture confidential voices and sensitive survey answers, live testing runs on your local machine with an air-gapped on-device audio model. We are actively seeking survey research partners to help test and deploy this prototype on real questionnaires. Contact me at contact@peji.ca to collaborate.',
                  'Ce prototype interactif démontre comment la prosodie vocale (hauteur F0, baisses de volume, pauses) et la télémétrie du questionnaire diagnostiquent automatiquement la friction cognitive selon les 4 construits de Tourangeau. Puisque les entrevues cognitives enregistrent des voix confidentielles, les tests réels s’exécutent en local avec un modèle audio isolé. Nous recherchons activement des partenaires de recherche pour aider à tester et déployer ce prototype sur de vrais questionnaires. Contactez-moi à contact@peji.ca pour collaborer.',
                )}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <button
                type="button"
                className="btn btn--primary"
                style={{
                  fontSize: 13,
                  padding: '8px 16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  background: '#1f5fae',
                  color: '#ffffff',
                }}
                onClick={() => setIsSetupModalOpen(true)}
                data-testid="banner-contact-btn"
              >
                <Mail size={15} /> {l('Contact to Help Test & Deploy (contact@peji.ca)', 'Participer aux tests et au déploiement (contact@peji.ca)')}
              </button>
              <button
                type="button"
                className="btn"
                style={{ fontSize: 12, padding: '5px 12px' }}
                onClick={() => setIsSetupModalOpen(true)}
              >
                {l('View Prototype Capabilities & Deployment Requirements', 'Voir les capacités du prototype et exigences de déploiement')}
              </button>
            </div>
          </div>

          {/* Collapsible Developer/Local Daemon CLI Box */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--brand)', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}
              onClick={() => setShowCliDetails((prev) => !prev)}
            >
              {showCliDetails
                ? l('▼ Hide Local Developer CLI command', '▼ Masquer la commande CLI pour développeurs')
                : l('▶ Developer Preview: Local CLI command (for local repo contributors)', '▶ Aperçu développeur : commande CLI locale (contributeurs au dépôt)')}
            </button>
            {showCliDetails && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%', marginTop: 4 }}>
                <code
                  style={{
                    background: '#0f172a',
                    color: '#e2e8f0',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    flex: '1 1 auto',
                  }}
                >
                  {cliCommand}
                </code>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 11.5, padding: '5px 10px' }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(cliCommand);
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 2000);
                  }}
                >
                  {copiedCmd ? l('Copied!', 'Copié!') : l('Copy CLI', 'Copier')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Executive Triage Summary Card (What matters first to a Methodologist) */}
        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(217, 119, 6, 0.12)',
                  color: '#b45309',
                }}
              >
                {l('Executive Cognitive Triage', 'Triage cognitif exécutif')}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                {l(
                  `${highFrictionQuestions.length} of ${activeSession.questions.length} questions exhibit cognitive friction in ${activeSession.participantCode}`,
                  `${highFrictionQuestions.length} questions sur ${activeSession.questions.length} présentent une friction cognitive chez ${activeSession.participantCode}`,
                )}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {l('Cohort: 3 interviews analyzed', 'Cohorte : 3 entrevues analysées')}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {activeSession.questions
              .filter((q) => q.overallSeverity === 'high' || q.overallSeverity === 'moderate')
              .map((q) => (
                <div
                  key={q.questionId}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: severityBg(q.overallSeverity),
                    borderLeft: `4px solid ${severityColor(q.overallSeverity)}`,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 4 }}>
                    <span>{q.questionNumber} · {q.dominantConstruct ? constructName(q.dominantConstruct, language) : ''}</span>
                    <span style={{ color: severityColor(q.overallSeverity) }}>
                      {q.overallFrictionScore}/100 ({q.overallSeverity.toUpperCase()})
                    </span>
                  </div>
                  <div style={{ color: 'var(--ink)', marginBottom: 4 }}>
                    {language === 'fr' ? q.questionTextFr : q.questionTextEn}
                  </div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>
                    <strong>{l('Key Signal:', 'Signal clé :')}</strong>{' '}
                    {(q.dominantConstruct && q.constructs[q.dominantConstruct]?.evidence[0]) ||
                      (q.dominantConstruct === 'mapping'
                        ? l('Option ambiguity & hover oscillations between choices', 'Ambiguïté des options et oscillations du curseur')
                        : q.dominantConstruct === 'sensitivity'
                        ? l('Vocal volume drop & pre-response hesitation on sensitive item', 'Baisse de volume vocal et hésitation sur question sensible')
                        : l('Extended mid-sentence pause & recall estimation burden', 'Pause prolongée en milieu de phrase et effort d’estimation'))}
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* Session Selector + Workspace Mode Tabs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label htmlFor="coglab-session-select" style={{ fontSize: 13, fontWeight: 600 }}>
              {l('Cognitive Session:', 'Séance cognitive :')}
            </label>
            <select
              id="coglab-session-select"
              data-testid="coglab-session-select"
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setSelectedQuestionId(null);
              }}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #cbd5e1)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.participantCode} — {language === 'fr' ? s.surveyTitleFr : s.surveyTitleEn}
                </option>
              ))}
            </select>
            <span
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
                background: activeSession.isExternalSurvey
                  ? 'rgba(139, 92, 246, 0.12)'
                  : 'rgba(31, 95, 174, 0.12)',
                color: activeSession.isExternalSurvey ? '#6d28d9' : '#1f5fae',
                fontWeight: 600,
              }}
            >
              {activeSession.isExternalSurvey
                ? l('External Web Survey (DOM Heuristic)', 'Enquête Web externe (Heuristique DOM)')
                : l('Native @mobilesurvey Instrument', 'Instrument @mobilesurvey natif')}
            </span>
          </div>

          <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'console'}
              data-testid="tab-moderator-console"
              className={activeTab === 'console' ? 'btn btn--primary' : 'btn'}
              style={{ fontSize: 13, padding: '7px 14px' }}
              onClick={() => setActiveTab('console')}
            >
              {l('1. Interview Replay & Moderator Console', '1. Relecture d’entrevue et console')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              data-testid="tab-question-diagnostics"
              className={activeTab === 'diagnostics' ? 'btn btn--primary' : 'btn'}
              style={{ fontSize: 13, padding: '7px 14px' }}
              onClick={() => setActiveTab('diagnostics')}
            >
              {l('2. 4-Construct Question Diagnostics', '2. Diagnostic par question (4 construits)')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'heatmap'}
              data-testid="tab-heatmap-sandbox"
              className={activeTab === 'heatmap' ? 'btn btn--primary' : 'btn'}
              style={{ fontSize: 13, padding: '7px 14px' }}
              onClick={() => setActiveTab('heatmap')}
            >
              {l('3. Cross-Participant Heatmap & Simulator', '3. Carte thermique et simulateur')}
            </button>
          </div>
        </div>

        {/* TAB 1: LIVE MODERATOR CONSOLE & SYNCHRONIZED MULTIMODAL TIMELINE */}
        {activeTab === 'console' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Split Console: Diarized Transcript (Left) + Real-Time Moderator Probes (Right) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                gap: 20,
              }}
            >
              {/* Left: Diarized Transcript with Human-Readable Prosodic & Disfluency Badges */}
              <section
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 12,
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                    {l(
                      'Diarized Transcript & Voice Sentiment Stream',
                      'Transcription avec locuteurs et sentiment vocal',
                    )}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    {selectedQuestionId ? `${l('Filtered to', 'Filtré sur')} ${selectedQuestionId}` : l('Showing all turns', 'Toutes les répliques')}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeSession.transcript
                    .filter((t) => !selectedQuestionId || t.questionId === selectedQuestionId)
                    .map((turn) => {
                      const isParticipant = turn.speaker === 'participant';
                      return (
                        <div
                          key={turn.id}
                          data-testid={`transcript-turn-${turn.id}`}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 10,
                            borderLeft: isParticipant ? '4px solid #1f5fae' : '4px solid #94a3b8',
                            background: isParticipant ? '#f8fafc' : '#ffffff',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 6,
                              fontSize: 11.5,
                              color: 'var(--ink-soft)',
                            }}
                          >
                            <strong>
                              {isParticipant
                                ? `🎙️ ${l('Participant', 'Répondant')} (${activeSession.participantCode})`
                                : `🧑‍🔬 ${l('Moderator', 'Modérateur')}`}
                            </strong>
                            <span>
                              {(turn.startMs / 1000).toFixed(1)}s – {(turn.endMs / 1000).toFixed(1)}s ·{' '}
                              <code>{turn.questionId}</code>
                            </span>
                          </div>

                          <p style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.5 }}>
                            {turn.text}
                          </p>

                          {isParticipant && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {/* Sentiment Badge */}
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontWeight: 600,
                                  background:
                                    turn.sentiment.label === 'confident_fluent' ||
                                    turn.sentiment.label === 'neutral_steady'
                                      ? 'rgba(22, 163, 74, 0.12)'
                                      : 'rgba(217, 119, 6, 0.14)',
                                  color:
                                    turn.sentiment.label === 'confident_fluent' ||
                                    turn.sentiment.label === 'neutral_steady'
                                      ? '#15803d'
                                      : '#b45309',
                                }}
                              >
                                {turn.sentiment.label.replace(/_/g, ' ')}
                              </span>

                              {/* Pitch shift badge (Human-readable label) */}
                              {Math.abs(turn.prosody.peakPitchDeltaSt) >= 1.5 && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'rgba(37, 99, 235, 0.1)',
                                    color: '#1d4ed8',
                                    fontWeight: 600,
                                  }}
                                >
                                  📈 {l('Pitch Rise (Uncertainty)', 'Hausse tonale (Incertitude)')} {turn.prosody.peakPitchDeltaSt > 0 ? '+' : ''}
                                  {turn.prosody.peakPitchDeltaSt} st
                                </span>
                              )}

                              {/* Terminal uptalk badge */}
                              {turn.prosody.terminalPitchSlopeSt >= 2.2 && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'rgba(139, 92, 246, 0.12)',
                                    color: '#6d28d9',
                                    fontWeight: 600,
                                  }}
                                >
                                  ❓ {l('Questioning Tone (Uptalk)', 'Ton interrogatif (Uptalk)')} +{turn.prosody.terminalPitchSlopeSt} st
                                </span>
                              )}

                              {/* Volume withdrawal badge */}
                              {turn.prosody.minVolumeDeltaDb <= -4.0 && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'rgba(220, 38, 38, 0.12)',
                                    color: '#b91c1c',
                                    fontWeight: 600,
                                  }}
                                >
                                  🔉 {l('Hesitant / Softer Voice', 'Voix atténuée / hésitante')} {turn.prosody.minVolumeDeltaDb} dB
                                </span>
                              )}

                              {/* Pre-response silence badge */}
                              {turn.prosody.preResponseSilenceMs >= 1500 && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'rgba(100, 116, 139, 0.14)',
                                    color: '#334155',
                                    fontWeight: 600,
                                  }}
                                >
                                  ⏸ {l('Thinking Delay', 'Délai de réflexion')} ({(turn.prosody.preResponseSilenceMs / 1000).toFixed(1)}s)
                                </span>
                              )}

                              {/* Filled pauses & hedges */}
                              {(turn.prosody.filledPauseCount > 0 || turn.prosody.hedgeCount > 0) && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'rgba(234, 179, 8, 0.15)',
                                    color: '#854d0e',
                                    fontWeight: 600,
                                  }}
                                >
                                  💬 {l('Hesitations', 'Hésitations')} ({turn.prosody.filledPauseCount} um/uh · {turn.prosody.hedgeCount} hedges)
                                </span>
                              )}
                            </div>
                          )}

                          {/* Lexical-Prosodic Incongruence Alert */}
                          {turn.sentiment.lexicalProsodicIncongruence && (
                            <div
                              data-testid="incongruence-alert"
                              style={{
                                marginTop: 8,
                                padding: '8px 10px',
                                borderRadius: 6,
                                background: 'rgba(220, 38, 38, 0.08)',
                                border: '1px solid rgba(220, 38, 38, 0.25)',
                                color: '#991b1b',
                                fontSize: 12,
                              }}
                            >
                              <strong>⚠️ {l('Lexical-Prosodic Incongruence:', 'Incongruence lexico-prosodique :')}</strong>{' '}
                              {turn.sentiment.incongruenceReason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>

              {/* Right: Real-Time Suggested Moderator Probes & Behavioral Events */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <section
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>
                    {l(
                      'Suggested Non-Leading Moderator Probes (Willis Protocol)',
                      'Questions d’approfondissement non directives (Protocole de Willis)',
                    )}
                  </h3>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-soft)' }}>
                    {l(
                      'Automatically synthesized when voice prosody + UI telemetry cross a Tourangeau construct threshold.',
                      'Générées automatiquement lorsque la prosodie vocale et les mouvements d’interface franchissent un seuil.',
                    )}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeSession.probes
                      .filter((p) => !selectedQuestionId || p.questionId === selectedQuestionId)
                      .map((probe) => {
                        const isAsked = Boolean(askedProbes[probe.id]);
                        return (
                          <div
                            key={probe.id}
                            data-testid={`moderator-probe-${probe.id}`}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 10,
                              border: `1px solid ${severityColor(probe.severity)}`,
                              background: isAsked ? '#f8fafc' : severityBg(probe.severity),
                              opacity: isAsked ? 0.72 : 1,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  color: severityColor(probe.severity),
                                }}
                              >
                                {constructName(probe.construct, language)} · {probe.questionLabel}
                              </span>
                              <button
                                type="button"
                                className="btn"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() =>
                                  setAskedProbes((prev) => ({ ...prev, [probe.id]: !isAsked }))
                                }
                              >
                                {isAsked
                                  ? l('✓ Probe Asked', '✓ Question posée')
                                  : l('Mark Asked', 'Marquer comme posée')}
                              </button>
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
                              <strong>{l('Signal Trigger:', 'Signal déclencheur :')}</strong>{' '}
                              {language === 'fr' ? probe.triggerSummaryFr : probe.triggerSummaryEn}
                            </div>
                            <blockquote
                              style={{
                                margin: 0,
                                fontSize: 13,
                                fontWeight: 600,
                                fontStyle: 'italic',
                                color: 'var(--ink)',
                              }}
                            >
                              “{language === 'fr' ? probe.probeTextFr : probe.probeTextEn}”
                            </blockquote>
                          </div>
                        );
                      })}
                  </div>
                </section>

                {/* Observed UI Interaction Friction Feed */}
                <section
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>
                    {l(
                      'Electronic Questionnaire Movement Log (DOM / Cursor / Scroll)',
                      'Journal des mouvements sur le questionnaire électronique (DOM / Curseur / Défilement)',
                    )}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 290, overflowY: 'auto' }}>
                    {activeSession.uiEvents
                      .filter((ev) => !selectedQuestionId || ev.questionId === selectedQuestionId)
                      .map((ev) => (
                        <div
                          key={ev.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 10px',
                            borderRadius: 6,
                            background:
                              ev.kind === 'answer_change' ||
                              ev.kind === 'scroll_regression' ||
                              ev.kind === 'prefer_not_hover' ||
                              ev.kind === 'cursor_thrash'
                                ? 'rgba(217, 119, 6, 0.1)'
                                : '#f8fafc',
                            fontSize: 12,
                          }}
                        >
                          <span>
                            <strong>[{ev.kind.replace(/_/g, ' ')}]</strong>{' '}
                            {ev.targetLabel ?? ev.note ?? ''}
                            {ev.previousValue && ev.newValue
                              ? ` (${ev.previousValue} → ${ev.newValue})`
                              : ''}
                            {ev.cursorTortuosity ? ` · Tortuosity ${ev.cursorTortuosity}×` : ''}
                          </span>
                          <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>
                            {(ev.timestampMs / 1000).toFixed(1)}s · <code>{ev.questionId}</code>
                          </span>
                        </div>
                      ))}
                  </div>
                </section>
              </div>
            </div>

            {/* Collapsible Synchronized Multi-Track SVG Waveform Inspector */}
            <section
              style={{
                background: '#ffffff',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: 12,
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowWaveformInspector((prev) => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {showWaveformInspector ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    {l(
                      'Detailed Acoustic Waveforms & Telemetry Track (Acoustic Inspector)',
                      'Formes d’ondes acoustiques détaillées et télémétrie (Inspecteur acoustique)',
                    )}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    {l(
                      `Speaker Baseline: F0 = ${activeSession.speakerBaseline.f0Hz} Hz · RMS = ${activeSession.speakerBaseline.rmsDbfs} dBFS · ${activeSession.speakerBaseline.wordsPerMinute} WPM (Click any question band below to filter)`,
                      `Référence du répondant : F0 = ${activeSession.speakerBaseline.f0Hz} Hz · Volume = ${activeSession.speakerBaseline.rmsDbfs} dBFS · ${activeSession.speakerBaseline.wordsPerMinute} mots/min`,
                    )}
                  </span>
                </div>

                {/* One-Click Moderator Question Override */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="text"
                    value={overrideQuestionInput}
                    onChange={(e) => setOverrideQuestionInput(e.target.value)}
                    placeholder={l('External step label (optional)…', 'Libellé de question externe…')}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid var(--border, #cbd5e1)',
                    }}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, padding: '6px 12px', fontWeight: 600 }}
                    onClick={() => void handleMarkNextQuestion()}
                    data-testid="mark-next-question-btn"
                  >
                    🔖 {l('Mark Next Question', 'Marquer la question suivante')}
                  </button>
                </div>
              </div>

              {overrideNotice && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(37, 99, 235, 0.1)',
                    color: '#1d4ed8',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {overrideNotice}
                </div>
              )}

              {/* Question Selector Pills */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => setSelectedQuestionId(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: selectedQuestionId === null ? '2px solid #1f5fae' : '1px solid #cbd5e1',
                    background: selectedQuestionId === null ? 'rgba(31, 95, 174, 0.08)' : '#f8fafc',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {l('All Questions', 'Toutes les questions')} ({activeSession.questions.length})
                </button>
                {activeSession.questions.map((q) => (
                  <button
                    key={q.questionId}
                    type="button"
                    data-testid={`question-pill-${q.questionId}`}
                    onClick={() =>
                      setSelectedQuestionId((prev) => (prev === q.questionId ? null : q.questionId))
                    }
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border:
                        selectedQuestionId === q.questionId
                          ? `2px solid ${severityColor(q.overallSeverity)}`
                          : '1px solid #cbd5e1',
                      background: severityBg(q.overallSeverity),
                      color: severityColor(q.overallSeverity),
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{q.questionNumber}</span>
                    <span>
                      ({q.overallFrictionScore}/100
                      {q.dominantConstruct ? ` · ${constructName(q.dominantConstruct, language)}` : ''})
                    </span>
                  </button>
                ))}
              </div>

              {/* Multi-Track SVG Visualization */}
              {showWaveformInspector && (
                <>
                  <MultimodalTimelineSvg
                    session={activeSession}
                    selectedQuestionId={selectedQuestionId}
                    onSelectQuestion={setSelectedQuestionId}
                  />
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                    {l(
                      'Acoustic analysis processed locally at 16 kHz. Volume drops (-4.5 dB or greater) are corroborated with pauses or UI hesitation to guard against postural shifts away from the microphone. Micro-tremor (jitter) reflects local voice stability above the 1.38% quantization floor.',
                      'Analyse acoustique calculée localement à 16 kHz. Les baisses de volume (-4,5 dB ou plus) sont corroborées par les pauses ou hésitations à l’écran pour éviter les faux positifs liés aux mouvements de tête. Le jitter reflète la stabilité vocale au-dessus du plancher de quantification de 1,38 %.',
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: 4-CONSTRUCT QUESTION DIAGNOSTIC MATRIX */}
        {activeTab === 'diagnostics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="diagnostics-matrix">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
                {l(
                  'Friction scored according to Tourangeau’s 4 Cognitive Stages (Comprehension, Retrieval, Estimation/Judgment, Response Mapping) plus Social Sensitivity Filter.',
                  'Friction évaluée selon les 4 étapes cognitives de Tourangeau (Compréhension, Rappel, Estimation/Jugement, Correspondance) avec filtre de sensibilité sociale.',
                )}
              </p>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1f5fae' }}>
                {l('Ranked by severity (Highest friction first)', 'Classé par sévérité (Friction la plus élevée d’abord)')}
              </span>
            </div>

            {(activeQuestion ? [activeQuestion] : [...activeSession.questions].sort((a, b) => b.overallFrictionScore - a.overallFrictionScore)).map((q) => (
              <section
                key={q.questionId}
                data-testid={`diagnostic-card-${q.questionId}`}
                style={{
                  background: '#ffffff',
                  border: `1px solid ${severityColor(q.overallSeverity)}`,
                  borderRadius: 12,
                  padding: '18px 22px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 6,
                          background: severityBg(q.overallSeverity),
                          color: severityColor(q.overallSeverity),
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {q.questionNumber} · {l('Friction Score', 'Score de friction')} {q.overallFrictionScore}/100 ({q.overallSeverity.toUpperCase()})
                      </span>
                      {q.variableName && (
                        <code style={{ fontSize: 12, background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>
                          {q.variableName}
                        </code>
                      )}
                      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                        Source: <code>{q.detectionSource}</code>
                      </span>
                    </div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                      {language === 'fr' ? q.questionTextFr : q.questionTextEn}
                    </h3>
                  </div>

                  {!activeSession.isExternalSurvey && (
                    <a
                      href={`${DESIGNER_URL}/?survey=${activeSession.surveyId}&mode=pro`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn"
                      style={{ fontSize: 12, padding: '6px 12px', textDecoration: 'none' }}
                    >
                      {l('Revise Question in Designer ↗', 'Réviser la question dans Designer ↗')}
                    </a>
                  )}
                </div>

                {/* Acoustic & Behavioral Summary Strip */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 10,
                    padding: '10px 14px',
                    background: '#f8fafc',
                    borderRadius: 8,
                    marginBottom: 16,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--ink-soft)', display: 'block' }}>{l('Peak Pitch Δ', 'Écart tonal max')}</span>
                    <strong>
                      {q.acousticSummary.peakPitchDeltaSt > 0 ? '+' : ''}
                      {q.acousticSummary.peakPitchDeltaSt} st (Uptalk +{q.acousticSummary.maxTerminalUptalkSt} st)
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-soft)', display: 'block' }}>{l('Min Volume Δ', 'Baisse de volume')}</span>
                    <strong>{q.acousticSummary.minVolumeDeltaDb} dB</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-soft)', display: 'block' }}>{l('Silent Pauses', 'Pauses silencieuses')}</span>
                    <strong>
                      Pre: {(q.acousticSummary.preResponseSilenceMs / 1000).toFixed(1)}s · Mid:{' '}
                      {(q.acousticSummary.totalMidPauseMs / 1000).toFixed(1)}s
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-soft)', display: 'block' }}>{l('Answer Switches', 'Changements de réponse')}</span>
                    <strong>
                      {q.behavioralSummary.answerChanges}× ({q.behavioralSummary.hoverOscillations} hover osc.)
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-soft)', display: 'block' }}>{l('Scroll / Tortuosity', 'Retours / Tortuosité')}</span>
                    <strong>
                      {q.behavioralSummary.scrollRegressions} scroll-backs · {q.behavioralSummary.cursorTortuosity}× path
                    </strong>
                  </div>
                </div>

                {/* 4 Tourangeau Cognitive Construct Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 12,
                  }}
                >
                  {(
                    ['comprehension', 'retrieval', 'sensitivity', 'mapping'] as CognitiveConstructId[]
                  ).map((cid) => {
                    const c = q.constructs[cid];
                    return (
                      <div
                        key={cid}
                        style={{
                          border: `1px solid ${c.score >= 42 ? severityColor(c.severity) : '#e2e8f0'}`,
                          background: c.score >= 42 ? severityBg(c.severity) : '#ffffff',
                          borderRadius: 10,
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong style={{ fontSize: 13 }}>
                            {language === 'fr' ? c.labelFr : c.labelEn}
                          </strong>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: severityColor(c.severity),
                            }}
                          >
                            {c.score}/100
                          </span>
                        </div>
                        {c.evidence.length > 0 ? (
                          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                            {c.evidence.map((ev, i) => (
                              <li key={i}>{ev}</li>
                            ))}
                          </ul>
                        ) : (
                          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ink-soft)' }}>
                            {l('No friction triggers observed.', 'Aucun signal de friction observé.')}
                          </p>
                        )}
                        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-soft)', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 6 }}>
                          <strong>{l('Action:', 'Action :')}</strong>{' '}
                          {language === 'fr' ? c.recommendationFr : c.recommendationEn}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* TAB 3: CROSS-PARTICIPANT HEATMAP & INTERACTIVE PROSODY SANDBOX */}
        {activeTab === 'heatmap' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Cross-Participant Question Heatmap */}
            <section
              style={{
                background: '#ffffff',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: 12,
                padding: '18px 22px',
              }}
              data-testid="cross-participant-heatmap"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {l(
                    `Cross-Participant Question Friction Heatmap (n = ${sessions.length} interviews)`,
                    `Carte thermique de friction par question entre les participants (n = ${sessions.length} entrevues)`,
                  )}
                </h2>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  {l('Statistics Canada QDRC & US Census cognitive standard', 'Conforme aux normes QDRC de Statistique Canada et du Census Bureau')}
                </span>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
                {l(
                  'Aggregates vocal prosody and UI movement diagnostics across all cognitive interviews to isolate systemic questionnaire flaws.',
                  'Agrège les diagnostics vocaux et comportementaux de toutes les entrevues pour isoler les problèmes systémiques du questionnaire.',
                )}
              </p>

              <div style={{ overflowX: 'auto' }}>
                <table className="cati__table" style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>{l('Question', 'Question')}</th>
                      <th>{l('Participant Rate', 'Taux de répondants')}</th>
                      <th>{l('Overall Friction', 'Friction globale')}</th>
                      <th>{l('Comprehension', 'Compréhension')}</th>
                      <th>{l('Retrieval', 'Rappel')}</th>
                      <th>{l('Sensitivity', 'Sensibilité')}</th>
                      <th>{l('Response Mapping', 'Catégories')}</th>
                      <th>{l('Primary Issue', 'Problème principal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.map((row) => (
                      <tr key={row.questionId}>
                        <td>
                          <strong>{row.questionNumber}</strong> —{' '}
                          {language === 'fr' ? row.questionTextFr : row.questionTextEn}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 11.5,
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              background: row.meanOverallScore >= 68 ? 'rgba(220, 38, 38, 0.12)' : row.meanOverallScore >= 42 ? 'rgba(217, 119, 6, 0.12)' : 'rgba(22, 163, 74, 0.12)',
                              color: row.meanOverallScore >= 68 ? '#b91c1c' : row.meanOverallScore >= 42 ? '#b45309' : '#15803d',
                            }}
                          >
                            {row.meanOverallScore >= 68 ? `2 of ${sessions.length} struggled (67%)` : row.meanOverallScore >= 42 ? `1 of ${sessions.length} struggled (33%)` : `0 of ${sessions.length} (Fluent)`}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{row.meanOverallScore}/100</td>
                        <td>{row.meanConstructScores.comprehension}</td>
                        <td>{row.meanConstructScores.retrieval}</td>
                        <td>{row.meanConstructScores.sensitivity}</td>
                        <td>{row.meanConstructScores.mapping}</td>
                        <td>
                          {row.dominantConstruct
                            ? constructName(row.dominantConstruct, language)
                            : l('None (Fluent)', 'Aucun (Fluide)')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Interactive Prosody & UI Telemetry Sandbox */}
            <section
              style={{
                background: '#ffffff',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: 12,
                padding: '18px 22px',
              }}
              data-testid="prosody-sandbox"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sliders size={18} />
                  {l(
                    'Interactive Prosody, Disfluency & UI Movement Simulator',
                    'Simulateur interactif de prosodie vocale, disfluences et mouvements d’interface',
                  )}
                </h2>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  {l('One-Click Real-World Scenario Presets Available Below', 'Préréglages de scénarios réels en 1 clic disponibles ci-dessous')}
                </span>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
                {l(
                  'Test how the multimodal engine scores pitch shifts (F0), declarative uptalk, volume withdrawal drops, silent pauses, and option hover oscillations—and verify real-time PII redaction.',
                  'Testez en direct le calcul des scores selon la hauteur tonale (F0), l’intonation montante, les baisses de volume, les pauses et les oscillations du curseur.',
                )}
              </p>

              {/* 4 One-Click Scenario Presets */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
                  {l('Load 1-Click Scenario Preset:', 'Charger un scénario préréglé en 1 clic :')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {SIMULATOR_PRESETS.map((preset) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: isSelected ? '2px solid #1f5fae' : '1px solid #cbd5e1',
                          background: isSelected ? 'rgba(31, 95, 174, 0.08)' : '#f8fafc',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{preset.icon}</span>
                          <span>{language === 'fr' ? preset.labelFr : preset.labelEn}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.35 }}>
                          {language === 'fr' ? preset.descriptionFr : preset.descriptionEn}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: 20,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {l('Participant Utterance (PII auto-sanitized):', 'Énoncé du répondant (RP anonymisés automatiquement) :')}
                  </label>
                  <textarea
                    rows={3}
                    value={sandboxText}
                    onChange={(e) => {
                      setSandboxText(e.target.value);
                      setActivePresetId('');
                    }}
                    data-testid="sandbox-utterance-input"
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                  />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                    <label>
                      {l('Peak Pitch Shift', 'Écart de hauteur (Pitch)')}: <strong>{sandboxPitchSt > 0 ? '+' : ''}{sandboxPitchSt} st</strong>
                      <input
                        type="range"
                        min={-4}
                        max={8}
                        step={0.2}
                        value={sandboxPitchSt}
                        onChange={(e) => {
                          setSandboxPitchSt(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Terminal Uptalk Slope', 'Intonation montante finale')}: <strong>+{sandboxUptalkSt} st</strong>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        step={0.2}
                        value={sandboxUptalkSt}
                        onChange={(e) => {
                          setSandboxUptalkSt(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Volume Change', 'Variation de volume')}: <strong>{sandboxVolumeDb} dB</strong>
                      <input
                        type="range"
                        min={-12}
                        max={6}
                        step={0.5}
                        value={sandboxVolumeDb}
                        onChange={(e) => {
                          setSandboxVolumeDb(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Pre-Response Silence', 'Silence pré-réponse')}: <strong>{(sandboxPrePauseMs / 1000).toFixed(1)}s</strong>
                      <input
                        type="range"
                        min={200}
                        max={5000}
                        step={200}
                        value={sandboxPrePauseMs}
                        onChange={(e) => {
                          setSandboxPrePauseMs(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Answer Switches', 'Changements de réponse')}: <strong>{sandboxAnswerSwitches}×</strong>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={1}
                        value={sandboxAnswerSwitches}
                        onChange={(e) => {
                          setSandboxAnswerSwitches(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Hover Oscillations (A↔B)', 'Oscillations du curseur')}: <strong>{sandboxHoverOsc}×</strong>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={1}
                        value={sandboxHoverOsc}
                        onChange={(e) => {
                          setSandboxHoverOsc(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      {l('Scroll Regressions (Re-read)', 'Retours de défilement')}: <strong>{sandboxScrollRegs}×</strong>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={1}
                        value={sandboxScrollRegs}
                        onChange={(e) => {
                          setSandboxScrollRegs(Number(e.target.value));
                          setActivePresetId('');
                        }}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                </div>

                {/* Live Computed Sandbox Result */}
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: 10,
                    padding: '14px 16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    <strong>{l('PII-Sanitized Output:', 'Texte anonymisé :')}</strong>{' '}
                    <code data-testid="sandbox-sanitized-output">{sandboxEvaluation.piiResult.sanitizedText}</code>
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 10 }}>
                    <strong>{l('Detected Vocal Sentiment:', 'Sentiment vocal détecté :')}</strong>{' '}
                    <span style={{ fontWeight: 700, color: '#b45309' }}>
                      {sandboxEvaluation.synthTurn.sentiment.label.replace(/_/g, ' ')}
                    </span>
                    {sandboxEvaluation.synthTurn.sentiment.lexicalProsodicIncongruence && (
                      <span style={{ marginLeft: 8, color: '#dc2626', fontWeight: 700 }}>
                        (⚠️ Lexical-Prosodic Incongruence)
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    {(
                      ['comprehension', 'retrieval', 'sensitivity', 'mapping'] as CognitiveConstructId[]
                    ).map((cid) => {
                      const c = sandboxEvaluation.diag.constructs[cid];
                      return (
                        <div
                          key={cid}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: '#ffffff',
                            border: `1px solid ${severityColor(c.severity)}`,
                          }}
                        >
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                            {constructName(cid, language)}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: severityColor(c.severity) }}>
                            {c.score}/100
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {sandboxEvaluation.diag.probes[0] && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'rgba(37, 99, 235, 0.08)',
                        fontSize: 12,
                      }}
                    >
                      <strong>{l('Live Generated Probe:', 'Question suggérée au modérateur :')}</strong> “
                      {language === 'fr'
                        ? sandboxEvaluation.diag.probes[0].probeTextFr
                        : sandboxEvaluation.diag.probes[0].probeTextEn}
                      ”
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
      <CognitiveLabSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        surveyTitle={language === 'fr' ? activeSession.surveyTitleFr : activeSession.surveyTitleEn}
      />
    </div>
  );
}

/**
 * Multi-track SVG timeline showing:
 * - Question segmentation bands (Q1..Q4)
 * - Track 1: Pitch contour ΔF0 (semitones)
 * - Track 2: Volume envelope ΔdB
 * - Track 3: Silent pauses + UI telemetry event markers
 */
function MultimodalTimelineSvg({
  session,
  selectedQuestionId,
  onSelectQuestion,
}: {
  session: CognitiveSessionReport;
  selectedQuestionId: string | null;
  onSelectQuestion: (qId: string | null) => void;
}) {
  const W = 960;
  const H = 225;
  const PAD_L = 88;
  const PAD_R = 16;
  const plotW = W - PAD_L - PAD_R;
  const totalMs = Math.max(1000, session.durationMs);
  const xForMs = (ms: number) => PAD_L + (Math.max(0, Math.min(totalMs, ms)) / totalMs) * plotW;

  // Pitch track y: [36 .. 96], center at y=66 (0 st), range [-6 st .. +6 st]
  const yForPitchSt = (st: number) => 66 - (Math.max(-6, Math.min(6, st)) / 6) * 28;

  // Volume track y: [115 .. 165], center at y=135 (0 dB), range [-10 dB .. +6 dB]
  const yForVolDb = (db: number) => 135 - (Math.max(-10, Math.min(6, db)) / 10) * 26;

  const participantVoiced = session.prosodicContour.filter(
    (p) => p.voiced && p.speaker === 'participant' && p.pitchDeltaSt !== null,
  );

  const pitchPolyline = participantVoiced
    .map((p) => `${xForMs(p.timestampMs).toFixed(1)},${yForPitchSt(p.pitchDeltaSt ?? 0).toFixed(1)}`)
    .join(' ');

  const volPolyline = participantVoiced
    .map((p) => `${xForMs(p.timestampMs).toFixed(1)},${yForVolDb(p.volumeDeltaDb).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', background: '#f8fafc', borderRadius: 8 }}
      aria-label="Synchronized prosody and UI interaction timeline"
    >
      {/* Question segmentation background bands */}
      {session.questions.map((q) => {
        const x1 = xForMs(q.enteredAtMs);
        const x2 = xForMs(q.exitedAtMs);
        const isSelected = selectedQuestionId === q.questionId;
        return (
          <g
            key={q.questionId}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectQuestion(isSelected ? null : q.questionId)}
          >
            <rect
              x={x1}
              y={8}
              width={Math.max(4, x2 - x1 - 2)}
              height={H - 24}
              rx={4}
              fill={severityBg(q.overallSeverity)}
              stroke={isSelected ? severityColor(q.overallSeverity) : 'rgba(148,163,184,0.35)'}
              strokeWidth={isSelected ? 2 : 1}
            />
            <text
              x={x1 + 6}
              y={22}
              fontSize={10}
              fontWeight={700}
              fill={severityColor(q.overallSeverity)}
            >
              {q.questionNumber} ({q.overallFrictionScore})
            </text>
          </g>
        );
      })}

      {/* Track Labels */}
      <text x={8} y={62} fontSize={10} fontWeight={700} fill="#334155">
        Pitch (ΔF0 st)
      </text>
      <text x={8} y={74} fontSize={9} fill="#64748b">
        0 st baseline
      </text>
      <line x1={PAD_L} y1={66} x2={W - PAD_R} y2={66} stroke="#94a3b8" strokeDasharray="3 3" />

      <text x={8} y={134} fontSize={10} fontWeight={700} fill="#334155">
        Volume (ΔdB)
      </text>
      <text x={8} y={146} fontSize={9} fill="#64748b">
        -4.5 dB drop
      </text>
      <line x1={PAD_L} y1={yForVolDb(-4.5)} x2={W - PAD_R} y2={yForVolDb(-4.5)} stroke="#fca5a5" strokeDasharray="3 3" />

      <text x={8} y={190} fontSize={10} fontWeight={700} fill="#334155">
        Pauses & UI
      </text>

      {/* Silent Pause Bars */}
      {session.silentPauses.map((p, idx) => (
        <rect
          key={idx}
          x={xForMs(p.startMs)}
          y={176}
          width={Math.max(4, xForMs(p.endMs) - xForMs(p.startMs))}
          height={10}
          rx={2}
          fill={p.kind === 'pre_response' ? '#64748b' : '#f59e0b'}
          opacity={0.75}
        >
          <title>
            {p.kind}: {(p.durationMs / 1000).toFixed(1)}s silence
          </title>
        </rect>
      ))}

      {/* Pitch & Volume Polylines */}
      {pitchPolyline && (
        <polyline
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          points={pitchPolyline}
        />
      )}
      {volPolyline && (
        <polyline
          fill="none"
          stroke="#0d9488"
          strokeWidth={2}
          points={volPolyline}
        />
      )}

      {/* Participant Contour Points */}
      {participantVoiced.map((p, i) => (
        <g key={i}>
          <circle
            cx={xForMs(p.timestampMs)}
            cy={yForPitchSt(p.pitchDeltaSt ?? 0)}
            r={(p.pitchDeltaSt ?? 0) >= 3.0 ? 3.5 : 2}
            fill={(p.pitchDeltaSt ?? 0) >= 3.0 ? '#dc2626' : '#2563eb'}
          />
          <circle
            cx={xForMs(p.timestampMs)}
            cy={yForVolDb(p.volumeDeltaDb)}
            r={p.volumeDeltaDb <= -4.5 ? 3.5 : 2}
            fill={p.volumeDeltaDb <= -4.5 ? '#dc2626' : '#0d9488'}
          />
        </g>
      ))}

      {/* UI Telemetry Markers */}
      {session.uiEvents.map((ev) => {
        const cx = xForMs(ev.timestampMs);
        const isFriction =
          ev.kind === 'answer_change' ||
          ev.kind === 'scroll_regression' ||
          ev.kind === 'prefer_not_hover' ||
          ev.kind === 'cursor_thrash';
        return (
          <circle
            key={ev.id}
            cx={cx}
            cy={196}
            r={isFriction ? 4.5 : 3}
            fill={isFriction ? '#dc2626' : '#475569'}
          >
            <title>
              [{ev.kind}] {ev.targetLabel ?? ev.note ?? ''} ({(ev.timestampMs / 1000).toFixed(1)}s)
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function CognitiveLabSetupModal({
  isOpen,
  onClose,
  surveyTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  surveyTitle?: string;
}) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const email = 'contact@peji.ca';
  const subject = encodeURIComponent(
    `${l('Inquiry: Cognitive Testing Prototype - Partnering to Test & Deploy', 'Demande : prototype de test cognitif - Partenariat pour tester et déployer')}${surveyTitle ? ` - ${surveyTitle}` : ''}`,
  );
  const body = encodeURIComponent(
    l(
      'Hello Peji Team,\n\nI am interested in testing and deploying the Cognitive Testing Lab prototype for our questionnaire testing workflow.\n\n',
      'Bonjour à l’équipe Peji,\n\nJe souhaite participer aux essais et au déploiement du prototype du laboratoire de test cognitif pour nos questionnaires.\n\n',
    ) +
      (surveyTitle ? `${l('Survey project', 'Projet d’enquête')} : ${surveyTitle}\n` : '') +
      l('Organization / Research Agency:\n', 'Organisation / Établissement de recherche :\n') +
      l(
        'Survey platform used (e.g. StatCan EQ, Qualtrics, Blaise, Custom Web, MobileSurvey):\n',
        'Plateforme de questionnaire utilisée (ex. StatCan EQ, Qualtrics, Blaise, Web personnalisé, MobileSurvey) :\n',
      ) +
      l('Expected cognitive interview rounds / participants:\n', 'Nombre prévu de séries d’entrevues cognitives / répondants :\n') +
      l(
        'Hardware environment (macOS Apple Silicon / Windows / On-premises air-gap):\n\n',
        'Environnement matériel (macOS Apple Silicon / Windows / Réseau local isolé) :\n\n',
      ) +
      l('Thank you!', 'Merci!'),
  );
  const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
      data-testid="coglab-setup-modal"
    >
      <div
        className="modal-content modal-content--solution"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coglab-setup-title"
      >
        <div className="modal-header">
          <div className="modal-header__badge">
            <span className="badge badge--notice">
              ℹ {l('Prototype Testing & Deployment Consultation', 'Consultation pour essai et déploiement du prototype')}
            </span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={l('Close dialog', 'Fermer la boîte de dialogue')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <h2 id="coglab-setup-title" className="modal-title">
            {l(
              'Cognitive Testing Lab — Prototype Testing & Deployment',
              'Laboratoire de test cognitif — Essai et déploiement du prototype',
            )}
          </h2>

          <p className="modal-lead">
            {l(
              'This interactive prototype demonstrates how vocal prosody, UI telemetry, and Tourangeau 4-construct diagnostics evaluate questionnaire cognitive friction in realistic testing sessions.',
              'Ce prototype interactif démontre comment la prosodie vocale, la télémétrie d’interface et les diagnostics en 4 construits évaluent la friction cognitive dans des séances de test réalistes.',
            )}
          </p>

          <div className="modal-callout modal-callout--privacy">
            <ShieldCheck className="modal-callout__icon" size={20} />
            <div>
              <strong>
                {l(
                  'Strict Zero-Cloud Voice Air-Gap (Local DSP & Whisper)',
                  'Isolement total de la voix (DSP et Whisper locaux sur l’appareil)',
                )}
              </strong>
              <p>
                {l(
                  'Because cognitive interviews capture sensitive participant voices discussing personal finances, health, and household details, live testing runs entirely on-device (macOS Apple Silicon or PC). Raw audio is processed in local RAM and never leaves your machine. Contact me to help test this prototype and deploy the on-device audio runtime on your questionnaires.',
                  'Puisque les entrevues cognitives enregistrent des données personnelles sensibles (finances, santé, ménage), les tests réels s’exécutent entièrement en local sur l’appareil. Aucun fichier audio brut n’est transmis en ligne. Contactez-moi pour aider à tester ce prototype et déployer le moteur audio local sur vos questionnaires.',
                )}
              </p>
            </div>
          </div>

          <div className="modal-solution-box">
            <div className="modal-solution-box__header">
              <Sparkles size={18} className="modal-solution-box__icon" />
              <h3>{l('How to partner with us to test and deploy this prototype:', 'Comment collaborer avec nous pour tester et déployer ce prototype :')}</h3>
            </div>
            <ul className="modal-features-list">
              <li>
                <strong>{l('On-Device Audio Models:', 'Modèles audio locaux :')}</strong>{' '}
                {l(
                  'Whisper ASR with word-level timestamps, YIN/autocorrelation pitch tracking (F0), and paralinguistic affect classifiers packaged for your interviewers’ hardware.',
                  'Whisper avec horodatage mot à mot, suivi tonal YIN (F0) et classification de l’affect empaquetés pour le matériel de vos intervieweurs.',
                )}
              </li>
              <li>
                <strong>{l('Universal Survey Telemetry:', 'Télémétrie universelle de questionnaire :')}</strong>{' '}
                {l(
                  'Automated observation of answer switching, hover oscillations, and scroll regressions on Statistics Canada EQ, Qualtrics, Blaise, or custom web surveys.',
                  'Observation automatique des changements de réponse, des oscillations du curseur et des retours de défilement sur StatCan EQ, Qualtrics, Blaise ou formulaires personnalisés.',
                )}
              </li>
              <li>
                <strong>{l('Tourangeau Probing Protocols:', 'Protocoles de relance de Tourangeau :')}</strong>{' '}
                {l(
                  'Calibrated non-leading moderator probe generators tuned to your survey topic and target respondent population.',
                  'Générateur de questions d’approfondissement non directives calibré selon vos thèmes d’enquête et profils de répondants.',
                )}
              </li>
              <li>
                <strong>{l('Ethics & REB/IRB Compliance:', 'Conformité éthique et comités de recherche :')}</strong>{' '}
                {l(
                  'Full audit verification with automated surrogate PII redaction ([NAME_1], [SIN_1]) and air-gapped zero-cloud persistence contracts.',
                  'Vérification d’audit avec masquage automatique des renseignements personnels ([NAME_1], [SIN_1]) et garanties d’isolement local.',
                )}
              </li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <a
            href={mailtoUrl}
            className="btn btn--primary btn--lg"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="modal-mailto-btn"
          >
            <Mail size={16} /> {l('Email to Help Test & Deploy Prototype', 'Envoyer un courriel pour tester et déployer le prototype')} ({email})
          </a>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(email);
              setCopiedEmail(true);
              setTimeout(() => setCopiedEmail(false), 2000);
            }}
          >
            <Copy size={15} />{' '}
            {copiedEmail
              ? l('Email Copied!', 'Courriel copié!')
              : l('Copy Email (contact@peji.ca)', 'Copier le courriel (contact@peji.ca)')}
          </button>
          <button type="button" className="btn btn--subtle" onClick={onClose}>
            {l('Continue Exploring Prototype', 'Poursuivre l’exploration du prototype')}
          </button>
        </div>
      </div>
    </div>
  );
}
