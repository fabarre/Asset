// ─────────────────────────────────────────────────────────────────────────────
// XSS validation harness (FASE A5)
//
// Inietta payload malevoli (nome con tag HTML, id con breakout di stringa JS)
// negli oggetti renderizzati dalle liste (impianti, stabilimenti, scenari) e
// verifica che:
//   1. escapeHtml neutralizzi i tag (unit, in-page)
//   2. nessun elemento vivo (es. <img>) venga creato nei contenitori
//   3. window.__xssFired non venga eseguito (onerror)
//   4. gli handler inline escapino gli id con sequenze \xNN (escapeJs) e il
//      click non esegua codice iniettato
//
// Uso: npm run test:xss   (oppure E2E_BASE_URL per un host diverso)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000/';

function resolveBrowserPath() {
    if (process.env.E2E_BROWSER_PATH) return process.env.E2E_BROWSER_PATH;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = [];
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
    throw new Error('Nessun browser trovato. Imposta E2E_BROWSER_PATH.');
}

(async () => {
    const browser = await chromium.launch({
        executablePath: resolveBrowserPath(),
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', e => errors.push('PAGE-EXC: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('PAGE-ERR: ' + m.text()); });

    await page.goto(BASE_URL, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000); // init app + stato globale State

    const report = await page.evaluate(() => {
        const out = { checks: [] };
        const check = (name, cond, detail = '') => {
            out.checks.push({ name, pass: !!cond, detail });
        };
        const EVIL_NAME = '<img src=x onerror="window.__xssFired=true"> & "\'<> payload';
        const EVIL_ID = "x');window.__xssId=true;//";

        // ── 1. Unit: escapeHtml ──
        const esc = window.escapeHtml(EVIL_NAME);
        check('escapeHtml: nessun < o > residui', typeof esc === 'string' && !esc.includes('<') && !esc.includes('>'), esc);
        check('escapeHtml: apici escapati', String(esc).includes('&#039;') && String(esc).includes('&quot;'));

        // ── 2. Lista impianti ──
        const origPlants = window.State.plants;
        window.State.plants = [{
            id: EVIL_ID, name: EVIL_NAME, zone: 'NORD', capacity: 1000, capex: 700,
            opex: 100000, generation: new Float64Array(8760), bessMwh: 0, bessMw: 0,
            bessType: 'none', bessConnection: 'none', enabled: true
        }];
        try {
            renderPlantsList();
            const body = document.getElementById('plants-table-body');
            const html = body ? body.innerHTML : '';
            check('impianti: nessun elemento <img> vivo', document.querySelectorAll('#plants-table-body img').length === 0);
            check('impianti: nome escapato nel markup', html.includes('&lt;img'), html.slice(0, 120));
            check('impianti: onerror NON eseguito', window.__xssFired === undefined);
            const tr = body && body.querySelector('tr');
            const onclick = tr ? tr.getAttribute('onclick') : '';
            check('impianti: id escapato in onclick (\\x27)', onclick.includes('\\x27'), onclick.slice(0, 80));
            if (tr) tr.click(); // esegue l'handler: non deve eseguire il payload
            check('impianti: click non esegue codice iniettato', window.__xssId === undefined);
        } catch (e) {
            check('impianti: render senza eccezioni', false, e.message);
        }
        window.State.plants = origPlants;

        // ── 3. Lista stabilimenti ──
        const origStab = window.State.stabilimenti;
        window.State.plants = [{
            id: EVIL_ID, name: EVIL_NAME, zone: 'NORD', capacity: 1000, capex: 700,
            opex: 100000, generation: new Float64Array(8760), enabled: true
        }];
        window.State.stabilimenti = [{
            id: EVIL_ID, name: EVIL_NAME, plantId: EVIL_ID, ppaType: 'on-site',
            ppaPrice: 100, ppaDuration: 10, enabled: true, annualConsumptionMwh: 1000,
            load: new Float64Array(8760)
        }];
        try {
            renderStabilimentiList();
            const cont = document.getElementById('stabilimenti-list-container');
            const html = cont ? cont.innerHTML : '';
            check('stabilimenti: nessun elemento <img> vivo', document.querySelectorAll('#stabilimenti-list-container img').length === 0);
            check('stabilimenti: nome escapato nel markup', html.includes('&lt;img'), html.slice(0, 120));
            const div = cont && cont.querySelector('div');
            const onclick = div ? div.getAttribute('onclick') : '';
            check('stabilimenti: id escapato in onclick (\\x27)', !onclick || onclick.includes('\\x27'), onclick.slice(0, 80));
        } catch (e) {
            check('stabilimenti: render senza eccezioni', false, e.message);
        }
        window.State.stabilimenti = origStab;
        window.State.plants = origPlants;

        // ── 4. Lista scenari ──
        const origScen = window.State.scenarios;
        const origSel = window.State.selectedCompareIds;
        window.State.scenarios = [{ id: EVIL_ID, name: EVIL_NAME, inputs: {} }];
        window.State.selectedCompareIds = new Set();
        try {
            renderScenarioList();
            const listEl = document.getElementById('scenario-list');
            const html = listEl ? listEl.innerHTML : '';
            check('scenari: nessun elemento <img> vivo', document.querySelectorAll('#scenario-list img').length === 0);
            check('scenari: nome escapato nel markup', html.includes('&lt;img'), html.slice(0, 120));
        } catch (e) {
            check('scenari: render senza eccezioni', false, e.message);
        }
        window.State.scenarios = origScen;
        window.State.selectedCompareIds = origSel;

        check('globale: nessun codice iniettato eseguito', window.__xssFired === undefined && window.__xssId === undefined);
        return out;
    });

    let failed = 0;
    for (const c of report.checks) {
        console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : ' — ' + c.detail}`);
        if (!c.pass) failed++;
    }
    console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 5) : 'nessuno');
    console.log(`Risultato: ${report.checks.length - failed} passati, ${failed} falliti`);
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
