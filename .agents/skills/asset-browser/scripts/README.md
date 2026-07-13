# asset-browser / scripts

Script di automazione browser per l'app ASSET (http://localhost:3000/).

## File

- **`browse.js`** — helper CLI con azioni predefinite (screenshot, eval, exists, text, click, download). Vedi `../SKILL.md` per l'uso.
- **`template.js`** — template per script custom con logica complessa.

## Dipendenze

Tutte risolte a runtime, nessun `npm install` nella cartella scripts:

- `playwright-core` → `../../../node_modules/playwright-core` (project-local, in `package.json` devDeps)
- Chromium for Testing → `/home/fabarre/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`
- Librerie system → `/home/fabarre/pw-libs/extracted/usr/lib/x86_64-linux-gnu/`

Gli script impostano automaticamente `LD_LIBRARY_PATH` e `executablePath`.

## Avvio app (prerequisito)

```bash
cd /mnt/c/Users/Utente/ASSET
(python3 -m http.server 3000 --bind 127.0.0.1 >/tmp/httpserver.log 2>&1 &)
sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
