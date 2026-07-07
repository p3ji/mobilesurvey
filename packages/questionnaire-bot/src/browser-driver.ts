/**
 * Generic Playwright interaction primitives. Deliberately schema-agnostic — every method takes
 * plain CSS selectors, ARIA labels, or visible text, so this file works against any web-based
 * questionnaire, not just the mobilesurvey respondent runtime. The mobilesurvey-specific
 * knowledge (which selector maps to which schema variable) lives in `schema-adapter.ts`; this
 * file only knows how to click/type once told exactly where.
 */
import type { Page } from 'playwright';

export interface DriverError {
  kind: 'console' | 'pageerror' | 'requestfailed';
  message: string;
  url?: string;
  ts: number;
}

const NEXT_BUTTON_PATTERN = /^(next|continue|submit|suivant|soumettre)\b/i;
const BACK_BUTTON_PATTERN = /^(back|previous|retour|précédent)\b/i;

/**
 * Wraps a Playwright `Page` with typed, resilient interaction methods and passive error capture.
 * Every method throws a descriptive Error on failure (locator not found, timeout, etc.) so the
 * runner can attribute a step failure to a specific instrument variable.
 */
export class BrowserDriver {
  readonly errors: DriverError[] = [];

  constructor(readonly page: Page) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.errors.push({ kind: 'console', message: msg.text(), ts: Date.now() });
      }
    });
    page.on('pageerror', (err) => {
      this.errors.push({ kind: 'pageerror', message: err.message, ts: Date.now() });
    });
    page.on('requestfailed', (req) => {
      this.errors.push({
        kind: 'requestfailed',
        message: req.failure()?.errorText ?? 'request failed',
        url: req.url(),
        ts: Date.now(),
      });
    });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  clearErrors(): void {
    this.errors.length = 0;
  }

  // ── text-like inputs ─────────────────────────────────────────────────────

  async fillText(selector: string, value: string): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible' });
    await locator.fill(value);
  }

  async fillNumeric(selector: string, value: number): Promise<void> {
    await this.fillText(selector, String(value));
  }

  async fillDate(selector: string, value: string): Promise<void> {
    await this.fillText(selector, value);
  }

  /** Type into a combobox/datalist-backed input (does not require selecting a suggestion). */
  async fillSearchable(selector: string, text: string): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible' });
    await locator.fill(text);
  }

  // ── grouped choice controls ──────────────────────────────────────────────

  /** Click the radio option within `groupSelector` whose visible label text matches exactly. */
  async selectRadioByLabel(groupSelector: string, labelText: string): Promise<void> {
    const group = this.page.locator(groupSelector);
    await group.waitFor({ state: 'visible' });
    const option = group.locator('label', { hasText: labelText }).first();
    await option.locator('input[type="radio"]').click();
  }

  /** Set a single checkbox's checked state by its visible label text within a group. */
  async setCheckboxByLabel(groupSelector: string, labelText: string, checked: boolean): Promise<void> {
    const group = this.page.locator(groupSelector);
    await group.waitFor({ state: 'visible' });
    const option = group.locator('label', { hasText: labelText }).first();
    const checkbox = option.locator('input[type="checkbox"]');
    const isChecked = await checkbox.isChecked();
    if (isChecked !== checked) await checkbox.click();
  }

  /** Drive every checkbox in a group to match a target label→checked map. */
  async setCheckboxes(groupSelector: string, targets: { labelText: string; checked: boolean }[]): Promise<void> {
    for (const t of targets) {
      await this.setCheckboxByLabel(groupSelector, t.labelText, t.checked);
    }
  }

  /** Click whatever single interactive element carries this exact `aria-label`. */
  async clickByAriaLabel(ariaLabel: string): Promise<void> {
    const locator = this.page.locator(`[aria-label="${cssEscape(ariaLabel)}"]`);
    await locator.waitFor({ state: 'visible' });
    await locator.click();
  }

  /** Set the checked state of a checkbox/radio identified by its exact `aria-label`. */
  async setByAriaLabel(ariaLabel: string, checked: boolean): Promise<void> {
    const locator = this.page.locator(`[aria-label="${cssEscape(ariaLabel)}"]`);
    await locator.waitFor({ state: 'visible' });
    const isChecked = await locator.isChecked().catch(() => false);
    if (isChecked !== checked) await locator.click();
  }

  // ── native form controls (for external/non-mobilesurvey questionnaires) ─

  async fillSelect(selector: string, value: string): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible' });
    await locator.selectOption(value);
  }

  /**
   * Click whatever single element a caller-supplied CSS selector resolves to. Used by discovery
   * mode, which (unlike schema-guided mode) resolves its own selectors from a DOM scan rather
   * than from label text, so it has no need for `selectRadioByLabel`'s label matching.
   */
  async clickSelector(selector: string): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible' });
    await locator.click();
  }

  /** Set the checked state of a checkbox/radio located by an arbitrary CSS selector. */
  async setChecked(selector: string, checked: boolean): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible' });
    const isChecked = await locator.isChecked().catch(() => false);
    if (isChecked !== checked) await locator.click();
  }

  // ── navigation ────────────────────────────────────────────────────────────

  /**
   * Click a "Next"/"Continue"/"Submit" button. Tries the mobilesurvey respondent runtime's
   * known classes first, then falls back to generic text matching so this also works against
   * external questionnaires that don't share that markup.
   */
  async clickNext(): Promise<void> {
    const known = this.page.locator('.eq__nav-next, .eq__nav-submit');
    if ((await known.count()) > 0) {
      await known.first().click();
      return;
    }
    const byText = this.page.getByRole('button', { name: NEXT_BUTTON_PATTERN });
    await byText.first().click();
  }

  async clickBack(): Promise<void> {
    const known = this.page.locator('.eq__nav-back');
    if ((await known.count()) > 0) {
      await known.first().click();
      return;
    }
    const byText = this.page.getByRole('button', { name: BACK_BUTTON_PATTERN });
    await byText.first().click();
  }

  /** True once the mobilesurvey respondent runtime's completion screen is showing. */
  async isComplete(): Promise<boolean> {
    return await this.page.locator('.done__title').isVisible().catch(() => false);
  }
}

function cssEscape(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}
