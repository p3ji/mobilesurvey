/**
 * Types for discovery mode: schema-free testing of arbitrary web questionnaires. Unlike
 * schema-guided mode (types.ts, enumerator.ts), there is no Instrument to enumerate against —
 * the bot must infer the form structure from the live DOM on each page it visits.
 */

export type DiscoveredFieldKind =
  | 'radio-group'
  | 'checkbox-group'
  | 'checkbox-single'
  | 'select'
  | 'textarea'
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'url';

export interface DiscoveredOption {
  label: string;
  value: string;
  /** Selector for this specific option's input element (empty for `<select>` options, which are targeted by value on the parent select). */
  selector: string;
}

/**
 * One discoverable form control (or group of controls sharing a `name`), as inferred purely
 * from DOM inspection — no schema, no variable names, only what's visible/queryable on the page.
 */
export interface DiscoveredField {
  kind: DiscoveredFieldKind;
  /** Best-effort human label: <label for>, wrapping <label>, aria-label, or aria-labelledby text. */
  label: string;
  /** CSS selector that uniquely locates this field (or the group container for grouped kinds). */
  selector: string;
  /** For radio-group/checkbox-group/select: the available options. */
  options?: DiscoveredOption[];
  required: boolean;
  /** Present on numeric/date-like inputs when the DOM declares them. */
  min?: string;
  max?: string;
  maxLength?: number;
}

export interface DiscoveredPage {
  url: string;
  fields: DiscoveredField[];
  /** True if the scanner found a submit/next-like control on the page. */
  hasNextControl: boolean;
}

export type DiscoveryIssueKind =
  | 'NO_PROGRESS'
  | 'NO_FIELDS_NO_NEXT'
  | 'FIELD_FAILED'
  | 'FATAL_ERROR'
  | 'CONSOLE_ERROR'
  | 'MAX_PAGES_EXCEEDED';

export interface DiscoveryIssue {
  kind: DiscoveryIssueKind;
  pageIndex: number;
  message: string;
  detail?: unknown;
}

export interface DiscoveryPageVisit {
  pageIndex: number;
  url: string;
  fieldsDiscovered: number;
  fieldsAnswered: number;
  screenshotBase64?: string;
}

export interface DiscoveryRunResult {
  visits: DiscoveryPageVisit[];
  issues: DiscoveryIssue[];
  /** True once the bot judged the flow finished (no more fields, no next control, or a stable terminal page). */
  reachedEnd: boolean;
  consoleErrorCount: number;
  durationMs: number;
  fatalError?: string;
  completionScreenshot?: string;
}

/**
 * Optional hook for smarter value generation. Given a discovered field, return a value to use
 * instead of the built-in heuristic (return undefined to fall back to the heuristic). This is
 * where an LLM-backed classifier can be plugged in without discovery/runner.ts knowing about it.
 */
export type FieldClassifier = (field: DiscoveredField) => Promise<unknown | undefined>;
