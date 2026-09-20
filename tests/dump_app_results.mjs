import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTRA_LIBS = path.join(os.homedir(), 'pw-libs', 'extracted', 'usr', 'lib', 'x86_64-linux-gnu');
if (fs.existsSync(EXTRA_LIBS)) {
  process.env.LD_LIBRARY_PATH = EXTRA_LIBS + ':' + (process.env.LD_LIBRARY_PATH || '');
}

const { chromium } = await import(path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'index.mjs'));

function resolveChromium() {
  const pwCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pwCache)) {
    const dirs = fs.readdirSync(pwCache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const bin = path.join(pwCache, d, sub, 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

(async () => {
  console.log('Avvio browser per estrazione risultati app...');
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERR:', msg.text());
  });

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Bypass auth
  await page.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    if (ov && ov.style.display !== 'none') {
      if (typeof window.continueAnonymous === 'function') window.continueAnonymous();
      else { const btn = document.getElementById('btn-continue-anonymous'); if (btn) btn.click(); }
    }
  });
  await page.waitForTimeout(4000);

  // Trigger recalculate
  console.log('Innesco triggerRecalculate...');
  await page.evaluate(() => {
    if (typeof window.triggerRecalculate === 'function') window.triggerRecalculate();
  });

  // Wait for State.results
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => !!(window.State && window.State.results && window.State.results.matrix));
    if (ready) {
      console.log('State.results pronto!');
      break;
    }
    await page.waitForTimeout(500);
  }

  const dump = await page.evaluate(() => {
    if (!window.State || !window.State.results) return null;
    const res = window.State.results;
    const p = window.State.inputs;
    return {
      projectName: window._currentProjectName,
      inputs: p,
      plants: window.State.plants,
      stabilimenti: window.State.stabilimenti,
      results: {
        irr: res.irr,
        equityIrr: res.equityIrr,
        npv: res.npv,
        payback: res.payback,
        lcoe: res.lcoe,
        exitEnterpriseValue: res.exitEnterpriseValue,
        exitEquityValue: res.exitEquityValue,
        exitYear: res.exitYear,
        matrix: res.matrix,
        debtSchedule: res.debtSchedule
      }
    };
  });

  if (dump) {
    fs.writeFileSync(path.join(REPO_ROOT, 'scratch', 'web_app_state_dump.json'), JSON.stringify(dump, null, 2));
    console.log('Dump salvato in scratch/web_app_state_dump.json con successo!');
  } else {
    console.error('ERRORE: State.results non trovato!');
  }

  await browser.close();
})();
