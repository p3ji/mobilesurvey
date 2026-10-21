/**
 * @mobilesurvey/cognitive-lab — Bilingual Disfluency, Epistemic Hedge, and
 * Paralinguistic Sentiment / Lexical-Prosodic Incongruence Analyzer.
 */

import { computeTerminalPitchSlopeSt, detectSilentPauses } from './prosody.js';
import type {
  ProsodicContourPoint,
  SpeakerBaseline,
  SpeakerRole,
  TranscriptTurn,
  VocalSentimentLabel,
} from './types.js';

const FILLED_PAUSE_REGEX =
  /\b(u+m+|u+h+|e+r+m*|a+h+|h+m+|e+u+h+m*|b+e+n+|b+a+h+|tsé)\b/gi;

const HEDGE_PATTERNS: RegExp[] = [
  /\bi\s+guess\b/gi,
  /\bi\s+think\b/gi,
  /\bi\s+suppose\b/gi,
  /\bmaybe\b/gi,
  /\bprobably\b/gi,
  /\bsort\s+of\b/gi,
  /\bkind\s+of\b/gi,
  /\broughly\b/gi,
  /\baround\b/gi,
  /\bapproximately\b/gi,
  /\bnot\s+(?:really\s+)?sure\b/gi,
  /\bhard\s+to\s+say\b/gi,
  /\bje\s+pense\b/gi,
  /\bj['’]imagine\b/gi,
  /\bpeut-être\b/gi,
  /\benviron\b/gi,
  /\bà\s+peu\s+près\b/gi,
  /\bmettons\b/gi,
  /\bpas\s+(?:vraiment\s+)?(?:sûr|sûre|certain|certaine)\b/gi,
];

const CLARIFICATION_PATTERNS: RegExp[] = [
  /\bwhat\s+does\b[^?.!]*\bmean\b/gi,
  /\bwhat\s+do\s+you\s+mean\b/gi,
  /\bdo\s+you\s+mean\b/gi,
  /\bdoes\s+(?:this|that)\s+include\b/gi,
  /\bi\s+don['’]t\s+understand\b/gi,
  /\bis\s+that\s+before\s+or\s+after\b/gi,
  /\bwhat\s+counts\s+as\b/gi,
  /\bqu['’]est-ce\s+que\b/gi,
  /\bça\s+veut\s+dire\s+quoi\b/gi,
  /\best-ce\s+que\s+ça\s+(?:inclut|comprend)\b/gi,
  /\bje\s+(?:ne\s+)?comprends\s+pas\b/gi,
  /\bavant\s+ou\s+après\s+impôt\b/gi,
];

const COMPLIANT_CERTAINTY_REGEX =
  /^\s*(?:um[,.]?\s*|uh[,.]?\s*|euh[,.]?\s*)?(?:yes|yeah|yep|sure|fine|okay|ok|no\s+problem|that['’]s\s+fine|that['’]s\s+clear|no|none|oui|ouais|d['’]accord|ça\s+va|pas\s+de\s+problème|c['’]est\s+clair|non)[.!?\s]*$/i;

/**
 * Extract bilingual filled pauses, epistemic hedges, and clarification requests
 * from a transcript string.
 */
export function analyzeLexicalDisfluencies(text: string): {
  filledPauses: string[];
  hedges: string[];
  clarificationMarkers: string[];
  wordCount: number;
} {
  const filledPauses: string[] = [];
  for (const match of text.matchAll(FILLED_PAUSE_REGEX)) {
    if (match[0]) filledPauses.push(match[0].toLowerCase());
  }

  const hedges: string[] = [];
  for (const rx of HEDGE_PATTERNS) {
    for (const match of text.matchAll(rx)) {
      if (match[0]) hedges.push(match[0].toLowerCase());
    }
  }

  const clarificationMarkers: string[] = [];
  for (const rx of CLARIFICATION_PATTERNS) {
    for (const match of text.matchAll(rx)) {
      if (match[0]) clarificationMarkers.push(match[0].trim());
    }
  }

  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').length > 0);

  return {
    filledPauses,
    hedges,
    clarificationMarkers,
    wordCount: words.length,
  };
}

/**
 * Classify vocal affect/sentiment and detect lexical-prosodic incongruence
 * from the turn's acoustic metrics and lexical features.
 */
export function classifyTurnSentiment(params: {
  text: string;
  meanPitchDeltaSt: number;
  peakPitchDeltaSt: number;
  terminalPitchSlopeSt: number;
  meanVolumeDeltaDb: number;
  minVolumeDeltaDb: number;
  meanJitterPct: number;
  speechRateRatio: number;
  preResponseSilenceMs: number;
  longestMidPauseMs: number;
  filledPauseCount: number;
  hedgeCount: number;
}): TranscriptTurn['sentiment'] {
  const {
    text,
    meanPitchDeltaSt,
    peakPitchDeltaSt,
    terminalPitchSlopeSt,
    meanVolumeDeltaDb,
    minVolumeDeltaDb,
    meanJitterPct,
    speechRateRatio,
    preResponseSilenceMs,
    longestMidPauseMs,
    filledPauseCount,
    hedgeCount,
  } = params;

  // Compute normalized acoustic arousal (-1 to +1) and valence (-1 to +1)
  const pitchActivation = Math.max(-1, Math.min(1, peakPitchDeltaSt / 6.0));
  const energyActivation = Math.max(-1, Math.min(1, meanVolumeDeltaDb / 8.0));
  const arousal = Number(
    Math.max(-1, Math.min(1, 0.55 * pitchActivation + 0.45 * energyActivation)).toFixed(2),
  );

  const pausePenalty = Math.min(0.6, (preResponseSilenceMs + longestMidPauseMs) / 7000);
  const disfluencyPenalty = Math.min(0.5, (filledPauseCount + hedgeCount) * 0.14);
  const jitterPenalty = Math.min(0.4, meanJitterPct / 5.0);
  const valence = Number(
    Math.max(-1, Math.min(1, 0.65 - pausePenalty - disfluencyPenalty - jitterPenalty)).toFixed(2),
  );

  // Detect lexical-prosodic incongruence:
  // Surface text is short/compliant/affirmative, OR lacks explicit negative words,
  // yet prosody shows major discomfort or uncertainty.
  const isSurfaceCompliant =
    COMPLIANT_CERTAINTY_REGEX.test(text) ||
    (filledPauseCount === 0 && hedgeCount === 0 && text.split(/\s+/).length <= 8);

  let lexicalProsodicIncongruence = false;
  let incongruenceReason: string | undefined;

  if (isSurfaceCompliant) {
    const reasons: string[] = [];
    if (minVolumeDeltaDb <= -4.5) {
      reasons.push(`volume dropped ${minVolumeDeltaDb.toFixed(1)} dB below baseline`);
    }
    if (Math.abs(peakPitchDeltaSt) >= 3.0) {
      reasons.push(
        `pitch shifted ${peakPitchDeltaSt > 0 ? '+' : ''}${peakPitchDeltaSt.toFixed(1)} st`,
      );
    }
    if (terminalPitchSlopeSt >= 2.5) {
      reasons.push(`rising terminal pitch (+${terminalPitchSlopeSt.toFixed(1)} st uptalk)`);
    }
    if (preResponseSilenceMs >= 2200) {
      reasons.push(`${(preResponseSilenceMs / 1000).toFixed(1)}s silent delay before answering`);
    }
    if (reasons.length > 0) {
      lexicalProsodicIncongruence = true;
      incongruenceReason = `Lexical response appears brief/compliant ("${text.trim()}"), but acoustic prosody indicates hidden friction: ${reasons.join(', ')}.`;
    }
  }

  // Determine primary vocal sentiment label
  let label: VocalSentimentLabel = 'neutral_steady';
  if (minVolumeDeltaDb <= -4.5 && (peakPitchDeltaSt >= 2.5 || preResponseSilenceMs >= 1800 || meanJitterPct >= 1.8)) {
    label = 'uncomfortable_withdrawn';
  } else if (meanVolumeDeltaDb >= 4.0 && peakPitchDeltaSt >= 3.0) {
    label = 'frustrated_tense';
  } else if (
    terminalPitchSlopeSt >= 2.5 ||
    filledPauseCount + hedgeCount >= 2 ||
    (peakPitchDeltaSt >= 2.5 && preResponseSilenceMs >= 1500)
  ) {
    label = 'uncertain_hesitant';
  } else if (
    longestMidPauseMs >= 1800 ||
    preResponseSilenceMs >= 2400 ||
    speechRateRatio <= 0.72
  ) {
    label = 'cognitively_strained';
  } else if (
    filledPauseCount === 0 &&
    hedgeCount === 0 &&
    preResponseSilenceMs < 1100 &&
    Math.abs(meanPitchDeltaSt) < 1.8 &&
    speechRateRatio >= 0.9
  ) {
    label = 'confident_fluent';
  }

  return {
    label,
    arousal,
    valence,
    confidence: 0.86,
    lexicalProsodicIncongruence,
    incongruenceReason,
  };
}

/**
 * Build a complete `TranscriptTurn` by fusing a transcript utterance with the
 * underlying `ProsodicContourPoint[]` slice and `SpeakerBaseline`.
 */
export function buildTranscriptTurn(params: {
  id: string;
  speaker: SpeakerRole;
  questionId: string;
  startMs: number;
  endMs: number;
  text: string;
  contour: ProsodicContourPoint[];
  baseline: SpeakerBaseline;
  referencePromptEndMs?: number;
}): TranscriptTurn {
  const {
    id,
    speaker,
    questionId,
    startMs,
    endMs,
    text,
    contour,
    baseline,
    referencePromptEndMs,
  } = params;

  const turnSlice = contour.filter((p) => p.timestampMs >= startMs && p.timestampMs <= endMs);
  const voicedSlice = turnSlice.filter((p) => p.voiced && p.f0Hz !== null);

  const meanF0Hz =
    voicedSlice.length > 0
      ? Number(
          (
            voicedSlice.reduce((s, p) => s + (p.f0Hz ?? 0), 0) / voicedSlice.length
          ).toFixed(1),
        )
      : null;

  const meanPitchDeltaSt =
    voicedSlice.length > 0
      ? Number(
          (
            voicedSlice.reduce((s, p) => s + (p.pitchDeltaSt ?? 0), 0) / voicedSlice.length
          ).toFixed(2),
        )
      : 0;

  let peakPitchDeltaSt = 0;
  for (const p of voicedSlice) {
    const st = p.pitchDeltaSt ?? 0;
    if (Math.abs(st) > Math.abs(peakPitchDeltaSt)) {
      peakPitchDeltaSt = st;
    }
  }

  const terminalPitchSlopeSt =
    speaker === 'participant' ? computeTerminalPitchSlopeSt(turnSlice) : 0;

  const activeDbSlice = voicedSlice.length > 0 ? voicedSlice : turnSlice;
  const meanVolumeDbfs =
    activeDbSlice.length > 0
      ? Number(
          (
            activeDbSlice.reduce((s, p) => s + p.volumeDbfs, 0) / activeDbSlice.length
          ).toFixed(2),
        )
      : baseline.rmsDbfs;

  const meanVolumeDeltaDb =
    activeDbSlice.length > 0
      ? Number(
          (
            activeDbSlice.reduce((s, p) => s + p.volumeDeltaDb, 0) / activeDbSlice.length
          ).toFixed(2),
        )
      : 0;

  const minVolumeDeltaDb =
    activeDbSlice.length > 0
      ? Number(Math.min(...activeDbSlice.map((p) => p.volumeDeltaDb)).toFixed(2))
      : 0;

  const meanJitterPct =
    voicedSlice.length > 0
      ? Number(
          (
            voicedSlice.reduce((s, p) => s + p.jitterPct, 0) / voicedSlice.length
          ).toFixed(2),
        )
      : 0;

  const lexical = analyzeLexicalDisfluencies(text);
  const durationMinutes = Math.max(0.01, (endMs - startMs) / 60000);
  const speechRateWpm = Math.round(lexical.wordCount / durationMinutes);
  const speechRateRatio = Number((speechRateWpm / Math.max(80, baseline.wordsPerMinute)).toFixed(2));

  const preResponseSilenceMs =
    referencePromptEndMs !== undefined && startMs > referencePromptEndMs
      ? startMs - referencePromptEndMs
      : 0;

  const pauses =
    speaker === 'participant'
      ? detectSilentPauses(contour, questionId, referencePromptEndMs ?? startMs, referencePromptEndMs)
          .filter((p) => p.startMs >= (referencePromptEndMs ?? startMs) && p.endMs <= endMs + 200)
      : [];

  const midPauses = pauses.filter((p) => p.kind === 'mid_utterance');
  const longestMidPauseMs =
    midPauses.length > 0 ? Math.max(...midPauses.map((p) => p.durationMs)) : 0;

  const sentiment =
    speaker === 'participant'
      ? classifyTurnSentiment({
          text,
          meanPitchDeltaSt,
          peakPitchDeltaSt,
          terminalPitchSlopeSt,
          meanVolumeDeltaDb,
          minVolumeDeltaDb,
          meanJitterPct,
          speechRateRatio,
          preResponseSilenceMs,
          longestMidPauseMs,
          filledPauseCount: lexical.filledPauses.length,
          hedgeCount: lexical.hedges.length,
        })
      : {
          label: 'neutral_steady' as const,
          arousal: 0,
          valence: 0.2,
          confidence: 0.95,
          lexicalProsodicIncongruence: false,
        };

  return {
    id,
    speaker,
    questionId,
    startMs,
    endMs,
    text,
    prosody: {
      meanF0Hz,
      meanPitchDeltaSt,
      peakPitchDeltaSt,
      terminalPitchSlopeSt,
      meanVolumeDbfs,
      meanVolumeDeltaDb,
      minVolumeDeltaDb,
      meanJitterPct,
      speechRateWpm,
      speechRateRatio,
      preResponseSilenceMs,
      midUtterancePauseCount: midPauses.length,
      longestMidPauseMs,
      filledPauseCount: lexical.filledPauses.length,
      filledPauses: lexical.filledPauses,
      hedgeCount: lexical.hedges.length,
      hedges: lexical.hedges,
      clarificationMarkers: lexical.clarificationMarkers,
    },
    sentiment,
  };
}
