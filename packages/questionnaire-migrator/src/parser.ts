import type {
  ParsedQuestionnaire,
  ParsedSection,
  ParsedQuestion,
  ParsedOption,
  ParsedSkipRule,
  ParsedQuestionType,
} from './types.js';

// ── Regexes ───────────────────────────────────────────────────────────────────

const SECTION_KEYWORD_RE = /^(?:section|part)\s+[A-Z0-9IVXivx]+[:\-–—.]\s*(.+)/i;
const SECTION_KEYWORD_BARE_RE = /^(?:section|part)\s+[A-Z0-9IVXivx]+\s*$/i;
const SECTION_DASHES_RE = /^[-=*]{3,}\s*(.+?)\s*[-=*]{3,}$/;
const SECTION_CAPS_COLON_RE = /^([A-Z][A-Z\s]{3,}):\s*$/; // "DEMOGRAPHICS:"

// Q?N[.)] or Q?N[.)]N[.)] — must have trailing space + text
const QUESTION_RE = /^(?:Q(?:uestion)?\s*\.?\s*)?(\d+(?:\.\d+)*)\s*[.)]\s+(.+)/i;

// Option detectors
const OPTION_BOX_RE = /^(?:\[[ xX]?\]|□|○|•|◦|-{1,2})\s+(.+)/;
const OPTION_NUM_RE = /^(\d{1,2})\s*[.)]\s+(.+)/;
const OPTION_ALPHA_RE = /^([a-e])\s*[.)]\s+(.+)/i; // only a–e to avoid false positives

// Skip logic within an option label
const SKIP_LABEL_ARROW_RE = /\s*[→>]\s*(?:(?:go|skip)\s+to\s+)?(?:question\s+)?(?:Q\.?\s?)?(\d+(?:\.\d+)*)\s*$/i;
const SKIP_LABEL_PAREN_RE = /\s*\((?:go|skip)\s+to\s+(?:question\s+)?(?:Q\.?\s?)?(\d+(?:\.\d+)*)\)\s*$/i;

// Standalone skip lines
const SKIP_IF_RE = /^if\s+(.+?)[,;]\s+(?:go|skip|continue)\s+to\s+(?:question\s+)?(?:Q\.?\s?)?(\d+(?:\.\d+)*)/i;
const SKIP_GO_RE = /^(?:go|skip)\s+to\s+(?:question\s+)?(?:Q\.?\s?)?(\d+(?:\.\d+)*)/i;

// Type-inference hints (tested against combined question text + instruction)
const MULTI_SELECT_RE = /select\s+all|check\s+all|mark\s+all/i;
const NUMERIC_RE = /\benter\s+(?:a\s+)?number\b|\bin\s+years\b|\binteger\b|how\s+many\b|\bquantity\b/i;
const DATE_RE = /\bdate\b|mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy-mm-dd/i;
const OPEN_RE = /\bopen[\s-]?(?:text|ended)\b|\bplease\s+specify\b|_{3,}|\bexplain\b|\bdescribe\b/i;
const NUMERIC_RANGE_RE = /(?:[\s(])(\d+)\s*(?:to|–|-)\s*(\d+)(?:[\s)]|$)/;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeNumber(raw: string): string {
  return raw.trim()
    .replace(/^[Qq]\.?\s*/i, '')
    .replace(/\./g, '_');
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

function detectSectionHeader(line: string): string | null {
  let m: RegExpMatchArray | null;

  m = line.match(SECTION_KEYWORD_RE);
  if (m) return (m[1] ?? line).trim();

  if (SECTION_KEYWORD_BARE_RE.test(line)) return line.trim();

  m = line.match(SECTION_DASHES_RE);
  if (m) return (m[1] ?? line).trim();

  m = line.match(SECTION_CAPS_COLON_RE);
  if (m) return (m[1] ?? line).trim();

  return null;
}

// Dotted leader lines from paper forms ("Net sales ..........") are numeric entry items.
const DOT_LEADER_RE = /\s*[.…]{4,}\s*$/;

function detectQuestion(line: string): { number: string; text: string; dotLeader?: boolean } | null {
  const m = line.match(QUESTION_RE);
  if (!m) return null;
  const n = parseInt((m[1] ?? '0').split('.')[0] ?? '0');
  if (n > 999) return null;
  let text = (m[2] ?? '').trim();
  const dotLeader = DOT_LEADER_RE.test(text);
  if (dotLeader) text = text.replace(DOT_LEADER_RE, '').trim();
  // Short texts without '?' are almost certainly option labels, not questions
  if (!text.includes('?') && text.length < 30 && !dotLeader) return null;
  if (text.length < 3) return null;
  return { number: m[1] ?? '', text, ...(dotLeader ? { dotLeader: true } : {}) };
}

function extractSkipFromLabel(raw: string): { label: string; skipTo?: string } {
  let label = raw;
  let skipTo: string | undefined;

  const arrowM = label.match(SKIP_LABEL_ARROW_RE);
  if (arrowM) {
    label = label.slice(0, arrowM.index!).trim();
    skipTo = normalizeNumber(arrowM[1] ?? '');
  }

  if (!skipTo) {
    const parenM = label.match(SKIP_LABEL_PAREN_RE);
    if (parenM) {
      label = label.slice(0, parenM.index!).trim();
      skipTo = normalizeNumber(parenM[1] ?? '');
    }
  }

  return { label, skipTo };
}

function detectOption(line: string, inOptions: boolean): ParsedOption | null {
  // Checkbox / bullet (always an option regardless of context)
  const boxM = line.match(OPTION_BOX_RE);
  if (boxM) {
    const { label, skipTo } = extractSkipFromLabel(boxM[1] ?? '');
    if (!label) return null;
    return { code: slugify(label) || 'opt', label, skipTo };
  }

  // Numeric: 1. or 1)
  const numM = line.match(OPTION_NUM_RE);
  if (numM) {
    const rawLabel = numM[2] ?? '';
    // Dotted leaders mark numeric line items on paper forms, not options.
    if (DOT_LEADER_RE.test(rawLabel)) return null;
    if (rawLabel.length > 0 && rawLabel.length < 120 && (inOptions || !rawLabel.includes('?'))) {
      const { label, skipTo } = extractSkipFromLabel(rawLabel);
      if (label) return { code: numM[1] ?? '', label, skipTo };
    }
  }

  // Alpha a–e (only when already in option mode to avoid false positives)
  if (inOptions) {
    const alphaM = line.match(OPTION_ALPHA_RE);
    if (alphaM) {
      const rawLabel = alphaM[2] ?? '';
      if (rawLabel.length > 0 && rawLabel.length < 120) {
        const { label, skipTo } = extractSkipFromLabel(rawLabel);
        if (label) return { code: (alphaM[1] ?? '').toLowerCase(), label, skipTo };
      }
    }
  }

  return null;
}

function detectSkipLogic(line: string): ParsedSkipRule | null {
  const ifM = line.match(SKIP_IF_RE);
  if (ifM) {
    return {
      condition: (ifM[1] ?? '').trim().toLowerCase(),
      targetNumber: normalizeNumber(ifM[2] ?? ''),
    };
  }
  const goM = line.match(SKIP_GO_RE);
  if (goM) {
    return { condition: 'always', targetNumber: normalizeNumber(goM[1] ?? '') };
  }
  return null;
}

function detectInstruction(line: string): string | null {
  if (/^\(.*\)$/.test(line)) return line.slice(1, -1).trim();
  if (/^\[.*\]$/.test(line)) return line.slice(1, -1).trim();
  if (/^(?:Note|Instructions?)[:\s]/i.test(line)) return line;
  return null;
}

function inferQuestionType(q: ParsedQuestion): ParsedQuestionType {
  const combined = [q.text, q.instruction].filter(Boolean).join(' ');

  if (q.options && q.options.length > 0) {
    if (MULTI_SELECT_RE.test(combined)) return 'multiple';
    if (q.options.length === 2) {
      const labels = q.options.map(o => o.label.toLowerCase().trim());
      const hasYes = labels.some(l => l === 'yes' || l === 'oui');
      const hasNo  = labels.some(l => l === 'no'  || l === 'non');
      if (hasYes && hasNo) return 'boolean';
    }
    return 'single';
  }

  if (DATE_RE.test(combined)) return 'date';
  if (NUMERIC_RE.test(combined)) return 'numeric';
  if (/how\s+(?:old|many|much|long)\b/i.test(combined)) return 'numeric';
  if (/\bage\b|\byears?\b|\bnumber\s+of\b/i.test(q.text)) return 'numeric';
  if (NUMERIC_RANGE_RE.test(q.text)) return 'numeric';
  if (OPEN_RE.test(combined)) return 'text';

  return 'text';
}

// ── State machine parser ──────────────────────────────────────────────────────

type ParseState = 'NONE' | 'IN_SECTION' | 'IN_QUESTION' | 'IN_OPTIONS';

export function parseQuestionnaire(text: string): ParsedQuestionnaire {
  const lines = text.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let currentQuestion: ParsedQuestion | null = null;
  let state: ParseState = 'NONE';
  let possibleTitle: string | undefined;
  let headerLines = 0;

  function ensureSection() {
    if (!currentSection) {
      currentSection = { questions: [] };
      sections.push(currentSection);
    }
  }

  function finalizeQuestion() {
    if (!currentQuestion) return;
    if (currentQuestion.type === 'unknown') {
      currentQuestion.type = inferQuestionType(currentQuestion);
    }
    // Extract numeric bounds from text/instruction
    if (currentQuestion.type === 'numeric') {
      const src = [currentQuestion.text, currentQuestion.instruction].filter(Boolean).join(' ');
      const rm = src.match(NUMERIC_RANGE_RE);
      if (rm && !currentQuestion.numericMin) {
        currentQuestion.numericMin = parseInt(rm[1] ?? '0');
        currentQuestion.numericMax = parseInt(rm[2] ?? '0');
      }
    }
    ensureSection();
    currentSection!.questions.push(currentQuestion);
    currentQuestion = null;
    state = 'IN_SECTION';
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (state === 'IN_OPTIONS') finalizeQuestion();
      continue;
    }

    // Section header?
    const sectionTitle = detectSectionHeader(line);
    if (sectionTitle !== null) {
      finalizeQuestion();
      headerLines = 0;
      currentSection = { title: sectionTitle, questions: [] };
      sections.push(currentSection);
      state = 'IN_SECTION';
      continue;
    }

    // When actively collecting options, try option detection FIRST so that
    // lines like "1. Male" are not misclassified as new questions.
    if (state === 'IN_OPTIONS') {
      const optMatch = detectOption(line, true);
      if (optMatch) {
        if (!currentQuestion!.options) currentQuestion!.options = [];
        currentQuestion!.options.push(optMatch);
        continue;
      }
      const skipMatch = detectSkipLogic(line);
      if (skipMatch) {
        if (!currentQuestion!.skipRules) currentQuestion!.skipRules = [];
        currentQuestion!.skipRules.push(skipMatch);
        continue;
      }
      const instrText = detectInstruction(line);
      if (instrText !== null) {
        currentQuestion!.instruction = [currentQuestion!.instruction, instrText]
          .filter(Boolean).join(' ');
        continue;
      }
      // Fall through to question detection if nothing matched
    }

    // Question line?
    const qMatch = detectQuestion(line);
    if (qMatch) {
      finalizeQuestion();
      headerLines = 0;
      currentQuestion = {
        number: qMatch.number,
        normalizedNumber: normalizeNumber(qMatch.number),
        text: qMatch.text,
        // A dotted leader marks a fill-in amount cell on paper forms.
        type: qMatch.dotLeader ? 'numeric' : 'unknown',
      };
      state = qMatch.dotLeader ? 'IN_OPTIONS' : 'IN_QUESTION';
      continue;
    }

    // Inside a new question (before any options)
    if (state === 'IN_QUESTION') {
      const optMatch = detectOption(line, false);
      if (optMatch) {
        if (!currentQuestion!.options) currentQuestion!.options = [];
        currentQuestion!.options.push(optMatch);
        state = 'IN_OPTIONS';
        continue;
      }

      const skipMatch = detectSkipLogic(line);
      if (skipMatch) {
        if (!currentQuestion!.skipRules) currentQuestion!.skipRules = [];
        currentQuestion!.skipRules.push(skipMatch);
        continue;
      }

      const instrText = detectInstruction(line);
      if (instrText !== null) {
        currentQuestion!.instruction = [currentQuestion!.instruction, instrText]
          .filter(Boolean).join(' ');
        continue;
      }

      // Continuation of question text
      currentQuestion!.text += ' ' + line;
      continue;
    }

    // Pre-question header area — capture possible survey title
    if (state === 'NONE' && !possibleTitle && headerLines < 5 && line.length > 3 && line.length < 120) {
      possibleTitle = line;
    }
    headerLines++;
  }

  finalizeQuestion();

  if (sections.length === 0) {
    sections.push({ questions: [] });
  }

  return { title: possibleTitle, sections };
}
