/**
 * Flattens an instrument's control-construct tree into an ordered list of render-ready items for
 * the current runtime state: evaluating visibility/routing, expanding rosters (including nested),
 * resolving piping, running soft/hard edits, and computing mid-interview computations.
 *
 * Pure: it clones the response map so derived/computation writes never mutate the input.
 */
import { evaluate, parse, type EvalContext } from '@mobilesurvey/expression-engine';
import type {
  ControlConstruct,
  EditRule,
  Instrument,
  LanguageCode,
  QuestionConstruct,
} from '@mobilesurvey/instrument-schema';
import { localizePiped, pick } from './piping.js';
import { instanceKey, makeContext } from './scope.js';
import type { FiredEdit, RenderItem, RuntimeState, Scope } from './types.js';

const REQUIRED_MESSAGE: Record<string, string> = {
  en: 'This field is required.',
  fr: 'Ce champ est obligatoire.',
};

function cond(src: string | undefined, ctx: EvalContext): boolean {
  if (!src || src.trim() === '') return true;
  try {
    return Boolean(evaluate(parse(src), ctx));
  } catch {
    // A malformed condition should not crash the preview; treat as visible/false-safe.
    return true;
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function evalEdits(
  edits: EditRule[] | undefined,
  required: boolean | undefined,
  value: unknown,
  ctx: EvalContext,
  language: LanguageCode,
): FiredEdit[] {
  const fired: FiredEdit[] = [];
  if (required && isEmpty(value)) {
    fired.push({
      id: '__required__',
      type: 'hard',
      message: REQUIRED_MESSAGE[language] ?? REQUIRED_MESSAGE.en!,
    });
  }
  for (const edit of edits ?? []) {
    try {
      if (Boolean(evaluate(parse(edit.when), ctx))) {
        fired.push({ id: edit.id, type: edit.type, message: pick(edit.message, language) });
      }
    } catch {
      // ignore malformed edit conditions in preview
    }
  }
  return fired;
}

/** Resolve the iteration count for a loop (capped to keep the preview responsive). */
function loopCount(countVariableRef: string | undefined, ctx: EvalContext): number {
  if (!countVariableRef) return 0;
  const raw = ctx.resolve(countVariableRef);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 50);
}

export interface FlattenResult {
  items: RenderItem[];
  /** Working response map after computations/derived writes (read-only snapshot). */
  computed: Record<string, unknown>;
}

export function flattenInstrument(instrument: Instrument, state: RuntimeState): FlattenResult {
  const responses: Record<string, unknown> = { ...state.responses };
  const { sample, language } = state;
  const items: RenderItem[] = [];

  const visit = (node: ControlConstruct, scope: Scope, depth: number): void => {
    const ctx = makeContext(instrument, responses, sample, scope);

    switch (node.type) {
      case 'sequence': {
        if (!cond(node.visibleWhen, ctx)) return;
        const scopeSuffix = scope.map((s) => s.index).join('.');
        if (node.isPage) {
          // Page boundary — emit a pageBreak marker; the preview paginates at these.
          items.push({
            kind: 'pageBreak',
            key: `${node.id}@${scopeSuffix}`,
            title: node.label ? localizePiped(node.label, language, ctx) : '',
          });
        } else if (node.label) {
          items.push({
            kind: 'section',
            key: `${node.id}@${scopeSuffix}`,
            title: localizePiped(node.label, language, ctx),
            depth,
          });
        }
        node.children.forEach((c) => visit(c, scope, depth));
        return;
      }
      case 'statement': {
        if (!cond(node.visibleWhen, ctx)) return;
        items.push({
          kind: 'statement',
          key: `${node.id}@${scope.map((s) => s.index).join('.')}`,
          text: localizePiped(node.text, language, ctx),
          depth,
        });
        return;
      }
      case 'question': {
        if (!cond(node.visibleWhen, ctx)) return;
        const q = node as QuestionConstruct;
        const scopeSuffix = scope.map((s) => s.index).join('.');

        // markAll: each category becomes its own dichotomous variable.
        if (q.responseDomain.type === 'markAll') {
          const domain = q.responseDomain;
          const scheme = instrument.categorySchemes.find((s) => s.id === domain.categorySchemeRef);
          const cats = scheme?.categories ?? [];
          items.push({
            kind: 'markAll',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            variablePrefix: domain.variablePrefix,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            categories: cats.map((cat) => {
              const iKey = instanceKey(`${domain.variablePrefix}_${cat.code}`, scope);
              return {
                code: cat.code,
                label: pick(cat.label, language),
                instanceKey: iKey,
                value: responses[iKey] as number | undefined,
              };
            }),
            firedEdits: [],
            depth,
          });
          return;
        }

        const key = instanceKey(q.variableRef, scope);
        const value = responses[key];
        items.push({
          kind: 'question',
          key: `${q.id}@${scopeSuffix}`,
          instanceKey: key,
          construct: q,
          text: localizePiped(q.text, language, ctx),
          instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
          tooltip: q.tooltip ? localizePiped(q.tooltip, language, ctx) : undefined,
          value,
          firedEdits: evalEdits(q.edits, q.required, value, ctx, language),
          depth,
        });
        return;
      }
      case 'ifThenElse': {
        const branch = cond(node.condition, ctx) ? node.then : (node.else ?? []);
        branch.forEach((c) => visit(c, scope, depth));
        return;
      }
      case 'loop': {
        if (!cond(node.visibleWhen, ctx)) return;
        const count = loopCount(node.countVariableRef, ctx);
        for (let i = 1; i <= count; i++) {
          const childScope: Scope = [...scope, { name: node.loopVariable, index: i }];
          const childCtx = makeContext(instrument, responses, sample, childScope);
          items.push({
            kind: 'loopHeading',
            key: `${node.id}#${i}@${scope.map((s) => s.index).join('.')}`,
            title: node.itemLabel
              ? localizePiped(node.itemLabel, language, childCtx)
              : `${pick(node.label, language)} ${i}`,
            depth,
          });
          node.children.forEach((c) => visit(c, childScope, depth + 1));
        }
        return;
      }
      case 'computation': {
        try {
          responses[instanceKey(node.targetVariableRef, scope)] = evaluate(
            parse(node.expression),
            ctx,
          );
        } catch {
          // ignore
        }
        return;
      }
    }
  };

  visit(instrument.sequence, [], 0);
  return { items, computed: responses };
}

/** Aggregate all fired edits across the flattened instrument (for a completeness summary). */
export function collectEdits(result: FlattenResult): { hard: number; soft: number } {
  let hard = 0;
  let soft = 0;
  for (const item of result.items) {
    if (item.kind !== 'question') continue;
    for (const edit of item.firedEdits) {
      if (edit.type === 'hard') hard++;
      else soft++;
    }
  }
  return { hard, soft };
}
