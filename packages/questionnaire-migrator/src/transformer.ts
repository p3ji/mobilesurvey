import type {
  Instrument,
  SequenceConstruct,
  QuestionConstruct,
  ControlConstruct,
  Variable,
  CategoryScheme,
  ResponseDomain,
  RepresentationType,
} from '@mobilesurvey/instrument-schema';
import type { ParsedQuestionnaire, ParsedQuestion } from './types.js';

// ── Response domain construction ──────────────────────────────────────────────

function representationFor(type: ParsedQuestion['type']): RepresentationType {
  switch (type) {
    case 'boolean': return 'boolean';
    case 'numeric': return 'numeric';
    case 'date':    return 'datetime';
    default:        return 'text';
  }
}

function buildResponseDomain(q: ParsedQuestion): ResponseDomain {
  switch (q.type) {
    case 'boolean':
      return { type: 'boolean' };
    case 'numeric':
      return {
        type: 'numeric',
        decimals: 0,
        ...(q.numericMin !== undefined ? { min: q.numericMin } : {}),
        ...(q.numericMax !== undefined ? { max: q.numericMax } : {}),
      };
    case 'date':
      return { type: 'datetime', mode: 'date' };
    case 'single':
      return { type: 'code', categorySchemeRef: `cs.q${q.normalizedNumber}`, selection: 'single' };
    case 'multiple':
      return { type: 'code', categorySchemeRef: `cs.q${q.normalizedNumber}`, selection: 'multiple' };
    default:
      return { type: 'text', multiline: true, maxLength: 500 };
  }
}

// ── Skip logic → visibleWhen expressions ─────────────────────────────────────

function getQuestionsBetween(
  all: ParsedQuestion[],
  fromNorm: string,
  toNorm: string,
): ParsedQuestion[] {
  const fi = all.findIndex(q => q.normalizedNumber === fromNorm);
  const ti = all.findIndex(q => q.normalizedNumber === toNorm);
  if (fi === -1 || ti === -1 || ti <= fi + 1) return [];
  return all.slice(fi + 1, ti);
}

function visibleWhenForOptionSkip(
  sourceQ: ParsedQuestion,
  varName: string,
  optCode: string,
): string {
  // visibleWhen = "NOT the skip condition" so the skipped questions are hidden when skip fires
  if (sourceQ.type === 'boolean') {
    const isYes = ['yes', '1', 'true', 'oui'].includes(optCode.toLowerCase());
    return isYes ? `!$${varName}` : `$${varName}`;
  }
  return `$${varName} !== '${optCode}'`;
}

function visibleWhenForConditionSkip(
  sourceQ: ParsedQuestion,
  varName: string,
  condition: string,
): string {
  const lower = condition.trim().toLowerCase();

  if (sourceQ.type === 'boolean') {
    if (['yes', 'true', '1', 'oui'].includes(lower)) return `!$${varName}`;
    if (['no', 'false', '0', 'non'].includes(lower)) return `$${varName}`;
    return `!$${varName}`;
  }

  // Try to match the condition text to an option label or code
  if (sourceQ.options) {
    const match = sourceQ.options.find(
      o => o.label.toLowerCase().includes(lower) || o.code.toLowerCase() === lower,
    );
    if (match) return `$${varName} !== '${match.code}'`;
  }

  return `!$${varName}`;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ── Main transformer ──────────────────────────────────────────────────────────

export function transformToInstrument(
  parsed: ParsedQuestionnaire,
  title: string,
  agency?: string,
): { instrument: Instrument; warnings: string[] } {
  const warnings: string[] = [];
  const lang = 'en';

  const allQuestions = parsed.sections.flatMap(s => s.questions);

  if (allQuestions.length === 0) {
    warnings.push('No questions were detected in the input text.');
  }

  // ── 1. Category schemes & variables ─────────────────────────────────────────

  const categorySchemes: CategoryScheme[] = [];
  const variables: Variable[] = [];
  // Keyed by question object identity so duplicate normalizedNumbers don't clash
  const varNameOf = new Map<ParsedQuestion, string>();

  // Detect collisions and deduplicate variable names
  const usedNames = new Set<string>();
  for (const q of allQuestions) {
    let name = `q${q.normalizedNumber}`;
    if (usedNames.has(name)) {
      let idx = 2;
      while (usedNames.has(`${name}_${idx}`)) idx++;
      warnings.push(`Duplicate question number "${q.number}" — renamed to ${name}_${idx}.`);
      name = `${name}_${idx}`;
    }
    usedNames.add(name);
    varNameOf.set(q, name);
  }

  for (const q of allQuestions) {
    const varName = varNameOf.get(q)!;
    const shortLabel = q.text.slice(0, 80);

    if ((q.type === 'single' || q.type === 'multiple') && q.options && q.options.length > 0) {
      const csId = `cs.q${q.normalizedNumber}`;
      categorySchemes.push({
        id: csId,
        label: { [lang]: shortLabel },
        categories: q.options.map((o, i) => ({
          code: o.code || String(i + 1),
          label: { [lang]: o.label },
        })),
      });
      variables.push({
        id: `v.q${q.normalizedNumber}`,
        name: varName,
        kind: 'collected',
        label: { [lang]: shortLabel },
        representation: 'code',
        categorySchemeRef: csId,
      });
    } else {
      variables.push({
        id: `v.q${q.normalizedNumber}`,
        name: varName,
        kind: 'collected',
        label: { [lang]: shortLabel },
        representation: representationFor(q.type),
      });
    }
  }

  // ── 2. Build visibleWhen map ─────────────────────────────────────────────────

  const visibleWhenMap = new Map<string, string[]>();

  function addVisibleWhen(normNum: string, expr: string) {
    const arr = visibleWhenMap.get(normNum) ?? [];
    arr.push(expr);
    visibleWhenMap.set(normNum, arr);
  }

  for (const q of allQuestions) {
    const varName = varNameOf.get(q)!;

    // Option-level skip
    for (const opt of q.options ?? []) {
      if (!opt.skipTo) continue;
      const skipped = getQuestionsBetween(allQuestions, q.normalizedNumber, opt.skipTo);
      if (skipped.length === 0) {
        if (opt.skipTo) warnings.push(`Skip target Q${opt.skipTo} not found (from Q${q.number}).`);
        continue;
      }
      const expr = visibleWhenForOptionSkip(q, varName, opt.code);
      for (const sq of skipped) addVisibleWhen(sq.normalizedNumber, expr);
    }

    // Question-level skip rules
    for (const rule of q.skipRules ?? []) {
      const skipped = getQuestionsBetween(allQuestions, q.normalizedNumber, rule.targetNumber);
      if (skipped.length === 0) {
        warnings.push(`Skip target Q${rule.targetNumber} not found (from Q${q.number}).`);
        continue;
      }
      if (rule.condition === 'always') {
        for (const sq of skipped) addVisibleWhen(sq.normalizedNumber, 'false');
        continue;
      }
      const expr = visibleWhenForConditionSkip(q, varName, rule.condition);
      for (const sq of skipped) addVisibleWhen(sq.normalizedNumber, expr);
    }
  }

  // ── 3. Build construct tree ──────────────────────────────────────────────────

  function buildQuestionConstruct(q: ParsedQuestion): QuestionConstruct {
    const varName = varNameOf.get(q)!;
    const vwParts = visibleWhenMap.get(q.normalizedNumber) ?? [];
    const visibleWhen = vwParts.length === 0
      ? undefined
      : vwParts.length === 1
        ? vwParts[0]!
        : `(${vwParts.join(') && (')})`;

    return {
      type: 'question',
      id: `q.${q.normalizedNumber}`,
      variableRef: varName,
      text: { [lang]: q.text },
      ...(q.instruction ? { instruction: { [lang]: q.instruction } } : {}),
      responseDomain: buildResponseDomain(q),
      ...(visibleWhen ? { visibleWhen } : {}),
    };
  }

  let pageSequences: SequenceConstruct[];
  const hasSections = parsed.sections.some(s => s.title);

  if (hasSections) {
    pageSequences = parsed.sections
      .filter(s => s.questions.length > 0)
      .map((s, i): SequenceConstruct => ({
        type: 'sequence',
        id: `pg.s${i + 1}`,
        isPage: true,
        ...(s.title ? { label: { [lang]: s.title } } : {}),
        children: s.questions.map(buildQuestionConstruct) as ControlConstruct[],
      }));
  } else {
    // No section headers — group into pages of ~10 questions
    pageSequences = chunk(allQuestions, 10).map((pageQs, i): SequenceConstruct => ({
      type: 'sequence',
      id: `pg.${i + 1}`,
      isPage: true,
      children: pageQs.map(buildQuestionConstruct) as ControlConstruct[],
    }));
  }

  if (pageSequences.length === 0) {
    pageSequences = [{ type: 'sequence', id: 'pg.1', isPage: true, children: [] }];
  }

  const instrument: Instrument = {
    id: `urn:ddi:mobilesurvey:migrated:${Date.now().toString(36)}`,
    version: '1.0.0',
    ddiProfile: 'ddi-lifecycle-3.3',
    languages: [lang],
    defaultLanguage: lang,
    metadata: {
      title: { [lang]: title },
      ...(agency ? { agency } : {}),
      description: { [lang]: `Migrated from questionnaire text on ${new Date().toLocaleDateString()}.` },
      created: new Date().toISOString(),
    },
    concepts: [],
    universes: [],
    categorySchemes,
    variables,
    prefillMappings: [],
    sequence: {
      type: 'sequence',
      id: 'seq.root',
      children: pageSequences as ControlConstruct[],
    },
  };

  return { instrument, warnings };
}
