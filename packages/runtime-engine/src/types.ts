import type { LanguageCode, QuestionConstruct } from '@mobilesurvey/instrument-schema';

/** One level of roster nesting: a loop variable bound to a 1-based iteration index. */
export interface ScopeEntry {
  name: string;
  index: number;
}

export type Scope = ScopeEntry[];

/** A fired validation edit, localized to the active language. */
export interface FiredEdit {
  id: string;
  type: 'hard' | 'soft';
  message: string;
}

/** One category entry inside a `markAll` render item. */
export interface MarkAllCategory {
  code: string;
  label: string;
  /** Storage key for this specific dichotomous variable, e.g. `Q01_A@m=1`. */
  instanceKey: string;
  /** Dichotomous code: 1=yes, 2=no, 6=valid skip, 7=don't know, 9=not stated. */
  value: number | undefined;
}

/** One row inside a `grid` render item. */
export interface GridRow {
  code: string;
  label: string;
  /** Storage key for this row's answer, e.g. `G01_A@m=1`. */
  instanceKey: string;
  /** Selected column code, or undefined if unanswered. */
  value: string | undefined;
}

/** One cell inside a `table` render item (indexed as `cells[rowIdx][colIdx]`). */
export interface TableCell {
  /** Storage key for input cells (`PREFIX_ROW_COL@scope`); synthetic total name for computed cells. */
  instanceKey: string;
  value: number | undefined;
  /** Authored as non-enterable: shown shaded, never answered. */
  disabled: boolean;
  /** Computed total cell — read-only, value recomputed live. */
  computed: boolean;
}

/**
 * A flattened, render-ready item. The designer preview maps these straight onto components; the
 * future runtime EQ paginates over them.
 */
export type RenderItem =
  | { kind: 'section'; key: string; title: string; depth: number }
  | { kind: 'statement'; key: string; text: string; depth: number }
  | { kind: 'loopHeading'; key: string; title: string; depth: number }
  | {
      /** Page boundary emitted by a Sequence with `isPage: true`. */
      kind: 'pageBreak';
      key: string;
      title: string;
    }
  | {
      kind: 'question';
      key: string;
      /** Storage key for this specific roster instance (e.g. `memberName@m=1`). */
      instanceKey: string;
      construct: QuestionConstruct;
      text: string;
      instruction?: string;
      tooltip?: string;
      value: unknown;
      firedEdits: FiredEdit[];
      depth: number;
    }
  | {
      /**
       * DDI MultipleResponseDomain — each checkbox stores to its own dichotomous variable
       * `{variablePrefix}_{code}` using DICHOTOMOUS_CODES values (1=yes, 2=no…).
       */
      kind: 'markAll';
      key: string;
      constructId: string;
      variablePrefix: string;
      questionText: string;
      instruction?: string;
      categories: MarkAllCategory[];
      firedEdits: FiredEdit[];
      depth: number;
    }
  | {
      /** Question grid (matrix): rows × shared column scale, one variable per row. */
      kind: 'grid';
      key: string;
      constructId: string;
      variablePrefix: string;
      questionText: string;
      instruction?: string;
      rows: GridRow[];
      columns: { code: string; label: string }[];
      firedEdits: FiredEdit[];
      depth: number;
    }
  | {
      /**
       * Establishment data table: rows × columns of numeric entry cells, one variable per
       * enabled cell (`{prefix}_{row}_{col}`), with optional computed total row/column
       * (row/col code `TOT`). Counts as one question for numbering.
       */
      kind: 'table';
      key: string;
      constructId: string;
      variablePrefix: string;
      questionText: string;
      instruction?: string;
      /** Localized unit caption, e.g. "thousands of dollars". */
      unit?: string;
      decimals?: number;
      min?: number;
      max?: number;
      required?: boolean;
      /** Includes the appended total row/col (code `TOT`, `isTotal: true`) when enabled. */
      rows: { code: string; label: string; isTotal?: boolean }[];
      columns: { code: string; label: string; isTotal?: boolean }[];
      /** Aligned with `rows` × `columns`. */
      cells: TableCell[][];
      firedEdits: FiredEdit[];
      depth: number;
    }
  | {
      /**
       * Device-location capture (sensor module). The base variable holds a pipeable text
       * summary; `subKeys` are the storage keys of the generated `_LAT/_LON/_ACC/_TS/_SRC`
       * sub-variables for this roster instance. `consent` mirrors the session-global
       * `CONSENT_GEOLOCATION` reserved variable (stored at `consentKey`).
       */
      kind: 'geolocation';
      key: string;
      constructId: string;
      questionText: string;
      instruction?: string;
      required?: boolean;
      /** Storage key of the base summary variable (this roster instance). */
      instanceKey: string;
      value: string | undefined;
      subKeys: { lat: string; lon: string; acc: string; ts: string; src: string };
      /** Current `_SRC` value: 'gps' | 'manual' | 'declined' | undefined. */
      src: string | undefined;
      consent: 'granted' | 'declined' | undefined;
      consentKey: string;
      /** Localized consent-card text from the instrument's sensor declaration. */
      purpose: string;
      retention?: string;
      precision: number;
      maxAccuracyM?: number;
      manualFallback: boolean;
      firedEdits: FiredEdit[];
      depth: number;
    }
  | {
      /**
       * Camera capture (sensor module). The base variable holds the attachment ref
       * (storage path); `subKeys` are the `_TS/_SRC` sub-variable storage keys. `consent`
       * mirrors the session-global `CONSENT_CAMERA` reserved variable.
       */
      kind: 'photo';
      key: string;
      constructId: string;
      questionText: string;
      instruction?: string;
      required?: boolean;
      /** Storage key of the base ref variable (this roster instance). */
      instanceKey: string;
      /** Stored attachment ref, or undefined until a photo is uploaded. */
      value: string | undefined;
      subKeys: { ts: string; src: string };
      /** Current `_SRC` value: 'camera' | 'library' | 'declined' | undefined. */
      src: string | undefined;
      consent: 'granted' | 'declined' | undefined;
      consentKey: string;
      purpose: string;
      retention?: string;
      facing: 'environment' | 'user';
      allowLibrary: boolean;
      maxEdgePx: number;
      firedEdits: FiredEdit[];
      depth: number;
    };

/** The serializable runtime state the engine operates on. */
export interface RuntimeState {
  /** Answers keyed by roster-aware instance key. */
  responses: Record<string, unknown>;
  /** Pre-fill / sample context (raw sample fields, e.g. `contact_name`). */
  sample: Record<string, unknown>;
  language: LanguageCode;
}
