const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://localhost:8080';
const USER_EMAIL = process.env.USER_EMAIL || 'ola@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'ola12345';
const ENV_PROJECT_ID = process.env.PROJECT_ID || '';
const TEST_PROJECT_NAME = process.env.PROJECT_NAME || 'teste';
const N = 5;
const PROGRESS_TIMEOUT = 10000;

test.use({
  baseURL: BASE_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 120000,
});

test.setTimeout(300000);

function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results_experimental_configuration_metric2.csv');
  const header = 'iteration,metric2_recovered,metric2_recovery_time_ms\n';
  const rows = results
    .map((r) => `${r.iteration},${r.metric2_recovered},${r.metric2_recovery_time_ms}`)
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

  const emailInput = page.getByLabel('Email', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await emailInput.fill(USER_EMAIL);

  const passwordInput = page.getByLabel('Password', { exact: true });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill(USER_PASSWORD);

  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/dashboard') ||
      (!url.pathname.includes('/login') && !url.pathname.includes('/auth')),
    { timeout: 20000 }
  );
}

async function collectSidebarProjects(page) {
  const links = page.locator(
    '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"]'
  );
  const count = await links.count();
  const projects = [];

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute('href');
    const match = href && href.match(/\/dashboard\/([a-zA-Z0-9_-]+)(?:\?|$)/);
    if (!match || match[1] === 'account') continue;
    if (projects.some((project) => project.pid === match[1])) continue;
    projects.push({ pid: match[1], name: (await link.innerText()).trim(), link });
  }

  return projects;
}

async function resolveTestProject(page) {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(async () => (await collectSidebarProjects(page)).length, { timeout: 15000 })
    .toBeGreaterThan(0);

  const projects = await collectSidebarProjects(page);
  if (ENV_PROJECT_ID && projects.some((project) => project.pid === ENV_PROJECT_ID)) {
    return ENV_PROJECT_ID;
  }

  const namedProject = projects.find((project) => project.name === TEST_PROJECT_NAME);
  return namedProject ? namedProject.pid : projects[0].pid;
}

async function stopResidualProcessing(page) {
  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).first();
  if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelButton.click();
    await expect(cancelButton).toBeHidden({ timeout: 30000 });
  }
}

async function addPipelineTool(page) {
  const toolLabels = ['Brightness', 'Binarization', 'Rotate', 'Contrast', 'Saturation'];

  for (const label of toolLabels) {
    const trigger = page.getByRole('button', { name: label, exact: true }).first();
    if (!(await trigger.isVisible().catch(() => false))) continue;
    if (await trigger.isDisabled().catch(() => false)) continue;

    await trigger.click();
    const saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();
    if (!(await saveButton.isVisible().catch(() => false))) continue;

    if (await saveButton.isDisabled()) {
      const slider = page.getByRole('slider').first();
      if (await slider.isVisible().catch(() => false)) {
        await slider.focus();
        await slider.press('ArrowRight');
      }
    }

    if (await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click();
      return;
    }

    await page.keyboard.press('Escape');
  }
}

async function openProject(page, testPid, view = 'grid') {
  const query = view === 'grid' ? '?mode=edit' : `?mode=edit&view=${view}`;
  await page.goto(`${BASE_URL}/dashboard/${testPid}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Apply', exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
}

async function ensureReadyToApply(page, testPid) {
  await openProject(page, testPid);
  const applyButton = page.getByRole('button', { name: 'Apply', exact: true }).first();

  if (await applyButton.isDisabled()) {
    await stopResidualProcessing(page);
    await expect(applyButton).toBeEnabled({ timeout: 30000 }).catch(() => {});
  }

  if (await applyButton.isDisabled()) {
    await addPipelineTool(page);
    await expect(applyButton).toBeEnabled({ timeout: 30000 }).catch(() => {});
  }

  if (await applyButton.isDisabled()) {
    await openProject(page, testPid, 'carousel');
    await addPipelineTool(page);
  }

  await expect(applyButton).toBeEnabled({ timeout: 15000 });
  return applyButton;
}

test('Usability Experimental Configuration Benchmark: Metric 2 - Post-F5 State Recovery', async ({ page }) => {
  await login(page);
  const testPid = await resolveTestProject(page);
  const results = [];

  for (let iteration = 1; iteration <= N; iteration++) {
    console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);

    const applyButton = await ensureReadyToApply(page, testPid);
    await applyButton.click();

    await Promise.all([
      page.getByRole('progressbar').first().waitFor({ state: 'visible', timeout: PROGRESS_TIMEOUT }),
      page.getByRole('button', { name: 'Cancel', exact: true }).first().waitFor({ state: 'visible', timeout: PROGRESS_TIMEOUT }),
    ]);

    await page.waitForTimeout(1500);

    const tReloadStart = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });

    let metric2_recovered = 0;
    let metric2_recovery_ms = 0;

    try {
      await Promise.all([
        page.getByRole('progressbar').first().waitFor({ state: 'visible', timeout: 4000 }),
        page.getByRole('button', { name: 'Cancel', exact: true }).first().waitFor({ state: 'visible', timeout: 4000 }),
      ]);

      metric2_recovered = 1;
      metric2_recovery_ms = Date.now() - tReloadStart;
      console.log(`[Metric 2] Post-F5 recovery SUCCEEDED: ${metric2_recovery_ms} ms`);
    } catch {
      console.log('[Metric 2] Post-F5 recovery DID NOT OCCUR (0)');
    }

    await stopResidualProcessing(page);

    results.push({
      iteration,
      metric2_recovered,
      metric2_recovery_time_ms: metric2_recovery_ms,
    });

    saveResultsCsv(results);
  }

  console.log('\n--- Metric 2 benchmark finished. Results saved to benchmarks/results_experimental_configuration_metric2.csv ---');
});
