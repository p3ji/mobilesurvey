export type {
  SpeakerRole,
  CognitiveConstructId,
  SeverityLevel,
  VocalSentimentLabel,
  SpeakerBaseline,
  ProsodicContourPoint,
  SilentPauseEvent,
  TranscriptWord,
  TranscriptTurn,
  UiTelemetryEventKind,
  UiTelemetryEvent,
  QuestionBehavioralSummary,
  ConstructDiagnostic,
  ModeratorProbeSuggestion,
  QuestionCognitiveDiagnostic,
  CognitiveSessionReport,
} from './types.js';

export {
  hzToSemitonesDelta,
  computeRmsDbfs,
  estimateFramePitchAndJitter,
  calibrateSpeakerBaseline,
  extractProsodicContourFromPcm,
  computeTerminalPitchSlopeSt,
  detectSilentPauses,
} from './prosody.js';

export {
  analyzeLexicalDisfluencies,
  classifyTurnSentiment,
  buildTranscriptTurn,
} from './transcriber.js';

export {
  computeCursorTortuosity,
  detectHoverOscillations,
  summarizeQuestionBehavior,
  resolveActiveQuestionFromDomSnapshot,
  type DomQuestionSnapshot,
} from './telemetry.js';

export {
  scoreToSeverity,
  evaluateQuestionDiagnostics,
  aggregateCrossParticipantHeatmap,
  type CrossParticipantQuestionRow,
} from './diagnostics.js';

export {
  sanitizeTranscriptText,
  sanitizeSessionReport,
  type PiiSanitizationResult,
} from './privacy.js';

export {
  createLfsCognitiveSessionP01,
  createLfsCognitiveSessionP02,
  createExternalEqCognitiveSessionP03,
  BUNDLED_COGNITIVE_SESSIONS,
} from './fixtures.js';
