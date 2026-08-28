# TODO — backlog operativo

Aggiornato: 2026-08-28 (post Fasi A-E del piano di sviluppo 2026-08).

## Aperti
- [ ] **Rotazione PAT Supabase**: il personal access token usato nelle sessioni di agosto è transitato in chat → revocare e rigenerare da https://supabase.com/dashboard/account/tokens, poi aggiornare `scratch/.sbp_token`.
- [ ] **Credenziali e2e autenticate**: creare `scratch/.e2e_auth.json` (utente di test) per automatizzare flussi login-dipendenti (PDF brandizzati, export Excel, ruoli).
- [ ] **Encoding `.agents/AGENTS.md`**: mojibake UTF-8 (round-trip latin1→utf8 pronto: `Buffer.from(raw,'latin1').toString('utf8')`) — richiede autorizzazione esplicita (file di configurazione agenti).
- [ ] **Consolidamento `Antigravity Agents Config.md`** (root, v2.2 storico) vs `.agents/AGENTS.md` canonico.
- [ ] **i18n canvas/PDF**: dizionario EN per label grafici Chart.js e testi report PDF.
- [ ] **Parità LP↔DP**: test browser con `bessOptimizer: 'lp'` (HiGHS) vs DP su casi noti.
- [ ] **Ambiente dev Supabase**: il progetto `ozexeaqnvlkflzweikph` non esiste più (DNS) — valutare ricreazione come staging per migrazioni.
- [ ] **TIDE 2026 quart'oraria**: estensione motore a 96 periodi/giorno per settlement CER (feature multi-step).
- [ ] **pm2 startup systemd**: verificare abilitazione boot-time sul VPS dopo il reboot di agosto (il dump esiste; `pm2 startup` da confermare).

## Chiusi (2026-08)
- [x] Hardening dipendenze CDN/SRI + SheetJS 0.20.3 (A1)
- [x] RLS/GRANT verificati e hardening anon (A2)
- [x] Gate accesso anonimo per ambiente (A3)
- [x] Template config + fix clone tool (A4)
- [x] Audit XSS + escaping uniforme (A5)
- [x] Suite motore 51→90 assertion; BRP lifetime-avg nel dispatch; MC seedato; drift guard (B1-B2)
- [x] Notifiche corporate (C1) · layout polish (C2) · grafici it-IT (C3) · branding report (C4)
- [x] Cash flow mensile 60 mesi motore+UI+export (D1-D2)
- [x] Ruoli viewer/admin + zonal_pun admin-only (D3)
- [x] Dashboard qualità dati + CSV (D4)
- [x] Backup schedulato + verify drill (D5)
- [x] Export audit CSV/PDF (D6)
- [x] README aggiornato + docs/PROJECT_SPEC.md (E1)
