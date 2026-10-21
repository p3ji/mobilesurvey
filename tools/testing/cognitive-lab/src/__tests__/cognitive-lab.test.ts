import { describe, expect, it } from 'vitest';
import {
  BUNDLED_COGNITIVE_SESSIONS,
  aggregateCrossParticipantHeatmap,
  analyzeLexicalDisfluencies,
  calibrateSpeakerBaseline,
  classifyTurnSentiment,
  computeCursorTortuosity,
  computeRmsDbfs,
  computeTerminalPitchSlopeSt,
  createLfsCognitiveSessionP01,
  detectHoverOscillations,
  detectSilentPauses,
  estimateFramePitchAndJitter,
  extractProsodicContourFromPcm,
  hzToSemitonesDelta,
  resolveActiveQuestionFromDomSnapshot,
  sanitizeSessionReport,
  sanitizeTranscriptText,
  summarizeQuestionBehavior,
  type ProsodicContourPoint,
  type UiTelemetryEvent,
} from '../index.js';
import { startCognitiveLabDaemon } from '../daemon.js';

function synthesizeHarmonicWave(
  f0Hz: number,
  sampleRate = 16000,
  durationMs = 100,
  amplitude = 0.25,
): Float32Array {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const out = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    out[i] =
      amplitude * Math.sin(2 * Math.PI * f0Hz * t) +
      0.35 * amplitude * Math.sin(2 * Math.PI * (2 * f0Hz) * t);
  }
  return out;
}

describe('@mobilesurvey/cognitive-lab — Acoustic Prosody DSP', () => {
  it('accurately estimates F0 pitch in Hz on synthetic harmonic speech frames and rejects silence', () => {
    const frame160 = synthesizeHarmonicWave(160, 16000, 100, 0.25);
    const res160 = estimateFramePitchAndJitter(frame160, 16000);
    expect(res160.voiced).toBe(true);
    expect(res160.f0Hz).not.toBeNull();
    expect(Math.abs((res160.f0Hz ?? 0) - 160)).toBeLessThan(3.5);

    const frame220 = synthesizeHarmonicWave(220, 16000, 100, 0.25);
    const res220 = estimateFramePitchAndJitter(frame220, 16000);
    expect(res220.voiced).toBe(true);
    expect(Math.abs((res220.f0Hz ?? 0) - 220)).toBeLessThan(4.0);

    const contourFromPcm = extractProsodicContourFromPcm(frame220, 16000, undefined, 100);
    expect(contourFromPcm.contour).toHaveLength(1);
    expect(contourFromPcm.contour[0]?.voiced).toBe(true);

    const silent = new Float32Array(1600);
    const resSilent = estimateFramePitchAndJitter(silent, 16000);
    expect(resSilent.voiced).toBe(false);
    expect(resSilent.f0Hz).toBeNull();
    expect(resSilent.volumeDbfs).toBe(-60);
  });

  it('computes semitone pitch deltas and RMS dBFS accurately', () => {
    expect(hzToSemitonesDelta(220, 110)).toBeCloseTo(12.0, 1);
    expect(hzToSemitonesDelta(110, 220)).toBeCloseTo(-12.0, 1);
    expect(hzToSemitonesDelta(170, 170)).toBe(0);

    const loudFrame = synthesizeHarmonicWave(180, 16000, 100, 0.5);
    const quietFrame = synthesizeHarmonicWave(180, 16000, 100, 0.08);
    expect(computeRmsDbfs(loudFrame)).toBeGreaterThan(computeRmsDbfs(quietFrame) + 12);
  });

  it('calibrates speaker baseline and detects declarative uptalk slope and silent pauses', () => {
    const baseline = calibrateSpeakerBaseline([
      { f0Hz: 168, volumeDbfs: -18.2, voiced: true },
      { f0Hz: 170, volumeDbfs: -18.0, voiced: true },
      { f0Hz: 172, volumeDbfs: -17.8, voiced: true },
      { f0Hz: null, volumeDbfs: -55.0, voiced: false },
    ]);
    expect(baseline.f0Hz).toBe(170);
    expect(baseline.rmsDbfs).toBe(-18);

    const contour: ProsodicContourPoint[] = [
      { timestampMs: 1000, speaker: null, voiced: false, f0Hz: null, pitchDeltaSt: null, volumeDbfs: -52, volumeDeltaDb: -34, jitterPct: 0 },
      { timestampMs: 2600, speaker: 'participant', voiced: true, f0Hz: 170, pitchDeltaSt: 0, volumeDbfs: -18, volumeDeltaDb: 0, jitterPct: 0.5 },
      { timestampMs: 2850, speaker: 'participant', voiced: true, f0Hz: 172, pitchDeltaSt: 0.2, volumeDbfs: -18, volumeDeltaDb: 0, jitterPct: 0.5 },
      { timestampMs: 3100, speaker: null, voiced: false, f0Hz: null, pitchDeltaSt: null, volumeDbfs: -52, volumeDeltaDb: -34, jitterPct: 0 },
      { timestampMs: 3900, speaker: 'participant', voiced: true, f0Hz: 174, pitchDeltaSt: 0.4, volumeDbfs: -18, volumeDeltaDb: 0, jitterPct: 0.6 },
      { timestampMs: 4150, speaker: 'participant', voiced: true, f0Hz: 210, pitchDeltaSt: 3.65, volumeDbfs: -18, volumeDeltaDb: 0, jitterPct: 0.8 },
    ];

    const uptalkSlope = computeTerminalPitchSlopeSt(contour);
    expect(uptalkSlope).toBeGreaterThan(2.5);

    const pauses = detectSilentPauses(contour, 'q_test', 1000, 1000, 450);
    expect(pauses.some((p) => p.kind === 'pre_response' && p.durationMs === 1600)).toBe(true);
    expect(pauses.some((p) => p.kind === 'mid_utterance' && p.durationMs === 800)).toBe(true);
  });
});

describe('@mobilesurvey/cognitive-lab — Bilingual Disfluency & Lexical-Prosodic Incongruence', () => {
  it('extracts English and French filled pauses, epistemic hedges, and clarification markers', () => {
    const en = analyzeLexicalDisfluencies(
      'Um, what does usual hours mean here? Uh, I guess maybe around 35 hours.',
    );
    expect(en.filledPauses).toEqual(['um', 'uh']);
    expect(en.hedges).toEqual(expect.arrayContaining(['i guess', 'maybe', 'around']));
    expect(en.clarificationMarkers.length).toBeGreaterThan(0);

    const fr = analyzeLexicalDisfluencies(
      'Euh, ben je ne comprends pas cette consigne... je pense peut-être environ 40 heures.',
    );
    expect(fr.filledPauses).toEqual(['euh', 'ben']);
    expect(fr.hedges).toEqual(expect.arrayContaining(['je pense', 'peut-être', 'environ']));
    expect(fr.clarificationMarkers.length).toBeGreaterThan(0);
  });

  it('flags lexical-prosodic incongruence when a compliant text response has strained prosody', () => {
    const sentiment = classifyTurnSentiment({
      text: 'Yeah, that is fine.',
      meanPitchDeltaSt: 3.4,
      peakPitchDeltaSt: 3.9,
      terminalPitchSlopeSt: 1.2,
      meanVolumeDeltaDb: -6.2,
      minVolumeDeltaDb: -6.8,
      meanJitterPct: 2.3,
      speechRateRatio: 0.85,
      preResponseSilenceMs: 2750,
      longestMidPauseMs: 0,
      filledPauseCount: 0,
      hedgeCount: 0,
    });
    expect(sentiment.lexicalProsodicIncongruence).toBe(true);
    expect(sentiment.label).toBe('uncomfortable_withdrawn');
    expect(sentiment.incongruenceReason).toContain('volume dropped');
  });
});

describe('@mobilesurvey/cognitive-lab — Behavioral UI Telemetry & Universal Question Resolver', () => {
  it('computes cursor tortuosity and detects alternating option hover oscillations', () => {
    const straight = computeCursorTortuosity([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(straight).toBe(1.0);

    const thrashing = computeCursorTortuosity([
      { x: 0, y: 0 },
      { x: 100, y: 120 },
      { x: 10, y: 20 },
      { x: 110, y: 130 },
      { x: 40, y: 30 },
    ]);
    expect(thrashing).toBeGreaterThan(3.5);

    const events: UiTelemetryEvent[] = [
      { id: '1', timestampMs: 100, questionId: 'q2', kind: 'option_hover', targetLabel: 'Option A', dwellMs: 400 },
      { id: '2', timestampMs: 600, questionId: 'q2', kind: 'option_hover', targetLabel: 'Option B', dwellMs: 500 },
      { id: '3', timestampMs: 1200, questionId: 'q2', kind: 'option_hover', targetLabel: 'Option A', dwellMs: 450 },
      { id: '4', timestampMs: 1800, questionId: 'q2', kind: 'option_hover', targetLabel: 'Option B', dwellMs: 400 },
    ];
    const osc = detectHoverOscillations(events);
    expect(osc.oscillationCount).toBe(2);
    expect(osc.oscillatingOptions).toEqual(['Option A', 'Option B']);

    const summary = summarizeQuestionBehavior('q2', 0, 2000, events);
    expect(summary.hoverOscillations).toBe(2);
  });

  it('resolves active question across native @mobilesurvey DOM, external survey heuristics, and moderator overrides', () => {
    const nativeResolved = resolveActiveQuestionFromDomSnapshot({
      url: 'http://localhost:5174/?survey=lfs',
      dataQuestionId: 'q_emp_class',
      dataVariableRef: 'COW_MAIN',
      fieldsetLegend: 'In your main job, were you a paid employee?',
    });
    expect(nativeResolved.detectionSource).toBe('mobilesurvey_dom');
    expect(nativeResolved.questionId).toBe('q_emp_class');
    expect(nativeResolved.variableName).toBe('COW_MAIN');

    const externalResolved = resolveActiveQuestionFromDomSnapshot({
      url: 'https://eq.statcan.gc.ca/survey/step2',
      fieldsetLegend: 'What were your total dwelling shelter costs last month?',
    });
    expect(externalResolved.detectionSource).toBe('external_heuristic');
    expect(externalResolved.questionId).toBe('ext_what_were_your_total_dwelling_shelte');

    const overrideResolved = resolveActiveQuestionFromDomSnapshot({
      url: 'https://eq.statcan.gc.ca/survey/step2',
      fieldsetLegend: 'What were your total dwelling shelter costs last month?',
      moderatorOverrideId: 'q_shelter_custom',
      moderatorOverrideLabel: 'Q5: Monthly Shelter Costs',
    });
    expect(overrideResolved.detectionSource).toBe('moderator_override');
    expect(overrideResolved.questionId).toBe('q_shelter_custom');
  });
});

describe('@mobilesurvey/cognitive-lab — 4-Construct Diagnostics, Probes & Zero-Cloud PII Air-Gap', () => {
  it('diagnoses all 4 Tourangeau constructs and generates bilingual moderator probes on LFS fixture', () => {
    const session = createLfsCognitiveSessionP01();
    expect(session.questions).toHaveLength(4);

    // Q1: Low friction baseline
    const q1 = session.questions.find((q) => q.questionId === 'q_age')!;
    expect(q1.overallSeverity).toBe('none');

    // Q2: High Response Mapping Confusion
    const q2 = session.questions.find((q) => q.questionId === 'q_emp_class')!;
    expect(q2.constructs.mapping.score).toBeGreaterThanOrEqual(70);
    expect(q2.dominantConstruct).toBe('mapping');
    expect(q2.probes.some((p) => p.construct === 'mapping' && p.probeTextFr.length > 20)).toBe(true);

    // Q3: High Comprehension & Retrieval Burden
    const q3 = session.questions.find((q) => q.questionId === 'q_usual_hours')!;
    expect(q3.constructs.comprehension.score).toBeGreaterThanOrEqual(65);
    expect(q3.constructs.retrieval.score).toBeGreaterThanOrEqual(60);

    // Q4: High Sensitivity / Vocal Discomfort
    const q4 = session.questions.find((q) => q.questionId === 'q_hh_income')!;
    expect(q4.constructs.sensitivity.score).toBeGreaterThanOrEqual(70);
    expect(q4.acousticSummary.hasLexicalProsodicIncongruence).toBe(true);
  });

  it('enforces zero-cloud-leakage privacy and redacts PII into surrogate tokens', () => {
    const res = sanitizeTranscriptText(
      'My name is Clara Tremblay, my SIN is 046-454-286, email clara@example.ca, phone 613-555-0199, postal K1A 0T6.',
    );
    expect(res.sanitizedText).not.toContain('Clara Tremblay');
    expect(res.sanitizedText).not.toContain('046-454-286');
    expect(res.sanitizedText).not.toContain('clara@example.ca');
    expect(res.sanitizedText).not.toContain('613-555-0199');
    expect(res.sanitizedText).not.toContain('K1A 0T6');
    expect(res.sanitizedText).toContain('[NAME_1]');
    expect(res.sanitizedText).toContain('[SIN_1]');
    expect(res.sanitizedText).toContain('[EMAIL_1]');
    expect(res.sanitizedText).toContain('[PHONE_1]');
    expect(res.sanitizedText).toContain('[POSTAL_1]');

    const session = createLfsCognitiveSessionP01();
    const sanitized = sanitizeSessionReport(session);
    expect(sanitized.privacy.rawAudioIncluded).toBe(false);
    expect(sanitized.privacy.piiSanitized).toBe(true);
    const fullDump = JSON.stringify(sanitized.transcript);
    expect(fullDump).not.toContain('Clara Tremblay');
    expect(fullDump).not.toContain('046-454-286');
  });

  it('aggregates multiple sessions into a cross-participant question heatmap', () => {
    const heatmap = aggregateCrossParticipantHeatmap(BUNDLED_COGNITIVE_SESSIONS);
    expect(heatmap).toHaveLength(4);
    const empRow = heatmap.find((r) => r.questionId === 'q_emp_class')!;
    expect(empRow.participantCount).toBe(3);
    expect(empRow.meanConstructScores.mapping).toBeGreaterThanOrEqual(70);
  });

  it('serves live health, sessions, question overrides, and PCM audio processing via local daemon', async () => {
    const daemon = await startCognitiveLabDaemon({ port: 0 });
    try {
      const healthRes = await fetch(`${daemon.url}/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as { status: string; models: { dsp: string } };
      expect(health.status).toBe('ok');
      expect(health.models.dsp).toBe('yin-autocorr-16khz');

      const markRes = await fetch(`${daemon.url}/session/mark-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: 'q_emp_class',
          questionTextEn: 'Q2: Class of Worker',
        }),
      });
      expect(markRes.status).toBe(200);

      const wave = Array.from(synthesizeHarmonicWave(205, 16000, 200, 0.2));
      const audioRes = await fetch(`${daemon.url}/session/audio-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples: wave,
          sampleRate: 16000,
          speaker: 'participant',
          questionId: 'q_emp_class',
          transcriptText: 'Um, my name is Jean Dupont and I guess I am not sure.',
        }),
      });
      expect(audioRes.status).toBe(200);
      const audioPayload = (await audioRes.json()) as {
        ok: boolean;
        contourPointsAdded: number;
        turn: { text: string };
      };
      expect(audioPayload.ok).toBe(true);
      expect(audioPayload.contourPointsAdded).toBeGreaterThan(0);
      // Verify PII was automatically scrubbed in the returned turn
      expect(audioPayload.turn.text).toContain('[NAME_');
      expect(audioPayload.turn.text).not.toContain('Jean Dupont');
    } finally {
      await daemon.close();
    }
  });
});
