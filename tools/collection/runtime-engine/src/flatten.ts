/**
 * Flattens an instrument's control-construct tree into an ordered list of render-ready items for
 * the current runtime state: evaluating visibility/routing, expanding rosters (including nested),
 * resolving piping, running soft/hard edits, and computing mid-interview computations.
 *
 * Pure: it clones the response map so derived/computation writes never mutate the input.
 */
import { evaluate, parse, type EvalContext } from '@mobilesurvey/expression-engine';
import {
  DICHOTOMOUS_CODES,
  SENSOR_CONSENT_VARIABLES,
  TABLE_TOTAL_CODE,
} from '@mobilesurvey/instrument-schema';
import type {
  ControlConstruct,
  EditRule,
  Instrument,
  LanguageCode,
  QuestionConstruct,
} from '@mobilesurvey/instrument-schema';
import { localizePiped, pick } from './piping.js';
import { instanceKey, makeContext, type SyntheticTotals } from './scope.js';
import type { FiredEdit, RenderItem, RuntimeState, Scope, TableCell } from './types.js';

const REQUIRED_MESSAGE: Record<string, string> = {
  en: 'This field is required.',
  fr: 'Ce champ est obligatoire.',
};

const TOTAL_LABEL: Record<string, string> = {
  en: 'Total',
  fr: 'Total',
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

/**
 * Register every table domain's synthetic total names (`P_row_TOT`, `P_TOT_col`, `P_TOT_TOT`)
 * with the enabled input cells they sum. Totals are always referenceable from expressions,
 * regardless of whether the table displays them (`totalRow`/`totalCol` govern display only).
 */
/**
 * Builds the synthetic-total registry for an instrument's `table` questions. Exported so
 * consumers that need to evaluate expressions/rules outside a full `flattenInstrument` pass
 * (e.g. the Validator re-running edits/rules over stored responses) can pass it to
 * `makeContext` and get the same `{prefix}_{row}_TOT` / `_TOT_{col}` / `_TOT_TOT` resolution.
 */
export function buildSyntheticTotals(instrument: Instrument): SyntheticTotals {
  const map: SyntheticTotals = new Map();
  const visitAll = (nodes: ControlConstruct[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'sequence':
        case 'loop':
          visitAll(node.children);
          break;
        case 'ifThenElse':
          visitAll(node.then);
          visitAll(node.else ?? []);
          break;
        case 'question': {
          const rd = node.responseDomain;
          if (rd.type !== 'table') break;
          const rowCodes = (
            instrument.categorySchemes.find((s) => s.id === rd.rowSchemeRef)?.categories ?? []
          ).map((c) => c.code);
          const colCodes = (
            instrument.categorySchemes.find((s) => s.id === rd.colSchemeRef)?.categories ?? []
          ).map((c) => c.code);
          const disabled = new Set(rd.disabledCells ?? []);
          const p = rd.variablePrefix;
          const all: string[] = [];
          for (const r of rowCodes) {
            const rowCells: string[] = [];
            for (const c of colCodes) {
              if (disabled.has(`${r}:${c}`)) continue;
              const cell = `${p}_${r}_${c}`;
              rowCells.push(cell);
              all.push(cell);
            }
            map.set(`${p}_${r}_${TABLE_TOTAL_CODE}`, { cellNames: rowCells });
          }
          for (const c of colCodes) {
            const colCells = rowCodes
              .filter((r) => !disabled.has(`${r}:${c}`))
              .map((r) => `${p}_${r}_${c}`);
            map.set(`${p}_${TABLE_TOTAL_CODE}_${c}`, { cellNames: colCells });
          }
          map.set(`${p}_${TABLE_TOTAL_CODE}_${TABLE_TOTAL_CODE}`, { cellNames: all });
          break;
        }
        default:
          break;
      }
    }
  };
  visitAll([instrument.sequence]);
  return map;
}

export function flattenInstrument(instrument: Instrument, state: RuntimeState): FlattenResult {
  const responses: Record<string, unknown> = { ...state.responses };
  const { sample, language } = state;
  const items: RenderItem[] = [];
  const synthetic = buildSyntheticTotals(instrument);

  const visit = (node: ControlConstruct, scope: Scope, depth: number): void => {
    const ctx = makeContext(instrument, responses, sample, scope, synthetic);

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

        // grid: each row becomes its own code variable (variablePrefix_rowCode = colCode).
        if (q.responseDomain.type === 'grid') {
          const domain = q.responseDomain;
          const rowScheme = instrument.categorySchemes.find((s) => s.id === domain.rowSchemeRef);
          const colScheme = instrument.categorySchemes.find((s) => s.id === domain.colSchemeRef);
          const rows = (rowScheme?.categories ?? []).map((cat) => {
            const iKey = instanceKey(`${domain.variablePrefix}_${cat.code}`, scope);
            return {
              code: cat.code,
              label: pick(cat.label, language),
              instanceKey: iKey,
              value: responses[iKey] as string | undefined,
            };
          });
          const columns = (colScheme?.categories ?? []).map((cat) => ({
            code: cat.code,
            label: pick(cat.label, language),
          }));
          const anyRowAnswered = rows.some((r) => !isEmpty(r.value));
          items.push({
            kind: 'grid',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            variablePrefix: domain.variablePrefix,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            rows,
            columns,
            // required = at least one row answered; a sentinel value stands in for the scalar
            // `value` so evalEdits' required check fires only when every row is blank.
            firedEdits: evalEdits(q.edits, q.required, anyRowAnswered ? 1 : '', ctx, language),
            depth,
          });
          return;
        }

        // table: establishment data table — one numeric variable per enabled cell
        // (variablePrefix_rowCode_colCode); computed totals resolve via synthetic names.
        if (q.responseDomain.type === 'table') {
          const domain = q.responseDomain;
          const rowScheme = instrument.categorySchemes.find((s) => s.id === domain.rowSchemeRef);
          const colScheme = instrument.categorySchemes.find((s) => s.id === domain.colSchemeRef);
          const disabled = new Set(domain.disabledCells ?? []);
          const totalLabel = TOTAL_LABEL[language] ?? TOTAL_LABEL.en!;
          const baseRows = (rowScheme?.categories ?? []).map((cat) => ({
            code: cat.code,
            label: pick(cat.label, language),
          }));
          const baseCols = (colScheme?.categories ?? []).map((cat) => ({
            code: cat.code,
            label: pick(cat.label, language),
          }));
          const rows = domain.totalRow
            ? [...baseRows, { code: TABLE_TOTAL_CODE, label: totalLabel, isTotal: true }]
            : baseRows;
          const columns = domain.totalCol
            ? [...baseCols, { code: TABLE_TOTAL_CODE, label: totalLabel, isTotal: true }]
            : baseCols;
          let anyAnswered = false;
          const cells: TableCell[][] = rows.map((row) =>
            columns.map((col) => {
              const name = `${domain.variablePrefix}_${row.code}_${col.code}`;
              if (('isTotal' in row && row.isTotal) || ('isTotal' in col && col.isTotal)) {
                const raw = ctx.resolve(name);
                const n = typeof raw === 'number' ? raw : Number(raw);
                return {
                  instanceKey: instanceKey(name, scope),
                  value: raw !== undefined && Number.isFinite(n) ? n : undefined,
                  disabled: false,
                  computed: true,
                };
              }
              const iKey = instanceKey(name, scope);
              if (disabled.has(`${row.code}:${col.code}`)) {
                return { instanceKey: iKey, value: undefined, disabled: true, computed: false };
              }
              const raw = responses[iKey];
              const n = typeof raw === 'number' ? raw : Number(raw);
              const value = !isEmpty(raw) && Number.isFinite(n) ? n : undefined;
              if (value !== undefined) anyAnswered = true;
              return { instanceKey: iKey, value, disabled: false, computed: false };
            }),
          );
          items.push({
            kind: 'table',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            variablePrefix: domain.variablePrefix,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            unit: domain.unit ? pick(domain.unit, language) : undefined,
            decimals: domain.decimals,
            min: domain.min,
            max: domain.max,
            required: q.required,
            rows,
            columns,
            cells,
            // required = at least one enabled input cell answered; a sentinel value stands in
            // for the scalar `value` so evalEdits' required check fires only when all-blank.
            firedEdits: evalEdits(q.edits, q.required, anyAnswered ? 1 : '', ctx, language),
            depth,
          });
          return;
        }

        // markAll: each category becomes its own dichotomous variable.
        if (q.responseDomain.type === 'markAll') {
          const domain = q.responseDomain;
          const scheme = instrument.categorySchemes.find((s) => s.id === domain.categorySchemeRef);
          const cats = scheme?.categories ?? [];
          let anyChecked = false;
          const categories = cats.map((cat) => {
            const iKey = instanceKey(`${domain.variablePrefix}_${cat.code}`, scope);
            const value = responses[iKey] as number | undefined;
            // Unlike grid (which only ever writes on selection), markAll writes an explicit
            // "unchecked" sentinel (DICHOTOMOUS_CODES.NO) the moment a checkbox is toggled off,
            // so `!isEmpty(value)` alone would treat "touched then unchecked" as an answer.
            // "Checked" means value === YES specifically.
            if (value === DICHOTOMOUS_CODES.YES) anyChecked = true;
            return { code: cat.code, label: pick(cat.label, language), instanceKey: iKey, value };
          });
          items.push({
            kind: 'markAll',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            variablePrefix: domain.variablePrefix,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            categories,
            // required = at least one category checked; a sentinel value stands in for the
            // scalar `value` so evalEdits' required check fires only when none are checked.
            firedEdits: evalEdits(q.edits, q.required, anyChecked ? 1 : '', ctx, language),
            depth,
          });
          return;
        }

        // geolocation: consent-gated device capture; base variable holds the pipeable
        // summary, generated `_LAT/_LON/_ACC/_TS/_SRC` sub-variables hold the parts.
        if (q.responseDomain.type === 'geolocation') {
          const domain = q.responseDomain;
          const baseKey = instanceKey(q.variableRef, scope);
          const decl = instrument.sensors?.sensors.find((s) => s.kind === 'geolocation');
          // Consent is session-global (one decision per sensor kind), never roster-scoped —
          // stored at root scope so `$CONSENT_GEOLOCATION` resolves in routing expressions.
          const consentKey = instanceKey(SENSOR_CONSENT_VARIABLES.geolocation, []);
          const consentRaw = responses[consentKey];
          const value = responses[baseKey] as string | undefined;
          items.push({
            kind: 'geolocation',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            required: q.required,
            instanceKey: baseKey,
            value,
            subKeys: {
              lat: instanceKey(`${q.variableRef}_LAT`, scope),
              lon: instanceKey(`${q.variableRef}_LON`, scope),
              acc: instanceKey(`${q.variableRef}_ACC`, scope),
              ts: instanceKey(`${q.variableRef}_TS`, scope),
              src: instanceKey(`${q.variableRef}_SRC`, scope),
            },
            src: responses[instanceKey(`${q.variableRef}_SRC`, scope)] as string | undefined,
            consent:
              consentRaw === 'granted' || consentRaw === 'declined' ? consentRaw : undefined,
            consentKey,
            // A missing declaration is a validation error; the empty purpose makes the
            // control render its "sensor not declared" refusal instead of capturing.
            purpose: decl ? pick(decl.purpose, language) : '',
            retention: decl?.retention ? pick(decl.retention, language) : undefined,
            precision: domain.precision ?? 3,
            maxAccuracyM: domain.maxAccuracyM,
            manualFallback: domain.manualFallback !== false,
            firedEdits: evalEdits(q.edits, q.required, value, ctx, language),
            depth,
          });
          return;
        }

        // photo: consent-gated camera capture; base variable holds the attachment ref.
        if (q.responseDomain.type === 'photo') {
          const domain = q.responseDomain;
          const baseKey = instanceKey(q.variableRef, scope);
          const decl = instrument.sensors?.sensors.find((s) => s.kind === 'camera');
          const consentKey = instanceKey(SENSOR_CONSENT_VARIABLES.camera, []);
          const consentRaw = responses[consentKey];
          const value = responses[baseKey] as string | undefined;

          let recognition;
          if (domain.recognition) {
            const rec = domain.recognition;
            const maxItems = rec.maxItems ?? 5;
            const scheme = rec.itemSchemeRef
              ? instrument.categorySchemes.find((s) => s.id === rec.itemSchemeRef)
              : undefined;
            const nRaw = responses[instanceKey(`${rec.variablePrefix}_N_ITEMS`, scope)];
            const n = Math.min(typeof nRaw === 'number' ? nRaw : Number(nRaw) || 0, maxItems);
            const storedItems = Array.from({ length: n }, (_, idx) => {
              const i = idx + 1;
              const get = (suffix: string): unknown =>
                responses[instanceKey(`${rec.variablePrefix}_I${i}_${suffix}`, scope)];
              const qty = get('QTY');
              const conf = get('CONF');
              return {
                label: String(get('LABEL') ?? ''),
                qty: typeof qty === 'number' ? qty : undefined,
                unit: (get('UNIT') as string | undefined) ?? undefined,
                conf: typeof conf === 'number' ? conf : undefined,
              };
            });
            recognition = {
              profile: rec.profile,
              variablePrefix: rec.variablePrefix,
              maxItems,
              scopeSuffix: scope.map((s) => `${s.name}=${s.index}`).join(';'),
              itemOptions: scheme
                ? scheme.categories.map((c) => ({ code: c.code, label: pick(c.label, language) }))
                : undefined,
              storedItems,
            };
          }
          items.push({
            kind: 'photo',
            key: `${q.id}@${scopeSuffix}`,
            constructId: q.id,
            questionText: localizePiped(q.text, language, ctx),
            instruction: q.instruction ? localizePiped(q.instruction, language, ctx) : undefined,
            required: q.required,
            instanceKey: baseKey,
            value,
            subKeys: {
              ts: instanceKey(`${q.variableRef}_TS`, scope),
              src: instanceKey(`${q.variableRef}_SRC`, scope),
            },
            src: responses[instanceKey(`${q.variableRef}_SRC`, scope)] as string | undefined,
            consent:
              consentRaw === 'granted' || consentRaw === 'declined' ? consentRaw : undefined,
            consentKey,
            purpose: decl ? pick(decl.purpose, language) : '',
            retention: decl?.retention ? pick(decl.retention, language) : undefined,
            facing: domain.facing ?? 'environment',
            allowLibrary: domain.allowLibrary === true,
            maxEdgePx: domain.maxEdgePx ?? 1600,
            recognition,
            firedEdits: evalEdits(q.edits, q.required, value, ctx, language),
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
          const childCtx = makeContext(instrument, responses, sample, childScope, synthetic);
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
    if (item.kind !== 'question' && item.kind !== 'table' && item.kind !== 'geolocation' && item.kind !== 'photo') continue;
    for (const edit of item.firedEdits) {
      if (edit.type === 'hard') hard++;
      else soft++;
    }
  }
  return { hard, soft };
}
