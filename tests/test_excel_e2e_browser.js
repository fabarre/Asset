// E2E Playwright test per validare l'esportazione Excel dall'interfaccia browser
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const EXTRA_LIBS = path.join(os.homedir(), 'pw-libs', 'extracted', 'usr', 'lib', 'x86_64-linux-gnu');
if (fs.existsSync(EXTRA_LIBS)) {
  process.env.LD_LIBRARY_PATH = EXTRA_LIBS + ':' + (process.env.LD_LIBRARY_PATH || '');
}

const { chromium } = require(path.join(REPO_ROOT, 'node_modules', 'playwright-core'));
const ExcelJS = require('exceljs');

function resolveChromium() {
  if (process.env.ASSET_BROWSER_PATH && fs.existsSync(process.env.ASSET_BROWSER_PATH)) {
    return process.env.ASSET_BROWSER_PATH;
  }
  const pwCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pwCache)) {
    const dirs = fs.readdirSync(pwCache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const bin = path.join(pwCache, d, sub, 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

const CHROMIUM = resolveChromium();
const URL = 'http://localhost:3000/';
const DL_DIR = '/tmp/e2e_excel_dl';
const ARTIFACT_SCREENSHOT = '/home/ubuntu/.gemini/antigravity-cli/brain/72ab711d-3499-40fe-9660-5307490c19c7/excel_export_financials_tab.png';

(async () => {
  console.log('🚀 Avvio E2E Browser Test: Esportazione Excel da UI...');
  if (fs.existsSync(DL_DIR)) {
    fs.rmSync(DL_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DL_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  page.on('pageerror', e => console.log('PAGE-EXC:', e.message));
  page.on('console', m => {
    if (m.type() === 'error') console.log('PAGE-ERR:', m.text());
  });



  console.log('▶ Navigazione su', URL);
  await page.goto(URL, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Gestione overlay autenticazione / login
  console.log('▶ Controllo overlay di autenticazione...');
  const overlayVisible = await page.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    return !!ov && ov.style.display !== 'none';
  });

  const authFile = path.join(REPO_ROOT, 'scratch', '.e2e_auth.json');
  let creds = null;
  if (fs.existsSync(authFile)) {
    try {
      creds = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    } catch (e) {
      console.warn('Impossibile leggere .e2e_auth.json:', e.message);
    }
  }

  if (overlayVisible) {
    console.log('▶ Chiamata continueAnonymous()...');
    await page.evaluate(() => {
      if (typeof window.continueAnonymous === 'function') {
        window.continueAnonymous();
      } else {
        const btn = document.getElementById('btn-continue-anonymous');
        if (btn) btn.click();
      }
    });

    await page.waitForFunction(
      () => {
        const ov = document.getElementById('auth-overlay');
        return !ov || ov.style.display === 'none';
      },
      { timeout: 15000 }
    );
    console.log('✓ Overlay chiuso con successo in modalità anonima.');
  }

  await page.waitForTimeout(2000);

  // Assicura la presenza di almeno un impianto attivo e innesca il calcolo
  console.log('▶ Controllo e inizializzazione impianto di test...');
  await page.evaluate(() => {
    if (!window.State.plants || window.State.plants.length === 0) {
      const profile = (typeof window.generateDefaultSolarProfile === 'function')
        ? window.generateDefaultSolarProfile(5, 1350)
        : new Float64Array(8760).fill(500);
      window.State.plants = [{
        id: 'p1', name: 'FV Tuscania 5MW', capacity: 5000, zone: 'CNOR',
        capex: 750, opex: 85000, enabled: true,
        generation: profile,
        codDate: '2026-06-01',
        bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
        bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
        bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
        gridVoltage: 'mt', gridConnectionKw: 5000,
        marketType: 'rid', traderContractType: 'pun_orario',
        traderSpread: 2, traderDisp: 1
      }];
    }
    if (!window.State.inputs.durationYears) window.State.inputs.durationYears = 20;
    if (typeof window.triggerRecalculate === 'function') {
      window.triggerRecalculate();
    }
  });

  // Attesa convergenza calcolo worker e popolamento State.results
  console.log('▶ Attesa convergenza calcolo worker (fino a 20s)...');
  await page.waitForFunction(() => {
    return !!(window.State && window.State.results && window.State.results.matrix &&
              window.State.results.matrix.revenueTotal && window.State.results.matrix.revenueTotal.length > 0);
  }, { timeout: 20000 });
  console.log('✓ Stato risultati simulazione disponibili!');
  await page.waitForTimeout(1500); // attesa completamento renderUI DOM

  // Passaggio alla scheda Financials
  console.log('▶ Passaggio a tab-financials...');
  await page.evaluate(() => {
    if (typeof window.switchTab === 'function') {
      window.switchTab('tab-financials');
    }
  });
  await page.waitForTimeout(2000);

  // Verifica DOM dell'Anno 0 nelle tabelle P&L e Ammortamento
  console.log('▶ Verifica elementi DOM Anno 0...');
  const domChecks = await page.evaluate(() => {
    const thA = Array.from(document.querySelectorAll('#pl-header-a th')).map(th => th.textContent.trim());
    const thDebt = Array.from(document.querySelectorAll('#debt-header th')).map(th => th.textContent.trim());
    const clean = s => (s || '').replace(/\u00a0/g, ' ').trim();
    const revY0 = clean(document.getElementById('cell-pnl-revenueTotal-y0')?.textContent);
    const ebitdaY0 = clean(document.getElementById('cell-pnl-ebitda-y0')?.textContent);
    const debtBeginY0 = clean(document.getElementById('cell-debt-beginningBalance-y0')?.textContent);
    const debtEndY0 = clean(document.getElementById('cell-debt-endingBalance-y0')?.textContent);
    const debtBeginY1 = clean(document.getElementById('cell-debt-beginningBalance-y1')?.textContent);
    return { thA, thDebt, revY0, ebitdaY0, debtBeginY0, debtEndY0, debtBeginY1 };
  });

  console.log('   Headers Tabella A:', domChecks.thA.slice(0, 4));
  console.log('   Headers Tabella Debito:', domChecks.thDebt.slice(0, 4));
  console.log(`   DOM Anno 0: Ricavi=${domChecks.revY0}, EBITDA=${domChecks.ebitdaY0}`);
  console.log(`   DOM Debito: Inizio Y0=${domChecks.debtBeginY0}, Fine Y0=${domChecks.debtEndY0}, Inizio Y1=${domChecks.debtBeginY1}`);

  if (!domChecks.thA.includes('Anno 0')) throw new Error("Header Tabella A privo di 'Anno 0'!");
  if (!domChecks.thDebt.includes('Anno 0')) throw new Error("Header Tabella Debito privo di 'Anno 0'!");
  if (domChecks.debtBeginY0 !== '0 €') throw new Error(`Debito inizio Anno 0 atteso '0 €', trovato '${domChecks.debtBeginY0}'`);
  if (domChecks.debtBeginY1 !== domChecks.debtEndY0) throw new Error(`Disallineamento: Inizio Y1 (${domChecks.debtBeginY1}) != Fine Y0 (${domChecks.debtEndY0})`);
  console.log('✓ Verifica DOM Anno 0 completata con successo al 100%!');

  // Rimuovi l'auth-overlay per evitare intercettazione dei pointer events e per pulizia visiva
  await page.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    if (ov) ov.remove();
  });

  // Screenshot visivo della tabella P&L con Anno 0
  console.log('▶ Cattura screenshot tabella P&L con Anno 0...');
  const tableEl = await page.$('#card-pl-section-a');
  if (tableEl) {
    await tableEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await tableEl.screenshot({ path: ARTIFACT_SCREENSHOT });
  } else {
    await page.screenshot({ path: ARTIFACT_SCREENSHOT, fullPage: false });
  }
  console.log('✓ Screenshot salvato:', ARTIFACT_SCREENSHOT);

  // Setup intercettazione download tramite CDP
  const client = await page.context().newCDPSession(page);
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DL_DIR
  });

  // Trigger Esporta in Excel
  console.log('▶ Trigger esportazione Excel (exportPnlToExcel)...');
  await page.evaluate(() => {
    if (typeof window.exportPnlToExcel === 'function') {
      window.exportPnlToExcel();
    } else {
      const btn = document.querySelector('button[onclick^="exportPnlToExcel"]');
      if (btn) btn.click();
    }
  });

  // Attesa download
  console.log('▶ Attesa generazione del file XLSX (fino a 30s)...');
  let downloadedFile = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const files = fs.readdirSync(DL_DIR).filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
    if (files.length > 0) {
      downloadedFile = path.join(DL_DIR, files[0]);
      break;
    }
  }

  if (!downloadedFile) {
    throw new Error('Nessun file scaricato entro il timeout!');
  }

  const stat = fs.statSync(downloadedFile);
  console.log(`✓ File scaricato con successo: ${path.basename(downloadedFile)} (${stat.size} bytes)`);

  if (stat.size < 50000) {
    throw new Error(`Dimensione file anomala: ${stat.size} bytes (attesi > 50KB)`);
  }

  // Verifica magic bytes ZIP/XLSX: PK\x03\x04
  const fd = fs.openSync(downloadedFile, 'r');
  const header = Buffer.alloc(4);
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);

  if (header[0] !== 0x50 || header[1] !== 0x4B || header[2] !== 0x03 || header[3] !== 0x04) {
    throw new Error(`Magic bytes ZIP/XLSX non validi: ${header.toString('hex')}`);
  }
  console.log('✓ Intestazione binaria ZIP/XLSX (PK\\x03\\x04) valida al 100%!');

  // Parsing ed analisi approfondita del workbook scaricato con ExcelJS
  console.log('▶ Parsing e verifica del workbook scaricato con ExcelJS...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(downloadedFile);

  const sheetCe = wb.getWorksheet('CONTO ECONOMICO');
  if (!sheetCe) throw new Error("Foglio 'CONTO ECONOMICO' mancante nel file scaricato!");

  // Verifica header temporali
  const headerRow = sheetCe.getRow(1);
  const colBHeader = String(headerRow.getCell(2).value || '');
  const colCHeader = String(headerRow.getCell(3).value || '');
  console.log(`   Header Col B: '${colBHeader}', Header Col C: '${colCHeader}'`);
  if (!colBHeader.includes('Anno 0')) throw new Error(`Colonna B attesa Anno 0, trovato '${colBHeader}'`);
  if (!colCHeader.includes('Anno 1')) throw new Error(`Colonna C attesa Anno 1, trovato '${colCHeader}'`);

  // Verifica Sheet AMMORTAMENTO
  const sheetDebt = wb.getWorksheet('AMMORTAMENTO');
  if (!sheetDebt) throw new Error("Foglio 'AMMORTAMENTO' mancante nel file scaricato!");
  
  let rowDebtBegin = null;
  let rowDebtEnd = null;
  sheetDebt.eachRow((r, rNum) => {
    const val = String(r.getCell(1).value || '').trim();
    if (val.includes('Debito Residuo Inizio Anno')) rowDebtBegin = rNum;
    if (val.includes('Debito Residuo Fine Anno')) rowDebtEnd = rNum;
  });

  if (!rowDebtBegin || !rowDebtEnd) throw new Error("Righe debito non trovate in AMMORTAMENTO!");
  const getVal = c => (typeof c === 'object' && c !== null) ? (c.result !== undefined ? c.result : c.formula) : c;
  const valBeginY0 = getVal(sheetDebt.getCell(`B${rowDebtBegin}`).value);
  const valEndY0 = getVal(sheetDebt.getCell(`B${rowDebtEnd}`).value);
  const formulaBeginY1 = sheetDebt.getCell(`C${rowDebtBegin}`).formula || sheetDebt.getCell(`C${rowDebtBegin}`).value?.formula;

  console.log(`   AMMORTAMENTO: Inizio Y0=${valBeginY0}, Fine Y0=${valEndY0}, Formula Inizio Y1="${formulaBeginY1}"`);
  if (valBeginY0 !== 0 && valBeginY0 !== '0') {
    throw new Error(`Debito inizio Anno 0 atteso 0, trovato ${valBeginY0}`);
  }
  if (!formulaBeginY1 || !formulaBeginY1.includes(`B${rowDebtEnd}`)) {
    throw new Error(`Formula inizio Anno 1 attesa '=B${rowDebtEnd}', trovato '${formulaBeginY1}'`);
  }
  console.log('✓ Verifica continuità contabile debito (Inizio Y1 = Fine Y0) verificata al 100%!');

  // Pulizia
  await browser.close();
  console.log('\n========================================================');
  console.log('🎉 TEST E2E BROWSER EXPORT EXCEL SUPERATO AL 100%!');
  console.log('========================================================\n');
})().catch(e => {
  console.error('❌ ERRORE E2E BROWSER:', e);
  process.exit(1);
});
