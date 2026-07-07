/**
 * Drives an arbitrary web questionnaire end-to-end without a schema: scan the current page for
 * fields, answer each with a heuristic (or classifier-supplied) value, click whatever looks like
 * "Next"/"Submit", and repeat until a completion state is detected or nothing changes.
 *
 * This is the schema-free counterpart to runner.ts's `runScenario`. It reuses `BrowserDriver`
 * (browser-driver.ts is deliberately schema-agnostic) but replaces `schema-adapter.ts`'s
 * re-flatten-and-match step with `scanner.ts`'s DOM inference, since there's no Instrument to
 * consult here.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { BrowserDriver } from '../browser-driver.js';
import { scanPage } from './scanner.js';
import { generateDiscoveryValue } from './value-gen.js';
import type {
  DiscoveredField,
  DiscoveredOption,
  DiscoveryIssue,
  DiscoveryPageVisit,
  DiscoveryRunResult,
  FieldClassifier,
} from './types.js';

export interface DiscoveryRunOptions {
  url: string;
  headless?: boolean;
  /** Safety cap on how many pages to walk before giving up (default 20). */
  maxPages?: number;
  actionTimeoutMs?: number;
  captureScreenshots?: boolean;
  /** Optional pluggable classifier (e.g. LLM-backed) consulted before the built-in heuristic. */
  classifier?: FieldClassifier;
  /** Reuse an existing Browser instance instead of launching a new one. */
  browser?: Browser;
}

async function answerField(driver: BrowserDriver, field: DiscoveredField, value: unknown): Promise<void> {
  switch (field.kind) {
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'date':
      await driver.fillText(field.selector, String(value ?? ''));
      return;

    case 'number':
      await driver.fillNumeric(field.selector, Number(value));
      return;

    case 'textarea':
      await driver.fillText(field.selector, String(value ?? ''));
      return;

    case 'select': {
      const opt = value as DiscoveredOption | undefined;
      if (!opt) return;
      await driver.fillSelect(field.selector, opt.value || opt.label);
      return;
    }

    case 'radio-group': {
      const opt = value as DiscoveredOption | undefined;
      if (!opt) return;
      await driver.clickSelector(opt.selector);
      return;
    }

    case 'checkbox-group': {
      const opts = (value as DiscoveredOption[] | undefined) ?? [];
      for (const opt of opts) {
        await driver.setChecked(opt.selector, true);
      }
      return;
    }

    case 'checkbox-single':
      await driver.setChecked(field.selector, Boolean(value));
      return;
  }
}

/** Cheap structural fingerprint used to detect "clicking next did nothing." Ignores field order stability concerns by kind+label pairing, which is stable across re-renders of the same page. */
function fingerprint(fields: DiscoveredField[]): string {
  return fields.map((f) => `${f.kind}:${f.label}`).join('|');
}

export async function runDiscoverySession(options: DiscoveryRunOptions): Promise<DiscoveryRunResult> {
  const start = Date.now();
  const maxPages = options.maxPages ?? 20;
  const ownBrowser = !options.browser;
  const browser = options.browser ?? (await chromium.launch({ headless: options.headless ?? true }));

  let page: Page | undefined;
  const visits: DiscoveryPageVisit[] = [];
  const issues: DiscoveryIssue[] = [];

  try {
    page = await browser.newPage();
    if (options.actionTimeoutMs) page.setDefaultTimeout(options.actionTimeoutMs);
    const driver = new BrowserDriver(page);

    await page.goto(options.url, { waitUntil: 'domcontentloaded' });

    let reachedEnd = false;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const discovered = await scanPage(page);

      if (discovered.fields.length === 0) {
        if (await driver.isComplete()) {
          reachedEnd = true;
          visits.push({ pageIndex, url: discovered.url, fieldsDiscovered: 0, fieldsAnswered: 0 });
          break;
        }
        if (!discovered.hasNextControl) {
          issues.push({
            kind: 'NO_FIELDS_NO_NEXT',
            pageIndex,
            message: `No fields and no next/submit control found on ${discovered.url} — treating this as the end of the flow`,
          });
          visits.push({ pageIndex, url: discovered.url, fieldsDiscovered: 0, fieldsAnswered: 0 });
          reachedEnd = true;
          break;
        }
      }

      let fieldsAnswered = 0;
      for (const field of discovered.fields) {
        try {
          const classified = options.classifier ? await options.classifier(field) : undefined;
          const value = classified !== undefined ? classified : generateDiscoveryValue(field);
          await answerField(driver, field, value);
          fieldsAnswered++;
        } catch (err) {
          issues.push({
            kind: 'FIELD_FAILED',
            pageIndex,
            message: `Failed to answer field "${field.label || field.kind}": ${err instanceof Error ? err.message : String(err)}`,
            detail: field,
          });
        }
      }

      let screenshotBase64: string | undefined;
      if (options.captureScreenshots) {
        screenshotBase64 = (await page.screenshot().catch(() => undefined))?.toString('base64');
      }
      visits.push({
        pageIndex,
        url: discovered.url,
        fieldsDiscovered: discovered.fields.length,
        fieldsAnswered,
        screenshotBase64,
      });

      if (await driver.isComplete()) {
        reachedEnd = true;
        break;
      }

      const beforeFingerprint = fingerprint(discovered.fields);
      const urlBefore = page.url();
      try {
        await driver.clickNext();
      } catch (err) {
        issues.push({
          kind: 'NO_FIELDS_NO_NEXT',
          pageIndex,
          message: `No clickable next/submit control after answering page ${pageIndex}: ${err instanceof Error ? err.message : String(err)}`,
        });
        break;
      }
      await page.waitForTimeout(150); // let navigation or SPA re-render settle

      if (await driver.isComplete()) {
        reachedEnd = true;
        break;
      }

      const afterDiscovered = await scanPage(page);
      const afterFingerprint = fingerprint(afterDiscovered.fields);

      if (page.url() === urlBefore && afterFingerprint === beforeFingerprint) {
        issues.push({
          kind: 'NO_PROGRESS',
          pageIndex,
          message:
            'Clicking next did not change the page or its fields — likely a validation error blocking progress, or the generated answers did not satisfy a constraint the bot cannot see',
        });
        break;
      }
    }

    if (!reachedEnd && visits.length >= maxPages) {
      issues.push({
        kind: 'MAX_PAGES_EXCEEDED',
        pageIndex: visits.length,
        message: `Reached the ${maxPages}-page limit without detecting a completion state`,
      });
    }

    let completionScreenshot: string | undefined;
    if (options.captureScreenshots && reachedEnd) {
      completionScreenshot = (await page.screenshot().catch(() => undefined))?.toString('base64');
    }

    for (const err of driver.errors) {
      issues.push({
        kind: 'CONSOLE_ERROR',
        pageIndex: Math.max(visits.length - 1, 0),
        message: `[${err.kind}] ${err.message}`,
        detail: err,
      });
    }

    return {
      visits,
      issues,
      reachedEnd,
      consoleErrorCount: driver.errors.length,
      durationMs: Date.now() - start,
      completionScreenshot,
    };
  } catch (err) {
    return {
      visits,
      issues,
      reachedEnd: false,
      consoleErrorCount: 0,
      durationMs: Date.now() - start,
      fatalError: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page?.close().catch(() => undefined);
    if (ownBrowser) await browser.close().catch(() => undefined);
  }
}
