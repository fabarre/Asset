// ─────────────────────────────────────────────────────────────────────────────
// E2E validation harness — cross-platform (Linux VPS / Windows)
//
// Carica l'app, verifica errori JS, KPI, tab GME, tab Sensibilità, input
// IRES/IRAP, comportamento "Nessun Exit", e salva screenshot di baseline.
//
// Browser:  E2E_BASE_URL    (default http://localhost:3000/)
//           E2E_BROWSER_PATH (path eseguibile; se assente: auto-detect)
//             - Linux  : Chromium for Testing in ~/.cache/ms-playwright
//             - Windows: Microsoft Edge (percorsi standard)
// Login:    scratch/.e2e_auth.json  { "email": "...", "password": "..." }
//           (gitignored). Se assente, la sessione prosegue anonima e il
//           report indica lo stato della auth overlay.
// Strict:   E2E_STRICT=1 → exit code 1 in presenza di errori console/pageerror
//
// Uso: npm run test:e2e
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000/';
const AUTH_FILE = path.join(ROOT, 'scratch', '.e2e_auth.json');
const OUT_DIR = path.join(ROOT, 'test-results');

function resolveBrowserPath() {
    if (process.env.E2E_BROWSER_PATH) return process.env.E2E_BROWSER_PATH;
    const candidates = [];
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (process.platform === 'win32') {
        candidates.push(
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
        );
    } else {
        const pwCache = path.join(home, '.cache', 'ms-playwright');
        if (fs.existsSync(pwCache)) {
            const dirs = fs.readdirSync(pwCache)
                .filter((d) => /^chromium-\d+$/.test(d))
                .sort()
                .reverse();
            for (const d of dirs) {
                candidates.push(path.join(pwCache, d, 'chrome-linux64', 'chrome'));
                candidates.push(path.join(pwCache, d, 'chrome-linux', 'chrome'));
            }
        }
    }
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error('Nessun browser trovato. Imposta E2E_BROWSER_PATH. Candidati verificati:\n' + candidates.join('\n'));
}

function loadCredentials() {
    try {
        if (fs.existsSync(AUTH_FILE)) {
            const c = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
            if (c && c.email && c.password) return c;
        }
    } catch (e) {
        console.error('WARN: scratch/.e2e_auth.json non valido:', e.message);
    }
    return null;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const executablePath = resolveBrowserPath();
    console.log('Browser:', executablePath);
    console.log('Base URL:', BASE_URL);
    const creds = loadCredentials();
    console.log('Credenziali e2e:', creds ? creds.email : 'assenti (sessione anonima)');

    const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', e => errors.push('PAGE-EXC: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('PAGE-ERR: ' + m.text()); });

    await page.goto(BASE_URL, { timeout: 30000, waitUntil: 'domcontentloaded' });

    // ── Eventuale login (se credenziali disponibili e overlay visibile) ──
    await page.waitForTimeout(4000); // init Supabase + valutazione sessione
    const overlayVisible = await page.evaluate(() => {
        const ov = document.getElementById('auth-overlay');
        return !!ov && ov.style.display !== 'none';
    });
    if (overlayVisible && creds) {
        await page.fill('#auth-email', creds.email);
        await page.fill('#auth-password', creds.password);
        await page.evaluate(() => window.loginUser());
        // Attendi chiusura overlay (boot + loadData + primo calcolo)
        await page.waitForFunction(
            () => { const ov = document.getElementById('auth-overlay'); return !ov || ov.style.display === 'none'; },
            { timeout: 60000 }
        );
        await page.waitForTimeout(15000); // primo calcolo worker
    } else {
        await page.waitForTimeout(12000); // Supabase init + primo calcolo (path anonimo)
    }

    const out = {};
    out.title = await page.evaluate(() => document.title);
    out.syncStatus = await page.evaluate(() => document.getElementById('sync-status')?.textContent);
    out.authOverlayVisible = await page.evaluate(() => {
        const ov = document.getElementById('auth-overlay');
        return !!ov && ov.style.display !== 'none';
    });
    // Gate anonimi: visibile solo su host locali o con ALLOW_ANONYMOUS (FASE A3)
    out.anonButtonVisible = await page.evaluate(() => {
        const w = document.getElementById('auth-anonymous-wrap');
        return !!w && w.style.display !== 'none';
    });
    // FASE C1: sistema di notifiche corporate (toast + modali)
    out.notifyAvailable = await page.evaluate(() =>
        typeof window.showToast === 'function' && typeof window.showConfirm === 'function' && typeof window.showPrompt === 'function');
    out.notifyToastRendered = await page.evaluate(async () => {
        window.showToast('E2E toast test', 'success', { duration: 600 });
        await new Promise(r => setTimeout(r, 150));
        return document.querySelectorAll('#toast-container .toast-card').length > 0;
    });
    out.notifyConfirmCancel = await page.evaluate(async () => {
        const p = window.showConfirm({ title: 'E2E', message: 'test' });
        await new Promise(r => setTimeout(r, 150));
        const btn = document.querySelector('[data-role="cancel"]');
        if (!btn) return false;
        btn.click();
        return (await p) === false;
    });
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

    // Tab GME: metriche dispatch
    await page.evaluate(() => switchTab('tab-gme'));
    await page.waitForTimeout(1500);
    out.gmeImmDiretta = await page.evaluate(() => document.getElementById('gme-kpi-imm-diretta')?.textContent);
    out.gmeUpliftTs = await page.evaluate(() => document.getElementById('gme-kpi-uplift-ts')?.textContent);
    out.gmeMargineArb = await page.evaluate(() => document.getElementById('gme-kpi-margine-arb')?.textContent);
    out.gmeMedione = await page.evaluate(() => document.getElementById('gme-kpi-medione-fv')?.textContent);

    // Tab Sensibilità
    await page.evaluate(() => switchTab('tab-sensitivity'));
    await page.waitForTimeout(800);
    out.sensTabVisible = await page.evaluate(() => document.getElementById('tab-sensitivity')?.classList.contains('active'));

    // Financials: tabelle popolate
    await page.evaluate(() => switchTab('tab-financials'));
    await page.waitForTimeout(800);
    out.pnlEbitdaY1 = await page.evaluate(() => document.getElementById('cell-pnl-ebitda-y1')?.textContent);
    out.debtEndY1 = await page.evaluate(() => document.getElementById('cell-debt-endingBalance-y1')?.textContent);
    out.pnlColCount = await page.evaluate(() => document.querySelectorAll('#pl-header-a th').length);

    // "Nessun Exit": slider a 0 -> le tabelle devono restare a 20 anni
    const exitOriginal = await page.evaluate(() => {
        const s = document.getElementById('input-exit-option');
        return s ? s.value : null;
    });
    if (exitOriginal !== null) {
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
    } else {
        out.pnlColCountNoExit = null;
        out.pnlColCountRestored = null;
    }

    await page.screenshot({ path: path.join(OUT_DIR, 'e2e_dashboard.png') });
    await page.evaluate(() => switchTab('tab-gme'));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT_DIR, 'e2e_gme.png') });

    console.log(JSON.stringify(out, null, 2));
    console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'nessuno');
    await browser.close();

    if (process.env.E2E_STRICT === '1' && errors.length > 0) {
        process.exit(1);
    }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
