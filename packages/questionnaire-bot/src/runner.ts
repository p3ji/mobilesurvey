/**
 * Drives a single Scenario end-to-end against a live mobilesurvey respondent runtime page:
 * launches a browser, applies each answer step in order (advancing pages as needed), and reports
 * whether the scenario reached the completion screen along with any captured errors.
 */
import { chromium, type Browser, type Page } from 'playwright';
import type { Instrument, LanguageCode } from '@mobilesurvey/instrument-schema';
import { flattenInstrument, paginate } from '@mobilesurvey/runtime-engine';
import type { RenderItem } from '@mobilesurvey/runtime-engine';
import { BrowserDriver, type DriverError } from './browser-driver.js';
import { resolveStep, type LocatorStrategy } from './schema-adapter.js';
import type { Scenario } from './types.js';

export interface RunOptions {
  /** URL of the respondent runtime, e.g. `http://localhost:5174/?survey=demo`. */
  url: string;
  language?: LanguageCode;
  headless?: boolean;
  /** Per-action timeout in ms, passed to Playwright's default locator timeout. */
  actionTimeoutMs?: number;
  /** Reuse an existing Browser instance instead of launching a new one per scenario. */
  browser?: Browser;
}

export interface StepResult {
  step: Scenario['steps'][number];
  strategy: LocatorStrategy;
  ok: boolean;
  error?: string;
}

export interface ScenarioRunResult {
  scenario: Scenario;
  stepResults: StepResult[];
  /** True once `.done__title` (the runtime's completion screen) appeared. */
  reachedCompletion: boolean;
  consoleErrors: DriverError[];
  durationMs: number;
  /** Set if the run failed outside of any individual step (e.g. navigation failure). */
  fatalError?: string;
}

function findItemPage(pages: RenderItem[][], instanceKey: string): number | undefined {
  for (let i = 0; i < pages.length; i++) {
    for (const item of pages[i]!) {
      if (item.kind === 'question' && item.instanceKey === instanceKey) return i;
      if (item.kind === 'markAll' && item.categories.some((c) => c.instanceKey === instanceKey)) return i;
      if (item.kind === 'grid' && item.rows.some((r) => r.instanceKey === instanceKey)) return i;
    }
  }
  return undefined;
}

async function applyStrategy(driver: BrowserDriver, strategy: LocatorStrategy): Promise<void> {
  switch (strategy.kind) {
    case 'fill-text':
      await driver.fillText(formControlSelector(strategy.inputId), strategy.value);
      return;
    case 'fill-numeric':
      await driver.fillNumeric(formControlSelector(strategy.inputId), strategy.value);
      return;
    case 'fill-date':
      await driver.fillDate(formControlSelector(strategy.inputId), strategy.value);
      return;
    case 'fill-searchable':
      await driver.fillSearchable(formControlSelector(strategy.inputId), strategy.text);
      return;
    case 'select-radio':
      await driver.selectRadioByLabel(strategy.groupSelector, strategy.labelText);
      return;
    case 'set-checkboxes':
      await driver.setCheckboxes(strategy.groupSelector, strategy.targets);
      return;
    case 'markall-checkbox':
      await driver.setCheckboxByLabel(
        `[aria-label="${cssAttrEscape(strategy.groupAriaLabel)}"]`,
        strategy.labelText,
        strategy.checked,
      );
      return;
    case 'grid-radio':
      await driver.setByAriaLabel(strategy.cellAriaLabel, true);
      return;
    case 'skip':
      return; // intentionally not driven (see resolveStep's reason)
  }
}

/** CSS.escape-lite for id selectors (ids here are always simple `[\w@.:;=-]+` strings). */
function cssId(id: string): string {
  return id.replace(/([.:@;=])/g, '\\$1');
}

/**
 * Scopes an inputId to its concrete form-control tag rather than a bare `#id` selector.
 * Defensive: QuestionPage.tsx previously duplicated a question's inputId onto both its `<label>`
 * and its control (fixed — see respondent-view's QuestionPage.tsx), and an arbitrary external
 * questionnaire (non-mobilesurvey target) may have its own id collisions we don't control.
 */
function formControlSelector(id: string): string {
  const escaped = cssId(id);
  return `input#${escaped}, textarea#${escaped}, select#${escaped}`;
}

function cssAttrEscape(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

/**
 * Run one Scenario against a live respondent runtime page. Launches its own browser + page
 * unless `options.browser` is supplied (for running many scenarios without relaunching Chromium
 * each time — see `runScenarios`).
 */
export async function runScenario(
  instrument: Instrument,
  scenario: Scenario,
  options: RunOptions,
): Promise<ScenarioRunResult> {
  const start = Date.now();
  const language = options.language ?? instrument.defaultLanguage;
  const ownBrowser = !options.browser;
  const browser = options.browser ?? (await chromium.launch({ headless: options.headless ?? true }));

  let page: Page | undefined;
  try {
    page = await browser.newPage();
    if (options.actionTimeoutMs) page.setDefaultTimeout(options.actionTimeoutMs);
    const driver = new BrowserDriver(page);

    await page.goto(options.url, { waitUntil: 'domcontentloaded' });

    const responses: Record<string, unknown> = {};
    const stepResults: StepResult[] = [];
    let currentPage = 0;

    for (const step of scenario.steps) {
      const { items } = flattenInstrument(instrument, { responses, sample: {}, language });
      const { pages } = paginate(items);
      const targetPage = findItemPage(pages, step.instanceKey);

      if (targetPage !== undefined) {
        while (currentPage < targetPage) {
          await driver.clickNext();
          currentPage++;
        }
      }

      const { strategy } = resolveStep(instrument, responses, language, step);
      try {
        await applyStrategy(driver, strategy);
        stepResults.push({ step, strategy, ok: strategy.kind !== 'skip' });
      } catch (err) {
        stepResults.push({
          step,
          strategy,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      responses[step.instanceKey] = step.value;
    }

    // Advance through any remaining pages (submits on the last one).
    let reachedCompletion = await driver.isComplete();
    for (let guard = 0; !reachedCompletion && guard < 50; guard++) {
      try {
        await driver.clickNext();
      } catch {
        break;
      }
      reachedCompletion = await driver.isComplete();
      if (reachedCompletion) break;
    }

    return {
      scenario,
      stepResults,
      reachedCompletion,
      consoleErrors: driver.errors,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenario,
      stepResults: [],
      reachedCompletion: false,
      consoleErrors: [],
      durationMs: Date.now() - start,
      fatalError: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page?.close().catch(() => undefined);
    if (ownBrowser) await browser.close().catch(() => undefined);
  }
}

/** Run many scenarios sequentially against one shared browser instance (faster than relaunching). */
export async function runScenarios(
  instrument: Instrument,
  scenarios: Scenario[],
  options: RunOptions,
): Promise<ScenarioRunResult[]> {
  const browser = options.browser ?? (await chromium.launch({ headless: options.headless ?? true }));
  const results: ScenarioRunResult[] = [];
  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(instrument, scenario, { ...options, browser }));
    }
  } finally {
    if (!options.browser) await browser.close().catch(() => undefined);
  }
  return results;
}
