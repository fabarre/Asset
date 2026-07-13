---
name: asset-browser
description: Browser automation per l'app AntiGravity Hybrid FV + BESS Simulator su http://localhost:3000. Usa Playwright + Chromium for Testing con librerie system user-space. Use when l'utente chiede di navigare l'app, verificare UI/DOM, fare screenshot, testare bottoni/flussi, intercettare download PDF, o validare modifiche frontend end-to-end.
---

# SKILL: Asset Browser — Automazione Browser per l'App ASSET

Skill custom per navigare l'SPA del progetto AntiGravity Hybrid FV + BESS Simulator da `http://localhost:3000/` in ambiente WSL, senza Google Chrome di sistema e senza `sudo`.

## Quando usare questa skill

- Verificare che una modifica UI funzioni davvero nell'app (es. nuova sezione, nuovo toggle)
- Fare screenshot di una scheda/tab per ispezionare visivamente
- Leggere valori dal DOM (KPI, celle tabelle P&L, valori select)
- Testare un flusso: click bottone → verifica risultato (es. "Genera PDF" → file scaricato)
- Intercettare i download (PDF report, export Excel)
- Verificare errori console/pageerror dopo una modifica

## Prerequisiti (già installati e persistenti)

| Componente | Path | Note |
|---|---|---|
| Chromium for Testing v149 | `/home/fabarre/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` | Scaricato via `playwright install` |
| Librerie system (nss/nspr/alsa) | `/home/fabarre/pw-libs/extracted/usr/lib/x86_64-linux-gnu/` | 12 .so estratte user-space da .deb (no sudo) |
| `playwright-core` | `./node_modules/playwright-core` (project-local) | v1.61.0, installato in `ASSET/package.json` devDeps |

Se un path non esiste più (es. chromium cancellato), vedi la sezione "Ripristino dipendenze" in fondo.

## Avviare l'app (prerequisito runtime)

L'app è una SPA statica: serve un web server su `http://localhost:3000/`. Avviarlo in background prima di navigare:

```bash
cd /mnt/c/Users/Utente/ASSET
(python3 -m http.server 3000 --bind 127.0.0.1 >/tmp/httpserver.log 2>&1 &)
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # deve rispondere 200
```

Per fermarlo: `pkill -f "http.server 3000"`

## Uso rapido — script helper `scripts/browse.js`

Helper preconfigurato che lancia il browser, naviga, e espone azioni comuni via argomenti.

```bash
# Screenshot della dashboard
node .agents/skills/asset-browser/scripts/browse.js screenshot --url http://localhost:3000/ --out /tmp/dash.png

# Leggere il titolo + un valore dal DOM
node .agents/skills/asset-browser/scripts/browse.js eval --url http://localhost:3000/ --expr "document.title"
node .agents/skills/asset-browser/scripts/browse.js eval --url http://localhost:3000/ --expr "document.getElementById('kpi-irr')?.textContent"

# Verificare la presenza di un elemento
node .agents/skills/asset-browser/scripts/browse.js exists --url http://localhost:3000/ --sel "#select-report-type"

# Click + screenshot (testa un flusso)
node .agents/skills/asset-browser/scripts/browse.js click --url http://localhost:3000/ --sel "button[onclick^='generateReport']" --out /tmp/after-click.png

# Intercettare un download (es. dopo click Genera PDF)
node .agents/skills/asset-browser/scripts/browse.js download --url http://localhost:3000/ --sel "button[onclick^='generateReport']" --outdir /tmp/dl
```

L'helper gestisce automaticamente: `LD_LIBRARY_PATH`, `executablePath`, `--no-sandbox`, wait `domcontentloaded` + timeout caricamento Supabase, pageerror/console capture.

## Uso avanzato — script custom

Per interazioni complesse (es. compilare form, sequenza di click, estrarre tabelle), scrivere uno script Node dedicato che richiede `playwright-core` locale:

```js
// template: .agents/skills/asset-browser/scripts/template.js
process.env.LD_LIBRARY_PATH = '/home/fabarre/pw-libs/extracted/usr/lib/x86_64-linux-gnu:' + (process.env.LD_LIBRARY_PATH || '');
const { chromium } = require('/mnt/c/Users/Utente/ASSET/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/fabarre/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => console.log('PAGE-EXC:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR:', m.text()); });
  await page.goto('http://localhost:3000/', { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000); // Supabase init + primo calcolo

  // ... qui la logica specifica ...

  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

API Playwright utili (vedi anche `references/`): `page.$()`, `page.$$()`, `page.$eval()`, `page.$$eval()`, `page.click()`, `page.fill()`, `page.selectOption()`, `page.evaluate()`, `page.screenshot()`, `page.waitForSelector()`, `page.waitForTimeout()`.

> **Nota API**: questa versione di Playwright usa `page.selectOption(sel, val)` (NON `page.select`). Stesso per altri metodi — se un metodo non esiste, controlla la versione in `node_modules/playwright-core/package.json`.

## Intercettare i download (CDP)

Per catturare file scaricati (PDF report, Excel export) senza che finiscano in una cartella utente arbitraria:

```js
const fs = require('fs');
fs.mkdirSync('/tmp/dl', { recursive: true });
const client = await page.context().newCDPSession(page);
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/dl' });
// ...azione che innesca il download...
await page.waitForTimeout(3000);
console.log('Downloaded:', fs.readdirSync('/tmp/dl'));
```

## Selettori utili dell'app ASSET

| Elemento | Selettore |
|---|---|
| Select tipologia report | `#select-report-type` |
| Descrizione report dinamica | `#report-desc-text` |
| Bottone Genera PDF | `button[onclick^="generateReport"]` |
| Toggle Private Debt | `#input-pd-enabled` |
| Toggle Private Equity | `#input-pe-enabled` |
| Toggle Altra Forma | `#input-af-enabled` |
| KPI IRR | `#kpi-irr` |
| KPI NPV | `#kpi-npv` |
| KPI DSCR | `#kpi-dscr` |
| Cella P&L anno N | `#cell-pnl-<key>-y<N>` |
| Cella debt schedule anno N | `#cell-debt-<key>-y<N>` |
| Tab navigation | `switchTab('tab-<name>')` (es. `tab-dashboard`, `tab-deal-config`, `tab-financials`) |

## Risoluzione problemi comuni

- **"Chromium distribution 'chrome' is not found"**: si verifica solo se si usa `playwright-cli` directly. Usare invece `playwright-core` con `executablePath` come negli script di questa skill.
- **Exit code 127 / "shared libraries not found"**: le `LD_LIBRARY_PATH` non è impostata. Verificare `~/pw-libs/extracted/usr/lib/x86_64-linux-gnu/*.so` esistano (12 file).
- **Pagina bianca / Supabase non carica**: l'app richiede origine http(s), non `file://`. Avviare sempre via `http.server` come sopra.
- **`page.select is not a function`**: usare `page.selectOption()`.
- **Timeout su goto**: aumentare `waitForTimeout` dopo `domcontentloaded` (Supabase fetch asincrono).

## Ripristino dipendenze (se un path manca)

```bash
# Chromium for Testing
npx playwright install chromium
# o specifico: npx playwright install chrome-for-testing

# Librerie system user-space (no sudo)
mkdir -p ~/pw-libs && cd ~/pw-libs
apt-get download libnss3 libnspr4 libasound2t64
mkdir -p extracted && for d in *.deb; do dpkg-deb -x "$d" extracted/; done

# playwright-core (già in package.json)
cd /mnt/c/Users/Utente/ASSET && npm install
```

## Note

- Il browser è **headless** (nessuna finestra visibile). Per debug visuale aggiungere `headless: false` (richiede X server / WSLg).
- Ogni sessione è **stateless**: nessun cookie/profilo persistente tra esecuzioni. Per persistenza usare `storageState` (vedi `references/storage-state.md` se presente).
- L'app carica CDN (Tailwind, Chart.js, jsPDF, Supabase SDK) — serve accesso internet al primo caricamento.
