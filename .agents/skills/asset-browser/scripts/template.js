// Template per script custom di automazione browser sull'app ASSET.
// Copiare e adattare per interazioni complesse (form, sequenze di click, estrazione tabelle).
// Avvio: node .agents/skills/asset-browser/scripts/template.js

'use strict';
process.env.LD_LIBRARY_PATH = '/home/fabarre/pw-libs/extracted/usr/lib/x86_64-linux-gnu:' + (process.env.LD_LIBRARY_PATH || '');

const { chromium } = require('/mnt/c/Users/Utente/ASSET/node_modules/playwright-core');

const CHROMIUM = '/home/fabarre/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const URL = 'http://localhost:3000/';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  // Cattura errori di pagina (utile per debug regressioni)
  page.on('pageerror', e => console.log('PAGE-EXC:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR:', m.text()); });

  await page.goto(URL, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000); // Supabase init + primo calcolo worker

  // === INSERISCI QUI LA LOGICA ===
  // Esempi:
  //   const title = await page.title();
  //   const irr = await page.$eval('#kpi-irr', el => el.textContent);
  //   await page.selectOption('#select-report-type', 'piano_ammortamento');
  //   await page.click('button[onclick^="generateReport"]');
  //   await page.screenshot({ path: '/tmp/result.png' });
  //   await switchTab('tab-financials');  // NB: è una funzione globale dell'app
  //   const rows = await page.$$eval('#debt-body tr', trs => trs.map(tr => tr.textContent.trim()));

  console.log('DONE');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
