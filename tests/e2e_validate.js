// E2E validation post-fix: carica l'app in Edge headless, verifica errori JS,
// KPI, tab GME, tab Sensibilità, input IRES/IRAP, "Nessun Exit".
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGE-EXC: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('PAGE-ERR: ' + m.text()); });

    await page.goto('http://localhost:3000/', { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000); // Supabase init + primo calcolo

    const out = {};
    out.title = await page.evaluate(() => document.title);
    out.syncStatus = await page.evaluate(() => document.getElementById('sync-status')?.textContent);
    out.plantsCount = await page.evaluate(() => window.State?.plants?.length);
    out.kpiIrr = await page.evaluate(() => document.getElementById('kpi-irr')?.textContent);
    out.kpiNpv = await page.evaluate(() => document.getElementById('kpi-npv')?.textContent);
    out.kpiDscr = await page.evaluate(() => document.getElementById('kpi-dscr')?.textContent);
    out.medione = await page.evaluate(() => document.getElementById('consolidated-medione-kpi')?.textContent);

    // IRES/IRAP inputs presenti e valorizzati
    out.iresInput = await page.evaluate(() => document.getElementById('input-ires-rate')?.value);
    out.irapInput = await page.evaluate(() => document.getElementById('input-irap-rate')?.value);
    out.iresState = await page.evaluate(() => window.State?.inputs?.iresRate);
    out.irapState = await page.evaluate(() => window.State?.inputs?.irapRate);

    // Tab GME: metriche dispatch (bug #2)
    await page.evaluate(() => switchTab('tab-gme'));
    await page.waitForTimeout(1500);
    out.gmeImmDiretta = await page.evaluate(() => document.getElementById('gme-kpi-imm-diretta')?.textContent);
    out.gmeUpliftTs = await page.evaluate(() => document.getElementById('gme-kpi-uplift-ts')?.textContent);
    out.gmeMargineArb = await page.evaluate(() => document.getElementById('gme-kpi-margine-arb')?.textContent);
    out.gmeMedione = await page.evaluate(() => document.getElementById('gme-kpi-medione-fv')?.textContent);

    // Tab Sensibilità (bug #7: crash switchTab)
    await page.evaluate(() => switchTab('tab-sensitivity'));
    await page.waitForTimeout(800);
    out.sensTabVisible = await page.evaluate(() => document.getElementById('tab-sensitivity')?.classList.contains('active'));

    // Financials: tabelle popolate
    await page.evaluate(() => switchTab('tab-financials'));
    await page.waitForTimeout(800);
    out.pnlEbitdaY1 = await page.evaluate(() => document.getElementById('cell-pnl-ebitda-y1')?.textContent);
    out.debtEndY1 = await page.evaluate(() => document.getElementById('cell-debt-endingBalance-y1')?.textContent);
    out.pnlColCount = await page.evaluate(() => document.querySelectorAll('#pl-header-a th').length);

    // "Nessun Exit": slider a 0 -> le tabelle devono restare a 20 anni (bug #3)
    const exitOriginal = await page.evaluate(() => document.getElementById('input-exit-option').value);
    await page.evaluate(() => {
        const s = document.getElementById('input-exit-option');
        s.value = 0;
        s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(4000);
    out.pnlColCountNoExit = await page.evaluate(() => document.querySelectorAll('#pl-header-a th').length);
    // ripristino del valore ORIGINALE di exit (evita side-effect sul config in DB)
    await page.evaluate((v) => {
        const s = document.getElementById('input-exit-option');
        s.value = v;
        s.dispatchEvent(new Event('input', { bubbles: true }));
    }, exitOriginal);
    await page.waitForTimeout(4000);
    out.pnlColCountRestored = await page.evaluate(() => document.querySelectorAll('#pl-header-a th').length);

    await page.screenshot({ path: 'scratch/e2e_dashboard.png' });
    await page.evaluate(() => switchTab('tab-gme'));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'scratch/e2e_gme.png' });

    console.log(JSON.stringify(out, null, 2));
    console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'nessuno');
    await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
