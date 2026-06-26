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
      'Designer — Business Collection',
      'Collector',
      'Searcher',
      'Analyzer',
    ];

    for (const name of expectedModules) {
      // Use .module-tile__name to avoid matching text in other elements (e.g. demo-picker paragraph)
      await expect(page.locator('.module-tile__name', { hasText: name })).toBeVisible();
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
      await expect(page.locator('.module-tile__tagline', { hasText: tagline })).toBeVisible();
    }
  });

  test('marks coming-soon modules as disabled', async ({ page }) => {
    // "Designer — Business" is a substring of "Designer — Business Collection"
    const businessDesigner = page.locator('button:has-text("Designer — Business")');
    const analyzer = page.locator('button:has-text("Analyzer")');

    await expect(businessDesigner).toBeDisabled();
    await expect(analyzer).toBeDisabled();

    await expect(businessDesigner.locator('text=Coming soon')).toBeVisible();
    await expect(analyzer.locator('text=Coming soon')).toBeVisible();
  });
});

test.describe('Module Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.module-grid');
  });

  test('clicking Collector navigates to collector view', async ({ page }) => {
    await page.click('button:has-text("Collector")');

    // CollectorView header contains these elements
    await expect(page.locator('strong:has-text("Collector")')).toBeVisible();
    await expect(page.locator('text=Manage surveys')).toBeVisible();
  });

  test('clicking Searcher shows search interface', async ({ page }) => {
    await page.click('button:has-text("Searcher")');

    // SearcherView renders an input[type="search"] (not type="text")
    await expect(page.locator('input[type="search"]')).toBeVisible();
    // SearcherView header tagline
    await expect(page.locator('text=Discover · reuse · extend metadata')).toBeVisible();
  });

  test('back button returns to home from Collector', async ({ page }) => {
    await page.click('button:has-text("Collector")');
    // Back button text is "← Modular Survey Tools", not "← Hub"
    await page.click('button:has-text("← Modular Survey Tools")');
    await expect(page.locator('h1:has-text("What would you like to do")')).toBeVisible();
  });
});

test.describe('Designer Links', () => {
  // These tests manage their own navigation so they can intercept window.open before goto.
  // The designer runs on a separate port (5173) that is not started during hub E2E tests,
  // so we spy on window.open instead of waiting for the new tab to load.

  test('Designer Pro link opens with mode=pro', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__capturedUrls = [] as string[];
      const orig = window.open;
      window.open = function (url?: string | URL, target?: string, features?: string) {
        (window as any).__capturedUrls.push(String(url ?? ''));
        return orig.call(window, url, target, features);
      };
    });

    await page.goto('/');
    await page.waitForSelector('.module-grid');
    await page.click('button:has-text("Designer — Pro")');

    const urls: string[] = await page.evaluate(() => (window as any).__capturedUrls);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toMatch(/mode=pro/);
  });

  test('Designer Easy Mode link opens with mode=easy', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__capturedUrls = [] as string[];
      const orig = window.open;
      window.open = function (url?: string | URL, target?: string, features?: string) {
        (window as any).__capturedUrls.push(String(url ?? ''));
        return orig.call(window, url, target, features);
      };
    });

    await page.goto('/');
    await page.waitForSelector('.module-grid');
    await page.click('button:has-text("Designer — Easy Mode")');

    const urls: string[] = await page.evaluate(() => (window as any).__capturedUrls);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toMatch(/mode=easy/);
  });
});

test.describe('Offline / Demo Mode', () => {
  test('shows offline state in Collector when Supabase is unavailable', async ({ page }) => {
    // On localhost without Supabase env vars configured, the app shows "● Offline"
    // (not "Demo mode" — demo mode only activates on non-localhost deployments)
    await page.route('**/supabase.co/**', (route) => route.abort());

    await page.goto('/');
    await page.click('button:has-text("Collector")');

    // Wait for the connection status indicator — either offline or demo badge
    await expect(page.locator('.hub__conn--off, .hub__conn--demo')).toBeVisible({ timeout: 10000 });
  });
});
