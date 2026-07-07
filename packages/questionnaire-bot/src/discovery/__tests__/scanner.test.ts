/**
 * Integration test: real Chromium against a static HTML fixture representing a generic
 * (non-mobilesurvey) web form — bare `<label for>`, native `<select>`, an unlabeled radio group
 * grouped only by shared `name`, a lone checkbox, and a submit `<button>`. This is the kind of
 * markup discovery mode has to work against, since it can't assume respondent-view's conventions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { scanPage } from '../scanner.js';

const FIXTURE_HTML = `
<!doctype html>
<html>
<body>
  <form>
    <label for="full-name">Full name</label>
    <input id="full-name" name="full_name" type="text" required />

    <label for="email-addr">Email</label>
    <input id="email-addr" name="email" type="email" />

    <label for="age-input">Age</label>
    <input id="age-input" name="age" type="number" min="18" max="99" />

    <fieldset>
      <legend>Do you agree to the terms?</legend>
      <label><input type="radio" name="agree" value="yes" /> Yes</label>
      <label><input type="radio" name="agree" value="no" /> No</label>
    </fieldset>

    <fieldset>
      <legend>Pick your interests</legend>
      <label><input type="checkbox" name="interests" value="sports" /> Sports</label>
      <label><input type="checkbox" name="interests" value="music" /> Music</label>
    </fieldset>

    <label><input type="checkbox" name="newsletter" value="1" /> Subscribe to newsletter</label>

    <label for="country-select">Country</label>
    <select id="country-select" name="country">
      <option value="">-- Select --</option>
      <option value="CA">Canada</option>
      <option value="US">USA</option>
    </select>

    <label for="comments-box">Comments</label>
    <textarea id="comments-box" name="comments" maxlength="500"></textarea>

    <button type="submit">Submit</button>
  </form>
</body>
</html>
`;

describe('scanPage (real Chromium)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeAll(async () => {
    page = await browser.newPage();
    await page.setContent(FIXTURE_HTML);
  });

  it('discovers a labelled text input via <label for>', async () => {
    const { fields } = await scanPage(page);
    const nameField = fields.find((f) => f.label === 'Full name');
    expect(nameField).toBeDefined();
    expect(nameField?.kind).toBe('text');
    expect(nameField?.required).toBe(true);
  });

  it('classifies an <input type="email"> as kind email', async () => {
    const { fields } = await scanPage(page);
    const emailField = fields.find((f) => f.label === 'Email');
    expect(emailField?.kind).toBe('email');
  });

  it('captures min/max on a numeric input', async () => {
    const { fields } = await scanPage(page);
    const ageField = fields.find((f) => f.label === 'Age');
    expect(ageField?.kind).toBe('number');
    expect(ageField?.min).toBe('18');
    expect(ageField?.max).toBe('99');
  });

  it('groups radios sharing a name into one radio-group with a legend-derived label', async () => {
    const { fields } = await scanPage(page);
    const radioGroup = fields.find((f) => f.kind === 'radio-group' && f.label === 'Do you agree to the terms?');
    expect(radioGroup).toBeDefined();
    expect(radioGroup?.options).toHaveLength(2);
    expect(radioGroup?.options?.map((o) => o.value).sort()).toEqual(['no', 'yes']);
  });

  it('groups checkboxes sharing a name into one checkbox-group', async () => {
    const { fields } = await scanPage(page);
    const checkboxGroup = fields.find((f) => f.kind === 'checkbox-group' && f.label === 'Pick your interests');
    expect(checkboxGroup).toBeDefined();
    expect(checkboxGroup?.options).toHaveLength(2);
  });

  it('treats a lone checkbox (unique name) as checkbox-single', async () => {
    const { fields } = await scanPage(page);
    const single = fields.find((f) => f.kind === 'checkbox-single');
    expect(single).toBeDefined();
    expect(single?.label).toContain('newsletter');
  });

  it('discovers a native select with its options', async () => {
    const { fields } = await scanPage(page);
    const select = fields.find((f) => f.kind === 'select');
    expect(select).toBeDefined();
    expect(select?.options?.map((o) => o.value)).toEqual(['', 'CA', 'US']);
  });

  it('discovers a textarea and its maxlength', async () => {
    const { fields } = await scanPage(page);
    const textarea = fields.find((f) => f.kind === 'textarea');
    expect(textarea).toBeDefined();
    expect(textarea?.maxLength).toBe(500);
  });

  it('detects a submit button as a next/submit control', async () => {
    const { hasNextControl } = await scanPage(page);
    expect(hasNextControl).toBe(true);
  });

  it('assigns each discovered field a selector that resolves to exactly one element', async () => {
    const { fields } = await scanPage(page);
    const nameField = fields.find((f) => f.label === 'Full name')!;
    const locatorCount = await page.locator(nameField.selector).count();
    expect(locatorCount).toBe(1);
  });

  it('returns no fields and no next control on a bare page', async () => {
    const blankPage = await browser.newPage();
    await blankPage.setContent('<!doctype html><html><body><p>Nothing here.</p></body></html>');
    const { fields, hasNextControl } = await scanPage(blankPage);
    expect(fields).toHaveLength(0);
    expect(hasNextControl).toBe(false);
    await blankPage.close();
  });
});
