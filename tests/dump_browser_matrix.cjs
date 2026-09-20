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

(async () => {
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  // Wait for simulation to finish
  await page.waitForFunction(() => window.State && window.State.results && window.State.results.matrix && window.State.results.matrix.ebitda && window.State.results.matrix.ebitda.length > 0, { timeout: 15000 });

  const matrix = await page.evaluate(() => {
    const m = window.State.results.matrix;
    return {
      revenueTotal: m.revenueTotal,
      revenueRid: m.revenueRid,
      qtySolarRid: m.qtySolarRid,
      priceSolarRid: m.priceSolarRid,
      opexTotal: m.opexTotal,
      opexPlants: m.opexPlants,
      opexInsurance: m.opexInsurance,
      opexTaxes: m.opexTaxes,
      opexSecurity: m.opexSecurity,
      ebitda: m.ebitda,
      depreciationCivil: m.depreciationCivil,
      ebit: m.ebit,
      interest: m.interest,
      principal: m.principal,
      debtOutstanding: m.debtOutstanding,
      sociInterestAccrued: m.sociInterestAccrued,
      ebt: m.ebt,
      taxTaxableIres: m.taxTaxableIres,
      taxTaxableFinal: m.taxTaxableFinal,
      taxableIrap: m.taxableIrap,
      currentTaxesSpv: m.currentTaxesSpv,
      iresTaxSpv: m.iresTaxSpv,
      irapTaxSpv: m.irapTaxSpv,
      deferredTaxes: m.deferredTaxes,
      netProfitSpv: m.netProfitSpv
    };
  });

  console.log('--- EXTRACTED BROWSER MATRIX ---');
  fs.writeFileSync(path.join(__dirname, 'browser_matrix.json'), JSON.stringify(matrix, null, 2));
  console.log('Saved to tests/browser_matrix.json');
  await browser.close();
})();
