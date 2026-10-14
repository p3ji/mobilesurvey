import { test, expect } from '@playwright/test';

/**
 * End-to-End Browser Tests for Searcher & Empirical Vocabulary
 * Tests live UI interaction, debouncing, auto-retry guardrails, and search aliases.
 */

test.describe('Searcher Empirical Terminology & Guardrails', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to Searcher
    await page.goto('/#searcher');
    // Wait for Searcher interface to load
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toBeVisible({ timeout: 15000 });
  });

  test('query "disinformation" resolves via canonical alias to misinformation without timeout', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('disinformation');

    // Wait for primary search results container
    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect canonical MIS_70 or misinformation variables to be visible in the results
    await expect(results.getByText('MIS_70', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(results.getByText('misinformation', { exact: false }).first()).toBeVisible();

    // Verify error state is NOT triggered
    await expect(page.locator('.cs-error')).toHaveCount(0);
  });

  test('query "unhoused" resolves to homelessness and is NOT hijacked by "used"', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('unhoused');

    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect canonical HOM_15 (homelessness) variable to appear
    await expect(results.getByText('HOM_15', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(results.getByText('Homelessness', { exact: false }).first()).toBeVisible();

    // Verify it was NOT auto-retried to "used"
    const correctedBanner = page.locator('.cs-corrected');
    if (await correctedBanner.count() > 0) {
      await expect(correctedBanner).not.toContainText('used');
    }
  });

  test('multi-word query "opioid crisis" preserves intent and is NOT hijacked by "crisis"', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('opioid crisis');

    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect opioid-related variables (OPI_) to appear
    await expect(results.getByText('OPI_', { exact: false }).first()).toBeVisible({ timeout: 10000 });

    // Verify it was NOT auto-retried to "crisis"
    const correctedBanner = page.locator('.cs-corrected');
    if (await correctedBanner.count() > 0) {
      await expect(correctedBanner).not.toContainText('crisis');
    }
  });

  test('compound query "childcare" returns canonical child care variables', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('childcare');

    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect child care variables to render
    await expect(results.getByText('child care', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });

  test('validated scale acronym "K10" returns Kessler Distress Scale at top', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('K10');

    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect distress scale variables
    await expect(results.getByText('distress', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });

  test('genuine typo "cannibis" auto-retries to "cannabis" with reader notice', async ({ page }) => {
    const input = page.locator('input[type="search"]');
    await input.fill('cannibis');

    // Wait for results
    const results = page.locator('.sr-results').first();
    await expect(results).toBeVisible({ timeout: 10000 });

    // Expect auto-retry banner and sr-count to show cannabis and note the correction from cannibis
    const srCount = page.locator('.sr-count');
    await expect(srCount).toContainText('cannabis');

    const correctedBanner = page.locator('.cs-corrected');
    await expect(correctedBanner).toBeVisible({ timeout: 10000 });
    await expect(correctedBanner).toContainText('cannibis');
  });

  test('more filters drawer opens and displays GSIM role options', async ({ page }) => {
    // Open More filters details
    const moreFiltersSummary = page.locator('summary.cs-more-filters__summary');
    await moreFiltersSummary.click();

    // Verify GSIM role dropdown is present with expected options
    const roleSelect = page.locator('select').filter({ hasText: 'All Roles' });
    await expect(roleSelect).toBeVisible();
    await expect(roleSelect.locator('option')).toHaveCount(5);
  });
});
