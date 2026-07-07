/**
 * Integration test: real Chromium driving a static multi-step form fixture end-to-end through
 * `runDiscoverySession`, with no schema involved at all. The fixture simulates a typical
 * multi-step form pattern (all steps present in the DOM, toggled visible/hidden via JS on
 * "Next"/"Submit") — the scanner's visibility filtering (scanner.ts) is what keeps step 2's
 * fields from being discovered while step 1 is still showing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { runDiscoverySession } from '../runner.js';

function dataUrl(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

const TWO_STEP_FORM = `
<!doctype html>
<html>
<body>
  <div id="step1">
    <label for="name">Your name</label>
    <input id="name" type="text" required />

    <fieldset>
      <legend>Do you agree?</legend>
      <label><input type="radio" name="agree" value="yes" /> Yes</label>
      <label><input type="radio" name="agree" value="no" /> No</label>
    </fieldset>

    <button type="button" onclick="document.getElementById('step1').style.display='none'; document.getElementById('step2').style.display='block';">Next</button>
  </div>

  <div id="step2" style="display:none">
    <label for="comments">Comments</label>
    <textarea id="comments"></textarea>

    <button type="button" onclick="document.getElementById('step2').style.display='none'; document.getElementById('done').style.display='block';">Submit</button>
  </div>

  <div id="done" style="display:none">
    <h1 class="done__title">Thanks for completing the form!</h1>
  </div>
</body>
</html>
`;

const NO_PROGRESS_FORM = `
<!doctype html>
<html>
<body>
  <div id="only-step">
    <label for="name">Your name</label>
    <input id="name" type="text" required />
    <button type="button" onclick="void 0;">Next</button>
  </div>
</body>
</html>
`;

const DEAD_END_FORM = `
<!doctype html>
<html>
<body>
  <p>Nothing to see here — no fields, no next button.</p>
</body>
</html>
`;

describe('runDiscoverySession (real Chromium)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('walks a two-step form to completion, answering fields on each step', async () => {
    const result = await runDiscoverySession({
      url: dataUrl(TWO_STEP_FORM),
      browser,
      headless: true,
    });

    expect(result.fatalError).toBeUndefined();
    expect(result.reachedEnd).toBe(true);
    expect(result.visits.length).toBe(2);
    expect(result.visits[0]!.fieldsDiscovered).toBe(2); // name + agree radio-group
    expect(result.visits[0]!.fieldsAnswered).toBe(2);
    expect(result.visits[1]!.fieldsDiscovered).toBe(1); // comments textarea
    expect(result.visits[1]!.fieldsAnswered).toBe(1);
    expect(result.issues.filter((i) => i.kind !== 'CONSOLE_ERROR')).toHaveLength(0);
  });

  it('captures a completion screenshot when requested', async () => {
    const result = await runDiscoverySession({
      url: dataUrl(TWO_STEP_FORM),
      browser,
      headless: true,
      captureScreenshots: true,
    });

    expect(result.reachedEnd).toBe(true);
    expect(result.completionScreenshot).toBeDefined();
    expect(result.visits[0]!.screenshotBase64).toBeDefined();
  });

  it('reports NO_PROGRESS when clicking next does not change the page', async () => {
    const result = await runDiscoverySession({
      url: dataUrl(NO_PROGRESS_FORM),
      browser,
      headless: true,
    });

    expect(result.reachedEnd).toBe(false);
    expect(result.issues.some((i) => i.kind === 'NO_PROGRESS')).toBe(true);
  });

  it('treats a page with no fields and no next control as the end of the flow', async () => {
    const result = await runDiscoverySession({
      url: dataUrl(DEAD_END_FORM),
      browser,
      headless: true,
    });

    expect(result.reachedEnd).toBe(true);
    expect(result.issues.some((i) => i.kind === 'NO_FIELDS_NO_NEXT')).toBe(true);
  });

  it('consults an optional classifier before falling back to the heuristic', async () => {
    const seenLabels: string[] = [];
    const result = await runDiscoverySession({
      url: dataUrl(TWO_STEP_FORM),
      browser,
      headless: true,
      classifier: async (field) => {
        seenLabels.push(field.label);
        return undefined; // defer to the built-in heuristic for all fields
      },
    });

    expect(result.reachedEnd).toBe(true);
    expect(seenLabels).toContain('Your name');
  });

  it('reports a fatal error for an unreachable URL rather than throwing', async () => {
    const result = await runDiscoverySession({
      url: 'http://127.0.0.1:1/does-not-exist',
      browser,
      headless: true,
      actionTimeoutMs: 1000,
    });

    expect(result.fatalError).toBeDefined();
    expect(result.reachedEnd).toBe(false);
  });
});
