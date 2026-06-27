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
    };

/** The serializable runtime state the engine operates on. */
export interface RuntimeState {
  /** Answers keyed by roster-aware instance key. */
  responses: Record<string, unknown>;
  /** Pre-fill / sample context (raw sample fields, e.g. `contact_name`). */
  sample: Record<string, unknown>;
  language: LanguageCode;
}
