import { test, expect } from '@playwright/test';

/**
 * Hub Navigation Tests
 * Phase 1: Hub home, module selection, offline fallback
 */

test.describe('Hub Home', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.module-grid', { timeout: 5000 });
  });

  test('displays all 6 module tiles', async ({ page }) => {
    const tiles = page.locator('.module-tile');
    await expect(tiles).toHaveCount(6);

    const expectedModules = [
      'Designer — Pro',
      'Designer — Easy Mode',
      'Designer — Business',
      'Collector',
      'Searcher',
      'Analyzer',
    ];

    for (const name of expectedModules) {
      await expect(page.locator(`text=${name}`)).toBeVisible();
    }
  });

  test('shows correct taglines for each module', async ({ page }) => {
    const taglines = [
      'Full-featured instrument authoring',
      'Simple question-by-question editor',
      'Optimized for business data collection',
      'Manage surveys · monitor collection',
      'Search and reuse survey metadata',
      'Descriptive stats · future: full analysis',
    ];

    for (const tagline of taglines) {
      await expect(page.locator(`text=${tagline}`)).toBeVisible();
    }
  });

  test('marks coming-soon modules correctly', async ({ page }) => {
    const businessDesigner = page.locator('button:has-text("Designer — Business")');
    const analyzer = page.locator('button:has-text("Analyzer")');

    await expect(businessDesigner).toBeDisabled();
    await expect(analyzer).toBeDisabled();

    // Should show "Coming soon" badge
    await expect(
      businessDesigner.locator('text=Coming soon')
    ).toBeVisible();
  });
});

test.describe('Module Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.module-grid');
  });

  test('clicking Collector navigates to collector view', async ({ page }) => {
    await page.click('button:has-text("Collector")');

    // Wait for collector header
    await expect(page.locator('text=Collector')).toBeVisible();
    await expect(page.locator('text=Manage surveys')).toBeVisible();
  });

  test('clicking Searcher shows search interface', async ({ page }) => {
    await page.click('button:has-text("Searcher")');

    // Wait for search box
    await expect(page.locator('input[type="text"]')).toBeVisible();
    await expect(page.locator('text=Search and reuse')).toBeVisible();
  });

  test('back button returns to home', async ({ page }) => {
    // Go to Collector
    await page.click('button:has-text("Collector")');
    await page.waitForLoadState();

    // Click back
    const backBtn = page.locator('button:has-text("← Hub")');
    await backBtn.click();

    // Should be back at home
    await expect(page.locator('text=What would you like to do')).toBeVisible();
  });

  test('Designer Pro opens in new tab', async ({ page, context }) => {
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click('button:has-text("Designer — Pro")'),
    ]);

    await newPage.waitForLoadState();

    // Verify it's the designer
    expect(newPage.url()).toContain('/mobilesurvey/designer');
    expect(newPage.url()).toContain('mode=pro');

    await newPage.close();
  });

  test('Designer Easy Mode opens in new tab', async ({ page, context }) => {
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click('button:has-text("Designer — Easy Mode")'),
    ]);

    await newPage.waitForLoadState();

    expect(newPage.url()).toContain('/mobilesurvey/designer');
    expect(newPage.url()).toContain('mode=easy');

    await newPage.close();
  });
});

test.describe('Offline Mode', () => {
  test('shows demo mode when Supabase is unreachable', async ({ page }) => {
    // Intercept all Supabase requests
    await page.route('**/supabase.co/**', (route) => route.abort());

    await page.goto('/');

    // Wait for demo mode content
    await expect(page.locator('text=Demo mode')).toBeVisible({ timeout: 5000 });

    // Should show bundled demo surveys
    await page.click('button:has-text("Collector")');
    await expect(
      page.locator('text=Household & Employment')
    ).toBeVisible();
    await expect(page.locator('text=Feature Demo')).toBeVisible();
  });
});
