const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://localhost:8080';
const USER_EMAIL = process.env.USER_EMAIL || 'ola@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'ola12345';
const ENV_PROJECT_ID = process.env.PROJECT_ID || '';
const TEST_PROJECT_NAME = process.env.PROJECT_NAME || 'teste';
const N = 5;

test.use({
  baseURL: BASE_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 120000,
});

test.setTimeout(300000); // 5 minutes total for N=5 iterations

function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results_metric2.csv');
  const header = 'iteration,metric2_recovered,metric2_recovery_time_ms\n';
  const rows = results
    .map(
      (r) =>
        `${r.iteration},${r.metric2_recovered},${r.metric2_recovery_time_ms}`
    )
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

test('Usability Baseline Benchmark: Metric 2 - Post-F5 State Recovery', async ({ page }) => {
  // 1. Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const emailInput = page
    .locator('#email, input[type="email"], input[name="email"]')
    .first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(USER_EMAIL);
    const passInput = page
      .locator('#password, input[type="password"], input[name="password"]')
      .first();
    await passInput.fill(USER_PASSWORD);
    const submitBtn = page
      .locator(
        'button[type="submit"]:has-text("Login"), button:has-text("Login"), button[type="submit"]'
      )
      .first();
    await submitBtn.click();
    await page.waitForURL(
      (url) => !url.pathname.includes('/login') && !url.pathname.includes('/auth'),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000);
  }

  // 2. Resolve test project ID by name in the sidebar if not provided via env
  let testPid = ENV_PROJECT_ID;
  if (!testPid) {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const testProjectItem = page
      .locator('[data-sidebar="sidebar"], aside, nav')
      .getByText(TEST_PROJECT_NAME, { exact: true })
      .first();

    if (!(await testProjectItem.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error(
        `Project "${TEST_PROJECT_NAME}" not found in sidebar. Create it with a video and a tool before running.`
      );
    }

    await testProjectItem.click();
    await page.waitForURL(/\/dashboard\/[a-zA-Z0-9_-]+/, {
      waitUntil: 'commit',
      timeout: 15000,
    });

    const match = new URL(page.url()).pathname.match(/\/dashboard\/([a-zA-Z0-9_-]+)/);
    if (!match || !match[1]) {
      throw new Error(`Could not extract project ID from URL: ${page.url()}`);
    }
    testPid = match[1];
    console.log(`Resolved project "${TEST_PROJECT_NAME}" ID: ${testPid}`);
  }

  // Selectors from frontend/app/dashboard/[pid]/page.tsx
  const applyButtonSelector = 'button:has-text("Apply")';
  const overlaySelector = 'div.bg-black\\/70, div[class*="bg-black/70"]';
  const progressBarSelector = '[role="progressbar"]';
  const cancelButtonSelector = 'button:has-text("Cancelar"), button:has-text("Cancel")';

  const results = [];

  for (let iteration = 1; iteration <= N; iteration++) {
    console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);

    // --- SETUP: Reopen test project in edit mode ---
    await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    const applyButton = page.locator(applyButtonSelector).first();
    await applyButton.waitFor({ state: 'visible', timeout: 15000 });

    // If pipeline is empty (Apply disabled), select an available tool to enable Apply
    if (await applyButton.isDisabled()) {
      const toolButton = page
        .locator(
          'aside button, [data-sidebar] ~ div button, button:has-text("Rotate"), button:has-text("Brightness"), button:has-text("Binarization")'
        )
        .first();
      if (await toolButton.isVisible().catch(() => false)) {
        await toolButton.click();
        await page.waitForTimeout(800);
      }
    }

    if (await applyButton.isDisabled()) {
      throw new Error(
        `Apply button is disabled in project "${TEST_PROJECT_NAME}". Ensure a video and at least one tool are configured.`
      );
    }

    // --- METRIC 2: Trigger processing, reload page mid-execution (F5), and measure recovery ---
    await applyButton.click();

    // Wait briefly for processing to start
    const overlay = page.locator(overlaySelector).first();
    await overlay.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Wait 1.5s to reach the midpoint of video processing
    await page.waitForTimeout(1500);

    // Execute F5 (page reload)
    const tReloadStart = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Check whether the progress bar and Cancel button reappear after reload
    let metric2_recovered = 0;
    let metric2_recovery_ms = 0;

    try {
      const progressBar = page.locator(progressBarSelector).first();
      const cancelButton = page.locator(cancelButtonSelector).first();

      await Promise.all([
        progressBar.waitFor({ state: 'visible', timeout: 4000 }),
        cancelButton.waitFor({ state: 'visible', timeout: 4000 }),
      ]);

      metric2_recovered = 1;
      metric2_recovery_ms = Date.now() - tReloadStart;
      console.log(`[Metric 2] Post-F5 recovery SUCCEEDED: ${metric2_recovery_ms} ms`);
    } catch {
      metric2_recovered = 0;
      metric2_recovery_ms = 0;
      console.log('[Metric 2] Post-F5 recovery DID NOT OCCUR (0)');
    }

    results.push({
      iteration,
      metric2_recovered,
      metric2_recovery_time_ms: metric2_recovery_ms,
    });

    saveResultsCsv(results);

    // Brief pause before reopening the project for the next iteration
    await page.waitForTimeout(1000);
  }

  console.log('\n--- Metric 2 benchmark finished. Results saved to benchmarks/results_metric2.csv ---');
});