/**
 * @mobilesurvey/cognitive-lab — Realistic Multimodal Cognitive Interview Fixtures.
 *
 * Synthesizes complete cognitive interview sessions through the deterministic
 * prosodic contour, transcript disfluency, behavioral telemetry, 4-construct
 * Tourangeau diagnostic, and PII sanitization pipeline.
 */

import { evaluateQuestionDiagnostics } from './diagnostics.js';
import { sanitizeSessionReport } from './privacy.js';
import { detectSilentPauses, hzToSemitonesDelta } from './prosody.js';
import { buildTranscriptTurn } from './transcriber.js';
import type {
  CognitiveSessionReport,
  ProsodicContourPoint,
  SilentPauseEvent,
  SpeakerBaseline,
  SpeakerRole,
  TranscriptTurn,
  UiTelemetryEvent,
} from './types.js';

interface ContourSegmentSpec {
  startMs: number;
  endMs: number;
  speaker: SpeakerRole | null;
  voiced: boolean;
  f0Hz?: number;
  endF0Hz?: number;
  volumeDbfs: number;
  jitterPct?: number;
}

function buildContourFromSegments(
  segments: ContourSegmentSpec[],
  baseline: SpeakerBaseline,
  totalDurationMs: number,
  stepMs = 250,
): ProsodicContourPoint[] {
  const points: ProsodicContourPoint[] = [];
  for (let t = 0; t <= totalDurationMs; t += stepMs) {
    const seg = segments.find((s) => t >= s.startMs && t < s.endMs);
    if (!seg || !seg.voiced || !seg.f0Hz) {
      points.push({
        timestampMs: t,
        speaker: null,
        voiced: false,
        f0Hz: null,
        pitchDeltaSt: null,
        volumeDbfs: -52,
        volumeDeltaDb: Number((-52 - baseline.rmsDbfs).toFixed(2)),
        jitterPct: 0,
      });
    } else {
      const progress = Math.max(
        0,
        Math.min(1, (t - seg.startMs) / Math.max(1, seg.endMs - seg.startMs)),
      );
      const targetEndF0 = seg.endF0Hz ?? seg.f0Hz;
      // Apply endF0Hz ramp primarily over the final 35% of the segment to model terminal intonation
      const rampProgress = progress > 0.65 ? (progress - 0.65) / 0.35 : 0;
      const currentF0 = Number(
        (seg.f0Hz + (targetEndF0 - seg.f0Hz) * rampProgress).toFixed(1),
      );
      points.push({
        timestampMs: t,
        speaker: seg.speaker,
        voiced: true,
        f0Hz: currentF0,
        pitchDeltaSt: hzToSemitonesDelta(currentF0, baseline.f0Hz),
        volumeDbfs: seg.volumeDbfs,
        volumeDeltaDb: Number((seg.volumeDbfs - baseline.rmsDbfs).toFixed(2)),
        jitterPct: seg.jitterPct ?? 0.65,
      });
    }
  }
  return points;
}

/**
 * Primary cognitive interview session on the Labour Force & Household Survey (`lfs`),
 * demonstrating all 4 Tourangeau cognitive constructs across 4 questions:
 * - Q1 (Age / Household roster): Fluent baseline (Low friction)
 * - Q2 (Employment Category Mapping): High Mapping Confusion (Hover oscillation between
 *   'Employee' and 'Self-employed incorporated' + Answer switch + +3.6 st rising uptalk)
 * - Q3 (Usual vs. Actual Hours Worked): High Comprehension & Retrieval Burden
 *   (2 scroll regressions to re-read stem + 2.8s mid-utterance recall pause + filled pauses)
 * - Q4 (Total Net Household Income): High Sensitivity / Discomfort
 *   (-6.5 dB vocal withdrawal drop + +3.8 st pitch elevation + hover on 'Prefer not to answer' +
 *   lexical-prosodic incongruence on "Yeah, that's fine")
 */
export function createLfsCognitiveSessionP01(): CognitiveSessionReport {
  const baseline: SpeakerBaseline = {
    f0Hz: 170,
    rmsDbfs: -18.0,
    wordsPerMinute: 145,
  };

  const segments: ContourSegmentSpec[] = [
    // Q1 (0 - 12,000ms): Smooth, confident baseline response
    { startMs: 500, endMs: 3000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    { startMs: 3500, endMs: 8500, speaker: 'participant', voiced: true, f0Hz: 172, endF0Hz: 168, volumeDbfs: -17.8, jitterPct: 0.55 },

    // Q2 (12,000 - 30,000ms): Mapping confusion (Employee vs Self-employed contract) with +3.6 st uptalk
    { startMs: 12500, endMs: 15000, speaker: 'moderator', voiced: true, f0Hz: 136, volumeDbfs: -17.5 },
    { startMs: 16200, endMs: 21000, speaker: 'participant', voiced: true, f0Hz: 176, endF0Hz: 192, volumeDbfs: -18.5, jitterPct: 1.1 },
    // Silent pause 21,000 - 22,500ms while switching radio options
    { startMs: 22500, endMs: 27500, speaker: 'participant', voiced: true, f0Hz: 175, endF0Hz: 212, volumeDbfs: -18.2, jitterPct: 1.25 },

    // Q3 (30,000 - 50,000ms): Comprehension + Retrieval burden (Usual vs Actual hours excluding overtime)
    { startMs: 30500, endMs: 32500, speaker: 'moderator', voiced: true, f0Hz: 134, volumeDbfs: -17.5 },
    { startMs: 35200, endMs: 39500, speaker: 'participant', voiced: true, f0Hz: 166, endF0Hz: 165, volumeDbfs: -19.2, jitterPct: 0.9 },
    // 2.8s mid-utterance recall silence (39,500 - 42,300ms)
    { startMs: 42300, endMs: 47500, speaker: 'participant', voiced: true, f0Hz: 168, endF0Hz: 185, volumeDbfs: -19.0, jitterPct: 1.05 },

    // Q4 (50,000 - 68,000ms): Sensitivity & Vocal Discomfort (Household Income & SIN reference)
    { startMs: 50500, endMs: 53000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    // 2.75s pre-response silence (53,000 - 55,750ms) followed by -6.8 dB quiet stage-whisper + +3.9 st pitch spike
    { startMs: 55750, endMs: 60500, speaker: 'participant', voiced: true, f0Hz: 206, endF0Hz: 214, volumeDbfs: -24.8, jitterPct: 2.35 },
    { startMs: 61500, endMs: 65000, speaker: 'participant', voiced: true, f0Hz: 202, endF0Hz: 208, volumeDbfs: -24.2, jitterPct: 2.15 },
  ];

  const contour = buildContourFromSegments(segments, baseline, 68000, 250);

  const uiEvents: UiTelemetryEvent[] = [
    // Q1
    { id: 'ev_1', timestampMs: 200, questionId: 'q_age', kind: 'question_enter', targetLabel: 'Q1: Respondent Age' },
    { id: 'ev_2', timestampMs: 4200, questionId: 'q_age', kind: 'answer_select', targetLabel: '34', newValue: '34', cursorTortuosity: 1.12 },
    { id: 'ev_3', timestampMs: 9200, questionId: 'q_age', kind: 'next_click', targetLabel: 'Next' },

    // Q2: Mapping confusion (Employee vs Self-employed)
    { id: 'ev_4', timestampMs: 12000, questionId: 'q_emp_class', kind: 'question_enter', targetLabel: 'Q2: Class of Worker' },
    { id: 'ev_5', timestampMs: 16500, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Paid employee', dwellMs: 900 },
    { id: 'ev_6', timestampMs: 17800, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Self-employed (incorporated)', dwellMs: 1100 },
    { id: 'ev_7', timestampMs: 19200, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Paid employee', dwellMs: 850 },
    { id: 'ev_8', timestampMs: 20400, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Self-employed (incorporated)', dwellMs: 950 },
    { id: 'ev_9', timestampMs: 21500, questionId: 'q_emp_class', kind: 'answer_select', targetLabel: 'Paid employee', newValue: 'Paid employee', cursorTortuosity: 2.85 },
    { id: 'ev_10', timestampMs: 24200, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Self-employed (incorporated)', previousValue: 'Paid employee', newValue: 'Self-employed (incorporated)' },
    { id: 'ev_11', timestampMs: 26100, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Paid employee', previousValue: 'Self-employed (incorporated)', newValue: 'Paid employee' },
    { id: 'ev_12', timestampMs: 29400, questionId: 'q_emp_class', kind: 'next_click', targetLabel: 'Next' },

    // Q3: Comprehension + Retrieval burden (Usual paid hours excluding unpaid overtime)
    { id: 'ev_13', timestampMs: 30000, questionId: 'q_usual_hours', kind: 'question_enter', targetLabel: 'Q3: Usual Weekly Paid Hours' },
    { id: 'ev_14', timestampMs: 36200, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -180, note: 'Scrolled up to re-read exclusion note on overtime' },
    { id: 'ev_15', timestampMs: 40100, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -145, note: 'Second scroll regression to check reference week definition' },
    { id: 'ev_16', timestampMs: 43500, questionId: 'q_usual_hours', kind: 'cursor_thrash', cursorTortuosity: 3.95 },
    { id: 'ev_17', timestampMs: 46200, questionId: 'q_usual_hours', kind: 'answer_select', targetLabel: '37.5', newValue: '37.5' },
    { id: 'ev_18', timestampMs: 49200, questionId: 'q_usual_hours', kind: 'next_click', targetLabel: 'Next' },

    // Q4: Sensitivity / Discomfort (Total household income)
    { id: 'ev_19', timestampMs: 50000, questionId: 'q_hh_income', kind: 'question_enter', targetLabel: 'Q4: Total Net Household Income' },
    { id: 'ev_20', timestampMs: 54800, questionId: 'q_hh_income', kind: 'prefer_not_hover', targetLabel: 'Prefer not to answer', dwellMs: 1400 },
    { id: 'ev_21', timestampMs: 58200, questionId: 'q_hh_income', kind: 'option_hover', targetLabel: '$80,000 to $99,999', dwellMs: 650 },
    { id: 'ev_22', timestampMs: 63200, questionId: 'q_hh_income', kind: 'answer_select', targetLabel: '$80,000 to $99,999', newValue: '$80,000 to $99,999', cursorTortuosity: 2.4 },
    { id: 'ev_23', timestampMs: 66800, questionId: 'q_hh_income', kind: 'next_click', targetLabel: 'Next' },
  ];

  const transcript: TranscriptTurn[] = [
    // Q1
    buildTranscriptTurn({
      id: 't_1',
      speaker: 'moderator',
      questionId: 'q_age',
      startMs: 500,
      endMs: 3000,
      text: 'Please go ahead and think aloud as you complete the first question on household demographics.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_2',
      speaker: 'participant',
      questionId: 'q_age',
      startMs: 3500,
      endMs: 8500,
      text: 'My name is Clara Tremblay and I am 34 years old, so I will just type 34 right here.',
      contour,
      baseline,
      referencePromptEndMs: 3000,
    }),

    // Q2
    buildTranscriptTurn({
      id: 't_3',
      speaker: 'moderator',
      questionId: 'q_emp_class',
      startMs: 12500,
      endMs: 15000,
      text: 'Tell me what you are looking at on this employment classification question.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_4',
      speaker: 'participant',
      questionId: 'q_emp_class',
      startMs: 16200,
      endMs: 27500,
      text: 'Um, well I work on a 12-month IT consulting contract through an agency... so I guess I am not really sure if that counts as Paid employee or Self-employed? I will pick Paid employee?',
      contour,
      baseline,
      referencePromptEndMs: 15000,
    }),

    // Q3
    buildTranscriptTurn({
      id: 't_5',
      speaker: 'moderator',
      questionId: 'q_usual_hours',
      startMs: 30500,
      endMs: 32500,
      text: 'And how about this next question on hours worked?',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_6',
      speaker: 'participant',
      questionId: 'q_usual_hours',
      startMs: 35200,
      endMs: 47500,
      text: 'Wait, what does usual paid hours excluding overtime mean if my contract has variable on-call shifts? Um... uh, let me think, first week was 42, then 35... probably around 37.5 hours I think.',
      contour,
      baseline,
      referencePromptEndMs: 32500,
    }),

    // Q4
    buildTranscriptTurn({
      id: 't_7',
      speaker: 'moderator',
      questionId: 'q_hh_income',
      startMs: 50500,
      endMs: 53000,
      text: 'Notice how you react to this final question on household income.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_8',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 55750,
      endMs: 60500,
      text: 'Yeah, that is fine.',
      contour,
      baseline,
      referencePromptEndMs: 53000,
    }),
    buildTranscriptTurn({
      id: 't_9',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 61500,
      endMs: 65000,
      text: 'Um, I usually do not share my exact salary or SIN 046-454-286 online, maybe I will just click the $80,000 bracket.',
      contour,
      baseline,
      referencePromptEndMs: 60500,
    }),
  ];

  const questionSpecs = [
    {
      questionId: 'q_age',
      variableName: 'AGE_YEARS',
      questionNumber: 'Q1',
      questionTextEn: 'What is your age in completed years?',
      questionTextFr: 'Quel est votre âge en années révolues?',
      enteredAtMs: 0,
      exitedAtMs: 12000,
      promptEndMs: 3000,
    },
    {
      questionId: 'q_emp_class',
      variableName: 'COW_MAIN',
      questionNumber: 'Q2',
      questionTextEn: 'In your main job, were you a paid employee, self-employed (incorporated), or working unpaid in a family business?',
      questionTextFr: 'Dans votre emploi principal, étiez-vous un employé salarié, un travailleur autonome (constitué en société) ou un travailleur familial non rémunéré?',
      enteredAtMs: 12000,
      exitedAtMs: 30000,
      promptEndMs: 15000,
    },
    {
      questionId: 'q_usual_hours',
      variableName: 'UHRS_MAIN',
      questionNumber: 'Q3',
      questionTextEn: 'Excluding paid or unpaid overtime, how many hours do you usually work per week at your main job?',
      questionTextFr: 'Sans compter les heures supplémentaires payées ou non payées, combien d’heures travaillez-vous habituellement par semaine à votre emploi principal?',
      enteredAtMs: 30000,
      exitedAtMs: 50000,
      promptEndMs: 32500,
    },
    {
      questionId: 'q_hh_income',
      variableName: 'HH_INC_NET',
      questionNumber: 'Q4',
      questionTextEn: 'What was your household’s total net income after tax and deductions in the past 12 months?',
      questionTextFr: 'Quel était le revenu net total de votre ménage après impôts et retenues au cours des 12 derniers mois?',
      enteredAtMs: 50000,
      exitedAtMs: 68000,
      promptEndMs: 53000,
    },
  ];

  const silentPauses: SilentPauseEvent[] = questionSpecs.flatMap((q) =>
    detectSilentPauses(
      contour.filter((p) => p.timestampMs >= q.enteredAtMs && p.timestampMs <= q.exitedAtMs),
      q.questionId,
      q.enteredAtMs,
      q.promptEndMs,
    ),
  );

  const questions = questionSpecs.map((q) =>
    evaluateQuestionDiagnostics({
      questionId: q.questionId,
      variableName: q.variableName,
      questionNumber: q.questionNumber,
      questionTextEn: q.questionTextEn,
      questionTextFr: q.questionTextFr,
      detectionSource: 'mobilesurvey_dom',
      enteredAtMs: q.enteredAtMs,
      exitedAtMs: q.exitedAtMs,
      turns: transcript,
      uiEvents,
    }),
  );

  const probes = questions.flatMap((q) => q.probes);

  const rawReport: CognitiveSessionReport = {
    sessionId: 'cog_lfs_p01',
    surveyId: 'lfs',
    surveyTitleEn: 'Household & Employment Survey (LFS Cognitive Pilot)',
    surveyTitleFr: 'Enquête sur les ménages et l’emploi (Pilote cognitif EPA)',
    targetUrl: 'http://localhost:5174/?survey=lfs',
    isExternalSurvey: false,
    createdAtIso: '2026-10-20T14:30:00Z',
    durationMs: 68000,
    participantCode: 'P-01 (Contract IT Analyst)',
    language: 'en',
    privacy: {
      rawAudioIncluded: false,
      piiSanitized: false,
      redactedEntityCount: 0,
      redactedCategories: [],
    },
    speakerBaseline: baseline,
    prosodicContour: contour,
    silentPauses,
    transcript,
    uiEvents,
    questions,
    probes,
  };

  return sanitizeSessionReport(rawReport);
}

/**
 * Second cognitive interview session (`P-02`) on `lfs` to power cross-participant
 * question heatmaps and demonstrate bilingual French disfluency/prosody detection.
 */
export function createLfsCognitiveSessionP02(): CognitiveSessionReport {
  const baseline: SpeakerBaseline = {
    f0Hz: 125,
    rmsDbfs: -17.5,
    wordsPerMinute: 130,
  };

  const segments: ContourSegmentSpec[] = [
    // Q1 (0 - 12,000ms): Fluent baseline in French
    { startMs: 500, endMs: 3000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    { startMs: 3500, endMs: 8800, speaker: 'participant', voiced: true, f0Hz: 126, endF0Hz: 124, volumeDbfs: -17.2, jitterPct: 0.55 },

    // Q2 (12,000 - 32,000ms): Category mapping confusion (Roofing contractor vs Gig delivery)
    { startMs: 12500, endMs: 15000, speaker: 'moderator', voiced: true, f0Hz: 136, volumeDbfs: -17.5 },
    { startMs: 16500, endMs: 21500, speaker: 'participant', voiced: true, f0Hz: 134, endF0Hz: 150, volumeDbfs: -18.0, jitterPct: 1.15 },
    // 1.7s silent pause while switching between options (21,500 - 23,200ms)
    { startMs: 23200, endMs: 29500, speaker: 'participant', voiced: true, f0Hz: 132, endF0Hz: 156, volumeDbfs: -18.2, jitterPct: 1.35 },

    // Q3 (32,000 - 54,000ms): Extreme recall / calculation burden (Seasonal hours: 55h in summer vs 15h in fall)
    { startMs: 32500, endMs: 34500, speaker: 'moderator', voiced: true, f0Hz: 134, volumeDbfs: -17.5 },
    { startMs: 36200, endMs: 41000, speaker: 'participant', voiced: true, f0Hz: 122, endF0Hz: 120, volumeDbfs: -19.5, jitterPct: 0.9 },
    // 3.4s mid-utterance recall silence (41,000 - 44,400ms)
    { startMs: 44400, endMs: 51500, speaker: 'participant', voiced: true, f0Hz: 124, endF0Hz: 140, volumeDbfs: -19.0, jitterPct: 1.1 },

    // Q4 (54,000 - 72,000ms): Sensitivity & Reluctance (Net Household Income & NAS reference)
    { startMs: 54500, endMs: 57000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    // 3.2s pre-response silence (57,000 - 60,200ms) followed by quiet volume withdrawal (-6.3 dB drop)
    { startMs: 60200, endMs: 63000, speaker: 'participant', voiced: true, f0Hz: 148, endF0Hz: 152, volumeDbfs: -23.8, jitterPct: 2.2 },
    { startMs: 64000, endMs: 69500, speaker: 'participant', voiced: true, f0Hz: 144, endF0Hz: 148, volumeDbfs: -23.2, jitterPct: 2.0 },
  ];

  const contour = buildContourFromSegments(segments, baseline, 72000, 250);

  const uiEvents: UiTelemetryEvent[] = [
    // Q1
    { id: 'ev_p2_1', timestampMs: 200, questionId: 'q_age', kind: 'question_enter', targetLabel: 'Q1 : Âge du répondant' },
    { id: 'ev_p2_2', timestampMs: 4500, questionId: 'q_age', kind: 'answer_select', targetLabel: '42', newValue: '42', cursorTortuosity: 1.15 },
    { id: 'ev_p2_3', timestampMs: 9500, questionId: 'q_age', kind: 'next_click', targetLabel: 'Suivant' },

    // Q2
    { id: 'ev_p2_4', timestampMs: 12000, questionId: 'q_emp_class', kind: 'question_enter', targetLabel: 'Q2 : Catégorie de travailleur' },
    { id: 'ev_p2_5', timestampMs: 17000, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Employé rémunéré', dwellMs: 1100 },
    { id: 'ev_p2_6', timestampMs: 18500, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Travailleur autonome (non constitué)', dwellMs: 1400 },
    { id: 'ev_p2_7', timestampMs: 20200, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Employé rémunéré', dwellMs: 950 },
    { id: 'ev_p2_8', timestampMs: 21800, questionId: 'q_emp_class', kind: 'answer_select', targetLabel: 'Employé rémunéré', newValue: 'Employé rémunéré', cursorTortuosity: 2.95 },
    { id: 'ev_p2_9', timestampMs: 24500, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Travailleur autonome (non constitué)', previousValue: 'Employé rémunéré', newValue: 'Travailleur autonome (non constitué)' },
    { id: 'ev_p2_10', timestampMs: 27200, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Employé rémunéré', previousValue: 'Travailleur autonome (non constitué)', newValue: 'Employé rémunéré' },
    { id: 'ev_p2_11', timestampMs: 31000, questionId: 'q_emp_class', kind: 'next_click', targetLabel: 'Suivant' },

    // Q3
    { id: 'ev_p2_12', timestampMs: 32000, questionId: 'q_usual_hours', kind: 'question_enter', targetLabel: 'Q3 : Heures hebdomadaires habituelles' },
    { id: 'ev_p2_13', timestampMs: 37500, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -190, note: 'A fait défiler vers le haut pour relire la note sur la semaine de référence' },
    { id: 'ev_p2_14', timestampMs: 42000, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -160, note: 'Deuxième retour en arrière pour vérifier l’exclusion des heures sup' },
    { id: 'ev_p2_15', timestampMs: 45800, questionId: 'q_usual_hours', kind: 'cursor_thrash', cursorTortuosity: 4.1 },
    { id: 'ev_p2_16', timestampMs: 48500, questionId: 'q_usual_hours', kind: 'answer_select', targetLabel: '25', newValue: '25' },
    { id: 'ev_p2_17', timestampMs: 53200, questionId: 'q_usual_hours', kind: 'next_click', targetLabel: 'Suivant' },

    // Q4
    { id: 'ev_p2_18', timestampMs: 54000, questionId: 'q_hh_income', kind: 'question_enter', targetLabel: 'Q4 : Revenu net total du ménage' },
    { id: 'ev_p2_19', timestampMs: 59000, questionId: 'q_hh_income', kind: 'prefer_not_hover', targetLabel: 'Préfère ne pas répondre', dwellMs: 1650 },
    { id: 'ev_p2_20', timestampMs: 63500, questionId: 'q_hh_income', kind: 'option_hover', targetLabel: '40 000 $ à 59 999 $', dwellMs: 800 },
    { id: 'ev_p2_21', timestampMs: 66500, questionId: 'q_hh_income', kind: 'answer_select', targetLabel: '40 000 $ à 59 999 $', newValue: '40 000 $ à 59 999 $', cursorTortuosity: 2.6 },
    { id: 'ev_p2_22', timestampMs: 70800, questionId: 'q_hh_income', kind: 'next_click', targetLabel: 'Suivant' },
  ];

  const transcript: TranscriptTurn[] = [
    // Q1
    buildTranscriptTurn({
      id: 't_p2_1',
      speaker: 'moderator',
      questionId: 'q_age',
      startMs: 500,
      endMs: 3000,
      text: 'Veuillez penser à voix haute pendant que vous répondez à la première question sur les données démographiques.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p2_2',
      speaker: 'participant',
      questionId: 'q_age',
      startMs: 3500,
      endMs: 8800,
      text: 'Je m’appelle Jean-François Gagnon et j’ai 42 ans, alors j’écris 42 ici.',
      contour,
      baseline,
      referencePromptEndMs: 3000,
    }),

    // Q2
    buildTranscriptTurn({
      id: 't_p2_3',
      speaker: 'moderator',
      questionId: 'q_emp_class',
      startMs: 12500,
      endMs: 15000,
      text: 'Dites-moi à quoi vous pensez en regardant cette question sur la catégorie de travailleur.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p2_4',
      speaker: 'participant',
      questionId: 'q_emp_class',
      startMs: 16500,
      endMs: 29500,
      text: 'Euh, ben là... l’été je fais de la toiture à contrat pour une compagnie, mais l’hiver je livre avec une application... alors est-ce que je suis un employé ou un travailleur autonome? Ben là, je vais cocher employé?',
      contour,
      baseline,
      referencePromptEndMs: 15000,
    }),

    // Q3
    buildTranscriptTurn({
      id: 't_p2_5',
      speaker: 'moderator',
      questionId: 'q_usual_hours',
      startMs: 32500,
      endMs: 34500,
      text: 'Et pour cette question sur les heures travaillées?',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p2_6',
      speaker: 'participant',
      questionId: 'q_usual_hours',
      startMs: 36200,
      endMs: 51500,
      text: 'Attendez... mes heures habituelles sans heures supplémentaires? En été je fais 55 heures par semaine, mais en octobre je fais peut-être 15 heures... Quelle semaine dois-je calculer? Euh... disons 25 heures en moyenne?',
      contour,
      baseline,
      referencePromptEndMs: 34500,
    }),

    // Q4
    buildTranscriptTurn({
      id: 't_p2_7',
      speaker: 'moderator',
      questionId: 'q_hh_income',
      startMs: 54500,
      endMs: 57000,
      text: 'Observez votre réaction face à cette dernière question sur le revenu du ménage.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p2_8',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 60200,
      endMs: 63000,
      text: 'Oui, c’est beau.',
      contour,
      baseline,
      referencePromptEndMs: 57000,
    }),
    buildTranscriptTurn({
      id: 't_p2_9',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 64000,
      endMs: 69500,
      text: 'Euh, mon NAS est le 048-912-345... pour le revenu, c’est tellement variable d’une saison à l’autre... je vais juste choisir la tranche de 40 000 $ à 59 999 $.',
      contour,
      baseline,
      referencePromptEndMs: 63000,
    }),
  ];

  const questionSpecs = [
    {
      questionId: 'q_age',
      variableName: 'AGE_YEARS',
      questionNumber: 'Q1',
      questionTextEn: 'What is your age in completed years?',
      questionTextFr: 'Quel est votre âge en années révolues?',
      enteredAtMs: 0,
      exitedAtMs: 12000,
      promptEndMs: 3000,
    },
    {
      questionId: 'q_emp_class',
      variableName: 'COW_MAIN',
      questionNumber: 'Q2',
      questionTextEn: 'In your main job, were you a paid employee, self-employed (incorporated), or working unpaid in a family business?',
      questionTextFr: 'Dans votre emploi principal, étiez-vous un employé salarié, un travailleur autonome (constitué en société) ou un travailleur familial non rémunéré?',
      enteredAtMs: 12000,
      exitedAtMs: 32000,
      promptEndMs: 15000,
    },
    {
      questionId: 'q_usual_hours',
      variableName: 'UHRS_MAIN',
      questionNumber: 'Q3',
      questionTextEn: 'Excluding paid or unpaid overtime, how many hours do you usually work per week at your main job?',
      questionTextFr: 'Sans compter les heures supplémentaires payées ou non payées, combien d’heures travaillez-vous habituellement par semaine à votre emploi principal?',
      enteredAtMs: 32000,
      exitedAtMs: 54000,
      promptEndMs: 34500,
    },
    {
      questionId: 'q_hh_income',
      variableName: 'HH_INC_NET',
      questionNumber: 'Q4',
      questionTextEn: 'What was your household’s total net income after tax and deductions in the past 12 months?',
      questionTextFr: 'Quel était le revenu net total de votre ménage après impôts et retenues au cours des 12 derniers mois?',
      enteredAtMs: 54000,
      exitedAtMs: 72000,
      promptEndMs: 57000,
    },
  ];

  const silentPauses: SilentPauseEvent[] = questionSpecs.flatMap((q) =>
    detectSilentPauses(
      contour.filter((p) => p.timestampMs >= q.enteredAtMs && p.timestampMs <= q.exitedAtMs),
      q.questionId,
      q.enteredAtMs,
      q.promptEndMs,
    ),
  );

  const questions = questionSpecs.map((q) =>
    evaluateQuestionDiagnostics({
      questionId: q.questionId,
      variableName: q.variableName,
      questionNumber: q.questionNumber,
      questionTextEn: q.questionTextEn,
      questionTextFr: q.questionTextFr,
      detectionSource: 'mobilesurvey_dom',
      enteredAtMs: q.enteredAtMs,
      exitedAtMs: q.exitedAtMs,
      turns: transcript,
      uiEvents,
    }),
  );

  const probes = questions.flatMap((q) => q.probes);

  const rawReport: CognitiveSessionReport = {
    sessionId: 'cog_lfs_p02',
    surveyId: 'lfs',
    surveyTitleEn: 'Household & Employment Survey (LFS Bilingual Cohort)',
    surveyTitleFr: 'Enquête sur les ménages et l’emploi (Cohorte bilingue EPA)',
    targetUrl: 'http://localhost:5174/?survey=lfs&lang=fr',
    isExternalSurvey: false,
    createdAtIso: '2026-10-20T16:10:00Z',
    durationMs: 72000,
    participantCode: 'P-02 (Gig & Seasonal Worker — FR)',
    language: 'fr',
    privacy: {
      rawAudioIncluded: false,
      piiSanitized: false,
      redactedEntityCount: 0,
      redactedCategories: [],
    },
    speakerBaseline: baseline,
    prosodicContour: contour,
    silentPauses,
    transcript,
    uiEvents,
    questions,
    probes,
  };

  return sanitizeSessionReport(rawReport);
}

/**
 * Third cognitive interview session (`P-03`) demonstrating testing on an EXTERNAL
 * non-mobilesurvey web questionnaire (DOM heuristic segmentation + Moderator Override).
 */
export function createExternalEqCognitiveSessionP03(): CognitiveSessionReport {
  const baseline: SpeakerBaseline = {
    f0Hz: 110,
    rmsDbfs: -16.5,
    wordsPerMinute: 125,
  };

  const segments: ContourSegmentSpec[] = [
    // Q1 (0 - 12,000ms): Fluent baseline
    { startMs: 500, endMs: 3000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    { startMs: 3500, endMs: 8200, speaker: 'participant', voiced: true, f0Hz: 111, endF0Hz: 109, volumeDbfs: -16.2, jitterPct: 0.5 },

    // Q2 (12,000 - 32,000ms): Class of worker mapping confusion (Partner vs Employee)
    { startMs: 12500, endMs: 15000, speaker: 'moderator', voiced: true, f0Hz: 136, volumeDbfs: -17.5 },
    { startMs: 16200, endMs: 21500, speaker: 'participant', voiced: true, f0Hz: 118, endF0Hz: 132, volumeDbfs: -17.0, jitterPct: 1.15 },
    // 2.2s silent pause while deliberating partnership vs employment (21,500 - 23,700ms)
    { startMs: 23700, endMs: 29800, speaker: 'participant', voiced: true, f0Hz: 116, endF0Hz: 136, volumeDbfs: -17.2, jitterPct: 1.3 },

    // Q3 (32,000 - 54,000ms): Usual hours retrieval / definition burden (Partner billable vs office hours)
    { startMs: 32500, endMs: 34500, speaker: 'moderator', voiced: true, f0Hz: 134, volumeDbfs: -17.5 },
    { startMs: 36000, endMs: 40500, speaker: 'participant', voiced: true, f0Hz: 108, endF0Hz: 106, volumeDbfs: -18.2, jitterPct: 0.85 },
    // 3.6s mid-utterance recall silence (40,500 - 44,100ms)
    { startMs: 44100, endMs: 51200, speaker: 'participant', voiced: true, f0Hz: 110, endF0Hz: 124, volumeDbfs: -17.8, jitterPct: 1.1 },

    // Q4 (54,000 - 72,000ms): Sensitivity & Reluctance (Net Household Income with dividends & phone)
    { startMs: 54500, endMs: 57000, speaker: 'moderator', voiced: true, f0Hz: 135, volumeDbfs: -17.5 },
    // 3.5s pre-response silence (57,000 - 60,500ms) followed by quiet volume withdrawal (-5.8 dB drop)
    { startMs: 60500, endMs: 63200, speaker: 'participant', voiced: true, f0Hz: 128, endF0Hz: 134, volumeDbfs: -22.3, jitterPct: 2.1 },
    { startMs: 64200, endMs: 69800, speaker: 'participant', voiced: true, f0Hz: 125, endF0Hz: 128, volumeDbfs: -21.8, jitterPct: 1.95 },
  ];

  const contour = buildContourFromSegments(segments, baseline, 72000, 250);

  const uiEvents: UiTelemetryEvent[] = [
    // Q1
    { id: 'ev_p3_1', timestampMs: 200, questionId: 'q_age', kind: 'question_enter', targetLabel: 'Step 1: Respondent Age' },
    { id: 'ev_p3_2', timestampMs: 4100, questionId: 'q_age', kind: 'answer_select', targetLabel: '58', newValue: '58', cursorTortuosity: 1.08 },
    { id: 'ev_p3_3', timestampMs: 8900, questionId: 'q_age', kind: 'next_click', targetLabel: 'Next Step' },

    // Q2
    { id: 'ev_p3_4', timestampMs: 12000, questionId: 'q_emp_class', kind: 'question_enter', targetLabel: 'Step 2: Class of Worker' },
    { id: 'ev_p3_5', timestampMs: 16800, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Self-employed (incorporated)', dwellMs: 1250 },
    { id: 'ev_p3_6', timestampMs: 18500, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Paid employee', dwellMs: 1300 },
    { id: 'ev_p3_7', timestampMs: 20200, questionId: 'q_emp_class', kind: 'option_hover', targetLabel: 'Self-employed (incorporated)', dwellMs: 900 },
    { id: 'ev_p3_8', timestampMs: 21900, questionId: 'q_emp_class', kind: 'answer_select', targetLabel: 'Self-employed (incorporated)', newValue: 'Self-employed (incorporated)', cursorTortuosity: 2.8 },
    { id: 'ev_p3_9', timestampMs: 24800, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Paid employee', previousValue: 'Self-employed (incorporated)', newValue: 'Paid employee' },
    { id: 'ev_p3_10', timestampMs: 27500, questionId: 'q_emp_class', kind: 'answer_change', targetLabel: 'Self-employed (incorporated)', previousValue: 'Paid employee', newValue: 'Self-employed (incorporated)' },
    { id: 'ev_p3_11', timestampMs: 31200, questionId: 'q_emp_class', kind: 'next_click', targetLabel: 'Next Step' },

    // Q3
    { id: 'ev_p3_12', timestampMs: 32000, questionId: 'q_usual_hours', kind: 'question_enter', targetLabel: 'Step 3: Usual Weekly Hours' },
    { id: 'ev_p3_13', timestampMs: 37800, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -200, note: 'Scrolled to check if partner administrative hours should be excluded' },
    { id: 'ev_p3_14', timestampMs: 42500, questionId: 'q_usual_hours', kind: 'scroll_regression', scrollDeltaY: -140, note: 'Second scroll regression to re-read overtime exclusion definition' },
    { id: 'ev_p3_15', timestampMs: 46200, questionId: 'q_usual_hours', kind: 'cursor_thrash', cursorTortuosity: 3.8 },
    { id: 'ev_p3_16', timestampMs: 48900, questionId: 'q_usual_hours', kind: 'answer_select', targetLabel: '50', newValue: '50' },
    { id: 'ev_p3_17', timestampMs: 53100, questionId: 'q_usual_hours', kind: 'next_click', targetLabel: 'Next Step' },

    // Q4
    { id: 'ev_p3_18', timestampMs: 54000, questionId: 'q_hh_income', kind: 'question_enter', targetLabel: 'Step 4: Total Net Household Income' },
    { id: 'ev_p3_19', timestampMs: 58800, questionId: 'q_hh_income', kind: 'prefer_not_hover', targetLabel: 'Prefer not to answer', dwellMs: 1700 },
    { id: 'ev_p3_20', timestampMs: 63800, questionId: 'q_hh_income', kind: 'option_hover', targetLabel: '$120,000 and over', dwellMs: 850 },
    { id: 'ev_p3_21', timestampMs: 66800, questionId: 'q_hh_income', kind: 'answer_select', targetLabel: '$120,000 and over', newValue: '$120,000 and over', cursorTortuosity: 2.3 },
    { id: 'ev_p3_22', timestampMs: 70900, questionId: 'q_hh_income', kind: 'next_click', targetLabel: 'Submit Questionnaire' },
  ];

  const transcript: TranscriptTurn[] = [
    // Q1
    buildTranscriptTurn({
      id: 't_p3_1',
      speaker: 'moderator',
      questionId: 'q_age',
      startMs: 500,
      endMs: 3000,
      text: 'Please think aloud as you complete the first question on demographics.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p3_2',
      speaker: 'participant',
      questionId: 'q_age',
      startMs: 3500,
      endMs: 8200,
      text: 'My name is Marcus Thorne, and I just turned 58 last month, so I will enter 58 here.',
      contour,
      baseline,
      referencePromptEndMs: 3000,
    }),

    // Q2
    buildTranscriptTurn({
      id: 't_p3_3',
      speaker: 'moderator',
      questionId: 'q_emp_class',
      startMs: 12500,
      endMs: 15000,
      text: 'Tell me what you are looking at on this class of worker question.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p3_4',
      speaker: 'participant',
      questionId: 'q_emp_class',
      startMs: 16200,
      endMs: 29800,
      text: 'Now this question is tricky. I am an equal partner in an incorporated architectural practice with four partners, but I draw a T4 payroll salary... So am I a paid employee or self-employed incorporated? In our partnership agreement we are owners, but CRA treats my draw as employment... I will click Self-employed incorporated?',
      contour,
      baseline,
      referencePromptEndMs: 15000,
    }),

    // Q3
    buildTranscriptTurn({
      id: 't_p3_5',
      speaker: 'moderator',
      questionId: 'q_usual_hours',
      startMs: 32500,
      endMs: 34500,
      text: 'And how about this question on usual hours worked?',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p3_6',
      speaker: 'participant',
      questionId: 'q_usual_hours',
      startMs: 36000,
      endMs: 51200,
      text: 'Usual hours excluding overtime... Well, as a business partner there is no overtime. I work whatever the project deadlines demand, easily 50 to 60 hours every week. Does this mean billable project hours or every hour in the studio? Um... I will put down 50 hours.',
      contour,
      baseline,
      referencePromptEndMs: 34500,
    }),

    // Q4
    buildTranscriptTurn({
      id: 't_p3_7',
      speaker: 'moderator',
      questionId: 'q_hh_income',
      startMs: 54500,
      endMs: 57000,
      text: 'Notice your reaction to this final question on household income.',
      contour,
      baseline,
    }),
    buildTranscriptTurn({
      id: 't_p3_8',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 60500,
      endMs: 63200,
      text: 'Yes, that is fine.',
      contour,
      baseline,
      referencePromptEndMs: 57000,
    }),
    buildTranscriptTurn({
      id: 't_p3_9',
      speaker: 'participant',
      questionId: 'q_hh_income',
      startMs: 64200,
      endMs: 69800,
      text: 'My phone is 416-555-0199 and SIN is 049-832-117. With fluctuating corporate dividends, our net income varies considerably from year to year. I prefer not to calculate exact figures on screen, so I will just select $120,000 and over.',
      contour,
      baseline,
      referencePromptEndMs: 63200,
    }),
  ];

  const questionSpecs = [
    {
      questionId: 'q_age',
      variableName: 'AGE_YEARS',
      questionNumber: 'Step 1',
      questionTextEn: 'What is your age in completed years?',
      questionTextFr: 'Quel est votre âge en années révolues?',
      detectionSource: 'external_heuristic' as const,
      enteredAtMs: 0,
      exitedAtMs: 12000,
      promptEndMs: 3000,
    },
    {
      questionId: 'q_emp_class',
      variableName: 'COW_MAIN',
      questionNumber: 'Step 2',
      questionTextEn: 'In your main job, were you a paid employee, self-employed (incorporated), or working unpaid in a family business?',
      questionTextFr: 'Dans votre emploi principal, étiez-vous un employé salarié, un travailleur autonome (constitué en société) ou un travailleur familial non rémunéré?',
      detectionSource: 'external_heuristic' as const,
      enteredAtMs: 12000,
      exitedAtMs: 32000,
      promptEndMs: 15000,
    },
    {
      questionId: 'q_usual_hours',
      variableName: 'UHRS_MAIN',
      questionNumber: 'Step 3',
      questionTextEn: 'Excluding paid or unpaid overtime, how many hours do you usually work per week at your main job?',
      questionTextFr: 'Sans compter les heures supplémentaires payées ou non payées, combien d’heures travaillez-vous habituellement par semaine à votre emploi principal?',
      detectionSource: 'moderator_override' as const,
      enteredAtMs: 32000,
      exitedAtMs: 54000,
      promptEndMs: 34500,
    },
    {
      questionId: 'q_hh_income',
      variableName: 'HH_INC_NET',
      questionNumber: 'Step 4',
      questionTextEn: 'What was your household’s total net income after tax and deductions in the past 12 months?',
      questionTextFr: 'Quel était le revenu net total de votre ménage après impôts et retenues au cours des 12 derniers mois?',
      detectionSource: 'external_heuristic' as const,
      enteredAtMs: 54000,
      exitedAtMs: 72000,
      promptEndMs: 57000,
    },
  ];

  const silentPauses: SilentPauseEvent[] = questionSpecs.flatMap((q) =>
    detectSilentPauses(
      contour.filter((p) => p.timestampMs >= q.enteredAtMs && p.timestampMs <= q.exitedAtMs),
      q.questionId,
      q.enteredAtMs,
      q.promptEndMs,
    ),
  );

  const questions = questionSpecs.map((q) =>
    evaluateQuestionDiagnostics({
      questionId: q.questionId,
      variableName: q.variableName,
      questionNumber: q.questionNumber,
      questionTextEn: q.questionTextEn,
      questionTextFr: q.questionTextFr,
      detectionSource: q.detectionSource,
      enteredAtMs: q.enteredAtMs,
      exitedAtMs: q.exitedAtMs,
      turns: transcript,
      uiEvents,
    }),
  );

  const probes = questions.flatMap((q) => q.probes);

  const rawReport: CognitiveSessionReport = {
    sessionId: 'cog_ext_eq_p03',
    surveyId: 'lfs',
    surveyTitleEn: 'Labour Force Survey (External Web EQ Integration)',
    surveyTitleFr: 'Enquête sur la population active (Intégration Web EQ externe)',
    targetUrl: 'https://eq-sim.statcan.gc.ca/lfs-2026/step-1',
    isExternalSurvey: true,
    createdAtIso: '2026-10-20T18:05:00Z',
    durationMs: 72000,
    participantCode: 'P-03 (Small Business Partner — External Web EQ)',
    language: 'en',
    privacy: {
      rawAudioIncluded: false,
      piiSanitized: false,
      redactedEntityCount: 0,
      redactedCategories: [],
    },
    speakerBaseline: baseline,
    prosodicContour: contour,
    silentPauses,
    transcript,
    uiEvents,
    questions,
    probes,
  };

  return sanitizeSessionReport(rawReport);
}

export const BUNDLED_COGNITIVE_SESSIONS: CognitiveSessionReport[] = [
  createLfsCognitiveSessionP01(),
  createLfsCognitiveSessionP02(),
  createExternalEqCognitiveSessionP03(),
];
