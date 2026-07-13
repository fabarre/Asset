#!/usr/bin/env node
// asset-browser helper — naviga l'app ASSET con Playwright + Chromium for Testing (WSL, no sudo)
// Uso:
//   node browse.js screenshot --url http://localhost:3000/ --out /tmp/dash.png
//   node browse.js eval      --url http://localhost:3000/ --expr "document.title"
//   node browse.js exists    --url http://localhost:3000/ --sel "#select-report-type"
//   node browse.js click     --url http://localhost:3000/ --sel "button[...]" --out /tmp/after.png
//   node browse.js download  --url http://localhost:3000/ --sel "button[...]" --outdir /tmp/dl
//   node browse.js text      --url http://localhost:3000/ --sel "#kpi-irr"

'use strict';
process.env.LD_LIBRARY_PATH = '/home/fabarre/pw-libs/extracted/usr/lib/x86_64-linux-gnu:' + (process.env.LD_LIBRARY_PATH || '');

const { chromium } = require('/mnt/c/Users/Utente/ASSET/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const CHROMIUM = '/home/fabarre/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const DEFAULT_WAIT = 4000; // ms dopo domcontentloaded (Supabase init + primo calcolo)

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function launch() {
  if (!fs.existsSync(CHROMIUM)) {
    console.error('ERRORE: Chromium non trovato in', CHROMIUM);
    console.error('Ripristinalo con: npx playwright install chromium');
    process.exit(1);
  }
  return chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => console.error('PAGE-EXC:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE-ERR:', m.text()); });
  return page;
}

async function gotoAndWait(page, url) {
  await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(DEFAULT_WAIT);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const action = args._[0];
  const url = args.url || 'http://localhost:3000/';
  const browser = await launch();

  try {
    const page = await newPage(browser);

    if (action === 'screenshot') {
      await gotoAndWait(page, url);
      const out = args.out || '/tmp/screenshot.png';
      await page.screenshot({ path: out, fullPage: args.full === true });
      const stat = fs.statSync(out);
      console.log('OK screenshot:', out, stat.size, 'bytes');
    }
    else if (action === 'eval') {
      await gotoAndWait(page, url);
      const result = await page.evaluate(args.expr);
      console.log('RESULT:', typeof result === 'object' ? JSON.stringify(result) : result);
    }
    else if (action === 'exists') {
      await gotoAndWait(page, url);
      const el = await page.$(args.sel);
      console.log('EXISTS:', args.sel, !!el);
    }
    else if (action === 'text') {
      await gotoAndWait(page, url);
      const txt = await page.$eval(args.sel, el => el?.textContent || null).catch(() => null);
      console.log('TEXT:', txt);
    }
    else if (action === 'click') {
      await gotoAndWait(page, url);
      const el = await page.$(args.sel);
      if (!el) { console.error('NOT FOUND:', args.sel); process.exit(2); }
      await el.click();
      await page.waitForTimeout(1500);
      if (args.out) {
        await page.screenshot({ path: args.out, fullPage: false });
        console.log('OK click + screenshot:', args.out);
      } else {
        console.log('OK click:', args.sel);
      }
    }
    else if (action === 'download') {
      await gotoAndWait(page, url);
      const outdir = args.outdir || '/tmp/dl';
      fs.mkdirSync(outdir, { recursive: true });
      // pulisci outdir
      fs.readdirSync(outdir).forEach(f => fs.unlinkSync(path.join(outdir, f)));
      const client = await page.context().newCDPSession(page);
      await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outdir });
      const el = await page.$(args.sel);
      if (!el) { console.error('NOT FOUND:', args.sel); process.exit(2); }
      await el.click();
      // attendi download (poll filesystem)
      let files = [];
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        files = fs.readdirSync(outdir).filter(f => !f.endsWith('.crdownload'));
        if (files.length) break;
      }
      if (!files.length) { console.error('NO DOWNLOAD received'); process.exit(3); }
      const f = files[0];
      const stat = fs.statSync(path.join(outdir, f));
      const head = fs.readFileSync(path.join(outdir, f)).slice(0, 5).toString();
      console.log('OK download:', f, stat.size, 'bytes, header:', head);
    }
    else {
      console.error('Azione non riconosciuta:', action);
      console.error('Azioni: screenshot | eval | exists | text | click | download');
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
