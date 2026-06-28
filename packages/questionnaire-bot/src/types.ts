import type { LanguageCode } from '@mobilesurvey/instrument-schema';

/**
 * How aggressively to enumerate paths through the questionnaire.
 *
 * - `all-paths`  : BFS, every combination of routing-variable values. Exact but exponential —
 *                  use `maxPaths` to cap.
 * - `coverage`   : (default) Greedy — each routing-variable × value pair exercised at least
 *                  once. Scales linearly with the total number of routing values.
 * - `boundary`   : BFS with boundary/edge-case values (min-1, max+1, empty, too-long, etc.)
 *                  instead of all routing values. Targets validation-rule testing.
 * - `n-wise`     : Planned — all N-way combinations of routing-variable values.
 */
export type CoverageStrategy = 'all-paths' | 'coverage' | 'boundary' | 'n-wise';

/**
 * Controls which answer values are generated for a given ResponseDomain.
 *
 * - `routing`   : all values that could change routing/visibility (used by all-paths / coverage)
 * - `canonical` : single "typical" value (used for non-routing questions, or as coverage filler)
 * - `boundary`  : edge-case / boundary values (used by the boundary strategy)
 */
export type GenerationMode = 'routing' | 'canonical' | 'boundary';

/** One answer applied to a single instance key during a scenario run. */
export interface AnswerStep {
  /** Roster-aware storage key, e.g. `memberName@m=1`. */
  instanceKey: string;
  /** Schema variable name as it appears in expressions, e.g. `memberName`. */
  variableRef: string;
  /** The value assigned. */
  value: unknown;
  /** ResponseDomain type tag (`code`, `numeric`, `text`, `markAll`, `grid`, …). */
  domainType: string;
  /** True if this variable appears in any routing/visibility expression or loop count. */
  isRoutingVar: boolean;
}

/**
 * A complete test scenario: an ordered sequence of answers that navigates one unique
 * path through the questionnaire.
 */
export interface Scenario {
  id: string;
  strategy: CoverageStrategy;
  /** Ordered answer steps — apply them in sequence to reproduce this path. */
  steps: AnswerStep[];
  /** Number of pages in the rendered survey for this answer state. */
  pageCount: number;
  /** Total number of answered questions/items in this scenario. */
  questionCount: number;
  /** True if the scenario reached the terminal state (all visible questions answered). */
  complete: boolean;
}

/** Options for `enumeratePaths`. */
export interface EnumeratorOptions {
  /**
   * Coverage strategy to use.
   * @default 'coverage'
   */
  strategy?: CoverageStrategy;
  /**
   * Language to use for flatten/localization (does not affect routing logic).
   * @default instrument.defaultLanguage
   */
  language?: LanguageCode;
  /**
   * Maximum number of scenarios to generate before stopping.
   * @default 200
   */
  maxPaths?: number;
  /**
   * Iteration counts to test for each roster (loop) question.
   * Only used when the loop's countVariableRef is a routing variable.
   * @default [1, 2]
   */
  rosterCounts?: number[];
}
