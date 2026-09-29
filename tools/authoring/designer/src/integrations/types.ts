/**
 * Integration boundary (the spec's data-flow diagram). The interfaces now live in
 * `@mobilesurvey/runtime-engine` so the designer and the standalone respondent runtime share one
 * contract; this module re-exports them for local imports and the mock implementations.
 */
export type {
  SampleUnit,
  SampleProvider,
  CmsClient,
  ParadataEvent,
  ParadataSink,
  SessionStore,
} from '@mobilesurvey/runtime-engine';
