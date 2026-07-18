/**
 * Translates a Scenario's schema-level AnswerSteps into concrete DOM locator strategies for the
 * mobilesurvey respondent runtime (`@mobilesurvey/respondent-view`'s rendered markup).
 *
 * Why this needs to re-flatten: `AnswerStep.instanceKey` is built from the *variable name*
 * (`instanceKey(variableRef, scope)` → `memberName@m=1`), but the DOM id the runtime renders is
 * built from the *construct id* (`${construct.id}@${scopeSuffix}`, see flatten.ts). These are
 * different strings whenever a question's `id` isn't identical to its `variableRef` — which is
 * common. The only reliable way to go from "this variable, this scope" to "this DOM id" is to
 * flatten the instrument with the responses accumulated so far and search the resulting
 * RenderItems for a match, exactly as the respondent app itself does on every render.
 */
import type { CategoryScheme, Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { flattenInstrument } from '@mobilesurvey/runtime-engine';
import type { RenderItem, RuntimeState } from '@mobilesurvey/runtime-engine';
import type { AnswerStep } from './types.js';

function lbl(intl: Record<string, string> | undefined, lang: LanguageCode): string {
  if (!intl) return '';
  return intl[lang] ?? Object.values(intl)[0] ?? '';
}

function schemeCategories(schemes: CategoryScheme[], ref: string) {
  return schemes.find((s) => s.id === ref)?.categories ?? [];
}

/** The mobilesurvey respondent runtime's boolean control renders these two fixed options. */
function booleanLabel(value: boolean, lang: LanguageCode): string {
  if (lang === 'fr') return value ? 'Oui' : 'Non';
  return value ? 'Yes' : 'No';
}

/**
 * How the browser driver should locate and interact with the DOM element(s) for one AnswerStep.
 * Each variant maps 1:1 to a `BrowserDriver` method.
 */
export type LocatorStrategy =
  | { kind: 'fill-text'; inputId: string; value: string }
  | { kind: 'fill-numeric'; inputId: string; value: number }
  | { kind: 'fill-date'; inputId: string; value: string }
  | { kind: 'fill-searchable'; inputId: string; text: string }
  | { kind: 'select-radio'; groupSelector: string; labelText: string }
  | { kind: 'set-checkboxes'; groupSelector: string; targets: { labelText: string; checked: boolean }[] }
  | { kind: 'markall-checkbox'; groupAriaLabel: string; labelText: string; checked: boolean }
  | { kind: 'grid-radio'; cellAriaLabel: string }
  | { kind: 'skip'; reason: string };

export interface ResolvedStep {
  step: AnswerStep;
  strategy: LocatorStrategy;
}

/** DOM id the respondent runtime assigns to a question's primary control (see QuestionPage.tsx). */
function inputIdFor(itemKey: string): string {
  return `eq-ctrl-${itemKey}`;
}

/**
 * Resolve one AnswerStep to a concrete locator strategy.
 *
 * `responsesSoFar` must be the response map accumulated from all *previous* steps in the
 * scenario (not including this one) — the instrument is re-flattened against that state so
 * conditional visibility/roster expansion matches what the browser is actually showing right now.
 */
export function resolveStep(
  instrument: Instrument,
  responsesSoFar: Record<string, unknown>,
  language: LanguageCode,
  step: AnswerStep,
): ResolvedStep {
  const state: RuntimeState = { responses: responsesSoFar, sample: {}, language };
  const { items } = flattenInstrument(instrument, state);

  const strategy = resolveAgainstItems(instrument, items, language, step);
  return { step, strategy };
}

function resolveAgainstItems(
  instrument: Instrument,
  items: RenderItem[],
  language: LanguageCode,
  step: AnswerStep,
): LocatorStrategy {
  for (const item of items) {
    if (item.kind === 'question' && item.instanceKey === step.instanceKey) {
      return resolveQuestion(instrument, item, language, step);
    }
    if (item.kind === 'markAll') {
      const cat = item.categories.find((c) => c.instanceKey === step.instanceKey);
      if (cat) {
        return {
          kind: 'markall-checkbox',
          groupAriaLabel: item.questionText,
          labelText: cat.label,
          checked: step.value === 1,
        };
      }
    }
    if (item.kind === 'grid') {
      const row = item.rows.find((r) => r.instanceKey === step.instanceKey);
      if (row) {
        const col = item.columns.find((c) => c.code === step.value);
        if (!col) return { kind: 'skip', reason: `grid column code ${String(step.value)} not found` };
        return { kind: 'grid-radio', cellAriaLabel: `${row.label}: ${col.label}` };
      }
    }
  }
  return { kind: 'skip', reason: `no rendered item found for instanceKey "${step.instanceKey}"` };
}

function resolveQuestion(
  instrument: Instrument,
  item: Extract<RenderItem, { kind: 'question' }>,
  language: LanguageCode,
  step: AnswerStep,
): LocatorStrategy {
  const inputId = inputIdFor(item.key);
  const domain = item.construct.responseDomain;

  switch (domain.type) {
    case 'numeric':
      if (step.value === null || step.value === undefined) return { kind: 'skip', reason: 'null numeric value' };
      return { kind: 'fill-numeric', inputId, value: Number(step.value) };

    case 'text':
      return { kind: 'fill-text', inputId, value: String(step.value ?? '') };

    case 'datetime':
      return { kind: 'fill-date', inputId, value: String(step.value ?? '') };

    case 'boolean': {
      if (typeof step.value !== 'boolean') return { kind: 'skip', reason: 'non-boolean value for boolean domain' };
      const groupSelector = `[aria-labelledby="${inputId}"]`;
      return { kind: 'select-radio', groupSelector, labelText: booleanLabel(step.value, language) };
    }

    case 'lookup': {
      // The runtime's lookup control stores whatever text the respondent typed/selected — the
      // datalist's option *values* are category labels, not codes — so we must type the label
      // corresponding to the target code, not the code itself.
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
      const cat = opts.find((c) => c.code === step.value);
      if (!cat) {
        // null / unmatched code (e.g. boundary-mode "clear the field") — type nothing.
        return { kind: 'fill-searchable', inputId, text: '' };
      }
      return { kind: 'fill-searchable', inputId, text: lbl(cat.label, language) };
    }

    case 'code': {
      const opts = schemeCategories(instrument.categorySchemes, domain.categorySchemeRef);
      const groupSelector = `[aria-labelledby="${inputId}"]`;

      if (domain.selection === 'single') {
        if (step.value === null || step.value === undefined) {
          // No native way to "deselect" a radio group in this UI — nothing to click.
          return { kind: 'skip', reason: 'null single-select value (no deselect control in UI)' };
        }
        const cat = opts.find((c) => c.code === step.value);
        if (!cat) return { kind: 'skip', reason: `code ${String(step.value)} not found in scheme` };
        return { kind: 'select-radio', groupSelector, labelText: lbl(cat.label, language) };
      }

      // multiple selection — step.value is the full target array; drive every checkbox to match.
      const targetCodes = Array.isArray(step.value) ? (step.value as string[]) : [];
      const targets = opts.map((c) => ({
        labelText: lbl(c.label, language),
        checked: targetCodes.includes(c.code),
      }));
      return { kind: 'set-checkboxes', groupSelector, targets };
    }

    case 'file':
      return { kind: 'skip', reason: 'file uploads are not driven by the bot' };

    // Unreachable in practice: flatten.ts renders markAll/grid/table domains as their own
    // RenderItem kinds ('markAll'/'grid'/'table'), never as a plain 'question' item — but
    // QuestionConstruct['responseDomain'] is the full ResponseDomain union, so TS still needs
    // an exhaustive case here.
    case 'markAll':
    case 'grid':
    case 'table':
    case 'geolocation':
    case 'photo':
      return { kind: 'skip', reason: `unexpected ${domain.type} domain on a plain question item` };
  }
}
