/**
 * Parser for Statistics Canada "electronic questionnaire" (EQ) text, as extracted
 * from the PDFs / pages published on statcan.gc.ca (e.g. the Canadian Survey on
 * Business Conditions). The dialect differs from generic questionnaire text:
 *
 *  - options are bare lines with no bullets or numbering,
 *  - question text wraps across lines,
 *  - "Select all that apply." marks multi-selects,
 *  - "OR" separates exclusive options (None of the above / Don't know),
 *  - matrix questions repeat one answer scale under several sub-item labels,
 *  - lettered sub-questions ("a. What percentage …?"),
 *  - routing is prose: "Flow condition: If X is selected in Q5, go to Q7.
 *    Otherwise, go to Q8."
 */
import type {
  ParsedQuestionnaire,
  ParsedSection,
  ParsedQuestion,
  ParsedOption,
  ParsedFlowCondition,
} from './types.js';

// ── Line classification regexes ───────────────────────────────────────────────

const EQ_QUESTION_RE = /^(\d{1,3})\.\s+(\S.*)$/;
const LETTERED_SUBQ_RE = /^([a-z])\.\s+(\S.*)$/;
const FLOW_RE = /^Flow condition:\s*(.*)$/i;
const DISPLAY_RE = /^Display condition:\s*(.*)$/i;
const SELECT_ALL_RE = /^Select all that apply\.?$/i;
const OR_RE = /^OR$/;
const HINT_START_RE = /^(?:e\.g\.|i\.e\.|Include\b|Exclude\b|Provide\b|Please\b|Answer\b|Report\b|If\b|When\b|Note\b|Enter\b|Round\b)/;
const SPECIFY_RE = /^Specify\b.*:\s*$/i;
const TERMINAL_PUNCT_RE = /[.?:]\s*$/;
const NUMERIC_ENTRY_RE = /percentage|per cent|number of|how many|year|amount|value|total|count/i;

/** Straighten typographic quotes/dashes so label matching is reliable. */
export function normalizeText(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberWord(w: string): number | undefined {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const n = parseInt(w, 10);
  if (!Number.isNaN(n)) return n;
  return words[w.toLowerCase()];
}

// ── Format detection ──────────────────────────────────────────────────────────

/** Heuristic: does this text look like a StatCan electronic questionnaire? */
export function looksLikeStatcanEQ(text: string): boolean {
  if (/^\s*Flow condition:/im.test(text)) return true;
  const hasSelectAll = /^Select all that apply\.?$/im.test(text);
  if (!hasSelectAll) return false;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const questionStarts = lines.filter((l) => EQ_QUESTION_RE.test(l)).length;
  // Prefix-numbered short labels indicate the generic "1. Male" option style, not EQ.
  const shortNumbered = lines.filter((l) => /^\d{1,2}\s*[.)]\s+.{1,30}$/.test(l) && !l.includes('?')).length;
  return questionStarts >= 2 && shortNumbered < 2;
}

// ── Flow-condition parsing ────────────────────────────────────────────────────

function parseGotoTarget(fragment: string): string | undefined {
  const m = fragment.match(/go\s+to\s+(?:Q\.?\s*)?(\d{1,3})\b/i);
  return m ? m[1] : undefined;
}

function parseFlowCondition(raw: string, afterQuestion: string): ParsedFlowCondition {
  const text = normalizeText(raw);
  const flow: ParsedFlowCondition = { raw: text, afterQuestion, kind: 'unknown' };

  // Split "then" / "otherwise" halves.
  const otherwiseIdx = text.search(/\bOtherwise\b/i);
  const thenPart = otherwiseIdx === -1 ? text : text.slice(0, otherwiseIdx);
  const elsePart = otherwiseIdx === -1 ? '' : text.slice(otherwiseIdx);

  flow.thenTarget = parseGotoTarget(thenPart);
  flow.elseTarget = parseGotoTarget(elsePart);

  // Condition = text between "If" and ", go to".
  const condM = thenPart.match(/\bIf\b\s+(.*?),?\s+go\s+to\s/i);
  const cond = condM ? (condM[1] ?? '') : '';

  // Every "… in Q<n>" mention, with its position in the condition text.
  const sourceMentions = [...cond.matchAll(/\bin\s+Q\.?\s*(\d{1,3})\b/gi)].map((m) => ({
    num: m[1]!,
    at: m.index ?? 0,
  }));
  if (sourceMentions.length > 0) flow.sourceNumber = sourceMentions[0]!.num;

  // Quoted option labels, each paired with the nearest source mentioned after it
  // ("If "Yes" was selected in Q28 or "Yes" was selected in Q29 …").
  const labelMatches = [...cond.matchAll(/"([^"]+)"/g)];
  const selections = labelMatches
    .map((m) => {
      const label = (m[1] ?? '').trim();
      const at = m.index ?? 0;
      const src = sourceMentions.find((s) => s.at > at) ?? sourceMentions[sourceMentions.length - 1];
      return { label, sourceNumber: src?.num };
    })
    .filter((s) => s.label.length > 0);

  const atLeastM = cond.match(/\bat\s+least\s+(\w+)\b/i);
  const greaterM = cond.match(/\bgreater\s+than\s+(\d+(?:\.\d+)?)\b/i);

  if (atLeastM && /selected/i.test(cond)) {
    const v = parseNumberWord(atLeastM[1] ?? '');
    if (v !== undefined && flow.sourceNumber) {
      flow.kind = 'countAtLeast';
      flow.value = v;
      return flow;
    }
  }
  if (greaterM && flow.sourceNumber) {
    flow.kind = 'greaterThan';
    flow.value = parseFloat(greaterM[1] ?? '0');
    return flow;
  }
  if (selections.length > 0 && flow.sourceNumber && /selected/i.test(cond)) {
    flow.kind = 'selected';
    flow.selections = selections;
    return flow;
  }
  return flow;
}

// ── Block content classification ──────────────────────────────────────────────

interface RawBlock {
  number: string;
  /** Question text (wrap-joined). */
  text: string;
  /** Remaining content lines (options, hints, sub-questions …). */
  lines: string[];
}

function isHintLine(line: string): boolean {
  if (SELECT_ALL_RE.test(line)) return false;
  if (HINT_START_RE.test(line)) return true;
  // Explanatory sentences end with a period; EQ option labels don't.
  if (/\.\s*$/.test(line) && line.length > 25) return true;
  return false;
}

/**
 * Join PDF-wrapped lines. EQ option labels are frequently long with no closing
 * punctuation, so length alone cannot signal a wrap; a continuation is joined
 * only when it starts lowercase, or when it is a short colon-terminated tail of
 * a long entry label ("… clients or customers in the United" + "States:").
 */
function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const startsLower = /^[a-z(]/.test(line) && !OR_RE.test(line) && !LETTERED_SUBQ_RE.test(line) && !/^e\.g\.|^i\.e\./.test(line);
    const colonTail = /:\s*$/.test(line) && line.length <= 30 && prev !== undefined && prev.length >= 55;
    if (prev !== undefined && !TERMINAL_PUNCT_RE.test(prev) && (startsLower || colonTail)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Detect a matrix (grid) question: one answer scale repeated under several
 * sub-item labels. Returns the scale and the label preceding each occurrence,
 * or null when the shape doesn't hold.
 */
function detectMatrix(optionLines: string[]): { scale: string[]; items: string[] } | null {
  const counts = new Map<string, number>();
  for (const l of optionLines) counts.set(l, (counts.get(l) ?? 0) + 1);

  // The scale is the first consecutive run of lines that all repeat.
  let scaleStart = -1;
  for (let i = 0; i < optionLines.length; i++) {
    if ((counts.get(optionLines[i]!) ?? 0) >= 2) { scaleStart = i; break; }
  }
  if (scaleStart < 1) return null; // must be preceded by at least one label
  const scale: string[] = [];
  for (let i = scaleStart; i < optionLines.length && (counts.get(optionLines[i]!) ?? 0) >= 2; i++) {
    scale.push(optionLines[i]!);
  }
  if (scale.length < 3) return null;

  // Walk occurrences of the exact scale sequence, collecting the labels between them.
  const items: string[] = [];
  let i = 0;
  let pendingLabels: string[] = [];
  while (i < optionLines.length) {
    const matchesScale = scale.every((s, k) => optionLines[i + k] === s);
    if (matchesScale) {
      if (pendingLabels.length === 0) return null; // scale with no label — not a matrix
      items.push(pendingLabels.join(' '));
      pendingLabels = [];
      i += scale.length;
    } else {
      pendingLabels.push(optionLines[i]!);
      i++;
    }
  }
  if (pendingLabels.length > 0) return null; // trailing loose options — not a clean matrix
  return items.length >= 2 ? { scale, items } : null;
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseStatcanEQ(text: string): ParsedQuestionnaire {
  const rawLines = text.split(/\r?\n/).map((l) => normalizeText(l));
  const warnings: string[] = [];
  const flows: ParsedFlowCondition[] = [];

  // Phase 1: walk lines, splitting into question blocks, flow/display conditions
  // and "pending" prose between blocks (front matter, section headers).
  const blocks: RawBlock[] = [];
  /** pending[i] = prose lines seen before blocks[i] started. */
  const pendingBefore: string[][] = [];
  let pending: string[] = [];
  let currentBlock: RawBlock | null = null;
  let lastBlockNumber = '0';
  let lastQNum = 0;

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    if (!line) { i++; continue; }

    // EQ web/PDF footer — everything after it is boilerplate.
    if (/^Date modified:?/i.test(line)) break;

    // Flow / display condition (may wrap over several lines).
    const flowM = line.match(FLOW_RE);
    const dispM = line.match(DISPLAY_RE);
    if (flowM || dispM) {
      let joined = line;
      while (i + 1 < rawLines.length) {
        const next = rawLines[i + 1]!;
        if (!next) break;
        const sentenceOpen = !/\.\s*$/.test(joined);
        const continues = /^(Otherwise|to\s|go\s|person)/i.test(next);
        if (!sentenceOpen && !continues) break;
        if (EQ_QUESTION_RE.test(next) || FLOW_RE.test(next) || DISPLAY_RE.test(next)) break;
        joined += ` ${next}`;
        i++;
      }
      if (flowM) {
        flows.push(parseFlowCondition(joined.replace(FLOW_RE, '$1'), lastBlockNumber));
      } else {
        warnings.push(`Display condition is not supported and was skipped: "${joined.slice(0, 120)}"`);
      }
      // A routing rule always ends a question block; what follows is a section
      // header or the next question.
      currentBlock = null;
      i++;
      continue;
    }

    // New numbered question?
    const qM = line.match(EQ_QUESTION_RE);
    if (qM) {
      const n = parseInt(qM[1]!, 10);
      // Guard against numbered prose in front matter: numbers must move forward modestly.
      if (n >= lastQNum + 1 && n <= lastQNum + 15) {
        // Join wrapped question text: continue while no terminal punctuation.
        let qText = (qM[2] ?? '').trim();
        let consumed = 0;
        while (!TERMINAL_PUNCT_RE.test(qText) && consumed < 6 && i + 1 < rawLines.length) {
          const next = rawLines[i + 1]!;
          if (!next || EQ_QUESTION_RE.test(next) || FLOW_RE.test(next) || DISPLAY_RE.test(next) || OR_RE.test(next)) break;
          qText += ` ${next}`;
          i++;
          consumed++;
        }
        currentBlock = { number: qM[1]!, text: qText, lines: [] };
        blocks.push(currentBlock);
        pendingBefore.push(pending);
        pending = [];
        lastBlockNumber = qM[1]!;
        lastQNum = n;
        i++;
        continue;
      }
    }

    if (currentBlock) currentBlock.lines.push(line);
    else pending.push(line);
    i++;
  }
  const pendingAfterLast = pending;

  // Trailing content of each block that precedes the NEXT block's section header
  // actually belongs to the next block's "pendingBefore" — but since options and
  // headers are both bare lines we cannot tell them apart at phase 1. Instead we
  // pull section headers out of the block tails in phase 2 below.

  // Phase 2: derive document title + section headers from pending prose.
  function extractSectionTitle(lines: string[]): string | undefined {
    // Scan from the end: skip hint-ish prose, then take the trailing title-ish
    // run (a lowercase-starting last line is a wrap of the line above it).
    let end = lines.length - 1;
    while (end >= 0) {
      const l = lines[end]!;
      const titleish = l.length > 0 && l.length <= 60 && !/[.:?]\s*$/.test(l) && !OR_RE.test(l) && !/,$/.test(l);
      if (titleish) break;
      end--;
    }
    if (end < 0) return undefined;
    let start = end;
    while (start > 0 && /^[a-z]/.test(lines[start]!) && lines[start - 1]!.length <= 60 && !/[.:?,]\s*$/.test(lines[start - 1]!)) {
      start--;
    }
    return lines.slice(start, end + 1).join(' ');
  }

  let docTitle: string | undefined;
  const firstPending = pendingBefore[0] ?? [];
  if (firstPending.length > 0) {
    const titleLines: string[] = [];
    for (let k = 0; k < Math.min(firstPending.length, 3); k++) {
      const l = firstPending[k]!;
      if (l.length > 90) break;
      titleLines.push(l);
      if (!/,\s*$/.test(l) && !(k + 1 < firstPending.length && /^[a-z0-9]/.test(firstPending[k + 1]!))) break;
    }
    if (titleLines.length > 0) docTitle = titleLines.join(' ').replace(/,\s*$/, '');
  }

  // Phase 3: parse each block's content into questions (+ nested/matrix/lettered).
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = { questions: [] };
  sections.push(currentSection);

  let carriedHeader: string | undefined;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b]!;
    const before = pendingBefore[b] ?? [];
    // Section header before this question? (skip doc-title lines for block 0)
    const headerSource = b === 0 && docTitle ? before.slice(countTitleLines(before, docTitle)) : before;
    const sectionTitle = extractSectionTitle(headerSource) ?? carriedHeader;
    if (sectionTitle) {
      currentSection = { title: sectionTitle, questions: [] };
      sections.push(currentSection);
    }

    const { questions: parsedQs, carryHeader } = parseBlock(block, warnings);
    carriedHeader = carryHeader;
    currentSection.questions.push(...parsedQs);
  }
  if (pendingAfterLast.length > 0) {
    // Usually "Date modified: …" boilerplate — ignore.
  }

  // Drop the initial section when empty (document started with a header).
  const nonEmptySections = sections.filter((s) => s.questions.length > 0 || s.title);

  return {
    title: docTitle,
    sections: nonEmptySections.length > 0 ? nonEmptySections : [{ questions: [] }],
    flows,
    parseWarnings: warnings,
  };
}

/** Number of leading lines of `lines` consumed by the extracted document title. */
function countTitleLines(lines: string[], title: string): number {
  let acc = '';
  for (let k = 0; k < lines.length; k++) {
    acc = acc ? `${acc} ${lines[k]}` : lines[k]!;
    if (acc.replace(/,\s*$/, '') === title) return k + 1;
    if (acc.length > title.length) break;
  }
  return 0;
}

// ── Per-block parsing ─────────────────────────────────────────────────────────

/** Exclusive choices that always close an EQ option list. */
const TERMINAL_OPTION_RE = /^(?:don'?t know|none of the above|prefer not to say|not applicable|no opinion)\s*$/i;

/**
 * The section header of the NEXT question often trails the current block's
 * option list ("… Don't know / Artificial intelligence / 33. …"). Strip
 * title-ish lines that follow the last terminal exclusive option.
 */
function stripTrailingHeader(optLines: string[]): string | undefined {
  let lastTerminal = -1;
  for (let i = 0; i < optLines.length; i++) {
    if (TERMINAL_OPTION_RE.test(optLines[i]!)) lastTerminal = i;
  }
  if (lastTerminal === -1 || lastTerminal !== optLines.length - 2) return undefined;
  // Exactly one trailing line: wrapped headers were already re-joined, and two
  // or more trailing lines are options that resumed after a nested follow-up.
  const trailing = optLines[optLines.length - 1]!;
  const titleish = trailing.length > 0 && trailing.length <= 60
    && !/[.:?]\s*$/.test(trailing) && !/,$/.test(trailing);
  if (!titleish) return undefined;
  optLines.length = lastTerminal + 1;
  return trailing;
}

function parseBlock(
  block: RawBlock,
  warnings: string[],
): { questions: ParsedQuestion[]; carryHeader?: string } {
  const parentNorm = block.number;
  const parent: ParsedQuestion = {
    number: block.number,
    normalizedNumber: parentNorm,
    text: block.text,
    type: 'unknown',
  };

  const results: ParsedQuestion[] = [parent];
  /** The question whose options are currently being collected. */
  let target = parent;
  let childCounter = 0;
  const lines = joinWrappedLines(block.lines);

  const optionLinesOf = new Map<ParsedQuestion, string[]>();
  optionLinesOf.set(parent, []);

  function newChild(text: string, letter?: string, nestedUnder?: ParsedQuestion['nestedUnder']): ParsedQuestion {
    childCounter++;
    const suffix = letter ?? String(childCounter);
    const child: ParsedQuestion = {
      number: `${block.number}.${suffix}`,
      normalizedNumber: `${parentNorm}_${suffix}`,
      text,
      type: 'unknown',
      ...(nestedUnder ? { nestedUnder } : {}),
    };
    results.push(child);
    optionLinesOf.set(child, []);
    target = child;
    return child;
  }

  let seenLettered = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (OR_RE.test(line)) continue; // exclusive-option separator

    if (SELECT_ALL_RE.test(line)) {
      target.multiSelect = true;
      continue;
    }

    // Lettered sub-question ("a. What percentage …?")
    const letM = line.match(LETTERED_SUBQ_RE);
    if (letM && (letM[2] ?? '').length > 20) {
      // Absorb wrapped continuations that start uppercase ("… owned by First" +
      // "Nations, Métis or Inuit peoples?") until the sentence closes.
      let subText = (letM[2] ?? '').trim();
      let absorbed = 0;
      while (!TERMINAL_PUNCT_RE.test(subText) && absorbed < 3 && li + 1 < lines.length && !OR_RE.test(lines[li + 1]!)) {
        subText += ` ${lines[li + 1]!}`;
        li++;
        absorbed++;
      }
      newChild(subText, letM[1]!);
      seenLettered = true;
      continue;
    }

    // Nested sub-question: a question-looking line inside the option area.
    if (/\?\s*$/.test(line) && line.length > 25) {
      const targetOpts = optionLinesOf.get(target) ?? [];
      const nestedUnder = targetOpts.length > 0
        ? { parentNormalized: target.normalizedNumber, optionIndex: targetOpts.length - 1 }
        : undefined;
      newChild(line, undefined, nestedUnder);
      if (nestedUnder) {
        warnings.push(
          `Q${block.number}: nested follow-up "${line.slice(0, 60)}…" attached to the preceding option — please review.`,
        );
      }
      continue;
    }

    // Entry label ("Percentage of sales …:", "Year …:", "Specify other …:")
    if (/:\s*$/.test(line)) {
      if (SPECIFY_RE.test(line)) continue; // other-specify field; the option itself is kept
      if (NUMERIC_ENTRY_RE.test(line)) {
        target.type = 'numeric';
        if (/percentage|per cent/i.test(line)) { target.numericMin = 0; target.numericMax = 100; }
      } else {
        target.type = 'text';
      }
      continue;
    }

    // Hint / instruction prose.
    if (isHintLine(line)) {
      const opts = optionLinesOf.get(target) ?? [];
      if (opts.length === 0) {
        target.instruction = [target.instruction, line].filter(Boolean).join(' ');
      }
      // Hints between options describe the option above them — drop.
      continue;
    }

    (optionLinesOf.get(target) ?? []).push(line);
  }

  // The section header of the next question may trail the last option list.
  const carryHeader = stripTrailingHeader(optionLinesOf.get(target) ?? []);

  // Materialise options / matrices per question.
  const expanded: ParsedQuestion[] = [];
  for (const q of results) {
    const optLines = optionLinesOf.get(q) ?? [];
    const matrix = optLines.length >= 8 ? detectMatrix(optLines) : null;

    if (matrix) {
      // Split into one sub-question per row; the stem becomes the instruction.
      matrix.items.forEach((item, idx) => {
        childCounter++;
        expanded.push({
          number: `${q.number}.${idx + 1}`,
          normalizedNumber: `${q.normalizedNumber}_${idx + 1}`,
          text: item,
          instruction: q.text,
          type: 'unknown',
          options: matrix.scale.map((s, k) => ({ code: String(k + 1), label: s })),
          ...(q.nestedUnder ? { nestedUnder: q.nestedUnder } : {}),
        });
      });
      continue;
    }

    if (optLines.length > 0) {
      // Deduplicate consecutive repeats (artefacts of nested structures we flattened).
      const deduped: string[] = [];
      for (const l of optLines) {
        if (deduped[deduped.length - 1] === l) {
          warnings.push(`Q${q.number}: dropped duplicated option "${l}" (likely a nested structure).`);
          continue;
        }
        deduped.push(l);
      }
      q.options = deduped.map((l, k): ParsedOption => ({ code: String(k + 1), label: l }));
      if (q.type === 'numeric' || q.type === 'text') {
        // Numeric/text entry with trailing exclusive choices (Don't know …) — the
        // entry wins; note the loss.
        warnings.push(
          `Q${q.number}: exclusive choices (${deduped.join(', ')}) dropped in favour of the ${q.type} entry field.`,
        );
        delete q.options;
      }
    }
    expanded.push(q);
  }

  // A parent that ended up with no options, no entry type and children is a stem —
  // keep it only when it has real content of its own.
  if (expanded.length > 1) {
    const parentIdx = expanded.indexOf(parent);
    if (parentIdx !== -1 && !parent.options && parent.type === 'unknown' && seenLettered) {
      // Lettered sub-questions carry the substance; parent stem becomes their context.
      for (const q of expanded) {
        if (q !== parent && !q.instruction) q.instruction = parent.text;
      }
      expanded.splice(parentIdx, 1);
    }
  }

  return { questions: expanded, carryHeader };
}
