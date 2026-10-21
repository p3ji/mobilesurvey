/**
 * @mobilesurvey/cognitive-lab — Core contracts for multimodal cognitive interviewing
 * and questionnaire usability testing (acoustic prosody, transcript disfluencies,
 * UI movement telemetry, Tourangeau 4-construct diagnostics, and PII-sanitized reports).
 */

export type SpeakerRole = 'moderator' | 'participant';

export type CognitiveConstructId =
  | 'comprehension'
  | 'retrieval'
  | 'sensitivity'
  | 'mapping';

export type SeverityLevel = 'none' | 'low' | 'moderate' | 'high';

export type VocalSentimentLabel =
  | 'neutral_steady'
  | 'uncertain_hesitant'
  | 'cognitively_strained'
  | 'uncomfortable_withdrawn'
  | 'frustrated_tense'
  | 'confident_fluent';

/**
 * Per-speaker acoustic baseline calibrated from the participant's early neutral turns
 * (or rolling median across voiced frames).
 */
export interface SpeakerBaseline {
  /** Baseline fundamental frequency (F0) in Hz (e.g., 125 Hz or 205 Hz). */
  f0Hz: number;
  /** Baseline short-term RMS volume in dBFS (e.g., -18.5 dBFS). */
  rmsDbfs: number;
  /** Baseline speech rate in words per minute (e.g., 145 WPM). */
  wordsPerMinute: number;
}

/**
 * Downsampled prosodic contour point (typically 100ms–250ms resolution)
 * for synchronized multi-track visualization and acoustic analysis.
 */
export interface ProsodicContourPoint {
  /** Offset in milliseconds from session start. */
  timestampMs: number;
  /** Active speaker if voiced, or null during silence. */
  speaker: SpeakerRole | null;
  /** Whether voice activity detection (VAD) classified this frame as voiced speech. */
  voiced: boolean;
  /** Fundamental frequency (F0) in Hz when voiced (null if unvoiced/silent). */
  f0Hz: number | null;
  /** Speaker-normalized pitch shift in semitones relative to baseline F0. */
  pitchDeltaSt: number | null;
  /** Short-term volume in dBFS (-60 to 0). */
  volumeDbfs: number;
  /** Speaker-normalized volume change in dB relative to baseline RMS. */
  volumeDeltaDb: number;
  /** Cycle-to-cycle pitch period perturbation (jitter %) when voiced. */
  jitterPct: number;
}

/**
 * Silent pause interval detected between or within speech turns.
 */
export interface SilentPauseEvent {
  startMs: number;
  endMs: number;
  durationMs: number;
  /**
   * 'pre_response': silence between question load / moderator prompt end and participant speech onset.
   * 'mid_utterance': intra-turn hesitation pause while the participant is formulating an answer.
   */
  kind: 'pre_response' | 'mid_utterance';
  questionId: string;
}

/**
 * Word-level token from local Whisper/Parakeet ASR with exact timing and disfluency tags.
 */
export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFilledPause?: boolean;
  isHedge?: boolean;
}

/**
 * Diarized utterance turn with synchronized prosodic summary and paralinguistic sentiment.
 */
export interface TranscriptTurn {
  id: string;
  speaker: SpeakerRole;
  questionId: string;
  startMs: number;
  endMs: number;
  /** Raw or PII-sanitized text of the utterance. */
  text: string;
  words?: TranscriptWord[];
  /** Prosodic and paralinguistic metrics computed over this turn. */
  prosody: {
    meanF0Hz: number | null;
    meanPitchDeltaSt: number;
    peakPitchDeltaSt: number;
    /** Terminal pitch slope in semitones over final 350ms (> +2.5 st indicates uptalk / question intonation). */
    terminalPitchSlopeSt: number;
    meanVolumeDbfs: number;
    meanVolumeDeltaDb: number;
    minVolumeDeltaDb: number;
    meanJitterPct: number;
    speechRateWpm: number;
    speechRateRatio: number;
    preResponseSilenceMs: number;
    midUtterancePauseCount: number;
    longestMidPauseMs: number;
    filledPauseCount: number;
    filledPauses: string[];
    hedgeCount: number;
    hedges: string[];
    clarificationMarkers: string[];
  };
  /** Acoustic + lexical sentiment classification. */
  sentiment: {
    label: VocalSentimentLabel;
    /** Acoustic arousal (-1 calm/withdrawn to +1 tense/activated). */
    arousal: number;
    /** Acoustic valence (-1 negative/strained to +1 positive/fluent). */
    valence: number;
    /** Confidence in classification (0–1). */
    confidence: number;
    /**
     * True when words express certainty/compliance ("Sure", "Yes", "Fine")
     * while prosody exhibits high pitch shift, volume drop, or long pre-response pause.
     */
    lexicalProsodicIncongruence: boolean;
    incongruenceReason?: string;
  };
}

/**
 * Granular UI interaction telemetry event captured from the questionnaire DOM
 * (native @mobilesurvey or external web questionnaire via Playwright/CDP).
 */
export type UiTelemetryEventKind =
  | 'question_enter'
  | 'option_hover'
  | 'answer_select'
  | 'answer_change'
  | 'scroll_regression'
  | 'cursor_thrash'
  | 'prefer_not_hover'
  | 'focus_blur'
  | 'next_click'
  | 'prev_backtrack'
  | 'moderator_bookmark';

export interface UiTelemetryEvent {
  id: string;
  timestampMs: number;
  questionId: string;
  kind: UiTelemetryEventKind;
  /** Option code, input selector, or target label involved in the interaction. */
  targetLabel?: string;
  previousValue?: string;
  newValue?: string;
  /** Cursor tortuosity ratio (actual path length / straight-line distance) when applicable. */
  cursorTortuosity?: number;
  /** Hover dwell duration in ms when applicable. */
  dwellMs?: number;
  /** Scroll delta in pixels (negative = scrolling back up to re-read stem). */
  scrollDeltaY?: number;
  note?: string;
}

/**
 * Aggregated behavioral interaction metrics for a single survey question window.
 */
export interface QuestionBehavioralSummary {
  questionId: string;
  enteredAtMs: number;
  exitedAtMs: number;
  totalDwellMs: number;
  timeToFirstInteractionMs: number;
  postSelectDelayMs: number;
  /** Number of times respondent changed an already-selected answer on this question. */
  answerChanges: number;
  answerSequence: string[];
  /** Count of A <-> B <-> A alternating option hover oscillations. */
  hoverOscillations: number;
  oscillatingOptions: string[];
  /** Ratio of total cursor travel to minimum Euclidean path (1.0 = straight line, >3.5 = thrashing). */
  cursorTortuosity: number;
  /** Count of upward scroll reversals back to the question stem/instructions. */
  scrollRegressions: number;
  /** Whether the participant hovered over "Prefer not to answer" / "Skip" / "Refuse". */
  hoveredPreferNotToAnswer: boolean;
  /** Number of times the respondent clicked Previous to backtrack from or into this question. */
  backtrackCount: number;
}

/**
 * Score and evidence trail for one of the 4 Tourangeau cognitive constructs on a question.
 */
export interface ConstructDiagnostic {
  construct: CognitiveConstructId;
  labelEn: string;
  labelFr: string;
  /** Normalized 0–100 friction score. */
  score: number;
  severity: SeverityLevel;
  /** Explicit acoustic, lexical, and behavioral evidence items that triggered this score. */
  evidence: string[];
  /** Actionable questionnaire design recommendation (EN/FR). */
  recommendationEn: string;
  recommendationFr: string;
}

/**
 * Context-aware, non-leading cognitive interviewing probe suggested to the moderator.
 */
export interface ModeratorProbeSuggestion {
  id: string;
  timestampMs: number;
  questionId: string;
  questionLabel: string;
  construct: CognitiveConstructId;
  severity: SeverityLevel;
  triggerSummaryEn: string;
  triggerSummaryFr: string;
  probeTextEn: string;
  probeTextFr: string;
  asked?: boolean;
}

/**
 * Synchronized multimodal diagnostic record for a single questionnaire item.
 */
export interface QuestionCognitiveDiagnostic {
  questionId: string;
  variableName?: string;
  questionNumber: string;
  questionTextEn: string;
  questionTextFr: string;
  detectionSource: 'mobilesurvey_dom' | 'external_heuristic' | 'moderator_override';
  enteredAtMs: number;
  exitedAtMs: number;
  /** Overall composite cognitive friction score (0–100). */
  overallFrictionScore: number;
  overallSeverity: SeverityLevel;
  dominantConstruct: CognitiveConstructId | null;
  /** All 4 Tourangeau construct scores. */
  constructs: Record<CognitiveConstructId, ConstructDiagnostic>;
  /** Aggregated participant prosody summary for this question. */
  acousticSummary: {
    participantTurnCount: number;
    preResponseSilenceMs: number;
    totalMidPauseMs: number;
    meanPitchDeltaSt: number;
    peakPitchDeltaSt: number;
    maxTerminalUptalkSt: number;
    meanVolumeDeltaDb: number;
    minVolumeDeltaDb: number;
    speechRateRatio: number;
    filledPauseCount: number;
    hedgeCount: number;
    dominantSentiment: VocalSentimentLabel;
    hasLexicalProsodicIncongruence: boolean;
  };
  /** Aggregated UI movement summary for this question. */
  behavioralSummary: QuestionBehavioralSummary;
  /** Suggested moderator probes triggered on this question. */
  probes: ModeratorProbeSuggestion[];
}

/**
 * Complete cognitive testing session state & exportable report.
 * Enforces strict zero-cloud-leakage (`rawAudioIncluded: false`, PII surrogate sanitization).
 */
export interface CognitiveSessionReport {
  sessionId: string;
  surveyId: string;
  surveyTitleEn: string;
  surveyTitleFr: string;
  targetUrl: string;
  isExternalSurvey: boolean;
  createdAtIso: string;
  durationMs: number;
  participantCode: string;
  language: 'en' | 'fr';
  privacy: {
    /** Always false in persisted/exported reports — raw voice stays strictly on 127.0.0.1. */
    rawAudioIncluded: false;
    piiSanitized: boolean;
    redactedEntityCount: number;
    redactedCategories: string[];
  };
  speakerBaseline: SpeakerBaseline;
  prosodicContour: ProsodicContourPoint[];
  silentPauses: SilentPauseEvent[];
  transcript: TranscriptTurn[];
  uiEvents: UiTelemetryEvent[];
  questions: QuestionCognitiveDiagnostic[];
  probes: ModeratorProbeSuggestion[];
}
