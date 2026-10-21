/**
 * @mobilesurvey/cognitive-lab — Multimodal 4-Construct Cognitive Diagnostic Engine
 * & Real-Time Bilingual Moderator Probe Generator.
 *
 * Maps synchronized voice prosody (pitch F0, volume ΔdB, silent/filled pauses,
 * uptalk slope, vocal sentiment) and UI movement telemetry (answer switching,
 * hover oscillation, scroll regressions, cursor tortuosity) onto Tourangeau's
 * 4 cognitive response constructs:
 *   1. Comprehension Difficulty
 *   2. Retrieval Burden
 *   3. Sensitivity / Discomfort
 *   4. Response Mapping Confusion
 */

import { summarizeQuestionBehavior } from './telemetry.js';
import type {
  CognitiveConstructId,
  CognitiveSessionReport,
  ConstructDiagnostic,
  ModeratorProbeSuggestion,
  QuestionBehavioralSummary,
  QuestionCognitiveDiagnostic,
  SeverityLevel,
  TranscriptTurn,
  UiTelemetryEvent,
  VocalSentimentLabel,
} from './types.js';

export function scoreToSeverity(score: number): SeverityLevel {
  if (score >= 68) return 'high';
  if (score >= 42) return 'moderate';
  if (score >= 20) return 'low';
  return 'none';
}

function clampScore(val: number): number {
  return Math.max(0, Math.min(100, Math.round(val)));
}

/**
 * Evaluate a single survey question window by fusing participant `TranscriptTurn[]`
 * and `UiTelemetryEvent[]` into a `QuestionCognitiveDiagnostic`.
 */
export function evaluateQuestionDiagnostics(params: {
  questionId: string;
  variableName?: string;
  questionNumber: string;
  questionTextEn: string;
  questionTextFr: string;
  detectionSource?: 'mobilesurvey_dom' | 'external_heuristic' | 'moderator_override';
  enteredAtMs: number;
  exitedAtMs: number;
  turns: ReadonlyArray<TranscriptTurn>;
  uiEvents: ReadonlyArray<UiTelemetryEvent>;
}): QuestionCognitiveDiagnostic {
  const {
    questionId,
    variableName,
    questionNumber,
    questionTextEn,
    questionTextFr,
    detectionSource = 'mobilesurvey_dom',
    enteredAtMs,
    exitedAtMs,
    turns,
    uiEvents,
  } = params;

  // Strictly filter to PARTICIPANT speech turns for this question
  const participantTurns = turns.filter(
    (t) => t.questionId === questionId && t.speaker === 'participant',
  );

  const behavior: QuestionBehavioralSummary = summarizeQuestionBehavior(
    questionId,
    enteredAtMs,
    exitedAtMs,
    uiEvents,
  );

  // Aggregate acoustic summary across participant turns on this question
  const preResponseSilenceMs =
    participantTurns.length > 0
      ? Math.max(...participantTurns.map((t) => t.prosody.preResponseSilenceMs))
      : 0;

  const totalMidPauseMs = participantTurns.reduce(
    (sum, t) => sum + t.prosody.longestMidPauseMs,
    0,
  );

  const meanPitchDeltaSt =
    participantTurns.length > 0
      ? Number(
          (
            participantTurns.reduce((s, t) => s + t.prosody.meanPitchDeltaSt, 0) /
            participantTurns.length
          ).toFixed(2),
        )
      : 0;

  let peakPitchDeltaSt = 0;
  for (const t of participantTurns) {
    if (Math.abs(t.prosody.peakPitchDeltaSt) > Math.abs(peakPitchDeltaSt)) {
      peakPitchDeltaSt = t.prosody.peakPitchDeltaSt;
    }
  }

  const maxTerminalUptalkSt =
    participantTurns.length > 0
      ? Math.max(0, ...participantTurns.map((t) => t.prosody.terminalPitchSlopeSt))
      : 0;

  const meanVolumeDeltaDb =
    participantTurns.length > 0
      ? Number(
          (
            participantTurns.reduce((s, t) => s + t.prosody.meanVolumeDeltaDb, 0) /
            participantTurns.length
          ).toFixed(2),
        )
      : 0;

  const minVolumeDeltaDb =
    participantTurns.length > 0
      ? Math.min(...participantTurns.map((t) => t.prosody.minVolumeDeltaDb))
      : 0;

  const speechRateRatio =
    participantTurns.length > 0
      ? Number(
          (
            participantTurns.reduce((s, t) => s + t.prosody.speechRateRatio, 0) /
            participantTurns.length
          ).toFixed(2),
        )
      : 1.0;

  const filledPauseCount = participantTurns.reduce(
    (s, t) => s + t.prosody.filledPauseCount,
    0,
  );
  const hedgeCount = participantTurns.reduce((s, t) => s + t.prosody.hedgeCount, 0);
  const clarificationMarkers = participantTurns.flatMap(
    (t) => t.prosody.clarificationMarkers,
  );
  const hasLexicalProsodicIncongruence = participantTurns.some(
    (t) => t.sentiment.lexicalProsodicIncongruence,
  );

  const meanJitterPct =
    participantTurns.length > 0
      ? participantTurns.reduce((s, t) => s + t.prosody.meanJitterPct, 0) /
        participantTurns.length
      : 0;

  // Determine dominant sentiment across participant turns
  const sentimentPriority: VocalSentimentLabel[] = [
    'uncomfortable_withdrawn',
    'frustrated_tense',
    'uncertain_hesitant',
    'cognitively_strained',
    'neutral_steady',
    'confident_fluent',
  ];
  let dominantSentiment: VocalSentimentLabel = 'neutral_steady';
  for (const cand of sentimentPriority) {
    if (participantTurns.some((t) => t.sentiment.label === cand)) {
      dominantSentiment = cand;
      break;
    }
  }

  // ── 1. COMPREHENSION DIFFICULTY ────────────────────────────────────────────
  let compRaw = 0;
  const compEvidence: string[] = [];
  if (clarificationMarkers.length > 0) {
    compRaw += 44;
    compEvidence.push(
      `Verbal clarification request: "${clarificationMarkers[0]}"`,
    );
  }
  if (behavior.scrollRegressions > 0) {
    compRaw += Math.min(34, behavior.scrollRegressions * 18);
    compEvidence.push(
      `${behavior.scrollRegressions} upward scroll regression(s) to re-read question stem`,
    );
  }
  if (speechRateRatio > 0 && speechRateRatio <= 0.78) {
    compRaw += 22;
    compEvidence.push(
      `Slowed speech cadence (${Math.round(speechRateRatio * 100)}% of baseline WPM while reading/interpreting)`,
    );
  }
  if (behavior.timeToFirstInteractionMs >= 5500) {
    compRaw += 18;
    compEvidence.push(
      `Extended initial reading latency before first pointer action (${(
        behavior.timeToFirstInteractionMs / 1000
      ).toFixed(1)}s)`,
    );
  }
  if (behavior.cursorTortuosity >= 3.2) {
    compRaw += 16;
    compEvidence.push(
      `High cursor search tortuosity (${behavior.cursorTortuosity.toFixed(1)}× straight-line path)`,
    );
  }
  const compScore = clampScore(compRaw);

  // ── 2. RETRIEVAL BURDEN ────────────────────────────────────────────────────
  let retRaw = 0;
  const retEvidence: string[] = [];
  if (totalMidPauseMs >= 1400) {
    retRaw += Math.min(38, Math.round(totalMidPauseMs / 75));
    retEvidence.push(
      `Extended mid-utterance recall pause (${(totalMidPauseMs / 1000).toFixed(1)}s silence mid-answer)`,
    );
  }
  if (preResponseSilenceMs >= 2200) {
    retRaw += Math.min(28, Math.round(preResponseSilenceMs / 130));
    retEvidence.push(
      `Long pre-response silent latency (${(preResponseSilenceMs / 1000).toFixed(1)}s before speaking)`,
    );
  }
  if (filledPauseCount >= 2) {
    retRaw += Math.min(24, filledPauseCount * 8);
    const sampleTokens = participantTurns
      .flatMap((t) => t.prosody.filledPauses)
      .slice(0, 3)
      .join(', ');
    retEvidence.push(
      `${filledPauseCount} filled pauses (${sampleTokens}) during memory retrieval`,
    );
  }
  if (hedgeCount >= 1) {
    retRaw += Math.min(24, hedgeCount * 12);
    const sampleHedges = participantTurns
      .flatMap((t) => t.prosody.hedges)
      .slice(0, 2)
      .map((h) => `"${h}"`)
      .join(', ');
    retEvidence.push(
      `${hedgeCount} epistemic estimation hedge(s) (${sampleHedges})`,
    );
  }
  const retScore = clampScore(retRaw);

  // ── 3. SENSITIVITY / DISCOMFORT ────────────────────────────────────────────
  let sensRaw = 0;
  const sensEvidence: string[] = [];
  // Require volume drop to be corroborated by pitch shift, hesitation, or avoidance hover
  // to avoid false alarms from simple posture drift / head movement away from laptop mic
  const isCorroboratedVolumeDrop =
    minVolumeDeltaDb <= -4.5 &&
    (peakPitchDeltaSt >= 2.0 ||
      hasLexicalProsodicIncongruence ||
      behavior.hoveredPreferNotToAnswer ||
      preResponseSilenceMs >= 1500 ||
      filledPauseCount >= 1);
  if (isCorroboratedVolumeDrop) {
    sensRaw += Math.min(40, Math.round(Math.abs(minVolumeDeltaDb) * 5.2));
    sensEvidence.push(
      `Corroborated vocal withdrawal: volume dropped ${minVolumeDeltaDb.toFixed(1)} dB below speaker baseline alongside hesitation/pitch markers`,
    );
  }
  if (peakPitchDeltaSt >= 3.0) {
    sensRaw += Math.min(30, Math.round(peakPitchDeltaSt * 6.5));
    sensEvidence.push(
      `Acute pitch elevation (+${peakPitchDeltaSt.toFixed(1)} semitones above baseline F0)`,
    );
  }
  if (meanJitterPct >= 1.8) {
    sensRaw += 16;
    sensEvidence.push(
      `Elevated vocal perturbation (${meanJitterPct.toFixed(2)}% period variance indicating acoustic strain)`,
    );
  }
  if (hasLexicalProsodicIncongruence) {
    sensRaw += 24;
    const reason = participantTurns.find((t) => t.sentiment.lexicalProsodicIncongruence)
      ?.sentiment.incongruenceReason;
    sensEvidence.push(
      reason ?? 'Lexical-prosodic incongruence: compliant words paired with strained voice envelope',
    );
  }
  if (behavior.hoveredPreferNotToAnswer) {
    sensRaw += 26;
    sensEvidence.push(
      'Pointer hovered on "Prefer not to answer / Refuse" option before responding',
    );
  }
  const sensScore = clampScore(sensRaw);

  // ── 4. RESPONSE MAPPING CONFUSION ──────────────────────────────────────────
  let mapRaw = 0;
  const mapEvidence: string[] = [];
  if (behavior.answerChanges >= 1) {
    mapRaw += Math.min(42, behavior.answerChanges * 24);
    mapEvidence.push(
      `Switched selected answer ${behavior.answerChanges}× (${behavior.answerSequence.join(' → ')})`,
    );
  }
  if (behavior.hoverOscillations >= 1) {
    mapRaw += Math.min(34, behavior.hoverOscillations * 17);
    mapEvidence.push(
      `Pointer oscillated ${behavior.hoverOscillations}× between competing options (${behavior.oscillatingOptions.join(' ↔ ')})`,
    );
  }
  if (maxTerminalUptalkSt >= 2.5) {
    mapRaw += Math.min(28, Math.round(maxTerminalUptalkSt * 7));
    mapEvidence.push(
      `Declarative uptalk (+${maxTerminalUptalkSt.toFixed(1)} st rising terminal pitch when stating chosen category)`,
    );
  }
  if (behavior.postSelectDelayMs >= 2600) {
    mapRaw += 16;
    mapEvidence.push(
      `${(behavior.postSelectDelayMs / 1000).toFixed(1)}s verification hesitation between selecting option and clicking Next`,
    );
  }
  const mapScore = clampScore(mapRaw);

  const constructs: Record<CognitiveConstructId, ConstructDiagnostic> = {
    comprehension: {
      construct: 'comprehension',
      labelEn: 'Comprehension & Terminology',
      labelFr: 'Compréhension et terminologie',
      score: compScore,
      severity: scoreToSeverity(compScore),
      evidence: compEvidence,
      recommendationEn:
        compScore >= 42
          ? 'Simplify technical terms in the question stem, add an inline definition or inclusion/exclusion note, and shorten subordinate clauses.'
          : 'Question wording and terminology were read fluently without re-reading regressions.',
      recommendationFr:
        compScore >= 42
          ? 'Simplifiez les termes techniques dans l’énoncé, ajoutez une définition ou une note d’inclusion/exclusion et raccourcissez les phrases complexes.'
          : 'L’énoncé et la terminologie ont été lus avec fluidité sans retour en arrière.',
    },
    retrieval: {
      construct: 'retrieval',
      labelEn: 'Memory Retrieval & Recall Burden',
      labelFr: 'Effort de rappel et de mémoire',
      score: retScore,
      severity: scoreToSeverity(retScore),
      evidence: retEvidence,
      recommendationEn:
        retScore >= 42
          ? 'Consider shortening the recall reference period, offering ranges/brackets instead of exact figures, or decomposing the calculation into simpler sub-items.'
          : 'Recall latency and vocal fluency indicate manageable memory retrieval burden.',
      recommendationFr:
        retScore >= 42
          ? 'Raccourcissez la période de référence, proposez des tranches plutôt qu’un montant exact ou décomposez le calcul en sous-questions.'
          : 'Le délai de réponse et la fluidité vocale indiquent un effort de mémoire raisonnable.',
    },
    sensitivity: {
      construct: 'sensitivity',
      labelEn: 'Sensitivity & Vocal Discomfort',
      labelFr: 'Sensibilité et inconfort vocal',
      score: sensScore,
      severity: scoreToSeverity(sensScore),
      evidence: sensEvidence,
      recommendationEn:
        sensScore >= 42
          ? 'Soften the question preamble with a confidentiality reassurance, use broad categories instead of exact values, and ensure an explicit "Prefer not to answer" option.'
          : 'No acoustic withdrawal, pitch tension, or avoidance behavior detected.',
      recommendationFr:
        sensScore >= 42
          ? 'Ajoutez un rappel de confidentialité en préambule, utilisez des tranches larges et assurez la présence d’une option « Préfère ne pas répondre ».'
          : 'Aucun retrait vocal, tension tonale ou comportement d’évitement détecté.',
    },
    mapping: {
      construct: 'mapping',
      labelEn: 'Response Category Mapping',
      labelFr: 'Correspondance des catégories de réponse',
      score: mapScore,
      severity: scoreToSeverity(mapScore),
      evidence: mapEvidence,
      recommendationEn:
        mapScore >= 42
          ? `Clarify boundary definitions between ${
              behavior.oscillatingOptions.length >= 2
                ? behavior.oscillatingOptions.map((o) => `"${o}"`).join(' and ')
                : 'competing response categories'
            } to ensure mutually exclusive, exhaustive options.`
          : 'Respondent mapped their answer cleanly to the available response categories.',
      recommendationFr:
        mapScore >= 42
          ? `Clarifiez la frontière entre ${
              behavior.oscillatingOptions.length >= 2
                ? behavior.oscillatingOptions.map((o) => `« ${o} »`).join(' et ')
                : 'les catégories de réponse concurrentes'
            } pour garantir des choix mutuellement exclusifs.`
          : 'Le répondant a associé sa réponse sans ambiguïté aux catégories proposées.',
    },
  };

  const orderedConstructs = (Object.values(constructs) as ConstructDiagnostic[]).sort(
    (a, b) => b.score - a.score,
  );
  const top = orderedConstructs[0]!;
  const second = orderedConstructs[1]!;
  const overallFrictionScore = clampScore(top.score * 0.75 + second.score * 0.25);
  const overallSeverity = scoreToSeverity(overallFrictionScore);
  const dominantConstruct = top.score >= 25 ? top.construct : null;

  // Generate context-aware moderator probes for any construct scoring >= 42
  const probes: ModeratorProbeSuggestion[] = [];
  for (const c of orderedConstructs) {
    if (c.score < 42) continue;
    probes.push(
      buildProbeForConstruct({
        questionId,
        questionNumber,
        questionTextEn,
        construct: c,
        behavior,
        preResponseSilenceMs,
        totalMidPauseMs,
        peakPitchDeltaSt,
        minVolumeDeltaDb,
        maxTerminalUptalkSt,
        exitedAtMs,
      }),
    );
  }

  return {
    questionId,
    variableName,
    questionNumber,
    questionTextEn,
    questionTextFr,
    detectionSource,
    enteredAtMs,
    exitedAtMs,
    overallFrictionScore,
    overallSeverity,
    dominantConstruct,
    constructs,
    acousticSummary: {
      participantTurnCount: participantTurns.length,
      preResponseSilenceMs,
      totalMidPauseMs,
      meanPitchDeltaSt,
      peakPitchDeltaSt,
      maxTerminalUptalkSt,
      meanVolumeDeltaDb,
      minVolumeDeltaDb,
      speechRateRatio,
      filledPauseCount,
      hedgeCount,
      dominantSentiment,
      hasLexicalProsodicIncongruence,
    },
    behavioralSummary: behavior,
    probes,
  };
}

function buildProbeForConstruct(params: {
  questionId: string;
  questionNumber: string;
  questionTextEn: string;
  construct: ConstructDiagnostic;
  behavior: QuestionBehavioralSummary;
  preResponseSilenceMs: number;
  totalMidPauseMs: number;
  peakPitchDeltaSt: number;
  minVolumeDeltaDb: number;
  maxTerminalUptalkSt: number;
  exitedAtMs: number;
}): ModeratorProbeSuggestion {
  const {
    questionId,
    questionNumber,
    questionTextEn,
    construct,
    behavior,
    preResponseSilenceMs,
    totalMidPauseMs,
    peakPitchDeltaSt,
    minVolumeDeltaDb,
    maxTerminalUptalkSt,
    exitedAtMs,
  } = params;

  const id = `probe_${questionId}_${construct.construct}`;
  const shortLabel = `${questionNumber}: ${questionTextEn.slice(0, 64)}`;

  switch (construct.construct) {
    case 'mapping': {
      const opts =
        behavior.oscillatingOptions.length >= 2
          ? behavior.oscillatingOptions.slice(0, 2).join(' and ')
          : behavior.answerSequence.length >= 2
            ? behavior.answerSequence.slice(0, 2).join(' and ')
            : 'the response options';
      return {
        id,
        timestampMs: exitedAtMs,
        questionId,
        questionLabel: shortLabel,
        construct: 'mapping',
        severity: construct.severity,
        triggerSummaryEn: `Switched/oscillated between ${opts} with +${maxTerminalUptalkSt.toFixed(1)} st rising pitch`,
        triggerSummaryFr: `Hésitation entre ${opts} avec hausse tonale finale de +${maxTerminalUptalkSt.toFixed(1)} demi-tons`,
        probeTextEn: `I noticed you looked closely at both ${opts} before deciding—in your own words, how were you distinguishing between those options?`,
        probeTextFr: `J’ai remarqué que vous avez hésité entre ${opts} avant de choisir — dans vos propres mots, comment faisiez-vous la distinction entre ces choix?`,
      };
    }
    case 'comprehension': {
      return {
        id,
        timestampMs: exitedAtMs,
        questionId,
        questionLabel: shortLabel,
        construct: 'comprehension',
        severity: construct.severity,
        triggerSummaryEn: `${behavior.scrollRegressions} stem re-read regression(s) & slowed reading cadence`,
        triggerSummaryFr: `${behavior.scrollRegressions} retour(s) à l’énoncé et ralentissement du débit vocal`,
        probeTextEn: `In your own words, what is this question asking for, and did any instructions feel ambiguous?`,
        probeTextFr: `Dans vos propres mots, que vous demande cette question et certaines consignes semblaient-elles ambiguës?`,
      };
    }
    case 'retrieval': {
      const pauseSec = ((preResponseSilenceMs + totalMidPauseMs) / 1000).toFixed(1);
      return {
        id,
        timestampMs: exitedAtMs,
        questionId,
        questionLabel: shortLabel,
        construct: 'retrieval',
        severity: construct.severity,
        triggerSummaryEn: `${pauseSec}s cumulative recall silence + estimation hedges`,
        triggerSummaryFr: `${pauseSec} s de pause de réflexion + marqueurs d’approximation`,
        probeTextEn: `Walk me through how you came up with that number—were you estimating from memory or thinking of specific records?`,
        probeTextFr: `Pouvez-vous m’expliquer comment vous êtes arrivé à ce chiffre — s’agissait-il d’une estimation de mémoire ou pensiez-vous à des documents précis?`,
      };
    }
    case 'sensitivity': {
      return {
        id,
        timestampMs: exitedAtMs,
        questionId,
        questionLabel: shortLabel,
        construct: 'sensitivity',
        severity: construct.severity,
        triggerSummaryEn: `Volume drop (${minVolumeDeltaDb.toFixed(1)} dB) & pitch shift (+${peakPitchDeltaSt.toFixed(1)} st)`,
        triggerSummaryFr: `Baisse de volume (${minVolumeDeltaDb.toFixed(1)} dB) et hausse de hauteur (+${peakPitchDeltaSt.toFixed(1)} dt)`,
        probeTextEn: `How comfortable did you feel answering this question as worded, and do you think other respondents might hesitate here?`,
        probeTextFr: `Dans quelle mesure étiez-vous à l’aise de répondre à cette question telle que formulée, et pensez-vous que d’autres répondants pourraient hésiter ici?`,
      };
    }
  }
}

/**
 * Roll up multiple cognitive interview sessions into a Cross-Participant Question Heatmap
 * to reveal systemic questionnaire design flaws across 2–15 participants.
 */
export interface CrossParticipantQuestionRow {
  questionId: string;
  questionNumber: string;
  questionTextEn: string;
  questionTextFr: string;
  participantCount: number;
  meanOverallScore: number;
  highSeverityCount: number;
  affectedRatio: string;
  issueSummaryEn: string;
  issueSummaryFr: string;
  meanConstructScores: Record<CognitiveConstructId, number>;
  dominantConstruct: CognitiveConstructId | null;
}

export function aggregateCrossParticipantHeatmap(
  sessions: ReadonlyArray<CognitiveSessionReport>,
): CrossParticipantQuestionRow[] {
  const byQuestion = new Map<
    string,
    {
      questionNumber: string;
      questionTextEn: string;
      questionTextFr: string;
      diagnostics: QuestionCognitiveDiagnostic[];
    }
  >();

  for (const session of sessions) {
    for (const q of session.questions) {
      const existing = byQuestion.get(q.questionId);
      if (existing) {
        existing.diagnostics.push(q);
      } else {
        byQuestion.set(q.questionId, {
          questionNumber: q.questionNumber,
          questionTextEn: q.questionTextEn,
          questionTextFr: q.questionTextFr,
          diagnostics: [q],
        });
      }
    }
  }

  const rows: CrossParticipantQuestionRow[] = [];
  for (const [questionId, group] of byQuestion.entries()) {
    const n = group.diagnostics.length;
    const meanOverallScore = Math.round(
      group.diagnostics.reduce((s, d) => s + d.overallFrictionScore, 0) / n,
    );
    const highSeverityCount = group.diagnostics.filter(
      (d) => d.overallSeverity === 'high' || d.overallSeverity === 'moderate',
    ).length;

    const meanConstructScores: Record<CognitiveConstructId, number> = {
      comprehension: Math.round(
        group.diagnostics.reduce((s, d) => s + d.constructs.comprehension.score, 0) / n,
      ),
      retrieval: Math.round(
        group.diagnostics.reduce((s, d) => s + d.constructs.retrieval.score, 0) / n,
      ),
      sensitivity: Math.round(
        group.diagnostics.reduce((s, d) => s + d.constructs.sensitivity.score, 0) / n,
      ),
      mapping: Math.round(
        group.diagnostics.reduce((s, d) => s + d.constructs.mapping.score, 0) / n,
      ),
    };

    const sortedConstructs = (
      Object.entries(meanConstructScores) as Array<[CognitiveConstructId, number]>
    ).sort((a, b) => b[1] - a[1]);

    const dominant = sortedConstructs[0]![1] >= 25 ? sortedConstructs[0]![0] : null;

    let issueSummaryEn = 'Fluent responding; no systemic friction observed.';
    let issueSummaryFr = 'Réponses fluides; aucune friction systémique observée.';
    if (dominant === 'mapping') {
      issueSummaryEn = 'Systemic option ambiguity: respondents oscillated between competing categories.';
      issueSummaryFr = 'Ambiguïté systémique : les répondants ont oscillé entre des choix concurrents.';
    } else if (dominant === 'comprehension') {
      issueSummaryEn = 'Complex phrasing: multiple upward scroll regressions to re-read instructions.';
      issueSummaryFr = 'Formulation complexe : retours répétés pour relire l’énoncé.';
    } else if (dominant === 'retrieval') {
      issueSummaryEn = 'Heavy recall burden: extended thinking pauses and estimation hedges.';
      issueSummaryFr = 'Effort de mémoire élevé : longues pauses de réflexion et approximations.';
    } else if (dominant === 'sensitivity') {
      issueSummaryEn = 'Vocal reluctance: drop in response volume and hesitation on sensitive item.';
      issueSummaryFr = 'Réticence vocale : baisse du volume de réponse et hésitation.';
    }

    rows.push({
      questionId,
      questionNumber: group.questionNumber,
      questionTextEn: group.questionTextEn,
      questionTextFr: group.questionTextFr,
      participantCount: n,
      meanOverallScore,
      highSeverityCount,
      affectedRatio: `${highSeverityCount} / ${n} (${Math.round((highSeverityCount / Math.max(1, n)) * 100)}%)`,
      issueSummaryEn,
      issueSummaryFr,
      meanConstructScores,
      dominantConstruct: dominant,
    });
  }

  return rows;
}
