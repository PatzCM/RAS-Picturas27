const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://localhost:8080';
const USER_EMAIL = process.env.USER_EMAIL || 'ola@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'ola12345';
const ENV_PROJECT_ID = process.env.PROJECT_ID || '6afadf4d7f9432a51decd5e1';
const N = 5;

test.use({
  baseURL: BASE_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 120000,
});

test.setTimeout(600000); // 10 minutes total for N=5 iterations

function saveResultsCsv(results) {
  const csvPath = path.join(__dirname, 'results.csv');
  const header = 'iteration,metric1_ui_blocking_ms,metric2_recovered,metric2_recovery_time_ms\n';
  const rows = results
    .map(
      (r) =>
        `${r.iteration},${r.metric1_ui_blocking_ms},${r.metric2_recovered},${r.metric2_recovery_time_ms}`
    )
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n', 'utf8');
}

test('Usability Baseline Benchmark: UI Blocking & Post-F5 Recovery', async ({ page }) => {
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

  // 2. Identify test project and a second project in sidebar
  let testPid = ENV_PROJECT_ID;
  if (!testPid) {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const projectLinks = page.locator(
      '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"], a[href*="/dashboard/"]'
    );
    const count = await projectLinks.count();
    const foundPids = [];
    for (let i = 0; i < count; i++) {
      const href = await projectLinks.nth(i).getAttribute('href');
      if (href) {
        const match = href.match(/\/dashboard\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] && !foundPids.includes(match[1])) {
          foundPids.push(match[1]);
        }
      }
    }

    if (foundPids.length === 0) {
      throw new Error(
        'Nenhum projeto encontrado. Cria um projeto com vídeo de teste antes de correr o benchmark.'
      );
    }
    testPid = foundPids[0];
  }

  // Define selectors identified from frontend/app/dashboard/[pid]/page.tsx
  const applyButtonSelector = 'button:has-text("Apply")';
  const overlaySelector = 'div.bg-black\\/70, div[class*="bg-black/70"]';
  const progressBarSelector = '[role="progressbar"]';
  const cancelButtonSelector = 'button:has-text("Cancelar")';

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

    // If pipeline is empty (Apply disabled), select an available tool or preset to enable Apply
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

    // --- MÉTRICA 1: Bloqueio da UI ---
    // Encontrar link para um outro projeto na sidebar
    const otherProjectLink = page
      .locator(
        '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"], a[href*="/dashboard/"]'
      )
      .filter({ hasNot: page.locator(`[href*="${testPid}"]`) })
      .first();

    const hasOtherProject = await otherProjectLink.isVisible().catch(() => false);
    if (!hasOtherProject) {
      console.warn(
        'Aviso: Não foi encontrado um segundo projeto na sidebar para medir navegação.'
      );
    }

    const tStartApply = Date.now();
    await applyButton.click();

    // Aguarda o overlay bloqueante (bg-black/70) aparecer
    const overlay = page.locator(overlaySelector).first();
    await overlay.waitFor({ state: 'visible', timeout: 10000 });

    let metric1_ms = 0;
    if (hasOtherProject) {
      // O clique no outro projeto da sidebar fica bloqueado pelo overlay bg-black/70.
      // O Playwright aguarda que o overlay desapareça (fim do processamento) antes de conseguir clicar e navegar.
      await otherProjectLink.click({ timeout: 120000 });
      await page.waitForURL((url) => !url.pathname.includes(testPid), { timeout: 30000 });
      metric1_ms = Date.now() - tStartApply;
    } else {
      // Se não houver outro projeto, mede até o overlay desaparecer
      await overlay.waitFor({ state: 'hidden', timeout: 120000 });
      metric1_ms = Date.now() - tStartApply;
    }

    console.log(`[Métrica 1] Tempo de bloqueio da UI: ${metric1_ms} ms`);

    // --- MÉTRICA 2: Recuperação pós-F5 ---
    // Voltar a abrir o projeto de teste em edit mode
    await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    const applyButtonM2 = page.locator(applyButtonSelector).first();
    await applyButtonM2.waitFor({ state: 'visible', timeout: 15000 });

    // Submeter o pipeline
    await applyButtonM2.click();

    // Aguarda início do processamento (overlay visível)
    const overlayM2 = page.locator(overlaySelector).first();
    await overlayM2.waitFor({ state: 'visible', timeout: 10000 });

    // Espera 1.5s para estar a meio do processamento
    await page.waitForTimeout(1500);

    // Executa page.reload()
    const tReloadStart = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Verifica se a barra de progresso e o botão Cancelar voltam a ficar visíveis
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
      console.log(
        `[Métrica 2] Recuperação pós-F5 BEM SUCEDIDA: ${metric2_recovery_ms} ms`
      );
    } catch {
      metric2_recovered = 0;
      metric2_recovery_ms = 0;
      console.log('[Métrica 2] Recuperação pós-F5 NÃO OCORREU (0)');
    }

    // Aguarda que o processamento em background termine antes da próxima iteração
    await page.waitForTimeout(5000);

    results.push({
      iteration,
      metric1_ui_blocking_ms: metric1_ms,
      metric2_recovered,
      metric2_recovery_time_ms: metric2_recovery_ms,
    });

    saveResultsCsv(results);
  }

  console.log('\n--- Benchmark Finalizado. Resultados gravados em benchmarks/results.csv ---');
});
