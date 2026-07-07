/**
 * Infers form structure from a live page's DOM — no schema, no prior knowledge of the
 * questionnaire. This is what makes discovery mode work against arbitrary web questionnaires:
 * schema-guided mode (schema-adapter.ts) knows exactly which DOM id a variable renders to because
 * it re-flattens the instrument; discovery mode has no instrument, so it has to look at the page
 * itself and guess.
 *
 * Every discovered field/option gets a `data-qbot-idx` attribute stamped onto its element during
 * the scan, so it can be re-located by a stable `[data-qbot-idx="N"]` selector afterwards — far
 * more robust than trying to rebuild a CSS selector from tag/class/position, and it doesn't
 * require the target page to have `id`/`name` attributes at all.
 */
import type { Page } from 'playwright';
import type { DiscoveredField, DiscoveredPage } from './types.js';

const NEXT_OR_SUBMIT_PATTERN = /^(next|continue|submit|finish|done|suivant|soumettre|terminer)\b/i;

/**
 * Runs entirely inside the browser (via `page.evaluate`) — must be a self-contained function
 * with no outer-scope references, since Playwright serializes it to run in the page context.
 */
function scanScript(): DiscoveredField[] {
  // The counter must persist on `window` across repeated scanPage() calls within the same page
  // lifetime (not reset to 0 per call) — otherwise a field first tagged on a later scan can be
  // assigned an idx already claimed by an element tagged on an earlier scan (e.g. a step-1 field
  // hidden after transitioning to step 2, and a step-2 field only now becoming visible), producing
  // two elements with the same `data-qbot-idx` and breaking every selector built from it.
  function nextIdx(el: Element): string {
    const attr = 'data-qbot-idx';
    let v = el.getAttribute(attr);
    if (!v) {
      const win = window as unknown as { __qbotCounter?: number };
      win.__qbotCounter = (win.__qbotCounter ?? 0) + 1;
      v = String(win.__qbotCounter);
      el.setAttribute(attr, v);
    }
    return v;
  }

  function resolveLabelledBy(idRefs: string): string {
    return idRefs
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
  }

  function labelForControl(el: HTMLElement): string {
    const id = el.getAttribute('id');
    if (id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = resolveLabelledBy(labelledBy);
      if (text) return text;
    }
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder) return placeholder;
    return '';
  }

  function isVisible(el: HTMLElement): boolean {
    // offsetParent is null for display:none (and ancestors thereof), except for position:fixed
    // elements — which a hidden multi-step-form panel virtually never is, so this heuristic holds.
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function groupLabel(container: Element | null, fallback: string): string {
    if (container) {
      const fieldset = container.closest('fieldset');
      const legend = fieldset?.querySelector('legend');
      if (legend?.textContent?.trim()) return legend.textContent.trim();
      const ariaLabel = container.getAttribute('aria-label');
      if (ariaLabel?.trim()) return ariaLabel.trim();
      const labelledBy = container.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = resolveLabelledBy(labelledBy);
        if (text) return text;
      }
    }
    return fallback;
  }

  const results: DiscoveredField[] = [];
  const seenGroupKeys = new Set<string>();
  const allControls = Array.from(document.querySelectorAll('input, select, textarea')) as HTMLElement[];

  for (const el of allControls) {
    const tag = el.tagName.toLowerCase();
    const inputType = (el as HTMLInputElement).type?.toLowerCase();

    if ((el as HTMLInputElement & { disabled?: boolean }).disabled) continue;
    if (tag === 'input' && ['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(inputType)) continue;
    if (!isVisible(el)) continue;

    if (tag === 'input' && (inputType === 'radio' || inputType === 'checkbox')) {
      const name = (el as HTMLInputElement).name;
      const groupKey = name || `__solo_${nextIdx(el)}`;
      if (seenGroupKeys.has(groupKey)) continue;
      seenGroupKeys.add(groupKey);

      const members = (
        name
          ? (Array.from(document.getElementsByName(name)) as HTMLInputElement[]).filter(
              (m) => m.type.toLowerCase() === inputType,
            )
          : [el as HTMLInputElement]
      ).filter(isVisible);
      if (members.length === 0) continue;

      const container = members[0]?.closest('[role="radiogroup"], [role="group"], fieldset') ?? null;
      const options = members.map((m) => ({
        label: labelForControl(m) || m.value || '',
        value: m.value || '',
        selector: `[data-qbot-idx="${nextIdx(m)}"]`,
      }));
      const required = members.some((m) => m.required);
      const fallbackLabel = options[0]?.label ?? '';

      if (inputType === 'checkbox' && members.length === 1) {
        results.push({
          kind: 'checkbox-single',
          label: fallbackLabel,
          selector: options[0]!.selector,
          required,
        });
      } else {
        results.push({
          kind: inputType === 'radio' ? 'radio-group' : 'checkbox-group',
          label: groupLabel(container, fallbackLabel),
          selector: container ? `[data-qbot-idx="${nextIdx(container)}"]` : (options[0]?.selector ?? ''),
          options,
          required,
        });
      }
      continue;
    }

    if (tag === 'select') {
      const selectEl = el as HTMLSelectElement;
      const options = Array.from(selectEl.options)
        .filter((o) => !o.disabled)
        .map((o) => ({ label: o.textContent?.trim() ?? '', value: o.value, selector: '' }));
      results.push({
        kind: 'select',
        label: labelForControl(el),
        selector: `[data-qbot-idx="${nextIdx(el)}"]`,
        options,
        required: selectEl.required,
      });
      continue;
    }

    if (tag === 'textarea') {
      const textareaEl = el as HTMLTextAreaElement;
      results.push({
        kind: 'textarea',
        label: labelForControl(el),
        selector: `[data-qbot-idx="${nextIdx(el)}"]`,
        required: textareaEl.required,
        maxLength: textareaEl.maxLength > 0 ? textareaEl.maxLength : undefined,
      });
      continue;
    }

    if (tag === 'input') {
      const inputEl = el as HTMLInputElement;
      const kindMap: Record<string, DiscoveredField['kind']> = {
        email: 'email',
        tel: 'tel',
        number: 'number',
        date: 'date',
        url: 'url',
      };
      results.push({
        kind: kindMap[inputType] ?? 'text',
        label: labelForControl(el),
        selector: `[data-qbot-idx="${nextIdx(el)}"]`,
        required: inputEl.required,
        min: inputEl.min || undefined,
        max: inputEl.max || undefined,
        maxLength: inputEl.maxLength > 0 ? inputEl.maxLength : undefined,
      });
    }
  }

  return results;
}

async function hasNextOrSubmitControl(page: Page): Promise<boolean> {
  const visible = page.locator(':visible');
  const known = page.locator('.eq__nav-next, .eq__nav-submit').and(visible);
  if ((await known.count()) > 0) return true;
  const byRole = page.getByRole('button', { name: NEXT_OR_SUBMIT_PATTERN }).and(visible);
  if ((await byRole.count()) > 0) return true;
  const submitInput = page.locator('input[type="submit"]').and(visible);
  return (await submitInput.count()) > 0;
}

/** Scans the current page for interactive form fields, tagging each with a stable locator. */
export async function scanPage(page: Page): Promise<DiscoveredPage> {
  const fields = await page.evaluate(scanScript);
  const hasNextControl = await hasNextOrSubmitControl(page);
  return { url: page.url(), fields, hasNextControl };
}
