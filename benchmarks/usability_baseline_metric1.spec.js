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
  actionTimeout: 180000,
});

test.setTimeout(900000); // 15 minutes total for N=5 iterations


function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results_baseline_metric1.csv');
  const header = 'iteration,metric1_ui_blocking_ms\n';
  const rows = results
    .map((r) => `${r.iteration},${r.metric1_ui_blocking_ms}`)
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

test('Usability Baseline Benchmark: Metric 1 - UI Blocking Duration', async ({ page }) => {
  // Track Socket.IO frames from wsGateway to confirm backend video processing completion
  let onProcessingComplete = null;
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : '';
      const isLegacyDone =
        payload.includes('"preview-ready"') ||
        payload.includes('"process-update"') ||
        payload.includes('"preview-error"') ||
        payload.includes('"process-error"');
      const isExecutionDone =
        payload.includes('"execution-update"') &&
        (payload.includes('"completed"') || payload.includes('"error"'));

      if ((isLegacyDone || isExecutionDone) && typeof onProcessingComplete === 'function') {
        const resolve = onProcessingComplete;
        onProcessingComplete = null;
        resolve();
      }
    });
  });

  const waitForToolCompletion = (timeoutMs = 180000) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        onProcessingComplete = null;
        resolve();
      }, timeoutMs);

      onProcessingComplete = () => {
        clearTimeout(timer);
        resolve();
      };
    });

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

  const results = [];

  for (let iteration = 1; iteration <= N; iteration++) {
    console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);

    // --- SETUP: Open test project in edit mode ---
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

    // --- METRIC 1: Measure full duration of the blocking overlay until processing finishes ---
    const completionPromise = waitForToolCompletion(180000);
    const tStartApply = Date.now();
    await applyButton.click();

    const overlay = page.locator(overlaySelector).first();
    const overlayAppeared = await overlay
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    let metric1_ms = 0;
    if (overlayAppeared) {
      console.log('Blocking screen active. Waiting until video processing finishes and overlay hides...');
      await overlay.waitFor({ state: 'hidden', timeout: 180000 });
      metric1_ms = Date.now() - tStartApply;
    } else {
      console.log('No blocking overlay appeared (non-blocking UI).');
      metric1_ms = 0;
    }

    // Confirm backend tool execution has completely finished before next iteration
    await completionPromise;
    

    console.log(`[Metric 1] UI blocking duration: ${metric1_ms} ms`);
    

    results.push({
      iteration,
      metric1_ui_blocking_ms: metric1_ms,
    });

    saveResultsCsv(results);

    // Brief cooldown before starting the next iteration
    await page.waitForTimeout(2000);
  }

  console.log('\n--- Metric 1 benchmark finished. Results saved to benchmarks/results_baseline_metric1.csv ---');
});