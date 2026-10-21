/**
 * @mobilesurvey/cognitive-lab — Behavioral UI Movement Telemetry &
 * Universal Question Segmentation Engine (native @mobilesurvey + external web surveys).
 */

import type { QuestionBehavioralSummary, UiTelemetryEvent } from './types.js';

/**
 * Compute cursor path tortuosity: ratio of total trajectory distance to the
 * straight-line Euclidean distance between start and end points.
 * Returns 1.0 for straight lines or < 2 points.
 */
export function computeCursorTortuosity(
  points: ReadonlyArray<{ x: number; y: number }>,
): number {
  if (points.length < 2) return 1.0;
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    pathLength += Math.hypot(dx, dy);
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chordLength = Math.max(24, Math.hypot(last.x - first.x, last.y - first.y));
  return Number(Math.max(1.0, pathLength / chordLength).toFixed(2));
}

/**
 * Detect alternating option hover oscillations (e.g. Option A -> Option B -> Option A)
 * within a question's UI telemetry stream.
 */
export function detectHoverOscillations(events: ReadonlyArray<UiTelemetryEvent>): {
  oscillationCount: number;
  oscillatingOptions: string[];
} {
  // Filter to meaningful option hovers (dwell >= 150ms or explicit hover event)
  const hovers = events.filter(
    (e) =>
      e.kind === 'option_hover' &&
      Boolean(e.targetLabel) &&
      (e.dwellMs === undefined || e.dwellMs >= 150),
  );

  // Deduplicate consecutive identical targets
  const sequence: string[] = [];
  for (const h of hovers) {
    const target = h.targetLabel!;
    if (sequence[sequence.length - 1] !== target) {
      sequence.push(target);
    }
  }

  let oscillationCount = 0;
  const involved = new Set<string>();
  for (let i = 2; i < sequence.length; i++) {
    if (sequence[i] === sequence[i - 2] && sequence[i] !== sequence[i - 1]) {
      oscillationCount++;
      involved.add(sequence[i]!);
      involved.add(sequence[i - 1]!);
    }
  }

  return {
    oscillationCount,
    oscillatingOptions: [...involved],
  };
}

/**
 * Aggregate raw UI telemetry events within a question window into a structured
 * `QuestionBehavioralSummary`.
 */
export function summarizeQuestionBehavior(
  questionId: string,
  enteredAtMs: number,
  exitedAtMs: number,
  allEvents: ReadonlyArray<UiTelemetryEvent>,
): QuestionBehavioralSummary {
  const qEvents = allEvents
    .filter((e) => e.questionId === questionId && e.timestampMs >= enteredAtMs && e.timestampMs <= exitedAtMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const totalDwellMs = Math.max(0, exitedAtMs - enteredAtMs);

  const interactiveEvents = qEvents.filter((e) => e.kind !== 'question_enter');
  const firstInteractive = interactiveEvents[0];
  const timeToFirstInteractionMs = firstInteractive
    ? Math.max(0, firstInteractive.timestampMs - enteredAtMs)
    : totalDwellMs;

  const selectionEvents = qEvents.filter(
    (e) => e.kind === 'answer_select' || e.kind === 'answer_change',
  );
  const lastSelection = selectionEvents[selectionEvents.length - 1];
  const nextClick = qEvents.find((e) => e.kind === 'next_click');
  const postSelectDelayMs = lastSelection
    ? Math.max(0, (nextClick ? nextClick.timestampMs : exitedAtMs) - lastSelection.timestampMs)
    : 0;

  const answerSequence: string[] = [];
  for (const sel of selectionEvents) {
    const val = sel.newValue ?? sel.targetLabel;
    if (val && answerSequence[answerSequence.length - 1] !== val) {
      answerSequence.push(val);
    }
  }
  const answerChanges = Math.max(
    qEvents.filter((e) => e.kind === 'answer_change').length,
    Math.max(0, answerSequence.length - 1),
  );

  const { oscillationCount, oscillatingOptions } = detectHoverOscillations(qEvents);

  const tortuosityValues = qEvents
    .map((e) => e.cursorTortuosity)
    .filter((v): v is number => typeof v === 'number' && v >= 1);
  const cursorTortuosity =
    tortuosityValues.length > 0
      ? Number(Math.max(...tortuosityValues).toFixed(2))
      : 1.15;

  const scrollRegressions = qEvents.filter(
    (e) => e.kind === 'scroll_regression' || (typeof e.scrollDeltaY === 'number' && e.scrollDeltaY < -40),
  ).length;

  const hoveredPreferNotToAnswer = qEvents.some(
    (e) =>
      e.kind === 'prefer_not_hover' ||
      (e.kind === 'option_hover' &&
        /prefer\s+not|refus|skip|ne\s+pas\s+r[ée]pondre/i.test(e.targetLabel ?? '')),
  );

  const backtrackCount = qEvents.filter((e) => e.kind === 'prev_backtrack').length;

  return {
    questionId,
    enteredAtMs,
    exitedAtMs,
    totalDwellMs,
    timeToFirstInteractionMs,
    postSelectDelayMs,
    answerChanges,
    answerSequence,
    hoverOscillations: oscillationCount,
    oscillatingOptions,
    cursorTortuosity,
    scrollRegressions,
    hoveredPreferNotToAnswer,
    backtrackCount,
  };
}

/**
 * Snapshot of active DOM metadata extracted by the Playwright observer script.
 */
export interface DomQuestionSnapshot {
  url: string;
  /** Native @mobilesurvey attribute (`data-question-id`) if present. */
  dataQuestionId?: string | null;
  /** Native @mobilesurvey variable attribute (`data-variable-ref`) if present. */
  dataVariableRef?: string | null;
  /** Closest `<fieldset>` legend text or `[role="group"]` / `[role="radiogroup"]` accessible label. */
  fieldsetLegend?: string | null;
  /** Primary visible question heading (`h1`, `h2`, `h3`, `.question-title`, `.q-text`). */
  visibleHeading?: string | null;
  /** Moderator manual bookmark override if triggered. */
  moderatorOverrideId?: string | null;
  moderatorOverrideLabel?: string | null;
}

/**
 * Universal Question Segmentation Resolver:
 * Supports both native `@mobilesurvey` instruments (`data-question-id`) and arbitrary
 * external web questionnaires (StatCan EQ, Qualtrics, legacy forms) via DOM heuristics,
 * plus one-click Moderator overrides.
 */
export function resolveActiveQuestionFromDomSnapshot(snapshot: DomQuestionSnapshot): {
  questionId: string;
  variableName?: string;
  questionText: string;
  detectionSource: 'mobilesurvey_dom' | 'external_heuristic' | 'moderator_override';
} {
  // 1. Moderator one-click override takes highest priority
  if (snapshot.moderatorOverrideId) {
    return {
      questionId: snapshot.moderatorOverrideId,
      questionText: snapshot.moderatorOverrideLabel || snapshot.visibleHeading || snapshot.moderatorOverrideId,
      detectionSource: 'moderator_override',
    };
  }

  // 2. Native @mobilesurvey instrument DOM attributes
  if (snapshot.dataQuestionId) {
    return {
      questionId: snapshot.dataQuestionId,
      variableName: snapshot.dataVariableRef ?? undefined,
      questionText:
        snapshot.fieldsetLegend || snapshot.visibleHeading || snapshot.dataQuestionId,
      detectionSource: 'mobilesurvey_dom',
    };
  }

  // 3. External Web Questionnaire Heuristic (fieldset legend -> visible heading -> URL slug)
  const rawLabel = (snapshot.fieldsetLegend || snapshot.visibleHeading || '').trim();
  if (rawLabel) {
    const slug = rawLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36);
    return {
      questionId: `ext_${slug || 'question'}`,
      questionText: rawLabel,
      detectionSource: 'external_heuristic',
    };
  }

  // Fallback to URL path/query hash
  let urlSlug = 'page_1';
  try {
    const parsed = new URL(snapshot.url, 'http://localhost');
    const stepParam =
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('step') ||
      parsed.searchParams.get('page') ||
      parsed.hash.replace(/^#/, '');
    const candidate = stepParam || parsed.pathname.split('/').filter(Boolean).pop() || 'page_1';
    urlSlug = candidate.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'page_1';
  } catch {
    urlSlug = 'page_1';
  }

  return {
    questionId: `ext_${urlSlug}`,
    questionText: `External Survey Step (${urlSlug})`,
    detectionSource: 'external_heuristic',
  };
}
