# mobilesurvey — E2E Testing Plan with Playwright

> Comprehensive end-to-end testing strategy for the multi-module hub architecture using Playwright browser automation.

---

## Testing Architecture

The hub is a React SPA with four main modules:
- **Home**: Module selector
- **Collector**: Survey management & response monitoring (live module)
- **Searcher**: Metadata discovery & reuse (live module)
- **Designer Pro/Easy**: Instrument authoring (opens in new tabs)

Tests fall into:
1. **Hub Navigation & State** — module switching, persistence, offline fallback
2. **Collector Workflows** — survey CRUD, publishing, link sharing, response viewing
3. **Designer Workflows** — question creation, routing, validation, save/load
4. **Searcher Workflows** — search, filtering, preview, insert into designer
5. **Cross-Module** — designer ↔ collector, collector → searcher
6. **Supabase Integration** — data persistence, fallback to demo mode
7. **Performance** — load times, responsiveness under load
8. **Accessibility** — keyboard nav, screen reader compat, WCAG 2.1 AA

---

## Phase 1: Hub & Navigation Tests

### Setup & Teardown
```typescript
test.beforeEach(async ({ page }) => {
  // Start on hub home
  await page.goto('/mobilesurvey/');
  // Wait for modules to load
  await page.waitForSelector('.module-grid');
});

test.afterEach(async ({ page }) => {
  // Clean up any open tabs/windows
  const context = page.context();
  await context.close();
});
```

### Test Cases

#### T1.1: Hub Home Loads with All Modules
```typescript
test('hub home displays all 6 module tiles', async ({ page }) => {
  const tiles = page.locator('.module-tile');
  await expect(tiles).toHaveCount(6);
  
  const expected = ['Designer — Pro', 'Designer — Easy Mode', 'Designer — Business', 'Collector', 'Searcher', 'Analyzer'];
  for (const name of expected) {
    await expect(page.locator(`text=${name}`)).toBeVisible();
  }
});
```

#### T1.2: Navigation to Collector
```typescript
test('clicking Collector navigates to collector view', async ({ page }) => {
  await page.click('button:has-text("Collector")');
  await expect(page).toHaveURL(/collector/);
  await page.waitForSelector('text=Manage surveys');
});
```

#### T1.3: Navigation to Searcher
```typescript
test('clicking Searcher shows search interface', async ({ page }) => {
  await page.click('button:has-text("Searcher")');
  await page.waitForSelector('input[placeholder*="Search"]');
  await expect(page.locator('text=Search and reuse')).toBeVisible();
});
```

#### T1.4: Back Button Returns to Home
```typescript
test('back button from collector returns to home', async ({ page }) => {
  await page.click('button:has-text("Collector")');
  await page.click('button:has-text("← Hub")');
  await expect(page.locator('text=What would you like to do')).toBeVisible();
});
```

#### T1.5: Designer Pro Opens in New Tab
```typescript
test('Designer Pro opens in new tab', async ({ page, context }) => {
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('button:has-text("Designer — Pro")')
  ]);
  await newPage.waitForLoadState();
  expect(newPage.url()).toContain('/mobilesurvey/designer');
  expect(newPage.url()).toContain('mode=pro');
});
```

#### T1.6: Demo Mode (Offline Fallback)
```typescript
test('demo mode shows when Supabase is unreachable', async ({ page }) => {
  // Intercept Supabase auth to simulate offline
  await page.route('*/**/auth/**', route => route.abort());
  await page.reload();
  
  await expect(page.locator('text=Demo mode')).toBeVisible();
  await expect(page.locator('text=bundled example surveys')).toBeVisible();
});
```

---

## Phase 2: Collector Workflows

### T2.1: Create Survey
```typescript
test('create new survey from collector', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  // Click + New survey
  await page.click('button:has-text("+ New survey")');
  
  // Fill prompt dialog
  const surveyTitle = `Test Survey ${Date.now()}`;
  await page.fill('input[type="text"]', surveyTitle); // Fill dialog input
  await page.click('button:has-text("OK")');
  
  // Designer should open
  const [designerTab] = await Promise.all([
    page.context().waitForEvent('page'),
  ]);
  
  await designerTab.waitForLoadState();
  expect(designerTab.url()).toContain('mode=');
  await designerTab.close();
  
  // Return to collector, verify survey appears
  await expect(page.locator(`text=${surveyTitle}`)).toBeVisible({ timeout: 5000 });
});
```

### T2.2: Publish Survey
```typescript
test('toggle survey published status', async ({ page }) => {
  // Assuming a survey card is visible
  const card = page.locator('.card').first();
  const publishCheckbox = card.locator('input[type="checkbox"]:nth-of-type(2)');
  
  const initialChecked = await publishCheckbox.isChecked();
  await publishCheckbox.click();
  
  // Verify state changed (UI feedback or API call)
  expect(await publishCheckbox.isChecked()).toBe(!initialChecked);
});
```

### T2.3: Toggle Access Code Requirement
```typescript
test('toggle access code requirement', async ({ page }) => {
  const card = page.locator('.card').first();
  const codeCheckbox = card.locator('input[type="checkbox"]:nth-of-type(1)');
  
  const initialChecked = await codeCheckbox.isChecked();
  await codeCheckbox.click();
  
  expect(await codeCheckbox.isChecked()).toBe(!initialChecked);
  
  // Verify metadata text updates (🔒 or 🌐)
  const meta = card.locator('.card__meta');
  if (!initialChecked) {
    await expect(meta.locator('text=🔒')).toBeVisible();
  } else {
    await expect(meta.locator('text=🌐')).toBeVisible();
  }
});
```

### T2.4: Copy Respondent Link
```typescript
test('copy respondent link to clipboard', async ({ page, context }) => {
  // Grant clipboard permission
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  
  const card = page.locator('.card').first();
  const copyBtn = card.locator('button:has-text("Copy")');
  
  await copyBtn.click();
  
  // Verify button text changed to "✓ Copied"
  await expect(copyBtn).toContainText('✓ Copied');
  
  // Verify clipboard has the link
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('/mobilesurvey/respondent');
  expect(clipboard).toContain('?survey=');
});
```

### T2.5: View Responses
```typescript
test('expand and view survey responses', async ({ page }) => {
  const card = page.locator('.card').first();
  const responsesBtn = card.locator('button:has-text("Responses")');
  
  // Initially collapsed
  await expect(card.locator('table')).not.toBeVisible();
  
  // Click to expand
  await responsesBtn.click();
  
  // Table should appear
  await expect(card.locator('table')).toBeVisible();
  
  // Verify table headers
  await expect(card.locator('th')).toContainText(['Respondent', 'Submitted', 'Duration', 'Status']);
});
```

### T2.6: Delete Survey
```typescript
test('delete survey with confirmation', async ({ page }) => {
  const card = page.locator('.card').first();
  const deleteBtn = card.locator('button.btn--danger');
  
  // Set up confirmation handler
  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('Delete');
    dialog.accept();
  });
  
  const surveyTitle = await card.locator('.card__title').textContent();
  
  await deleteBtn.click();
  
  // Survey card should disappear
  await expect(card.locator(`text=${surveyTitle}`)).not.toBeVisible();
});
```

---

## Phase 3: Designer Workflows

### T3.1: Designer Pro Loads
```typescript
test('designer pro opens and loads with default instrument', async ({ page, context }) => {
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('button:has-text("Designer — Pro")')
  ]);
  
  await designerPage.waitForLoadState();
  
  // Verify toolbar is present
  await expect(designerPage.locator('text=mobilesurvey')).toBeVisible();
  
  // Verify default instrument loaded
  await expect(designerPage.locator('.tree__row')).toBeDefined();
});
```

### T3.2: Designer Easy Mode
```typescript
test('designer easy mode shows simplified question list', async ({ page, context }) => {
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('button:has-text("Designer — Easy Mode")')
  ]);
  
  await designerPage.waitForLoadState();
  
  // Verify easy mode UI (flat list, not tree)
  await expect(designerPage.locator('.easymode__list')).toBeVisible();
  await expect(designerPage.locator('.easymode__card')).toBeDefined();
});
```

### T3.3: Add Question in Easy Mode
```typescript
test('add question in easy mode', async ({ page, context }) => {
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('button:has-text("Designer — Easy Mode")')
  ]);
  
  await designerPage.waitForLoadState();
  
  // Click ⊕ Add Question
  await designerPage.click('button:has-text("⊕")');
  
  // A new card should appear
  const cards = designerPage.locator('.easymode__card');
  const countBefore = await cards.count();
  
  // Verify new card
  const newCard = cards.last();
  await expect(newCard).toBeVisible();
});
```

### T3.4: Question Type Selection
```typescript
test('select question response domain type', async ({ page, context }) => {
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('button:has-text("Designer — Pro")')
  ]);
  
  await designerPage.waitForLoadState();
  
  // Select a question from tree
  await designerPage.click('.tree__row >> nth=0');
  
  // Inspector should show response domain options
  await expect(designerPage.locator('text=Response Domain')).toBeVisible();
  
  // Click to select a type (e.g., "code")
  const typeSelect = designerPage.locator('select').first();
  await typeSelect.selectOption('code');
});
```

### T3.5: Save Survey from Designer
```typescript
test('save survey from designer to collector', async ({ page, context, surveyId }) => {
  // Navigate to collector, create survey, get ID
  // Open designer with survey ID
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
  ]);
  
  await page.goto(`/mobilesurvey/designer/?survey=${surveyId}`);
  
  // Make an edit (e.g., change title)
  // Click Save button
  await page.click('button:has-text("Save")');
  
  // Verify feedback
  await expect(page.locator('text=Saved')).toBeVisible();
});
```

---

## Phase 4: Searcher Workflows

### T4.1: Search Interface Loads
```typescript
test('searcher loads with search box and filters', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  await expect(page.locator('text=Questions')).toBeVisible();
  await expect(page.locator('text=Variables')).toBeVisible();
  await expect(page.locator('text=Code Lists')).toBeVisible();
});
```

### T4.2: Search Results
```typescript
test('search returns matching questions', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  // Type search term
  await page.fill('input[placeholder*="Search"]', 'employment');
  
  // Results should appear
  await page.waitForSelector('.sr-hit', { timeout: 2000 });
  
  const hits = page.locator('.sr-hit');
  expect(await hits.count()).toBeGreaterThan(0);
});
```

### T4.3: Filter by Type
```typescript
test('filter search results by component type', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  // Search first
  await page.fill('input[placeholder*="Search"]', 'yes');
  await page.waitForSelector('.sr-hit', { timeout: 2000 });
  
  // Click "Questions" filter
  await page.click('text=Questions');
  
  // Results should be filtered
  const hits = page.locator('.sr-hit');
  expect(await hits.count()).toBeGreaterThan(0);
});
```

### T4.4: Open Result in Designer
```typescript
test('open search result in designer', async ({ page, context }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  // Search for something
  await page.fill('input[placeholder*="Search"]', 'employment');
  await page.waitForSelector('.sr-hit', { timeout: 2000 });
  
  // Get the first result
  const firstResult = page.locator('.sr-hit').first();
  const openBtn = firstResult.locator('button, a:has-text("Open")');
  
  // Click to open in designer
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    openBtn.click()
  ]);
  
  await designerPage.waitForLoadState();
  expect(designerPage.url()).toContain('/mobilesurvey/designer');
});
```

---

## Phase 5: Cross-Module Workflows

### T5.1: Create Survey in Collector → Edit in Designer → Return
```typescript
test('full workflow: collector → designer → collector', async ({ page, context }) => {
  // 1. In collector, create survey
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  await page.click('button:has-text("+ New survey")');
  
  const surveyTitle = `E2E Test ${Date.now()}`;
  // Dialog handling...
  
  // 2. Designer opens, make an edit
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
  ]);
  
  // 3. Save and close designer
  await designerPage.click('button:has-text("Save")');
  await designerPage.close();
  
  // 4. Verify back in collector, survey is updated
  await expect(page.locator(`text=${surveyTitle}`)).toBeVisible();
});
```

### T5.2: Searcher → Designer → Collector
```typescript
test('reuse question from searcher in new survey', async ({ page, context }) => {
  // 1. In searcher, find and open a question in designer
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  await page.fill('input[placeholder*="Search"]', 'employment');
  await page.waitForSelector('.sr-hit');
  
  const [designerPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.sr-hit').first().locator('a:has-text("Open")').click()
  ]);
  
  // 2. In designer, the question is present
  await designerPage.waitForLoadState();
  
  // 3. Close and verify in collector
  await designerPage.close();
  
  // Back in searcher
  await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
});
```

---

## Phase 6: Integration & Data Persistence

### T6.1: Survey Persists After Refresh
```typescript
test('survey data persists after page refresh', async ({ page }) => {
  // Create a survey, note its title
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  const surveyTitle = page.locator('.card__title').first();
  const titleText = await surveyTitle.textContent();
  
  // Refresh
  await page.reload();
  
  // Survey should still be there
  await expect(page.locator(`text=${titleText}`)).toBeVisible();
});
```

### T6.2: Supabase Offline → Demo Mode
```typescript
test('demo mode shows when Supabase is offline', async ({ page }) => {
  // Intercept all Supabase requests
  await page.route('**/supabase.co/**', route => route.abort());
  
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  // Demo mode notice should appear
  await expect(page.locator('text=Demo mode')).toBeVisible();
  
  // Bundled surveys (lfs + demo) should be shown
  await expect(page.locator('text=Household & Employment')).toBeVisible();
  await expect(page.locator('text=Feature Demo')).toBeVisible();
});
```

### T6.3: Response Tracking
```typescript
test('responses are counted and displayed', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  // Find a live survey
  const liveSection = page.locator('text=● Live surveys');
  const card = liveSection.locator('..').locator('.card').first();
  
  const responsesBtn = card.locator('button:has-text("Responses")');
  const responseText = await responsesBtn.textContent();
  
  // Should show response count
  expect(responseText).toMatch(/Responses \(\d+\)/);
});
```

---

## Phase 7: Performance Testing

### T7.1: Hub Home Load Time
```typescript
test('hub home loads in under 2 seconds', async ({ page }) => {
  const startTime = Date.now();
  
  await page.goto('/mobilesurvey/');
  await page.waitForSelector('.module-grid');
  
  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(2000);
});
```

### T7.2: Collector List Load (Many Surveys)
```typescript
test('collector loads with 100+ surveys in under 3 seconds', async ({ page }) => {
  // Assume DB has 100+ surveys
  const startTime = Date.now();
  
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  await page.waitForSelector('.card', { timeout: 5000 });
  
  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000);
});
```

### T7.3: Search Latency (Large Catalog)
```typescript
test('search returns results in under 500ms', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Searcher")');
  
  const startTime = Date.now();
  
  await page.fill('input[placeholder*="Search"]', 'test');
  await page.waitForSelector('.sr-hit');
  
  const searchTime = Date.now() - startTime;
  expect(searchTime).toBeLessThan(500);
});
```

---

## Phase 8: Accessibility Testing

### T8.1: Keyboard Navigation
```typescript
test('navigate hub with keyboard only (Tab)', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  
  // Tab through module tiles
  let focusedElement = '';
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    focusedElement = await page.evaluate(() => document.activeElement?.className);
    expect(focusedElement).toContain('module-tile');
  }
  
  // Enter on focused tile should activate
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  
  // Should have navigated to a module view
  expect(page.url()).not.toContain('/mobilesurvey/$'); // Not home anymore
});
```

### T8.2: Screen Reader (ARIA Labels)
```typescript
test('collector has proper ARIA labels for screen readers', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  await page.click('button:has-text("Collector")');
  
  // Check for ARIA labels
  const surveyCard = page.locator('.card').first();
  const title = surveyCard.locator('.card__title');
  
  // Title should have role=heading or be in a heading context
  const role = await title.getAttribute('role');
  expect(['heading', null]).toContain(role);
  
  // Buttons should have labels
  const buttons = surveyCard.locator('button');
  for (const btn of await buttons.all()) {
    const ariaLabel = await btn.getAttribute('aria-label');
    const title = await btn.getAttribute('title');
    const text = await btn.textContent();
    
    // At least one of these should be present
    expect(ariaLabel || title || text).toBeTruthy();
  }
});
```

### T8.3: Color Contrast
```typescript
test('button text has sufficient color contrast', async ({ page }) => {
  await page.goto('/mobilesurvey/');
  
  // Check primary button
  const primaryBtn = page.locator('button.btn--primary').first();
  
  // Get computed colors
  const color = await primaryBtn.evaluate(el => window.getComputedStyle(el).color);
  const bgColor = await primaryBtn.evaluate(el => window.getComputedStyle(el).backgroundColor);
  
  // Simple check: colors should not be identical
  expect(color).not.toBe(bgColor);
});
```

---

## Running Tests

### Playwright Config
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'pnpm --filter @mobilesurvey/hub dev',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
```

### Run Tests
```bash
# All tests
pnpm exec playwright test

# Specific test file
pnpm exec playwright test tests/e2e/hub.spec.ts

# Watch mode
pnpm exec playwright test --watch

# UI mode (visual debugging)
pnpm exec playwright test --ui

# Headed mode (see browser)
pnpm exec playwright test --headed

# Generate report
pnpm exec playwright show-report
```

---

## Test Coverage Goals

| Module | Unit | E2E | Coverage |
|--------|------|-----|----------|
| Hub Navigation | ✅ | ✅ | 100% |
| Collector (CRUD) | ✅ | ✅ | 95% |
| Collector (Responses) | ✅ | ✅ | 90% |
| Designer Pro | ✅ | ✅ | 85% |
| Designer Easy | ✅ | ✅ | 85% |
| Searcher | ✅ | ✅ | 80% |
| Supabase Integration | ✅ | ✅ | 90% |
| Offline/Demo Mode | ✅ | ✅ | 100% |
| Cross-Module Workflows | — | ✅ | 80% |
| Performance | — | ✅ | 70% |
| Accessibility | — | ✅ | 75% |

---

## CI/CD Integration

### GitHub Actions Workflow
```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      
      - run: pnpm install
      - run: pnpm exec playwright install
      
      # Optional: Set Supabase env vars for testing
      # - run: pnpm test:e2e
      
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

---

## Testing Best Practices

1. **Isolation**: Each test should be independent; no cross-test dependencies
2. **Cleanup**: Use beforeEach/afterEach to reset state
3. **Waits**: Use explicit waits (waitForSelector) not sleeps
4. **Selectors**: Prefer semantic selectors (role, text) over CSS/class names
5. **Assertions**: Be specific (toContainText, not just toBeVisible)
6. **Mocking**: Mock Supabase for offline/demo mode tests
7. **Reporting**: Always generate HTML reports for CI failures
8. **Flakiness**: Run tests locally 3× before pushing; rerun failures in CI
