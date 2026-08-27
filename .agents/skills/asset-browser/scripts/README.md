# asset-browser / scripts

Script di automazione browser per l'app ASSET (http://localhost:3000/).

## File

- **`browse.js`** — helper CLI con azioni predefinite (screenshot, eval, exists, text, click, download). Vedi `../SKILL.md` per l'uso.
- **`template.js`** — template per script custom con logica complessa.

## Dipendenze

Tutte risolte a runtime dagli script, nessun `npm install` nella cartella scripts:

- `playwright-core` → `<repo>/node_modules/playwright-core` (project-local, in `package.json` devDeps; il repo root è risolto automaticamente dagli script)
- Chromium for Testing → auto-detect della cartella `chromium-*` più recente in `~/.cache/ms-playwright` (su questo VPS: `chromium-1234`); override con variabile env `ASSET_BROWSER_PATH`
- Librerie system → librerie di sistema del VPS (verificate con `ldd`); la directory user-space `~/pw-libs/extracted/...` viene aggiunta a `LD_LIBRARY_PATH` solo se presente (retaggio setup WSL senza sudo)

## Avvio app (prerequisito)

Sul VPS di produzione l'app è già servita h24 da PM2 (`asset-app`, porta 3000). Verifica:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # deve rispondere 200
```

Solo se PM2 non è attivo, avvio manuale:

```bash
cd /home/ubuntu/Asset
(python3 -m http.server 3000 --bind 127.0.0.1 >/tmp/httpserver.log 2>&1 &)
sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
