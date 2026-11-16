# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: usability_baseline.spec.js >> Usability Baseline Benchmark: UI Blocking & Post-F5 Recovery
- Location: usability_baseline.spec.js:32:1

# Error details

```
TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "https://localhost:8080/dashboard/6afadf4d7f9432a51decd5e1"
============================================================
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - alert [ref=f1e2]
  - generic [ref=f1e4]:
    - generic [ref=f1e8]:
      - link "PictuRAS" [ref=f1e10] [cursor=pointer]:
        - /url: /
      - generic [ref=f1e11]:
        - button "New Project" [ref=f1e13] [cursor=pointer]
        - generic [ref=f1e14]:
          - generic [ref=f1e15]:
            - generic [ref=f1e16]: Your projects
            - button [ref=f1e17] [cursor=pointer]
          - list [ref=f1e19]:
            - listitem [ref=f1e20]:
              - link "teste" [active] [ref=f1e21] [cursor=pointer]:
                - /url: /dashboard/6afadf4d7f9432a51decd5e1
              - button [ref=f1e22] [cursor=pointer]
            - listitem [ref=f1e27]:
              - link "teste2" [ref=f1e28] [cursor=pointer]:
                - /url: /dashboard/6afae26b7f9432a51decd759
              - button [ref=f1e29] [cursor=pointer]
      - list [ref=f1e35]:
        - listitem [ref=f1e36]:
          - button "o ola ola ola@example.com" [ref=f1e37] [cursor=pointer]:
            - generic [ref=f1e38]: o
            - generic [ref=f1e40]:
              - generic [ref=f1e41]: ola ola
              - generic [ref=f1e42]: ola@example.com
    - main [ref=f1e46]:
      - generic [ref=f1e47]:
        - generic [ref=f1e48]:
          - heading "teste" [level=1] [ref=f1e50]
          - generic [ref=f1e52]:
            - button "Apply" [ref=f1e53] [cursor=pointer]
            - button "IA na edição" [ref=f1e54] [cursor=pointer]
            - button "Presets" [ref=f1e55] [cursor=pointer]
            - button "Import" [ref=f1e56] [cursor=pointer]
            - button "Share" [ref=f1e57] [cursor=pointer]
            - button "Download project" [ref=f1e59] [cursor=pointer]
            - generic [ref=f1e60]:
              - generic [ref=f1e61]:
                - button "Grid view" [pressed] [ref=f1e62] [cursor=pointer]
                - button "Carousel view" [ref=f1e63] [cursor=pointer]
              - generic [ref=f1e64]:
                - button "Edit mode" [pressed] [ref=f1e65] [cursor=pointer]
                - button "Results mode" [ref=f1e66] [cursor=pointer]
        - generic [ref=f1e69]:
          - generic [ref=f1e70]: To start editing, select an image from the grid.
          - button "Video · 176.6 s" [ref=f1e72] [cursor=pointer]
      - generic [ref=f1e82]:
        - heading "Processing" [level=1] [ref=f1e84]
        - progressbar [ref=f1e87]
        - generic [ref=f1e89]: 61%
        - button "Cancelar" [ref=f1e90] [cursor=pointer]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  49  |       )
  50  |       .first();
  51  |     await submitBtn.click();
  52  |     await page.waitForURL(
  53  |       (url) => !url.pathname.includes('/login') && !url.pathname.includes('/auth'),
  54  |       { timeout: 15000 }
  55  |     );
  56  |     await page.waitForTimeout(1000);
  57  |   }
  58  | 
  59  |   // 2. Identify test project and a second project in sidebar
  60  |   let testPid = ENV_PROJECT_ID;
  61  |   if (!testPid) {
  62  |     await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  63  |     await page.waitForTimeout(1000);
  64  | 
  65  |     const projectLinks = page.locator(
  66  |       '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"], a[href*="/dashboard/"]'
  67  |     );
  68  |     const count = await projectLinks.count();
  69  |     const foundPids = [];
  70  |     for (let i = 0; i < count; i++) {
  71  |       const href = await projectLinks.nth(i).getAttribute('href');
  72  |       if (href) {
  73  |         const match = href.match(/\/dashboard\/([a-zA-Z0-9_-]+)/);
  74  |         if (match && match[1] && !foundPids.includes(match[1])) {
  75  |           foundPids.push(match[1]);
  76  |         }
  77  |       }
  78  |     }
  79  | 
  80  |     if (foundPids.length === 0) {
  81  |       throw new Error(
  82  |         'Nenhum projeto encontrado. Cria um projeto com vídeo de teste antes de correr o benchmark.'
  83  |       );
  84  |     }
  85  |     testPid = foundPids[0];
  86  |   }
  87  | 
  88  |   // Define selectors identified from frontend/app/dashboard/[pid]/page.tsx
  89  |   const applyButtonSelector = 'button:has-text("Apply")';
  90  |   const overlaySelector = 'div.bg-black\\/70, div[class*="bg-black/70"]';
  91  |   const progressBarSelector = '[role="progressbar"]';
  92  |   const cancelButtonSelector = 'button:has-text("Cancelar")';
  93  | 
  94  |   const results = [];
  95  | 
  96  |   for (let iteration = 1; iteration <= N; iteration++) {
  97  |     console.log(`\n=================== ITERATION ${iteration}/${N} ===================`);
  98  | 
  99  |     // --- SETUP: Open test project in edit mode ---
  100 |     await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
  101 |       waitUntil: 'domcontentloaded',
  102 |     });
  103 |     await page.waitForTimeout(1500);
  104 | 
  105 |     const applyButton = page.locator(applyButtonSelector).first();
  106 |     await applyButton.waitFor({ state: 'visible', timeout: 15000 });
  107 | 
  108 |     // If pipeline is empty (Apply disabled), select an available tool or preset to enable Apply
  109 |     if (await applyButton.isDisabled()) {
  110 |       const toolButton = page
  111 |         .locator(
  112 |           'aside button, [data-sidebar] ~ div button, button:has-text("Rotate"), button:has-text("Brightness"), button:has-text("Binarization")'
  113 |         )
  114 |         .first();
  115 |       if (await toolButton.isVisible().catch(() => false)) {
  116 |         await toolButton.click();
  117 |         await page.waitForTimeout(800);
  118 |       }
  119 |     }
  120 | 
  121 |     // --- MÉTRICA 1: Bloqueio da UI ---
  122 |     // Encontrar link para um outro projeto na sidebar
  123 |     const otherProjectLink = page
  124 |       .locator(
  125 |         '[data-sidebar="sidebar"] a[href*="/dashboard/"], aside a[href*="/dashboard/"], nav a[href*="/dashboard/"], a[href*="/dashboard/"]'
  126 |       )
  127 |       .filter({ hasNot: page.locator(`[href*="${testPid}"]`) })
  128 |       .first();
  129 | 
  130 |     const hasOtherProject = await otherProjectLink.isVisible().catch(() => false);
  131 |     if (!hasOtherProject) {
  132 |       console.warn(
  133 |         'Aviso: Não foi encontrado um segundo projeto na sidebar para medir navegação.'
  134 |       );
  135 |     }
  136 | 
  137 |     const tStartApply = Date.now();
  138 |     await applyButton.click();
  139 | 
  140 |     // Aguarda o overlay bloqueante (bg-black/70) aparecer
  141 |     const overlay = page.locator(overlaySelector).first();
  142 |     await overlay.waitFor({ state: 'visible', timeout: 10000 });
  143 | 
  144 |     let metric1_ms = 0;
  145 |     if (hasOtherProject) {
  146 |       // O clique no outro projeto da sidebar fica bloqueado pelo overlay bg-black/70.
  147 |       // O Playwright aguarda que o overlay desapareça (fim do processamento) antes de conseguir clicar e navegar.
  148 |       await otherProjectLink.click({ timeout: 120000 });
> 149 |       await page.waitForURL((url) => !url.pathname.includes(testPid), { timeout: 30000 });
      |                  ^ TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
  150 |       metric1_ms = Date.now() - tStartApply;
  151 |     } else {
  152 |       // Se não houver outro projeto, mede até o overlay desaparecer
  153 |       await overlay.waitFor({ state: 'hidden', timeout: 120000 });
  154 |       metric1_ms = Date.now() - tStartApply;
  155 |     }
  156 | 
  157 |     console.log(`[Métrica 1] Tempo de bloqueio da UI: ${metric1_ms} ms`);
  158 | 
  159 |     // --- MÉTRICA 2: Recuperação pós-F5 ---
  160 |     // Voltar a abrir o projeto de teste em edit mode
  161 |     await page.goto(`${BASE_URL}/dashboard/${testPid}?mode=edit`, {
  162 |       waitUntil: 'domcontentloaded',
  163 |     });
  164 |     await page.waitForTimeout(1500);
  165 | 
  166 |     const applyButtonM2 = page.locator(applyButtonSelector).first();
  167 |     await applyButtonM2.waitFor({ state: 'visible', timeout: 15000 });
  168 | 
  169 |     // Submeter o pipeline
  170 |     await applyButtonM2.click();
  171 | 
  172 |     // Aguarda início do processamento (overlay visível)
  173 |     const overlayM2 = page.locator(overlaySelector).first();
  174 |     await overlayM2.waitFor({ state: 'visible', timeout: 10000 });
  175 | 
  176 |     // Espera 1.5s para estar a meio do processamento
  177 |     await page.waitForTimeout(1500);
  178 | 
  179 |     // Executa page.reload()
  180 |     const tReloadStart = Date.now();
  181 |     await page.reload({ waitUntil: 'domcontentloaded' });
  182 | 
  183 |     // Verifica se a barra de progresso e o botão Cancelar voltam a ficar visíveis
  184 |     let metric2_recovered = 0;
  185 |     let metric2_recovery_ms = 0;
  186 | 
  187 |     try {
  188 |       const progressBar = page.locator(progressBarSelector).first();
  189 |       const cancelButton = page.locator(cancelButtonSelector).first();
  190 | 
  191 |       await Promise.all([
  192 |         progressBar.waitFor({ state: 'visible', timeout: 4000 }),
  193 |         cancelButton.waitFor({ state: 'visible', timeout: 4000 }),
  194 |       ]);
  195 | 
  196 |       metric2_recovered = 1;
  197 |       metric2_recovery_ms = Date.now() - tReloadStart;
  198 |       console.log(
  199 |         `[Métrica 2] Recuperação pós-F5 BEM SUCEDIDA: ${metric2_recovery_ms} ms`
  200 |       );
  201 |     } catch {
  202 |       metric2_recovered = 0;
  203 |       metric2_recovery_ms = 0;
  204 |       console.log('[Métrica 2] Recuperação pós-F5 NÃO OCORREU (0)');
  205 |     }
  206 | 
  207 |     // Aguarda que o processamento em background termine antes da próxima iteração
  208 |     await page.waitForTimeout(5000);
  209 | 
  210 |     results.push({
  211 |       iteration,
  212 |       metric1_ui_blocking_ms: metric1_ms,
  213 |       metric2_recovered,
  214 |       metric2_recovery_time_ms: metric2_recovery_ms,
  215 |     });
  216 | 
  217 |     saveResultsCsv(results);
  218 |   }
  219 | 
  220 |   console.log('\n--- Benchmark Finalizado. Resultados gravados em benchmarks/results.csv ---');
  221 | });
  222 | 
```