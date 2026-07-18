/**
 * DDI-aligned instrument specification (TypeScript source of truth).
 *
 * Every structural element maps to a DDI-Lifecycle / Codebook metadata object; the mapping is
 * documented in `docs/phase1-schema.md`. The Zod mirror in `./zod.ts` is the runtime-validation
 * source of truth and is kept structurally identical to these types.
 */

/** BCP-47 language code, e.g. 'en', 'fr', 'es'. */
export type LanguageCode = string;

/**
 * DDI *InternationalString*: a label/text/tooltip/message keyed by language. Every
 * human-visible string in the instrument is multilingual at the metadata layer so the runtime
 * can toggle language instantly without losing state.
 */
export type InternationalString = Record<LanguageCode, string>;

/** Stable identifier for a metadata object (URN-like; unique within its scheme). */
export type Id = string;

/**
 * Expression source text evaluated by `@mobilesurvey/expression-engine`. An empty string means
 * "always true / no condition". Used for routing, visibility, derived computation and edits.
 */
export type Expression = string;

/** DDI *Concept*: the idea a question/variable measures. */
export interface Concept {
  id: Id;
  label: InternationalString;
  description?: InternationalString;
}

/** DDI *Universe*: the population in scope for a construct. */
export interface Universe {
  id: Id;
  label: InternationalString;
  /** Optional membership clause (expression) describing who belongs to this universe. */
  clause?: Expression;
}

/** A single code in a code list (DDI *Category* + *Code*). */
export interface Category {
  code: string;
  label: InternationalString;
}

/** DDI *CategoryScheme* / *CodeList*: a reusable code list backing coded response domains. */
export interface CategoryScheme {
  id: Id;
  label: InternationalString;
  categories: Category[];
}

/**
 * DDI *Variable* role.
 * - `collected`: answered by the respondent.
 * - `hidden`: background variable not shown; holds administrative values/flags.
 * - `derived`: computed mid-interview from other variables via `compute`.
 */
export type VariableKind = 'collected' | 'hidden' | 'derived';

/** Representation family of a variable / response domain. */
export type RepresentationType = 'code' | 'numeric' | 'text' | 'datetime' | 'boolean' | 'file';

/** DDI *Variable* / *RepresentedVariable*. */
export interface Variable {
  id: Id;
  /** Machine name referenced from expressions as `$name`. Must be unique. */
  name: string;
  kind: VariableKind;
  label: InternationalString;
  representation: RepresentationType;
  conceptRef?: Id;
  /** For `code` representation: the backing category scheme. */
  categorySchemeRef?: Id;
  /** For `hidden`/`derived` variables: the expression that computes the value. */
  compute?: Expression;
  /** When true, this variable is suppressed in self-administered mode and shown only to interviewers. */
  interviewerOnly?: boolean;
  /** When true, any collected value is considered personally identifiable information (PII)
   *  and must be redacted before sharing or exporting. */
  isPII?: boolean;
}

/**
 * Conventional reserved codes for dichotomous (mark-all) variables.
 * 1=yes/checked, 2=no/not-selected, 6=valid skip, 7=don't know, 9=not stated/missing.
 */
export const DICHOTOMOUS_CODES = {
  YES: 1,
  NO: 2,
  VALID_SKIP: 6,
  DONT_KNOW: 7,
  NOT_STATED: 9,
} as const;

/**
 * DDI *ResponseDomain*. A discriminated union over representation families.
 * `lookup` is a coded domain rendered with the advanced-search UI (auto-suggest / fuzzy /
 * hierarchical routing).
 * `markAll` (DDI *MultipleResponseDomain*) explodes each category into its own dichotomous
 * variable `{variablePrefix}_{code}`, stored using `DICHOTOMOUS_CODES` values.
 */
export type ResponseDomain =
  | { type: 'code'; categorySchemeRef: Id; selection: 'single' | 'multiple' }
  | { type: 'numeric'; min?: number; max?: number; decimals?: number; unit?: InternationalString }
  | { type: 'text'; multiline?: boolean; maxLength?: number; pattern?: string }
  | { type: 'datetime'; mode: 'date' | 'time' | 'datetime' }
  | { type: 'boolean' }
  | { type: 'file'; accept?: string[]; maxSizeMb?: number }
  | { type: 'lookup'; categorySchemeRef: Id; hierarchical?: boolean }
  | {
      type: 'markAll';
      categorySchemeRef: Id;
      /** Prefix for the auto-generated dichotomous variables, e.g. `Q01` → Q01_A, Q01_B … */
      variablePrefix: string;
    }
  | {
      /**
       * Question grid (matrix): rows from `rowSchemeRef`, shared column scale from `colSchemeRef`.
       * Auto-generates one code variable per row: `{variablePrefix}_{rowCode}` = selected col code.
       */
      type: 'grid';
      rowSchemeRef: Id;
      colSchemeRef: Id;
      variablePrefix: string;
    }
  | {
      /**
       * Establishment data table: rows from `rowSchemeRef` × columns from `colSchemeRef`,
       * every cell a numeric entry. Auto-generates one numeric variable per enabled cell:
       * `{variablePrefix}_{rowCode}_{colCode}`. When `totalRow`/`totalCol` are set, computed
       * total cells are derived live (never stored) and are referenceable in expressions and
       * piping as `{variablePrefix}_{rowCode}_TOT`, `{variablePrefix}_TOT_{colCode}` and
       * `{variablePrefix}_TOT_TOT` (`TOT` is a reserved code — see `TABLE_TOTAL_CODE`).
       * Group subtotals ("Total – Spirits" … "Total – Wines") are modeled as one table per
       * group, each with its own total row.
       */
      type: 'table';
      rowSchemeRef: Id;
      colSchemeRef: Id;
      variablePrefix: string;
      /** Unit caption shown with the table, e.g. "thousands of dollars". */
      unit?: InternationalString;
      /** Decimal places for entry/formatting of cells (default 0). */
      decimals?: number;
      /** Optional bounds applied to every input cell. */
      min?: number;
      max?: number;
      /** Append a computed "Total" row (column sums). */
      totalRow?: boolean;
      /** Append a computed "Total" column (row sums). */
      totalCol?: boolean;
      /** Cells that cannot be answered, as "ROWCODE:COLCODE". */
      disabledCells?: string[];
    };

/** Reserved category code for computed total row/column cells in `table` response domains. */
export const TABLE_TOTAL_CODE = 'TOT' as const;

/** Hard edits block progression; soft edits warn but allow a confirmed override. */
export type EditType = 'hard' | 'soft';

/**
 * A validation rule. `when` is an expression that, when it evaluates **true**, means the edit
 * has fired (i.e. the data is in violation) and `message` should be shown.
 */
export interface EditRule {
  id: Id;
  type: EditType;
  when: Expression;
  message: InternationalString;
  /** Names of the variables this edit relates to (drives focus / highlighting). */
  scope?: string[];
}

/** DDI *QuestionConstruct* referencing a *QuestionItem*. */
export interface QuestionConstruct {
  type: 'question';
  id: Id;
  /** Name of the variable this question collects. */
  variableRef: string;
  /** Question text. May contain `${var}` piping tokens resolved at runtime. */
  text: InternationalString;
  instruction?: InternationalString;
  tooltip?: InternationalString;
  responseDomain: ResponseDomain;
  required?: boolean;
  edits?: EditRule[];
  /** Conditional visibility (expression). Empty/undefined = always visible. */
  visibleWhen?: Expression;
  /** When true, this question is suppressed in self-administered mode and shown only to interviewers. */
  interviewerOnly?: boolean;
}

/** DDI *Sequence* control construct: an ordered group of children (a section/block). */
export interface SequenceConstruct {
  type: 'sequence';
  id: Id;
  label?: InternationalString;
  children: ControlConstruct[];
  visibleWhen?: Expression;
  /** When true this sequence is a page boundary — the runtime renders one page at a time. */
  isPage?: boolean;
  /**
   * Designates this sequence as an interviewer administration module:
   * - `entry`: pre-interview validation (phone/address confirm); runs before the main survey.
   * - `main`: core survey content (default for sequences without a tag).
   * - `exit`: post-interview housekeeping (household phone enumeration); runs after main completes.
   * Entry and exit modules are suppressed entirely in self-administered (respondent) mode.
   */
  moduleKind?: 'entry' | 'main' | 'exit';
  /** When true, this section is hidden from respondents and shown only to interviewers. */
  interviewerOnly?: boolean;
}

/** DDI *IfThenElse* control construct: branching / skip patterns. */
export interface IfThenElseConstruct {
  type: 'ifThenElse';
  id: Id;
  condition: Expression;
  then: ControlConstruct[];
  else?: ControlConstruct[];
}

/**
 * DDI *Loop* control construct: a roster (dynamic array). Nest a `loop` inside another `loop`'s
 * `children` to build nested rosters (e.g. household members → each member's employment history).
 */
export interface LoopConstruct {
  type: 'loop';
  id: Id;
  label?: InternationalString;
  /** Numeric variable whose value sets the iteration count (e.g. household size). */
  countVariableRef?: string;
  /** Alternatively, loop while this expression is true. */
  loopWhile?: Expression;
  /** Index variable name made available to children (e.g. `i`). Referenced as `$i`. */
  loopVariable: string;
  /** Per-iteration heading; may use `${i}` and other piping tokens. */
  itemLabel?: InternationalString;
  children: ControlConstruct[];
  visibleWhen?: Expression;
}

/** DDI *ComputationItem*: assigns a derived value mid-interview. */
export interface ComputationConstruct {
  type: 'computation';
  id: Id;
  targetVariableRef: string;
  expression: Expression;
}

/** DDI *StatementItem*: display-only text/instruction. */
export interface StatementConstruct {
  type: 'statement';
  id: Id;
  text: InternationalString;
  visibleWhen?: Expression;
  /** When true, this statement is suppressed in self-administered mode and shown only to interviewers. */
  interviewerOnly?: boolean;
}

/** The DDI *ControlConstruct* tree node union. */
export type ControlConstruct =
  | SequenceConstruct
  | QuestionConstruct
  | IfThenElseConstruct
  | LoopConstruct
  | ComputationConstruct
  | StatementConstruct;

/** Maps a field from the ingested sample/CMS context onto an instrument variable (pre-fill). */
export interface PrefillMapping {
  sampleField: string;
  targetVariable: string;
}

/**
 * Interviewer-administration configuration for CATI or field-interviewer mode.
 * When `enabled` is true, the designer exposes a dedicated Interviewer mode with entry/exit
 * module builders and free-navigation preview.
 */
export interface InterviewerConfig {
  enabled: boolean;
  /** Allow the interviewer to jump to any question, bypassing routing logic. */
  allowFreeNavigation: boolean;
  /** ID of the SequenceConstruct with moduleKind='entry' (pre-interview validation). */
  entryModuleRef?: string;
  /** ID of the SequenceConstruct with moduleKind='exit' (post-interview housekeeping). */
  exitModuleRef?: string;
}

export interface InstrumentMetadata {
  title: InternationalString;
  /** Human-readable creator/agency name for citations (e.g. "Demo Org"). */
  agency?: string;
  /**
   * DDI maintenance-agency identifier used to mint every URN on DDI-XML export
   * (`urn:ddi:{agencyId}:{id}:{version}`). Must match the DDI registry pattern
   * (dot-separated labels, e.g. `io.github.p3ji`). Leave unset to use the project
   * placeholder — never set a registered agency (like `ca.statcan`) unless you
   * actually publish on that agency's behalf.
   */
  agencyId?: string;
  description?: InternationalString;
  /** ISO-8601 creation timestamp. */
  created?: string;
}

/** Root of the instrument specification — decoupled from rendering and runtime state engines. */
export interface Instrument {
  id: Id;
  version: string;
  ddiProfile: 'ddi-lifecycle-3.3';
  languages: LanguageCode[];
  defaultLanguage: LanguageCode;
  metadata: InstrumentMetadata;
  concepts: Concept[];
  universes: Universe[];
  categorySchemes: CategoryScheme[];
  variables: Variable[];
  prefillMappings: PrefillMapping[];
  /** Root control construct (always a sequence). */
  sequence: SequenceConstruct;
  /** Optional interviewer-administration settings (CATI / field interviewer mode). */
  interviewer?: InterviewerConfig;
}
