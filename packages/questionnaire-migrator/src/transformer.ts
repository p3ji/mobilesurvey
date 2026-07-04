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
import type { ParsedQuestionnaire, ParsedQuestion, ParsedFlowCondition } from './types.js';

// ── Response domain construction ──────────────────────────────────────────────

function representationFor(type: ParsedQuestion['type']): RepresentationType {
  switch (type) {
    case 'boolean': return 'boolean';
    case 'numeric': return 'numeric';
    case 'date':    return 'datetime';
    default:        return 'text';
  }
}

function buildResponseDomain(q: ParsedQuestion, csId: string): ResponseDomain {
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
      return { type: 'code', categorySchemeRef: csId, selection: 'single' };
    case 'multiple':
      return { type: 'code', categorySchemeRef: csId, selection: 'multiple' };
    default:
      return { type: 'text', multiline: true, maxLength: 500 };
  }
}

/** Resolve types the parser left as 'unknown' (the EQ parser defers inference). */
function resolveType(q: ParsedQuestion): ParsedQuestion['type'] {
  if (q.type !== 'unknown') return q.type;
  if (q.options && q.options.length > 0) {
    if (q.multiSelect) return 'multiple';
    if (q.options.length === 2) {
      const labels = q.options.map((o) => o.label.toLowerCase().trim());
      if (labels.some((l) => l === 'yes' || l === 'oui') && labels.some((l) => l === 'no' || l === 'non')) {
        return 'boolean';
      }
    }
    return 'single';
  }
  return 'text';
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
  return `$${varName} != '${optCode}'`;
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
    if (match) return `$${varName} != '${match.code}'`;
  }

  return `!$${varName}`;
}

// ── Flow conditions (StatCan EQ prose routing) ────────────────────────────────

/** "is/was selected" membership test for one option of a source question. */
function selectedExpr(sourceQ: ParsedQuestion, varName: string, code: string): string {
  if (sourceQ.type === 'multiple') return `contains($${varName}, '${code}')`;
  if (sourceQ.type === 'boolean') {
    const opt = sourceQ.options?.find((o) => o.code === code);
    const isYes = opt ? ['yes', 'oui'].includes(opt.label.toLowerCase().trim()) : code === '1';
    return isYes ? `$${varName}` : `!$${varName}`;
  }
  return `$${varName} == '${code}'`;
}

function matchOptionCode(sourceQ: ParsedQuestion, label: string): string | undefined {
  const lbl = label.toLowerCase().trim();
  const found = sourceQ.options?.find((o) => {
    const ol = o.label.toLowerCase().trim();
    return ol === lbl || ol.startsWith(lbl) || lbl.startsWith(ol);
  });
  return found?.code;
}

/** Build the truthy condition expression for a flow; undefined when unresolvable. */
function flowConditionExpr(
  flow: ParsedFlowCondition,
  all: ParsedQuestion[],
  varNameOf: Map<ParsedQuestion, string>,
  warnings: string[],
): string | undefined {
  if (flow.kind === 'unknown') {
    warnings.push(`Flow condition could not be interpreted; routing skipped: "${flow.raw.slice(0, 140)}"`);
    return undefined;
  }
  const findQ = (num: string | undefined) =>
    num === undefined
      ? undefined
      : all.find((q) => q.normalizedNumber === num || q.normalizedNumber.startsWith(`${num}_`));

  switch (flow.kind) {
    case 'countAtLeast':
    case 'greaterThan': {
      const src = findQ(flow.sourceNumber);
      if (!src) {
        warnings.push(`Flow condition references Q${flow.sourceNumber ?? '?'} which was not found: "${flow.raw.slice(0, 140)}"`);
        return undefined;
      }
      const varName = varNameOf.get(src)!;
      return flow.kind === 'countAtLeast'
        ? `count($${varName}) >= ${flow.value ?? 1}`
        : `$${varName} > ${flow.value ?? 0}`;
    }
    case 'selected': {
      const parts: string[] = [];
      for (const sel of flow.selections ?? []) {
        const src = findQ(sel.sourceNumber ?? flow.sourceNumber);
        if (!src) {
          warnings.push(`Flow condition references Q${sel.sourceNumber ?? '?'} which was not found: "${flow.raw.slice(0, 140)}"`);
          continue;
        }
        const code = matchOptionCode(src, sel.label);
        if (code === undefined) {
          warnings.push(`Flow condition option "${sel.label}" not found in Q${src.number}; that clause was skipped.`);
          continue;
        }
        const expr = selectedExpr(src, varNameOf.get(src)!, code);
        if (!parts.includes(expr)) parts.push(expr);
      }
      if (parts.length === 0) return undefined;
      return parts.length === 1 ? parts[0]! : `(${parts.join(' || ')})`;
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function negate(expr: string): string {
  if (expr.startsWith('!') && !expr.includes('&&') && !expr.includes('||') && !expr.includes(' ')) {
    return expr.slice(1);
  }
  // Bare variable or single function call can be negated directly.
  if (/^\$\w+$/.test(expr) || /^\w+\([^()]*\)$/.test(expr)) return `!${expr}`;
  return `!(${expr})`;
}

// ── Main transformer ──────────────────────────────────────────────────────────

export function transformToInstrument(
  parsed: ParsedQuestionnaire,
  title: string,
  agency?: string,
): { instrument: Instrument; warnings: string[] } {
  const warnings: string[] = [...(parsed.parseWarnings ?? [])];
  const lang = 'en';

  const allQuestions = parsed.sections.flatMap(s => s.questions);
  for (const q of allQuestions) q.type = resolveType(q);

  if (allQuestions.length === 0) {
    warnings.push('No questions were detected in the input text.');
  }

  // ── 1. Variable names, category schemes & variables ─────────────────────────

  // Keyed by question object identity so duplicate normalizedNumbers don't clash
  const varNameOf = new Map<ParsedQuestion, string>();

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

  const categorySchemes: CategoryScheme[] = [];
  const variables: Variable[] = [];

  for (const q of allQuestions) {
    const varName = varNameOf.get(q)!;
    const shortLabel = q.text.slice(0, 80);

    if ((q.type === 'single' || q.type === 'multiple') && q.options && q.options.length > 0) {
      const csId = `cs.${varName}`;
      categorySchemes.push({
        id: csId,
        label: { [lang]: shortLabel },
        categories: q.options.map((o, i) => ({
          code: o.code || String(i + 1),
          label: { [lang]: o.label },
        })),
      });
      variables.push({
        id: `v.${varName}`,
        name: varName,
        kind: 'collected',
        label: { [lang]: shortLabel },
        representation: 'code',
        categorySchemeRef: csId,
      });
    } else {
      variables.push({
        id: `v.${varName}`,
        name: varName,
        kind: 'collected',
        label: { [lang]: shortLabel },
        representation: representationFor(q.type),
      });
    }
  }

  // ── 2. Build visibleWhen map ─────────────────────────────────────────────────

  const visibleWhenOf = new Map<ParsedQuestion, string[]>();

  function addVisibleWhen(q: ParsedQuestion, expr: string) {
    const arr = visibleWhenOf.get(q) ?? [];
    arr.push(expr);
    visibleWhenOf.set(q, arr);
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
      for (const sq of skipped) addVisibleWhen(sq, expr);
    }

    // Question-level skip rules
    for (const rule of q.skipRules ?? []) {
      const skipped = getQuestionsBetween(allQuestions, q.normalizedNumber, rule.targetNumber);
      if (skipped.length === 0) {
        warnings.push(`Skip target Q${rule.targetNumber} not found (from Q${q.number}).`);
        continue;
      }
      if (rule.condition === 'always') {
        for (const sq of skipped) addVisibleWhen(sq, 'false');
        continue;
      }
      const expr = visibleWhenForConditionSkip(q, varName, rule.condition);
      for (const sq of skipped) addVisibleWhen(sq, expr);
    }

    // Nested sub-questions: visible only while the parent's option is selected.
    if (q.nestedUnder) {
      const parent = allQuestions.find((p) => p.normalizedNumber === q.nestedUnder!.parentNormalized);
      const opt = parent?.options?.[q.nestedUnder.optionIndex];
      if (parent && opt) {
        addVisibleWhen(q, selectedExpr(parent, varNameOf.get(parent)!, opt.code));
      } else {
        warnings.push(`Q${q.number}: could not resolve the option its visibility depends on.`);
      }
    }
  }

  // Prose flow conditions ("If X is selected in Q5, go to Q7. Otherwise, go to Q8.")
  const indexOfTarget = (target: string | undefined): number => {
    if (!target) return allQuestions.length; // end of survey / non-question label
    const i = allQuestions.findIndex(
      (q) => q.normalizedNumber === target || q.normalizedNumber.startsWith(`${target}_`),
    );
    return i === -1 ? allQuestions.length : i;
  };

  for (const flow of parsed.flows ?? []) {
    if (flow.thenTarget === undefined && flow.elseTarget === undefined) {
      warnings.push(`Flow condition has no resolvable targets; skipped: "${flow.raw.slice(0, 140)}"`);
      continue;
    }
    const cond = flowConditionExpr(flow, allQuestions, varNameOf, warnings);
    if (!cond) continue;

    // Anchor: last question belonging to the block the flow followed.
    let anchor = -1;
    for (let i = 0; i < allQuestions.length; i++) {
      const n = allQuestions[i]!.normalizedNumber;
      if (n === flow.afterQuestion || n.startsWith(`${flow.afterQuestion}_`)) anchor = i;
    }

    const iThen = indexOfTarget(flow.thenTarget);
    const iElse = indexOfTarget(flow.elseTarget);
    if (iThen === iElse) continue;

    // The questions between the two branch targets are skipped by one branch:
    // they stay visible only when that branch was NOT taken.
    const lo = Math.max(Math.min(iThen, iElse), anchor + 1);
    const hi = Math.max(iThen, iElse);
    const expr = iThen > iElse ? negate(cond) : cond;
    for (let i = lo; i < hi; i++) addVisibleWhen(allQuestions[i]!, expr);
  }

  // ── 3. Build construct tree ──────────────────────────────────────────────────

  function buildQuestionConstruct(q: ParsedQuestion): QuestionConstruct {
    const varName = varNameOf.get(q)!;
    const vwParts = visibleWhenOf.get(q) ?? [];
    const visibleWhen = vwParts.length === 0
      ? undefined
      : vwParts.length === 1
        ? vwParts[0]!
        : `(${vwParts.join(') && (')})`;

    return {
      type: 'question',
      id: `q.${varName}`,
      variableRef: varName,
      text: { [lang]: q.text },
      ...(q.instruction ? { instruction: { [lang]: q.instruction } } : {}),
      responseDomain: buildResponseDomain(q, `cs.${varName}`),
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
