/**
 * Path enumerator: given an Instrument, produces a list of Scenarios — each representing one
 * unique navigable path through the questionnaire.
 *
 * Pure TypeScript; no browser or network required.  The browser driver (Phase B) consumes these
 * Scenarios to drive a real survey UI and compare expected vs actual.
 */
import { variablesUsed } from '@mobilesurvey/expression-engine';
import type { ControlConstruct, Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { flattenInstrument, paginate } from '@mobilesurvey/runtime-engine';
import type { RenderItem, RuntimeState } from '@mobilesurvey/runtime-engine';
import { generateValues } from './answer-gen.js';
import type { AnswerStep, CoverageStrategy, EnumeratorOptions, GenerationMode, Scenario } from './types.js';

// ─── Internal resolved options ────────────────────────────────────────────────

interface ResolvedOptions {
  strategy: CoverageStrategy;
  language: LanguageCode;
  maxPaths: number;
  rosterCounts: number[];
}

function resolveOptions(instrument: Instrument, options: EnumeratorOptions = {}): ResolvedOptions {
  return {
    strategy: options.strategy ?? 'coverage',
    language: options.language ?? instrument.defaultLanguage,
    maxPaths: options.maxPaths ?? 200,
    rosterCounts: options.rosterCounts ?? [1, 2],
  };
}

// ─── Static instrument analysis ───────────────────────────────────────────────

/**
 * Returns the set of variable names that appear in any routing or visibility expression.
 * These are the variables whose values must be varied to explore different paths.
 */
export function collectRoutingVariables(instrument: Instrument): Set<string> {
  const vars = new Set<string>();

  function addExpr(expr: string | undefined): void {
    if (expr) variablesUsed(expr).forEach((v) => vars.add(v));
  }

  function visit(node: ControlConstruct): void {
    switch (node.type) {
      case 'sequence':
        addExpr(node.visibleWhen);
        node.children.forEach(visit);
        break;
      case 'question':
        addExpr(node.visibleWhen);
        break;
      case 'ifThenElse':
        addExpr(node.condition);
        node.then.forEach(visit);
        node.else?.forEach(visit);
        break;
      case 'loop':
        addExpr(node.visibleWhen);
        if (node.countVariableRef) vars.add(node.countVariableRef);
        if (node.loopWhile) addExpr(node.loopWhile);
        node.children.forEach(visit);
        break;
      case 'statement':
        addExpr(node.visibleWhen);
        break;
      case 'computation':
        // Computation outputs can feed into routing expressions downstream.
        vars.add(node.targetVariableRef);
        addExpr(node.expression);
        break;
    }
  }

  visit(instrument.sequence);
  return vars;
}

/**
 * Returns the set of variable names used as `countVariableRef` in any loop construct.
 * When enumerating paths, we use `rosterCounts` values for these instead of the full
 * routing value set, to avoid runaway roster expansion.
 */
export function collectRosterCountVariables(instrument: Instrument): Set<string> {
  const vars = new Set<string>();

  function visit(node: ControlConstruct): void {
    if (node.type === 'loop' && node.countVariableRef) {
      vars.add(node.countVariableRef);
    }
    if (node.type === 'sequence') node.children.forEach(visit);
    if (node.type === 'ifThenElse') {
      node.then.forEach(visit);
      node.else?.forEach(visit);
    }
    if (node.type === 'loop') node.children.forEach(visit);
  }

  visit(instrument.sequence);
  return vars;
}

// ─── Unanswered item detection ────────────────────────────────────────────────

function isItemAnswered(item: RenderItem, responses: Record<string, unknown>): boolean {
  if (item.kind === 'question') return responses[item.instanceKey] !== undefined;
  if (item.kind === 'markAll') return item.categories.every((c) => responses[c.instanceKey] !== undefined);
  if (item.kind === 'grid') return item.rows.every((r) => responses[r.instanceKey] !== undefined);
  if (item.kind === 'table')
    return item.cells
      .flat()
      .filter((c) => !c.disabled && !c.computed)
      .every((c) => responses[c.instanceKey] !== undefined);
  // Sensor questions: unanswered until the consent decision exists; after that, granted
  // needs a capture (base variable), declined needs the manual fallback when offered
  // (photo has none — a declined photo question is simply skippable).
  if (item.kind === 'geolocation') {
    if (item.consent === undefined) return responses[item.consentKey] !== undefined;
    if (item.consent === 'declined' && !item.manualFallback) return true;
    return responses[item.instanceKey] !== undefined;
  }
  if (item.kind === 'photo') {
    if (item.consent === undefined) return responses[item.consentKey] !== undefined;
    if (item.consent === 'declined') return true;
    return responses[item.instanceKey] !== undefined;
  }
  return true; // sections, statements, headings, pageBreaks need no answer
}

function findFirstUnanswered(
  items: RenderItem[],
  responses: Record<string, unknown>,
): RenderItem | undefined {
  return items.find((item) => !isItemAnswered(item, responses));
}

// ─── Answer candidate generation ──────────────────────────────────────────────

/** One set of (instanceKey → value) pairs that fills an unanswered item. */
interface AnswerCandidate {
  answers: Record<string, unknown>;
  steps: AnswerStep[];
}

/**
 * Generate one or more AnswerCandidates for an unanswered RenderItem.
 *
 * - Routing questions in `routing`/`boundary` mode produce N candidates (one per value).
 * - Non-routing questions always produce exactly one candidate (canonical value).
 * - markAll blocks produce two candidates when any category is a routing var (all-yes / all-no).
 * - Grid blocks always produce one candidate (first column code for all rows).
 * - If `targetOverride` is set and matches the item's variableRef, that exact value is used.
 */
function generateCandidates(
  item: RenderItem,
  instrument: Instrument,
  routingVars: Set<string>,
  rosterVars: Set<string>,
  options: ResolvedOptions,
  mode: GenerationMode,
  targetOverride?: { variableRef: string; value: unknown },
): AnswerCandidate[] {
  if (item.kind === 'question') {
    const varRef = item.construct.variableRef;
    const domain = item.construct.responseDomain;
    const isRouting = routingVars.has(varRef);
    const isRoster = rosterVars.has(varRef);

    // Target override: force a specific value regardless of mode.
    if (targetOverride?.variableRef === varRef) {
      const value = targetOverride.value;
      return [
        {
          answers: { [item.instanceKey]: value },
          steps: [
            {
              instanceKey: item.instanceKey,
              variableRef: varRef,
              value,
              domainType: domain.type,
              isRoutingVar: true,
            },
          ],
        },
      ];
    }

    let values: unknown[];
    if (isRoster) {
      values = options.rosterCounts;
    } else if (mode === 'canonical') {
      values = generateValues(domain, instrument, 'canonical');
    } else if (mode === 'boundary') {
      // Boundary strategy targets validation-rule testing on every field, not just
      // routing variables — edit rules commonly live on non-branching questions
      // (e.g. an NPS score or age field that never affects visibility).
      values = generateValues(domain, instrument, 'boundary');
    } else if (isRouting) {
      values = generateValues(domain, instrument, mode);
    } else {
      values = generateValues(domain, instrument, 'canonical');
    }

    if (!values.length) {
      // Fallback for unhandleable domain types (file, etc.)
      values = [null];
    }

    return values.map((value) => ({
      answers: { [item.instanceKey]: value },
      steps: [
        {
          instanceKey: item.instanceKey,
          variableRef: varRef,
          value,
          domainType: domain.type,
          isRoutingVar: isRouting || isRoster,
        },
      ],
    }));
  }

  if (item.kind === 'markAll') {
    const isAnyRouting = item.categories.some((c) =>
      routingVars.has(`${item.variablePrefix}_${c.code}`),
    );

    if (isAnyRouting && mode !== 'canonical') {
      // Branch: all-selected (1=yes) and none-selected (2=no)
      const buildCandidate = (selectedValue: 1 | 2): AnswerCandidate => {
        const answers: Record<string, unknown> = {};
        const steps: AnswerStep[] = [];
        for (const cat of item.categories) {
          answers[cat.instanceKey] = selectedValue;
          steps.push({
            instanceKey: cat.instanceKey,
            variableRef: `${item.variablePrefix}_${cat.code}`,
            value: selectedValue,
            domainType: 'markAll',
            isRoutingVar: true,
          });
        }
        return { answers, steps };
      };
      return [buildCandidate(1), buildCandidate(2)];
    }

    // Canonical: all selected (1=yes)
    const answers: Record<string, unknown> = {};
    const steps: AnswerStep[] = [];
    for (const cat of item.categories) {
      answers[cat.instanceKey] = 1;
      steps.push({
        instanceKey: cat.instanceKey,
        variableRef: `${item.variablePrefix}_${cat.code}`,
        value: 1,
        domainType: 'markAll',
        isRoutingVar: false,
      });
    }
    return [{ answers, steps }];
  }

  if (item.kind === 'grid') {
    const firstColCode = item.columns[0]?.code ?? '';
    const answers: Record<string, unknown> = {};
    const steps: AnswerStep[] = [];
    for (const row of item.rows) {
      if (answers[row.instanceKey] === undefined) {
        answers[row.instanceKey] = firstColCode;
        steps.push({
          instanceKey: row.instanceKey,
          variableRef: `${item.variablePrefix}_${row.code}`,
          value: firstColCode,
          domainType: 'grid',
          isRoutingVar: false,
        });
      }
    }
    return [{ answers, steps }];
  }

  if (item.kind === 'table') {
    const fill = item.min ?? 1;
    const answers: Record<string, unknown> = {};
    const steps: AnswerStep[] = [];
    for (const cell of item.cells.flat()) {
      if (cell.disabled || cell.computed) continue;
      if (answers[cell.instanceKey] === undefined) {
        answers[cell.instanceKey] = fill;
        steps.push({
          instanceKey: cell.instanceKey,
          variableRef: cell.instanceKey.split('@')[0] ?? cell.instanceKey,
          value: fill,
          domainType: 'table',
          isRoutingVar: false,
        });
      }
    }
    return [{ answers, steps }];
  }

  // Sensor questions answer in two rounds: first the consent decision (both branches
  // enumerated outside canonical mode — consent is routable via $CONSENT_*), then the
  // capture itself, filled with deterministic bot values mirroring the runtime mocks.
  if (item.kind === 'geolocation' || item.kind === 'photo') {
    const step = (instanceKey: string, variableRef: string, value: unknown, isRoutingVar: boolean): AnswerStep => ({
      instanceKey,
      variableRef,
      value,
      domainType: item.kind,
      isRoutingVar,
    });
    const consentVar = item.consentKey.split('@')[0] ?? item.consentKey;
    if (item.consent === undefined) {
      const isRouting = routingVars.has(consentVar);
      const decide = (decision: 'granted' | 'declined'): AnswerCandidate => ({
        answers: { [item.consentKey]: decision },
        steps: [step(item.consentKey, consentVar, decision, isRouting)],
      });
      return mode === 'canonical' && !isRouting ? [decide('granted')] : [decide('granted'), decide('declined')];
    }
    const baseVar = item.instanceKey.split('@')[0] ?? item.instanceKey;
    if (item.kind === 'geolocation') {
      if (item.consent === 'declined') {
        // manualFallback is guaranteed here (no-fallback declines were "answered" above).
        return [{
          answers: { [item.instanceKey]: 'Bot City', [item.subKeys.src]: 'declined' },
          steps: [step(item.instanceKey, baseVar, 'Bot City', routingVars.has(baseVar))],
        }];
      }
      const f = 10 ** item.precision;
      const lat = Math.round(45.42153 * f) / f;
      const lon = Math.round(-75.697193 * f) / f;
      return [{
        answers: {
          [item.instanceKey]: `${lat}, ${lon} (±12 m)`,
          [item.subKeys.lat]: lat,
          [item.subKeys.lon]: lon,
          [item.subKeys.acc]: 12,
          [item.subKeys.ts]: '2026-01-01T00:00:00.000Z',
          [item.subKeys.src]: 'gps',
        },
        steps: [step(item.instanceKey, baseVar, `${lat}, ${lon} (±12 m)`, routingVars.has(baseVar))],
      }];
    }
    // photo, consent granted: mock ref (+ one confirmed recognition item when configured).
    const answers: Record<string, unknown> = {
      [item.instanceKey]: `bot/${item.constructId}.jpg`,
      [item.subKeys.ts]: '2026-01-01T00:00:00.000Z',
      [item.subKeys.src]: 'camera',
    };
    if (item.recognition) {
      const p = item.recognition.variablePrefix;
      const suffix = item.recognition.scopeSuffix;
      const k = (name: string) => `${name}@${suffix}`;
      answers[k(`${p}_N_ITEMS`)] = 1;
      answers[k(`${p}_I1_LABEL`)] = item.recognition.itemOptions?.[0]?.code ?? 'Bot item';
      answers[k(`${p}_I1_QTY`)] = 1;
      answers[k(`${p}_I1_UNIT`)] = 'serving';
      answers[k(`${p}_I1_CONF`)] = 1;
    }
    return [{
      answers,
      steps: [step(item.instanceKey, baseVar, answers[item.instanceKey], routingVars.has(baseVar))],
    }];
  }

  return [{ answers: {}, steps: [] }];
}

// ─── Scenario assembly ────────────────────────────────────────────────────────

function makeRuntimeState(responses: Record<string, unknown>, language: LanguageCode): RuntimeState {
  return { responses, sample: {}, language };
}

function assembleScenario(
  id: string,
  strategy: CoverageStrategy,
  steps: AnswerStep[],
  responses: Record<string, unknown>,
  language: LanguageCode,
  instrument: Instrument,
): Scenario {
  const { items } = flattenInstrument(instrument, makeRuntimeState(responses, language));
  const { pages } = paginate(items);
  return {
    id,
    strategy,
    steps,
    pageCount: pages.length,
    questionCount: steps.length,
    complete: findFirstUnanswered(items, responses) === undefined,
  };
}

// ─── Strategy: all-paths (BFS) ────────────────────────────────────────────────

function enumerateAllPaths(
  instrument: Instrument,
  routingVars: Set<string>,
  rosterVars: Set<string>,
  options: ResolvedOptions,
  mode: GenerationMode,
): Scenario[] {
  interface SearchState {
    responses: Record<string, unknown>;
    steps: AnswerStep[];
  }

  const queue: SearchState[] = [{ responses: {}, steps: [] }];
  const scenarios: Scenario[] = [];

  while (queue.length > 0 && scenarios.length < options.maxPaths) {
    const state = queue.shift()!;
    const { items } = flattenInstrument(
      instrument,
      makeRuntimeState(state.responses, options.language),
    );

    const unanswered = findFirstUnanswered(items, state.responses);

    if (!unanswered) {
      scenarios.push(
        assembleScenario(
          `scenario-${scenarios.length + 1}`,
          options.strategy,
          state.steps,
          state.responses,
          options.language,
          instrument,
        ),
      );
      continue;
    }

    const candidates = generateCandidates(
      unanswered,
      instrument,
      routingVars,
      rosterVars,
      options,
      mode,
    );

    for (const candidate of candidates) {
      queue.push({
        responses: { ...state.responses, ...candidate.answers },
        steps: [...state.steps, ...candidate.steps],
      });
    }
  }

  return scenarios;
}

// ─── Strategy: coverage (greedy per routing-variable × value) ─────────────────

function getFallbackKey(item: RenderItem): string {
  if (item.kind === 'question') return item.instanceKey;
  if (item.kind === 'geolocation' || item.kind === 'photo')
    return item.consent === undefined ? item.consentKey : item.instanceKey;
  if (item.kind === 'markAll') return item.categories[0]?.instanceKey ?? '';
  if (item.kind === 'grid') return item.rows[0]?.instanceKey ?? '';
  if (item.kind === 'table')
    return item.cells.flat().find((c) => !c.disabled && !c.computed)?.instanceKey ?? '';
  return '';
}

/**
 * Run a single directed path through the instrument.
 *
 * All questions use canonical values, except:
 *  - Roster count vars use `rosterCounts[0]` (the smallest roster for the first scenario).
 *  - When `targetOverride` is set, that specific variable gets the target value.
 *
 * Returns null only on pathological infinite-loop detection (>10 000 steps).
 */
function runDirectedPath(
  instrument: Instrument,
  routingVars: Set<string>,
  rosterVars: Set<string>,
  options: ResolvedOptions,
  targetOverride?: { variableRef: string; value: unknown },
): Scenario | null {
  const responses: Record<string, unknown> = {};
  const steps: AnswerStep[] = [];
  let targetConsumed = false;

  for (let guard = 0; guard < 10_000; guard++) {
    const { items } = flattenInstrument(
      instrument,
      makeRuntimeState(responses, options.language),
    );

    const unanswered = findFirstUnanswered(items, responses);
    if (!unanswered) {
      return assembleScenario(
        `directed-${Date.now()}`,
        options.strategy,
        steps,
        responses,
        options.language,
        instrument,
      );
    }

    const override = targetConsumed ? undefined : targetOverride;
    const candidates = generateCandidates(
      unanswered,
      instrument,
      routingVars,
      rosterVars,
      options,
      'canonical',
      override,
    );

    const candidate = candidates[0];
    if (!candidate || !candidate.steps.length) {
      // Unhandleable item (e.g. empty file domain) — assign null and skip
      const fallbackKey = getFallbackKey(unanswered);
      if (fallbackKey) responses[fallbackKey] = null;
      continue;
    }

    Object.assign(responses, candidate.answers);
    steps.push(...candidate.steps);

    // Once the target variable has been answered, stop overriding subsequent questions.
    if (targetOverride && !targetConsumed) {
      targetConsumed = steps.some(
        (s) =>
          s.variableRef === targetOverride.variableRef &&
          JSON.stringify(s.value) === JSON.stringify(targetOverride.value),
      );
    }
  }

  return null; // guard tripped — shouldn't happen on well-formed instruments
}

/**
 * Build the coverage map: for each routing variable, the set of values (JSON-serialised)
 * that need to be exercised to achieve full coverage.
 */
function buildCoverageMap(
  instrument: Instrument,
  routingVars: Set<string>,
  rosterVars: Set<string>,
  options: ResolvedOptions,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  function scan(node: ControlConstruct): void {
    if (node.type === 'question' && routingVars.has(node.variableRef)) {
      const varRef = node.variableRef;
      if (!map.has(varRef)) {
        const values = rosterVars.has(varRef)
          ? options.rosterCounts
          : generateValues(node.responseDomain, instrument, 'routing');
        if (values.length > 0) {
          map.set(varRef, new Set(values.map((v) => JSON.stringify(v))));
        }
      }
    }
    if (node.type === 'sequence') node.children.forEach(scan);
    if (node.type === 'ifThenElse') {
      node.then.forEach(scan);
      node.else?.forEach(scan);
    }
    if (node.type === 'loop') node.children.forEach(scan);
  }

  scan(instrument.sequence);
  return map;
}

function enumerateCoverage(
  instrument: Instrument,
  routingVars: Set<string>,
  rosterVars: Set<string>,
  options: ResolvedOptions,
): Scenario[] {
  const tocover = buildCoverageMap(instrument, routingVars, rosterVars, options);
  const scenarios: Scenario[] = [];

  // Targets that couldn't be reached (unreachable from default path) — skip after one attempt.
  const failedTargets = new Set<string>();

  while (scenarios.length < options.maxPaths) {
    // Find the next (varRef, value) pair not yet covered.
    let target: { variableRef: string; value: unknown } | undefined;
    for (const [varRef, remaining] of tocover.entries()) {
      if (remaining.size === 0) continue;
      const valueStr = remaining.values().next().value!;
      const key = `${varRef}:${valueStr}`;
      if (failedTargets.has(key)) continue;
      target = { variableRef: varRef, value: JSON.parse(valueStr) as unknown };
      break;
    }

    if (!target) break; // all covered (or remaining are unreachable)

    const scenario = runDirectedPath(instrument, routingVars, rosterVars, options, target);

    if (!scenario) break; // guard tripped

    const scenarioId = `scenario-${scenarios.length + 1}`;
    scenarios.push({ ...scenario, id: scenarioId });

    // Update coverage: mark every (varRef, value) pair exercised in this scenario.
    for (const step of scenario.steps) {
      const remaining = tocover.get(step.variableRef);
      if (remaining) {
        remaining.delete(JSON.stringify(step.value));
        if (remaining.size === 0) tocover.delete(step.variableRef);
      }
    }

    // Check if the target was actually covered; if not, mark it as failed.
    const targetKey = `${target.variableRef}:${JSON.stringify(target.value)}`;
    const wasCovered = scenario.steps.some(
      (s) =>
        s.variableRef === target!.variableRef &&
        JSON.stringify(s.value) === JSON.stringify(target!.value),
    );
    if (!wasCovered) {
      failedTargets.add(targetKey);
    }
  }

  // If there are no routing variables at all, run exactly one canonical path.
  if (scenarios.length === 0) {
    const scenario = runDirectedPath(instrument, routingVars, rosterVars, options);
    if (scenario) {
      scenarios.push({ ...scenario, id: 'scenario-1' });
    }
  }

  return scenarios;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Enumerate test scenarios for the given instrument.
 *
 * Each Scenario contains an ordered list of AnswerSteps that, when applied sequentially,
 * drive the instrument through one unique path — useful for both headless assertion (Phase A)
 * and browser-driven testing (Phase B).
 *
 * @example
 * ```ts
 * const scenarios = enumeratePaths(demoInstrument, { strategy: 'coverage' });
 * for (const s of scenarios) {
 *   console.log(s.id, s.pageCount, 'pages', s.questionCount, 'questions', s.complete ? '✓' : '✗');
 * }
 * ```
 */
export function enumeratePaths(instrument: Instrument, options?: EnumeratorOptions): Scenario[] {
  const resolved = resolveOptions(instrument, options);
  const routingVars = collectRoutingVariables(instrument);
  const rosterVars = collectRosterCountVariables(instrument);

  switch (resolved.strategy) {
    case 'all-paths':
      return enumerateAllPaths(instrument, routingVars, rosterVars, resolved, 'routing');

    case 'coverage':
      return enumerateCoverage(instrument, routingVars, rosterVars, resolved);

    case 'boundary':
      return enumerateAllPaths(instrument, routingVars, rosterVars, resolved, 'boundary');

    case 'n-wise':
      // TODO Phase C: implement proper N-wise enumeration.
      // Falls back to coverage for now.
      return enumerateCoverage(instrument, routingVars, rosterVars, resolved);
  }
}
