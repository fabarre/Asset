# PROJECT SPEC — AntiGravity Hybrid FV + BESS Simulator (Enterprise Edition)

Stato: 2026-08-30 · Snapshot di riferimento: commit `ce44596` e successivi.
Documento operativo sintetico: per i dettagli storico-funzionali vedere `README.md`.

## 1. Architettura
- **SPA frameless** HTML5 + Vanilla JS (ES6), tema dark premium (Tailwind vendored `vendor/tailwind-3.4.17.js` + CDN pinnati con SRI: Chart.js 4.4.1, ExcelJS 4.3.0, FileSaver 2.0.5, jsPDF 2.5.1 + autotable 3.8.2, SheetJS 0.20.3, supabase-js 2.112.4, HiGHS 1.15.2 lazy).
- **Web Worker** `src/worker/simulation.worker.js`: dispatch BESS (DP euristica + LP HiGHS WASM), modello finanziario 20 anni (IRES/IRAP, Art.96/84 TUIR, deferred taxes), debito senior/soci/PD/PE/AF, DSRA, sculpting, cash sweep, refi, exit, CER, BRP fee dinamiche, Monte Carlo seedato, cash flow mensile **72 mesi** (Anno 0 + Anni 1-5, àncora = COD più antico), IVA di cassa.
- **Moduli browser**: `main.js` (controller/UI/render), `notify.js` (toast/modali), `audit.js` (audit+undo), `i18n.js` (IT/EN DOM), `excelExport.js` (cartella Excel multi-foglio), `db.js` (IndexedDB, legacy).
- **PWA**: `manifest.json` + `sw.js` (shell offline; API Supabase/PVGIS mai cachate).

## 2. Modello dati (Supabase, project prod `bfszzyeysqijxrqxsofk`)
Tabelle: `plants` (+ colonna `cod_date`), `plant_generation`, `stabilimenti`, `stabilimento_load`, `simulation_config` (config/scenari/audit/branding/CAPEX-OPEX budget, PK `(parameter_key,user_id)`, varchar(255) → chunking 200 char), `hourly_telemetry` (PK `(hour_index,user_id)`), `zonal_pun` (globale), `plant_custom_costs` (voci CAPEX/OPEX personalizzate per impianto, FK composita `(plant_id,user_id)`).
Migrazioni applicate su PROD (in ordine): `master_init_schema.sql`, `migration_auth_rls.sql`, `migration_per_user.sql`, `migration_admin_users.sql`, `migration_anon_least_privilege.sql`, `migration_roles_viewer.sql`, `migration_plant_custom_costs.sql`, `migration_cf7_viewer_gate.sql`; alter storici: BRP, CER, markets, earnout, OPEX detail, decay, economic params, BESS detail, COD date.

## 3. Sicurezza & ruoli
- RLS restrittiva: tabelle utente per-owner con gate viewer (`get_my_role() <> 'viewer'` su 7/7 tabelle owner, inclusa `plant_custom_costs`); `zonal_pun` SELECT authenticated, write **admin-only**; `anon` senza alcun GRANT DML/TRUNCATE.
- Ruoli via claim JWT `app_metadata.role`: `admin` / `editor` (default) / `viewer` (sola lettura, negato anche lato UI con `canWrite()` su 10 operazioni); gestione con `admin_set_role()` (SECURITY DEFINER, whitelist).
- Accesso anonimo: solo host locali o `ALLOW_ANONYMOUS: true` nel config di ambiente (`supabase_config.js`, gitignored; template `supabase_config.example.*`).
- XSS: escaping uniforme (`escapeHtml`/`escapeJs`), suite `tests/xss_validate.js`; nessun `alert/confirm/prompt` nativo.

## 4. Qualità & verifiche
- `npm test` → `tests/test_worker.mjs` (**136 assertion**: quadrature, fisco, BRP per anno, CER, decay, Monte Carlo seedato, cash flow mensile 72 mesi, IVA di cassa, edge case).
- `npm run test:e2e` → Playwright-core + Chromium for Testing (`~/.cache/ms-playwright`), login opzionale via `scratch/.e2e_auth.json`.
- `npm run test:xss` → 13 check con payload reali.
- Drift guard main↔worker su `generateDefaultSolarProfile`/`getMonthOfHour`/`resolveGridLosses` (Test 21).
- Dashboard "Qualità Dati & Copertura" (tab dedicato, score OK/avvisi/errori) + export CSV.

## 5. Operatività
- Deploy: VPS OVH `164.132.103.235:3000`, PM2 `asset-app` (`pm2 serve`, `pm2 save`, `pm2 startup systemd` abilitato).
- Backup: cron `0 3 * * *` → `tools/backup.mjs run prod --keep 14`; `verify` (sha256+count+live delta), `restore` (chunked, `--dry-run`, `--only`); dump in `scratch/backups/` (gitignored).
- Tooling: `tools/sb.mjs` (Management API, token in `scratch/.sbp_token`), `clone_supabase.js` (clone tra progetti, auth opzionale), `tools/backup.mjs`.

## 6. Feature corporate (2026-08)
Notifiche corporate (toast/modali) · branding report (ragione sociale/tagline/logo, copertina PDF, COPERTINA Excel, watermark) · cash flow mensile 72 mesi (UI/Excel/PDF, vista SPV/Holding, funding dates, XIRR datato) · voci CAPEX/OPEX personalizzate per impianto · modello budget CAPEX/OPEX con contatori residuo e categorie · IVA solo cash flow (pass-through, non tocca P&L/IRR) · ruoli viewer/editor/admin · export audit CSV/PDF · dashboard qualità dati · formattazione it-IT uniforme (assi/tooltip/KPI) · tab bar responsive.

## 7. Limiti noti
- Label canvas e testi PDF restano IT (i18n solo DOM).
- Parità LP↔DP non testata in Node (HiGHS richiede `importScripts`): da verificare via browser.
- Risoluzione quart'oraria (96 periodi TIDE 2026) non implementata.
- Registro audit limitato a 200 voci con pruning (per compliance servirebbe retention più lunga).
