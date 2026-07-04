import type { Instrument } from '@mobilesurvey/instrument-schema';
import { parseQuestionnaire } from './parser.js';
import { parseStatcanEQ, looksLikeStatcanEQ } from './statcan-eq.js';
import { transformToInstrument } from './transformer.js';
import type { ParsedQuestionnaire, ParsedSection } from './types.js';

export type SourceFormat = 'statcan-eq' | 'generic';

export interface MigrateOptions {
  /** Override survey title (defaults to first detected heading or "Migrated Survey"). */
  title?: string;
  /** Statistical agency or organisation name for DDI metadata. */
  agency?: string;
  /** Force a specific input dialect instead of auto-detecting. */
  format?: SourceFormat;
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
  /** Which input dialect was used to parse the text. */
  format: SourceFormat;
}

export function migrate(text: string, options?: MigrateOptions): MigrateResult {
  const format: SourceFormat =
    options?.format ?? (looksLikeStatcanEQ(text) ? 'statcan-eq' : 'generic');

  const parsed = format === 'statcan-eq' ? parseStatcanEQ(text) : parseQuestionnaire(text);

  // The EQ heuristic can misfire on unusual documents — fall back when it finds
  // almost nothing where the generic parser finds more.
  if (format === 'statcan-eq' && !options?.format) {
    const eqCount = parsed.sections.reduce((s, sec) => s + sec.questions.length, 0);
    if (eqCount < 3) {
      const generic = parseQuestionnaire(text);
      const genCount = generic.sections.reduce((s, sec) => s + sec.questions.length, 0);
      if (genCount > eqCount) {
        return buildResult(generic, options, 'generic');
      }
    }
  }

  return buildResult(parsed, options, format);
}

function buildResult(
  parsed: ParsedQuestionnaire,
  options: MigrateOptions | undefined,
  format: SourceFormat,
): MigrateResult {
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
    format,
  };
}

// Re-export the parsers for consumers that want the intermediate IR
export { parseQuestionnaire } from './parser.js';
export { parseStatcanEQ, looksLikeStatcanEQ } from './statcan-eq.js';
export type {
  ParsedQuestionnaire,
  ParsedQuestion,
  ParsedSection,
  ParsedOption,
  ParsedSkipRule,
  ParsedQuestionType,
  ParsedFlowCondition,
} from './types.js';
