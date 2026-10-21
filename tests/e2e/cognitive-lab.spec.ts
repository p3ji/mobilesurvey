import { expect, test } from '@playwright/test';

test.describe('Cognitive Testing Lab (#coglab)', () => {
  test('renders synchronized prosody timeline, diarized PII-sanitized transcript, and 4-construct diagnostics', async ({
    page,
  }) => {
    await page.goto('/#coglab');

    const root = page.getByTestId('cognitive-lab-view');
    await expect(root).toBeVisible();

    // Verify Contact to Set Up banner and button are visible
    await expect(page.getByTestId('coglab-setup-banner')).toBeVisible();
    await expect(page.getByTestId('coglab-contact-btn')).toBeVisible();

    // Open Contact to Set Up modal and verify mailto link and air-gap details
    await page.getByTestId('coglab-contact-btn').click();
    const modal = page.getByTestId('coglab-setup-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('contact@peji.ca');
    const mailtoBtn = page.getByTestId('modal-mailto-btn');
    await expect(mailtoBtn).toHaveAttribute('href', /mailto:contact@peji\.ca/);

    // Close modal to continue exploring the demonstration
    await page.getByRole('button', { name: /Continue Exploring|Poursuivre/i }).click();
    await expect(modal).not.toBeVisible();

    // Verify PII surrogates are enforced in the diarized transcript (no raw Clara Tremblay or SIN)
    const turn2 = page.getByTestId('transcript-turn-t_2');
    await expect(turn2).toContainText('[NAME_1]');
    await expect(turn2).not.toContainText('Clara Tremblay');

    // Verify Lexical-Prosodic Incongruence alert is rendered on Q4 ("Yeah, that is fine." with -6.8 dB drop)
    await expect(page.getByTestId('incongruence-alert').first()).toBeVisible();
    await expect(page.getByTestId('incongruence-alert').first()).toContainText(
      'volume dropped -6.8 dB',
    );

    // Test Moderator one-click "Mark Next Question" override
    await page.getByTestId('mark-next-question-btn').click();
    await expect(page.getByText(/Tagged question transition/)).toBeVisible();

    // Switch to Tab 2: 4-Construct Question Diagnostics
    await page.getByTestId('tab-question-diagnostics').click();
    await expect(page.getByTestId('diagnostics-matrix')).toBeVisible();
    await expect(page.getByTestId('diagnostic-card-q_emp_class')).toContainText(
      'Response Category Mapping',
    );
    await expect(page.getByTestId('diagnostic-card-q_hh_income')).toContainText(
      'Sensitivity & Vocal Discomfort',
    );

    // Switch to Tab 3: Cross-Participant Heatmap & Prosody Sandbox
    await page.getByTestId('tab-heatmap-sandbox').click();
    await expect(page.getByTestId('cross-participant-heatmap')).toBeVisible();
    await expect(page.getByTestId('prosody-sandbox')).toBeVisible();
    await expect(page.getByTestId('sandbox-sanitized-output')).toContainText('[NAME_1]');
    await expect(page.getByTestId('sandbox-sanitized-output')).not.toContainText('Alex Martin');

    // Test 1-click scenario preset switching in the simulator
    await page.getByRole('button', { name: /Category Overlap Confusion/i }).click();
    await expect(page.getByTestId('sandbox-utterance-input')).toHaveValue(/am I an employee or self-employed/i);
    await expect(page.getByTestId('sandbox-sanitized-output')).toContainText('[NAME_1]');

    await page.getByRole('button', { name: /Fluent Baseline Response/i }).click();
    await expect(page.getByTestId('sandbox-utterance-input')).toHaveValue(/permanent full-time employee/i);
    await expect(page.getByText('confident fluent')).toBeVisible();
  });

  test('switches between all 3 cognitive sessions and verifies distinct participant info', async ({
    page,
  }) => {
    await page.goto('/#coglab');

    // 1. Session P-01 (Contract IT Analyst - EN)
    await page.getByTestId('coglab-session-select').selectOption('cog_lfs_p01');
    await expect(page.getByText(/Speaker Baseline: F0 = 170 Hz/)).toBeVisible();
    await expect(page.getByText(/34 years old/)).toBeVisible();
    await expect(page.getByText(/IT consulting contract/)).toBeVisible();

    // 2. Session P-02 (Gig & Seasonal Worker - FR)
    await page.getByTestId('coglab-session-select').selectOption('cog_lfs_p02');
    await expect(page.getByText(/Speaker Baseline: F0 = 125 Hz/)).toBeVisible();
    await expect(page.getByText(/j’ai 42 ans/)).toBeVisible();
    await expect(page.getByText(/toiture à contrat/)).toBeVisible();
    await expect(page.getByText(/34 years old/)).not.toBeVisible();

    // 3. Session P-03 (Small Business Partner - External Web EQ)
    await page.getByTestId('coglab-session-select').selectOption('cog_ext_eq_p03');
    await expect(page.getByText(/Speaker Baseline: F0 = 110 Hz/)).toBeVisible();
    await expect(page.getByText(/turned 58 last month/)).toBeVisible();
    await expect(page.getByText(/architectural practice/)).toBeVisible();
    await expect(page.getByText(/toiture à contrat/)).not.toBeVisible();
    await expect(page.getByText(/External Web Survey/)).toBeVisible();
  });
});
