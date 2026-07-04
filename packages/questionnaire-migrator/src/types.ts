/** Intermediate representation produced by the text parser, consumed by the transformer. */

export interface ParsedOption {
  /** Code value stored in responses (numeric string "1", alpha "a", or slugified label "yes"). */
  code: string;
  /** Display label. */
  label: string;
  /** Normalised question number to jump to when this option is selected. */
  skipTo?: string;
}

export type ParsedQuestionType =
  | 'single'    // one answer from a code list
  | 'multiple'  // select all that apply
  | 'boolean'   // yes / no
  | 'numeric'   // number entry
  | 'text'      // open-ended text
  | 'date'      // date entry
  | 'unknown';  // could not be determined (falls back to text)

export interface ParsedSkipRule {
  /** Natural-language condition fragment, lowercased ("yes", "no", "male", "always", …). */
  condition: string;
  /** Normalised question number to jump to. */
  targetNumber: string;
}

export interface ParsedQuestion {
  /** Raw number string as it appears in the text ("1", "Q1", "1.1"). */
  number: string;
  /** Canonical form used for ID generation and look-up ("1", "1_1"). */
  normalizedNumber: string;
  text: string;
  instruction?: string;
  type: ParsedQuestionType;
  options?: ParsedOption[];
  skipRules?: ParsedSkipRule[];
  numericMin?: number;
  numericMax?: number;
  /** Set when "Select all that apply" (or equivalent) was detected. */
  multiSelect?: boolean;
  /** Nested sub-question: show only while the parent's option (0-based index) is selected. */
  nestedUnder?: { parentNormalized: string; optionIndex: number };
}

export interface ParsedSection {
  title?: string;
  questions: ParsedQuestion[];
}

/**
 * A prose routing rule ("Flow condition: If X is selected in Q5, go to Q7.
 * Otherwise, go to Q8.") as found in StatCan electronic questionnaires.
 */
export interface ParsedFlowCondition {
  /** Original text, for warnings. */
  raw: string;
  /** Normalised number of the question the flow sits after (position anchor). */
  afterQuestion: string;
  /** Question the condition reads from (normalised number), when identified. */
  sourceNumber?: string;
  /** For kind 'selected': each quoted label with the question it is selected in. */
  selections?: Array<{ label: string; sourceNumber?: string }>;
  kind: 'selected' | 'countAtLeast' | 'greaterThan' | 'unknown';
  /** Numeric operand for countAtLeast ("at least two") / greaterThan ("greater than 0"). */
  value?: number;
  /** Go-to target when the condition holds; undefined = end of survey / non-question label. */
  thenTarget?: string;
  /** Go-to target otherwise; undefined = end of survey / non-question label. */
  elseTarget?: string;
}

export interface ParsedQuestionnaire {
  /** First prominent non-empty line before any section/question, if detected. */
  title?: string;
  sections: ParsedSection[];
  /** Prose flow conditions (StatCan EQ format). */
  flows?: ParsedFlowCondition[];
  /** Non-fatal notes gathered during parsing (unsupported display conditions, etc.). */
  parseWarnings?: string[];
}
