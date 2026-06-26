import type { Instrument } from '@mobilesurvey/instrument-schema';
import { parseQuestionnaire } from './parser.js';
import { transformToInstrument } from './transformer.js';
import type { ParsedSection } from './types.js';

export interface MigrateOptions {
  /** Override survey title (defaults to first detected heading or "Migrated Survey"). */
  title?: string;
  /** Statistical agency or organisation name for DDI metadata. */
  agency?: string;
}

export interface ParsedSectionSummary {
  title?: string;
  questionCount: number;
}

export interface MigrateResult {
  instrument: Instrument;
  /** Non-fatal messages about parse decisions (unresolved skip targets, duplicate IDs, etc.). */
  warnings: string[];
  questionCount: number;
  sectionCount: number;
  /** Per-section breakdown of what was detected. */
  sections: ParsedSectionSummary[];
}

export function migrate(text: string, options?: MigrateOptions): MigrateResult {
  const parsed = parseQuestionnaire(text);
  const title = options?.title ?? parsed.title ?? 'Migrated Survey';

  const { instrument, warnings } = transformToInstrument(parsed, title, options?.agency);

  const questionCount = parsed.sections.reduce((s, sec) => s + sec.questions.length, 0);
  const nonEmpty = parsed.sections.filter((s: ParsedSection) => s.questions.length > 0);

  return {
    instrument,
    warnings,
    questionCount,
    sectionCount: nonEmpty.length,
    sections: parsed.sections.map((s: ParsedSection) => ({
      title: s.title,
      questionCount: s.questions.length,
    })),
  };
}

// Re-export the parser for consumers that want the intermediate IR
export { parseQuestionnaire } from './parser.js';
export type { ParsedQuestionnaire, ParsedQuestion, ParsedSection, ParsedOption, ParsedSkipRule, ParsedQuestionType } from './types.js';
