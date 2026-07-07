/**
 * `@mobilesurvey/validation-engine` — post-collection data editing & validation. See
 * docs/validator-plan.md for the full design and rationale.
 */
export * from './types.js';
export { baseName } from './keys.js';
export { walkQuestions } from './walkQuestions.js';
export { buildFieldRegistry, runMetadataChecks } from './metadataChecks.js';
export { runInstrumentEditRerun } from './editRerun.js';
export { runValidatorRules } from './ruleRunner.js';
export {
  runOutlierChecks,
  runDuplicateChecks,
  runSpeederChecks,
  runStraightLineChecks,
  computeMissingness,
} from './statChecks.js';
export { applyCorrections } from './corrections.js';
export { computeImpact, finalizeFlags } from './score.js';
export { runValidation, type RunValidationInput } from './run.js';
