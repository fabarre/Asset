# TODO — backlog operativo

Aggiornato: 2026-08-30 (post Fasi A-E + CF7-CF10 del piano di sviluppo 2026-08).

## Aperti
- [ ] **Rotazione PAT Supabase**: il personal access token usato nelle sessioni di agosto è transitato in chat → revocare e rigenerare da https://supabase.com/dashboard/account/tokens, poi aggiornare `scratch/.sbp_token`.
- [ ] **Consolidamento `Antigravity Agents Config.md`** (root, v2.2 storico) vs `.agents/AGENTS.md` canonico.
- [ ] **i18n canvas/PDF**: dizionario EN per label grafici Chart.js e testi report PDF.
- [ ] **Parità LP↔DP**: test browser con `bessOptimizer: 'lp'` (HiGHS) vs DP su casi noti.
- [ ] **Ambiente dev Supabase**: il progetto `ozexeaqnvlkflzweikph` non esiste più (DNS) — valutare ricreazione come staging per migrazioni.
- [ ] **TIDE 2026 quart'oraria**: estensione motore a 96 periodi/giorno per settlement CER (feature multi-step).
- [ ] **Retention audit log**: registro limitato a 200 voci con pruning; per compliance valutare retention più lunga/export periodico.

## Chiusi (2026-08)
- [x] Hardening dipendenze CDN/SRI + SheetJS 0.20.3 (A1)
- [x] RLS/GRANT verificati e hardening anon (A2)
- [x] Gate accesso anonimo per ambiente (A3)
- [x] Template config + fix clone tool (A4)
- [x] Audit XSS + escaping uniforme (A5)
- [x] Suite motore 51→136 assertion; BRP lifetime-avg nel dispatch; MC seedato; drift guard (B1-B2)
- [x] Notifiche corporate (C1) · layout polish (C2) · grafici it-IT (C3) · branding report (C4)
- [x] Cash flow mensile 72 mesi (Anno 0 + Anni 1-5, COD dinamico) motore+UI+export (D1-D2, CF1-CF6)
- [x] Ruoli viewer/editor/admin + zonal_pun admin-only + gate viewer su plant_custom_costs (D3)
- [x] Dashboard qualità dati (tab dedicato) + CSV (D4)
- [x] Backup schedulato + verify drill + restore dry-run (D5)
- [x] Export audit CSV/PDF (D6)
- [x] Credenziali e2e autenticate (`scratch/.e2e_auth.json`)
- [x] Encoding `.agents/AGENTS.md` corretto (commit d083475)
- [x] pm2 startup systemd abilitato
- [x] Voci CAPEX/OPEX personalizzate per impianto (CF7)
- [x] Date funding capitali + XIRR datato (CF8)
- [x] Modello budget CAPEX/OPEX con contatori residuo e categorie (CF9)
- [x] IVA solo cash flow (pass-through, non tocca P&L/IRR) (CF10)
- [x] README aggiornato + docs/PROJECT_SPEC.md + docs/TODO.md (E1)
