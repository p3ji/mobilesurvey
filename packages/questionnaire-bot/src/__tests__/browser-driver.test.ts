/**
 * Integration test: launches real Chromium and drives a static HTML fixture that mirrors the
 * exact markup `@mobilesurvey/respondent-view`'s Control.tsx/QuestionPage.tsx renders (radio
 * groups with `aria-labelledby`, markAll/grid `aria-label` groups, `.eq__nav-next` buttons, the
 * `.done__title` completion marker). This verifies BrowserDriver's primitives actually work
 * against real DOM/CSS/event semantics, not just against mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { BrowserDriver } from '../browser-driver.js';

const FIXTURE_HTML = `
<!doctype html>
<html>
<body>
  <div id="eq-main">
    <div class="eq__question">
      <label id="eq-ctrl-c.name@" class="eq__q-text" for="eq-ctrl-c.name@">Your name?</label>
      <input id="eq-ctrl-c.name@" type="text" />
    </div>

    <div class="eq__question">
      <label id="eq-ctrl-c.age@" class="eq__q-text" for="eq-ctrl-c.age@">Your age?</label>
      <input id="eq-ctrl-c.age@" type="number" />
    </div>

    <div class="eq__question">
      <label id="eq-ctrl-c.has_account@" class="eq__q-text">Do you have an account?</label>
      <div class="eq__radios" role="radiogroup" aria-labelledby="eq-ctrl-c.has_account@">
        <label class="eq__radio"><input type="radio" name="r1" /> Yes</label>
        <label class="eq__radio"><input type="radio" name="r1" /> No</label>
      </div>
    </div>

    <div class="eq__question">
      <label id="eq-ctrl-c.topics@" class="eq__q-text">Topics of interest?</label>
      <div class="eq__radios" role="group" aria-labelledby="eq-ctrl-c.topics@">
        <label class="eq__radio"><input type="checkbox" /> Design</label>
        <label class="eq__radio"><input type="checkbox" /> Logic</label>
        <label class="eq__radio"><input type="checkbox" /> Analytics</label>
      </div>
    </div>

    <div class="eq__question">
      <p class="eq__q-text">Which features did you try?</p>
      <div class="eq__radios" role="group" aria-label="Which features did you try?">
        <label class="eq__radio"><input type="checkbox" /> Preview</label>
        <label class="eq__radio"><input type="checkbox" /> Export</label>
      </div>
    </div>

    <table class="eq__grid">
      <tbody>
        <tr>
          <td><input type="radio" name="grid1" aria-label="Row A: Column 1" /></td>
          <td><input type="radio" name="grid1" aria-label="Row A: Column 2" /></td>
        </tr>
      </tbody>
    </table>
  </div>

  <footer class="eq__nav">
    <button type="button" class="eq__nav-back">← Back</button>
    <button type="button" class="eq__nav-next" onclick="document.getElementById('eq-main').style.display='none'; document.getElementById('done').style.display='block';">Next →</button>
  </footer>

  <div id="done" class="done" style="display:none">
    <h1 class="done__title">Survey submitted</h1>
  </div>
</body>
</html>
`;

describe('BrowserDriver (real Chromium)', () => {
  let browser: Browser;
  let page: Page;
  let driver: BrowserDriver;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  });

  afterAll(async () => {
    await browser.close();
  });

  async function freshPage(): Promise<{ page: Page; driver: BrowserDriver }> {
    const p = await browser.newPage();
    await p.setContent(FIXTURE_HTML);
    return { page: p, driver: new BrowserDriver(p) };
  }

  // NOTE: QuestionPage.tsx assigns the same `id` to both a question's <label> and its form
  // control (a pre-existing duplicate-id bug in respondent-view — see runner.ts's
  // formControlSelector doc comment). These tests scope to `input#id` directly, matching how
  // the runner disambiguates in practice; a bare `#id` would hit Playwright's strict-mode error.

  it('fillText sets an input value by CSS id (scoped to the input tag)', async () => {
    ({ page, driver } = await freshPage());
    await driver.fillText('input#eq-ctrl-c\\.name\\@', 'Alice');
    expect(await page.locator('input#eq-ctrl-c\\.name\\@').inputValue()).toBe('Alice');
    await page.close();
  });

  it('fillNumeric coerces a number to string and fills it', async () => {
    ({ page, driver } = await freshPage());
    await driver.fillNumeric('input#eq-ctrl-c\\.age\\@', 42);
    expect(await page.locator('input#eq-ctrl-c\\.age\\@').inputValue()).toBe('42');
    await page.close();
  });

  it('selectRadioByLabel clicks the radio matching visible label text within a group', async () => {
    ({ page, driver } = await freshPage());
    const group = '[aria-labelledby="eq-ctrl-c.has_account@"]';
    await driver.selectRadioByLabel(group, 'Yes');
    const radios = page.locator(`${group} input[type="radio"]`);
    expect(await radios.nth(0).isChecked()).toBe(true);
    expect(await radios.nth(1).isChecked()).toBe(false);
    await page.close();
  });

  it('selectRadioByLabel only checks the matching option, not others', async () => {
    ({ page, driver } = await freshPage());
    const group = '[aria-labelledby="eq-ctrl-c.has_account@"]';
    await driver.selectRadioByLabel(group, 'No');
    const radios = page.locator(`${group} input[type="radio"]`);
    expect(await radios.nth(0).isChecked()).toBe(false);
    expect(await radios.nth(1).isChecked()).toBe(true);
    await page.close();
  });

  it('setCheckboxes drives a multi-select group to match a target set exactly', async () => {
    ({ page, driver } = await freshPage());
    const group = '[aria-labelledby="eq-ctrl-c.topics@"]';
    await driver.setCheckboxes(group, [
      { labelText: 'Design', checked: true },
      { labelText: 'Logic', checked: false },
      { labelText: 'Analytics', checked: true },
    ]);
    const boxes = page.locator(`${group} input[type="checkbox"]`);
    expect(await boxes.nth(0).isChecked()).toBe(true);
    expect(await boxes.nth(1).isChecked()).toBe(false);
    expect(await boxes.nth(2).isChecked()).toBe(true);
    await page.close();
  });

  it('setCheckboxByLabel is idempotent — toggling to the same state does not double-click', async () => {
    ({ page, driver } = await freshPage());
    const group = '[aria-labelledby="eq-ctrl-c.topics@"]';
    await driver.setCheckboxByLabel(group, 'Design', true);
    await driver.setCheckboxByLabel(group, 'Design', true); // second call, same target state
    const box = page.locator(`${group} input[type="checkbox"]`).nth(0);
    expect(await box.isChecked()).toBe(true); // still checked, not toggled back off
    await page.close();
  });

  it('setCheckboxByLabel (used via markall-checkbox path) locates a group by aria-label', async () => {
    ({ page, driver } = await freshPage());
    const group = '[aria-label="Which features did you try?"]';
    await driver.setCheckboxByLabel(group, 'Preview', true);
    const box = page.locator(`${group} input[type="checkbox"]`).nth(0);
    expect(await box.isChecked()).toBe(true);
    await page.close();
  });

  it('setByAriaLabel checks a grid cell radio identified by its composed aria-label', async () => {
    ({ page, driver } = await freshPage());
    await driver.setByAriaLabel('Row A: Column 2', true);
    const cell = page.locator('[aria-label="Row A: Column 2"]');
    expect(await cell.isChecked()).toBe(true);
    await page.close();
  });

  it('clickNext advances via the known .eq__nav-next class', async () => {
    ({ page, driver } = await freshPage());
    expect(await driver.isComplete()).toBe(false);
    await driver.clickNext();
    expect(await driver.isComplete()).toBe(true);
    await page.close();
  });

  it('isComplete reflects the presence of .done__title', async () => {
    ({ page, driver } = await freshPage());
    expect(await driver.isComplete()).toBe(false);
    await page.close();
  });

  it('captures a real console.error as a DriverError', async () => {
    ({ page, driver } = await freshPage());
    await page.evaluate(() => console.error('synthetic test error'));
    // console events are emitted asynchronously; give the event loop a tick.
    await page.waitForTimeout(50);
    expect(driver.errors.some((e) => e.kind === 'console' && e.message.includes('synthetic test error'))).toBe(true);
    await page.close();
  });

  it('captures an uncaught page error as a DriverError', async () => {
    ({ page, driver } = await freshPage());
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('synthetic uncaught error');
      }, 0);
    });
    await page.waitForTimeout(50);
    expect(driver.errors.some((e) => e.kind === 'pageerror' && e.message.includes('synthetic uncaught error'))).toBe(true);
    await page.close();
  });
});
