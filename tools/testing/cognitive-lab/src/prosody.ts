/**
 * @mobilesurvey/cognitive-lab — Deterministic Acoustic & Prosodic DSP Engine.
 *
 * Extracts fundamental frequency (F0) via normalized autocorrelation / YIN-style
 * difference function, speaker-normalized semitone pitch shifts, terminal uptalk
 * slope, cycle-to-cycle jitter, RMS energy (dBFS & ΔdB), Voice Activity Detection
 * (VAD), and silent pause intervals (pre-response latency vs. mid-utterance pauses).
 */

import type {
  ProsodicContourPoint,
  SilentPauseEvent,
  SpeakerBaseline,
  SpeakerRole,
} from './types.js';

const EPSILON = 1e-10;
const MIN_F0_HZ = 65;
const MAX_F0_HZ = 450;

/**
 * Convert a frequency ratio (f0 / baselineF0) into semitones.
 * +12 st = 1 octave above baseline; -12 st = 1 octave below baseline.
 */
export function hzToSemitonesDelta(f0Hz: number, baselineF0Hz: number): number {
  if (f0Hz <= 0 || baselineF0Hz <= 0) return 0;
  return Number((12 * Math.log2(f0Hz / baselineF0Hz)).toFixed(2));
}

/**
 * Compute short-term Root-Mean-Square (RMS) amplitude and convert to dBFS (-60 to 0).
 */
export function computeRmsDbfs(samples: Float32Array | number[]): number {
  if (samples.length === 0) return -60;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const dbfs = 20 * Math.log10(Math.max(rms, EPSILON));
  return Number(Math.max(-60, Math.min(0, dbfs)).toFixed(2));
}

/**
 * Estimate Fundamental Frequency (F0 in Hz) and cycle-to-cycle jitter (%) from a
 * single PCM frame using cumulative mean normalized difference (YIN estimator)
 * with parabolic peak interpolation.
 *
 * Returns `{ f0Hz: null, jitterPct: 0, voiced: false }` if the frame is unvoiced
 * or below the energy floor.
 */
export function estimateFramePitchAndJitter(
  samples: Float32Array | number[],
  sampleRate = 16000,
  voicingThreshold = 0.22,
  silenceFloorDbfs = -46,
): { f0Hz: number | null; jitterPct: number; voiced: boolean; volumeDbfs: number } {
  const volumeDbfs = computeRmsDbfs(samples);
  if (volumeDbfs <= silenceFloorDbfs || samples.length < 64) {
    return { f0Hz: null, jitterPct: 0, voiced: false, volumeDbfs };
  }

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));
  const maxLag = Math.min(Math.floor(samples.length / 2), Math.ceil(sampleRate / MIN_F0_HZ));
  if (maxLag <= minLag) {
    return { f0Hz: null, jitterPct: 0, voiced: false, volumeDbfs };
  }

  // Step 1: Difference function d(tau)
  const diff = new Float64Array(maxLag + 1);
  const windowSize = samples.length - maxLag;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const delta = (samples[j] ?? 0) - (samples[j + tau] ?? 0);
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference function d'(tau)
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau]!;
    cmnd[tau] = runningSum > EPSILON ? (diff[tau]! * tau) / runningSum : 1;
  }

  // Step 3: Absolute threshold search in [minLag, maxLag]
  let bestLag = -1;
  let minVal = Infinity;
  for (let tau = minLag; tau <= maxLag; tau++) {
    const val = cmnd[tau]!;
    if (val < voicingThreshold) {
      // Walk to local minimum of this dip
      while (tau + 1 <= maxLag && cmnd[tau + 1]! < cmnd[tau]!) {
        tau++;
      }
      bestLag = tau;
      minVal = cmnd[tau]!;
      break;
    }
    if (val < minVal) {
      minVal = val;
      bestLag = tau;
    }
  }

  // Reject unvoiced frames: require candidate dip to be within the voicing threshold (<= 0.22)
  if (bestLag <= 0 || minVal > voicingThreshold) {
    return { f0Hz: null, jitterPct: 0, voiced: false, volumeDbfs };
  }

  // Step 4: Parabolic interpolation around bestLag to find sub-sample minimum
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y1 = cmnd[bestLag - 1]!;
    const y2 = cmnd[bestLag]!;
    const y3 = cmnd[bestLag + 1]!;
    // denom = 2 * (y1 - 2*y2 + y3); must be positive for concave-up curve (local minimum)
    const denom = 2 * (y1 - 2 * y2 + y3);
    if (denom > EPSILON) {
      const delta = (y1 - y3) / denom;
      const clampedDelta = Math.max(-0.5, Math.min(0.5, delta));
      refinedLag = bestLag + clampedDelta;
    }
  }

  const f0Hz = Number((sampleRate / refinedLag).toFixed(1));
  if (f0Hz < MIN_F0_HZ || f0Hz > MAX_F0_HZ) {
    return { f0Hz: null, jitterPct: 0, voiced: false, volumeDbfs };
  }

  // Step 5: Cycle-to-cycle period perturbation (jitter %)
  // Note: At 16 kHz sampling, sample discretization creates a baseline ~1.3% noise floor.
  // This is treated as an indicative heuristic rather than a clinical measurement.
  const periodSamples = Math.round(refinedLag);
  const subPeriods: number[] = [];
  let prevPeakIdx = -1;
  for (let start = 0; start + periodSamples <= samples.length; start += periodSamples) {
    let maxAmp = -Infinity;
    let maxIdx = start;
    for (let k = start; k < start + periodSamples; k++) {
      const v = samples[k] ?? 0;
      if (v > maxAmp) {
        maxAmp = v;
        maxIdx = k;
      }
    }
    if (prevPeakIdx >= 0) {
      subPeriods.push(maxIdx - prevPeakIdx);
    }
    prevPeakIdx = maxIdx;
  }

  let jitterPct = 0;
  if (subPeriods.length >= 2) {
    let diffSum = 0;
    let periodSum = 0;
    for (let i = 0; i < subPeriods.length; i++) {
      periodSum += subPeriods[i]!;
      if (i > 0) {
        diffSum += Math.abs(subPeriods[i]! - subPeriods[i - 1]!);
      }
    }
    const meanPeriod = periodSum / subPeriods.length;
    const meanDiff = diffSum / (subPeriods.length - 1);
    jitterPct = meanPeriod > 0 ? Number(Math.min(12, (meanDiff / meanPeriod) * 100).toFixed(2)) : 0;
  }

  return { f0Hz, jitterPct, voiced: true, volumeDbfs };
}

/**
 * Calibrate a speaker's baseline F0 (median of voiced frames) and baseline RMS volume
 * from a series of contour frames or raw frame measurements.
 */
export function calibrateSpeakerBaseline(
  frames: Array<{ f0Hz: number | null; volumeDbfs: number; voiced: boolean }>,
  defaultWordsPerMinute = 145,
): SpeakerBaseline {
  const voicedF0 = frames
    .filter((f) => f.voiced && f.f0Hz !== null && f.f0Hz >= MIN_F0_HZ && f.f0Hz <= MAX_F0_HZ)
    .map((f) => f.f0Hz as number)
    .sort((a, b) => a - b);

  const voicedDb = frames
    .filter((f) => f.voiced && f.volumeDbfs > -46)
    .map((f) => f.volumeDbfs)
    .sort((a, b) => a - b);

  const median = (arr: number[], fallback: number): number => {
    if (arr.length === 0) return fallback;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 0
      ? Number(((arr[mid - 1]! + arr[mid]!) / 2).toFixed(1))
      : Number(arr[mid]!.toFixed(1));
  };

  return {
    f0Hz: median(voicedF0, 165),
    rmsDbfs: median(voicedDb, -19.0),
    wordsPerMinute: defaultWordsPerMinute,
  };
}

/**
 * Analyze a continuous PCM audio buffer into a sequence of speaker-normalized
 * `ProsodicContourPoint` entries.
 */
export function extractProsodicContourFromPcm(
  pcmSamples: Float32Array,
  sampleRate = 16000,
  baseline?: SpeakerBaseline,
  frameDurationMs = 100,
  defaultSpeaker: SpeakerRole = 'participant',
): { contour: ProsodicContourPoint[]; baseline: SpeakerBaseline } {
  const samplesPerFrame = Math.max(128, Math.floor((sampleRate * frameDurationMs) / 1000));
  const rawFrames: Array<{
    timestampMs: number;
    f0Hz: number | null;
    jitterPct: number;
    voiced: boolean;
    volumeDbfs: number;
  }> = [];

  for (let offset = 0, idx = 0; offset + samplesPerFrame <= pcmSamples.length; offset += samplesPerFrame, idx++) {
    const slice = pcmSamples.subarray(offset, offset + samplesPerFrame);
    const est = estimateFramePitchAndJitter(slice, sampleRate);
    rawFrames.push({
      timestampMs: idx * frameDurationMs,
      ...est,
    });
  }

  const resolvedBaseline = baseline ?? calibrateSpeakerBaseline(rawFrames);

  const contour: ProsodicContourPoint[] = rawFrames.map((f) => ({
    timestampMs: f.timestampMs,
    speaker: f.voiced ? defaultSpeaker : null,
    voiced: f.voiced,
    f0Hz: f.f0Hz,
    pitchDeltaSt: f.f0Hz !== null ? hzToSemitonesDelta(f.f0Hz, resolvedBaseline.f0Hz) : null,
    volumeDbfs: f.volumeDbfs,
    volumeDeltaDb: Number((f.volumeDbfs - resolvedBaseline.rmsDbfs).toFixed(2)),
    jitterPct: f.jitterPct,
  }));

  return { contour, baseline: resolvedBaseline };
}

/**
 * Compute terminal pitch slope (in semitones) over the tail of an utterance to detect
 * "declarative uptalk" (rising question intonation on a statement answer, signaling
 * mapping or retrieval uncertainty).
 */
export function computeTerminalPitchSlopeSt(
  contourSlice: ProsodicContourPoint[],
): number {
  const voiced = contourSlice.filter(
    (p) => p.voiced && p.pitchDeltaSt !== null && p.speaker === 'participant',
  );
  if (voiced.length < 2) return 0;

  // Compare the last third (or final 2 points) of the utterance against the middle body
  const tailCount = Math.max(1, Math.floor(voiced.length / 3));
  const bodySlice = voiced.slice(0, voiced.length - tailCount);
  const tailSlice = voiced.slice(voiced.length - tailCount);

  const meanPitch = (pts: ProsodicContourPoint[]) =>
    pts.reduce((acc, p) => acc + (p.pitchDeltaSt ?? 0), 0) / pts.length;

  const bodyMean = meanPitch(bodySlice);
  const tailEnd = Math.max(...tailSlice.map((p) => p.pitchDeltaSt ?? bodyMean));
  return Number((tailEnd - bodyMean).toFixed(2));
}

/**
 * Segment unvoiced intervals in a prosodic contour into `pre_response` and `mid_utterance`
 * silent pauses within a question window.
 */
export function detectSilentPauses(
  contour: ProsodicContourPoint[],
  questionId: string,
  questionEnteredAtMs: number,
  moderatorPromptEndedAtMs?: number,
  minMidPauseMs = 450,
): SilentPauseEvent[] {
  const inWindow = contour.filter((p) => p.timestampMs >= questionEnteredAtMs);
  if (inWindow.length === 0) return [];

  const frameStepMs =
    inWindow.length >= 2
      ? Math.max(50, inWindow[1]!.timestampMs - inWindow[0]!.timestampMs)
      : 100;

  const referenceStartMs = moderatorPromptEndedAtMs ?? questionEnteredAtMs;
  const participantVoiced = inWindow.filter(
    (p) => p.timestampMs >= referenceStartMs && p.voiced && p.speaker === 'participant',
  );

  const pauses: SilentPauseEvent[] = [];

  // 1. Pre-response latency: from referenceStartMs to first participant voiced frame
  if (participantVoiced.length > 0) {
    const firstOnsetMs = participantVoiced[0]!.timestampMs;
    const preDuration = firstOnsetMs - referenceStartMs;
    if (preDuration >= 300) {
      pauses.push({
        startMs: referenceStartMs,
        endMs: firstOnsetMs,
        durationMs: preDuration,
        kind: 'pre_response',
        questionId,
      });
    }

    // 2. Mid-utterance silent gaps between first and last participant voiced frames
    const lastVoicedMs = participantVoiced[participantVoiced.length - 1]!.timestampMs;
    const turnFrames = inWindow.filter(
      (p) => p.timestampMs >= firstOnsetMs && p.timestampMs <= lastVoicedMs,
    );

    let gapStart: number | null = null;
    for (const pt of turnFrames) {
      const isParticipantVoiced = pt.voiced && pt.speaker === 'participant';
      if (!isParticipantVoiced) {
        if (gapStart === null) gapStart = pt.timestampMs;
      } else if (gapStart !== null) {
        const duration = pt.timestampMs - gapStart;
        if (duration >= minMidPauseMs) {
          pauses.push({
            startMs: gapStart,
            endMs: pt.timestampMs,
            durationMs: duration,
            kind: 'mid_utterance',
            questionId,
          });
        }
        gapStart = null;
      }
    }
    if (gapStart !== null) {
      const duration = lastVoicedMs + frameStepMs - gapStart;
      if (duration >= minMidPauseMs) {
        pauses.push({
          startMs: gapStart,
          endMs: lastVoicedMs + frameStepMs,
          durationMs: duration,
          kind: 'mid_utterance',
          questionId,
        });
      }
    }
  }

  return pauses;
}
