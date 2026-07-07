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
  formatReportHtml,
  type Report,
  type Issue,
  type IssueKind,
} from './reporter.js';

// ── Discovery mode: schema-free testing of non-mobilesurvey web questionnaires ─────────────

export type {
  DiscoveredFieldKind,
  DiscoveredOption,
  DiscoveredField,
  DiscoveredPage,
  DiscoveryIssueKind,
  DiscoveryIssue,
  DiscoveryPageVisit,
  DiscoveryRunResult,
  FieldClassifier,
} from './discovery/types.js';

export { scanPage } from './discovery/scanner.js';

export { generateDiscoveryValue } from './discovery/value-gen.js';

export { runDiscoverySession, type DiscoveryRunOptions } from './discovery/runner.js';

export {
  buildDiscoveryReport,
  formatDiscoveryReportText,
  formatDiscoveryReportHtml,
  type DiscoveryReport,
} from './discovery/reporter.js';
