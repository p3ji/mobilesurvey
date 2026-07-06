export type {
  CoverageStrategy,
  GenerationMode,
  AnswerStep,
  Scenario,
  EnumeratorOptions,
} from './types.js';

export { generateValues, generateCanonicalValue } from './answer-gen.js';

export {
  collectRoutingVariables,
  collectRosterCountVariables,
  enumeratePaths,
} from './enumerator.js';

export { BrowserDriver, type DriverError } from './browser-driver.js';

export { resolveStep, type LocatorStrategy, type ResolvedStep } from './schema-adapter.js';

export {
  runScenario,
  runScenarios,
  type RunOptions,
  type StepResult,
  type ScenarioRunResult,
} from './runner.js';

export {
  buildReport,
  formatReportText,
  type Report,
  type Issue,
  type IssueKind,
} from './reporter.js';
