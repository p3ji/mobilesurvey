import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility sweep (axe-core) across the three respondent-facing / authoring
 * surfaces: the hub (localhost:5175), the respondent runtime (localhost:5174), and the designer
 * (localhost:5173). Each app runs on a fixed port in dev — see AGENTS.md — so this spec targets
 * absolute URLs directly rather than the single relative `baseURL` the hub-only e2e config uses,
 * and expects all three `pnpm --filter <app> dev` servers to already be running.
 *
 * This is a heuristic-plus-automated pass, not a substitute for a manual screen-reader audit
 * (NVDA/VoiceOver) — axe-core catches ~30-50% of WCAG issues by design; it cannot verify reading
 * order, focus management quality, or that ARIA labels are actually *meaningful* to a real user.
 */

const HUB = 'http://localhost:5175';
const RUNTIME = 'http://localhost:5174';
const DESIGNER = 'http://localhost:5173';

/** Run axe against the current page, scoped to WCAG 2.0/2.1 A+AA rules (the plan's target level). */
async function runAxe(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

/** Format violations into a readable failure message (axe's default JSON dump is unreadable). */
function formatViolations(violations: import('axe-core').Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.slice(0, 3).map((n) => `    - ${n.target.join(' ')}`).join('\n');
      const more = v.nodes.length > 3 ? `\n    ... +${v.nodes.length - 3} more` : '';
      return `[${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n${nodes}${more}`;
    })
    .join('\n\n');
}

test.describe('Accessibility — Hub', () => {
  test('home screen has no automatically detectable WCAG A/AA violations', async ({ page }) => {
    await page.goto(HUB, { waitUntil: 'networkidle' });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Collector view has no violations', async ({ page }) => {
    await page.goto(HUB, { waitUntil: 'networkidle' });
    await page.locator('.module-tile', { hasText: 'Collector' }).first().click();
    await page.waitForTimeout(600);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Searcher view has no violations', async ({ page }) => {
    await page.goto(HUB, { waitUntil: 'networkidle' });
    await page.locator('.module-tile', { hasText: 'Searcher' }).first().click();
    await page.waitForTimeout(600);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Migrator view has no violations', async ({ page }) => {
    await page.goto(HUB, { waitUntil: 'networkidle' });
    await page.locator('.module-tile', { hasText: 'Migrator' }).first().click();
    await page.waitForTimeout(600);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});

test.describe('Accessibility — Runtime (respondent survey)', () => {
  test('demo survey question page has no violations', async ({ page }) => {
    await page.goto(`${RUNTIME}/?survey=demo`, { waitUntil: 'networkidle' });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('demo survey with a fired hard edit has no violations', async ({ page }) => {
    await page.goto(`${RUNTIME}/?survey=demo`, { waitUntil: 'networkidle' });
    // Trigger a hard edit (nps out of range) so the aria-invalid / role=alert markup is present.
    const nps = page.locator('.eq__question input[type=number]').first();
    await nps.fill('99');
    await page.waitForTimeout(300);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('access-gated survey (lfs) gate screen has no violations', async ({ page }) => {
    await page.goto(`${RUNTIME}/?survey=lfs`, { waitUntil: 'networkidle' });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('completion screen has no violations', async ({ page }) => {
    await page.goto(`${RUNTIME}/?survey=demo`, { waitUntil: 'networkidle' });
    // Walk to the end quickly by filling every control with a valid-ish value on each page.
    for (let i = 0; i < 10; i++) {
      for (const el of await page.$$('.eq__question input[type=number]')) {
        const min = await el.getAttribute('min');
        await el.fill(String(min != null ? Math.max(2, Number(min)) : 5));
      }
      for (const el of await page.$$('.eq__question input[type=text]')) await el.fill('Test');
      for (const el of await page.$$('.eq__question textarea')) await el.fill('Text');
      for (const el of await page.$$('.eq__question input[type=date]')) await el.fill('2026-01-15');
      for (const el of await page.$$('.eq__question input[type=time]')) await el.fill('10:30');
      for (const el of await page.$$('.eq__question input[type=datetime-local]')) await el.fill('2026-01-15T10:30');
      for (const grp of await page.$$('.eq__radios[role=radiogroup]')) { const r = await grp.$('input[type=radio]'); if (r) await r.check().catch(() => {}); }
      for (const row of await page.$$('.eq__grid__row')) { const r = await row.$('input[type=radio]'); if (r) await r.check().catch(() => {}); }
      for (const grp of await page.$$('.eq__radios[role=group]')) { const c = await grp.$('input[type=checkbox]'); if (c) await c.check().catch(() => {}); }
      for (const el of await page.$$('.eq__question input[list]')) {
        const listId = await el.getAttribute('list');
        const opt = await page.$(`datalist[id="${listId}"] option`);
        if (opt) await el.fill((await opt.getAttribute('value')) || 'x');
      }
      await page.waitForTimeout(200);
      const isSubmit = await page.evaluate(() => !!document.querySelector('.eq__nav-submit'));
      const disabled = await page.evaluate(() => !!document.querySelector('.eq__nav-next[disabled],.eq__nav-submit[disabled]'));
      if (disabled) break;
      await page.locator(isSubmit ? '.eq__nav-submit' : '.eq__nav-next').click();
      await page.waitForTimeout(500);
      if (isSubmit) break;
    }
    await expect(page.locator('.done')).toBeVisible({ timeout: 5000 });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});

test.describe('Accessibility — Designer', () => {
  test('Pro mode with a survey loaded has no violations', async ({ page }) => {
    await page.goto(`${DESIGNER}/?survey=demo&mode=pro`, { waitUntil: 'networkidle' });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Pro mode with a question selected (Inspector open) has no violations', async ({ page }) => {
    await page.goto(`${DESIGNER}/?survey=demo&mode=pro`, { waitUntil: 'networkidle' });
    await page.getByText('How likely are you to recommend', { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Preview tab has no violations', async ({ page }) => {
    await page.goto(`${DESIGNER}/?survey=demo&mode=pro`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /^Preview$/ }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  test('Easy mode has no violations', async ({ page }) => {
    await page.goto(`${DESIGNER}/?survey=demo&mode=easy`, { waitUntil: 'networkidle' });
    const results = await runAxe(page);
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});
