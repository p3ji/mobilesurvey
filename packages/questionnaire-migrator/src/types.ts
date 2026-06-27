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
}

export interface ParsedSection {
  title?: string;
  questions: ParsedQuestion[];
}

export interface ParsedQuestionnaire {
  /** First prominent non-empty line before any section/question, if detected. */
  title?: string;
  sections: ParsedSection[];
}
