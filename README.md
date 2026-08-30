# AntiGravity Hybrid FV + BESS Simulator - Enterprise Edition

Benvenuti nel progetto **AntiGravity Hybrid FV + BESS Simulator (Enterprise Edition)**.
Questo strumento è una Single Page Application (SPA) avanzata progettata per la valutazione tecno-economica e la due diligence bancaria di progetti infrastrutturali complessi nel settore delle energie rinnovabili, con particolare focus sull'ibridazione di impianti Fotovoltaici (FV) e sistemi di accumulo a batterie (BESS).

## Indice
1. [Architettura di Sistema](#1-architettura-di-sistema)
2. [Modello Dati (Supabase)](#2-modello-dati-supabase)
3. [Motore di Calcolo Fisico-Energetico](#3-motore-di-calcolo-fisico-energetico)
4. [Logiche Finanziarie e Struttura del Debito](#4-logiche-finanziarie-e-struttura-del-debito)
5. [Integrazione Normativa e M&A](#5-integrazione-normativa-e-ma)
6. [Flusso di Esecuzione (Workflow)](#6-flusso-di-esecuzione-workflow)

---

## 1. Architettura di Sistema

L'applicazione segue un paradigma architetturale **Frameless SPA (Single Page Application)** orientato alle performance estreme nel browser.

* **Frontend:** Costruito in puro **HTML5** e **Vanilla JavaScript (ES6+)**. L'assenza di framework reattivi (come React o Vue) riduce al minimo l'overhead del Virtual DOM, consentendo di gestire matrici di dati orarie pesanti. L'aggiornamento del DOM è pilotato da un oggetto di stato globale mutuabile.
* **Styling:** Utilizza **Tailwind CSS** caricato via CDN, con una UI/UX "Dark Premium" ad alto contrasto ottimizzata per dashboard professionali.
* **Computazione Asincrona:** L'intero carico di simulazione (bilancio orario 8760x, ottimizzazione e attualizzazione finanziaria) è delegato a un **Web Worker dedicato (`simulation.worker.js`)**, mantenendo l'interfaccia utente (Main Thread) responsiva a 60 FPS in ogni momento.
* **Data Visualization & Aggregation:** **Chart.js** e i cruscotti dei dati analitici impiegano tecniche di aggregazione intelligente nel frontend. Le logiche di *downsampling* eseguono medie per i valori puntuali o percentuali (come i Prezzi e lo State of Charge del BESS) e **somme vettoriali** per i flussi energetici (che da potenza oraria in kW diventano cumulati in kWh raggruppati su base giornaliera o mensile) per assicurare totale integrità di quadratura tra i volumi fisici e i ricavi in € mostrati.
* **Backend & Database:** **Supabase (PostgreSQL)** gestisce in cloud l'archiviazione dello stato, delle configurazioni, dei metadati degli impianti e delle pesantissime serie storiche orarie.

---

## 2. Modello Dati (Supabase)

L'applicativo salva il 100% della propria configurazione e telemetria su Supabase, permettendo il salvataggio di scenari e il ripristino istantaneo dello stato dell'applicativo al caricamento. 

Le tabelle principali sono:

* `simulation_config`: Configurazione globale. Salva coppie chiave/valore (`key`, `value`) per i parametri della scheda FINANZA (es. WACC, inflazione, EURIBOR, spread bancario, target DSCR) e gli scenari dei prezzi dell'energia.
* `plants`: Anagrafica degli Impianti. Include tutti i metadati strutturali, CAPEX, OPEX dettagliati (O&M, Assicurazione, Tasse, Asset Management), dettagli BESS (Capacità, SoC, Efficienza, Cicli), dettagli Inverter, spread del Trader, ecc.
* `plant_generation`: Serie Storiche Impianti. Relazione 1-a-N con `plants`. Contiene 8760 record (ore dell'anno) per ciascun impianto (`hour_index`, `generation_kw`). 
* `stabilimenti`: Anagrafica delle Utenze/Carichi Industriali. Include i dettagli del carico annuo, le logiche PPA (prezzo, tipologia On-site/Off-site/CER) e le dipendenze con gli impianti (`plant_id`).
* `stabilimento_load`: Curve di Carico. Relazione 1-a-N con `stabilimenti`. Contiene 8760 record per ciascun carico (`hour_index`, `load_kw`).
* `zonal_pun`: Prezzi Zonali. Contiene la curva dei prezzi orari PUN per le varie zone di mercato (Nord, Centro-Nord, Sud, ecc.).

> **Nota di Sicurezza (RLS):** tutte le tabelle hanno Row Level Security **restrittiva**: le sei tabelle utente sono per-owner (`auth.uid() = user_id`, migrazione `migration_per_user.sql`), `zonal_pun` è letto da tutti gli autenticati ma scrivibile solo dal ruolo `admin`. I ruoli (`admin`/`editor`/`viewer`, claim JWT `app_metadata.role`) sono gestiti da `migration_roles_viewer.sql`: il ruolo `viewer` è in sola lettura (SELECT owner, scritture negate lato RLS e lato UI). L'accesso anonimo è consentito solo su host locali o con `ALLOW_ANONYMOUS: true` nel config di ambiente (gate applicativo, `FASE A3`).

---

## 3. Motore di Calcolo Fisico-Energetico

La simulazione avviene nel Worker (`simulation.worker.js`) iterando su 8760 ore (o 96 quarti d'ora, a seconda del livello di dettaglio).

### Profili di Generazione e Consumo
* **Fotovoltaico:** I profili sono ricavati da file CSV generati da PVGIS 5.3/5.4 o importati tramite i TMY (Typical Meteorological Year). Il motore supporta l'applicazione di percentuali di decadimento lineare annuo (separato tra RID, time-shifting e arbitraggio).
* **Profili di Carico:** Possono essere caricati da CSV custom o modellati matematicamente tramite l'algoritmo integrato che considera orari di lavoro, turnazioni, weekend, giorni festivi italiani e quota di base-load.

### Dinamiche del BESS (Battery Energy Storage System)
L'ottimizzazione del BESS avviene con logica euristica "greedy" (in attesa di upgrade a MILP completo) che previene la carica/scarica simultanea:
1. **Gestione SoC:** Il livello di carica è vincolato rigorosamente ai limiti `SoC Min` e `SoC Max` dell'hardware.
2. **Efficienza Round-Trip (RTE):** Applica le perdite di conversione energetica sia in fase di carica che di scarica.
3. **Decadimento BESS:** Modella il Cycle Aging e il Calendar Aging. Se l'hardware scende sotto un determinato livello di State of Health (SOH), si valuta l'opzione di **Capex di Sostituzione (Augmentation)**. Quando attivato, il CAPEX di sostituzione (tipicamente all'anno 10) viene capitalizzato a Stato Patrimoniale con un ammortamento dedicato in quote costanti civilistiche da 10 anni, scorporandolo dagli ammortamenti fiscali pregressi.

---

## 4. Logiche Finanziarie, Fiscali e Struttura del Debito

Il simulatore applica un modello finanziario M&A di stampo istituzionale, gestendo complessi meccanismi di finanziamento in Project Finance (o SPV standalone) e calcoli fiscali italiani puntuali.

### Modello Fiscale (IRES/IRAP/TUIR)
Il Web Worker integra un sofisticato Tax Engine in grado di mappare asimmetrie fiscali e civilistiche:
* **Dettaglio Imposte Correnti:** Tracciamento separato e analitico di **IRES (24%)** su EBT e variazioni fiscali e **IRAP (3.9%)** su EBIT e costi indeducibili, visibile nelle schede di scenario, nei report PDF e nelle esportazioni Excel multi-tab.
* **Art. 96 TUIR (Interessi Passivi):** Limitazione della deducibilità degli interessi passivi entro il 30% del ROL (Reddito Operativo Lordo) e riporto a nuovo degli interessi eccedenti.
* **Art. 84 TUIR (Riporto Perdite - NOL):** Le perdite fiscali maturate nei primi 3 anni della SPV sono utilizzabili per compensare il 100% del reddito futuro. Dallo spegnimento del terzo anno in poi, la compensazione segue il tetto massimo dell'80% del reddito imponibile.
* **Imposte Differite (Deferred Taxes):** Il disallineamento tra ammortamento civilistico e ammortamento fiscale genera passività differite. È integrato un meccanismo di *reversal* (storno) che riassorbe i fondi accantonati una volta che l'ammortamento civilistico eccede quello fiscale, garantendo quadratura nello Stato Patrimoniale a fine vita dell'asset.

### Debito, Ammortamento e Indici di Copertura
* **Leva Finanziaria (LTV):** Il debito erogato (Senior Debt) è configurabile da 0% a 85% del CAPEX totale investito (permettendo anche la valutazione di progetti 100% Equity).
* **Ammortamento:** Piano a rate costanti (French style) o decrescenti (Italian style) dipendente dai tassi (EURIBOR + Spread).
* **Pre-Ammortamento:** Possibilità di configurare mesi di "grace period" (quota solo interessi) all'inizio della vita utile.
* **DSCR & LLCR:** Viene calcolato il *Debt Service Coverage Ratio* annuo per verificare la bancabilità. Un DSCR minimo target viene monitorato per assicurare che la rata non ecceda la cassa disponibile (CFADS).

### Cash Sweep (Blocco Distribuzione Dividendi)
Una delle feature principali del tool è il **Cash Sweep**.
Se abilitato, la SPV non può erogare dividendi alla Holding fintanto che il debito non è stato estinto. 
* L'intera Cassa in Eccesso (CFADS al netto del Servizio del Debito programmato) viene usata per **rimborsare anticipatamente la quota capitale del debito**.
* Questo contrae la durata del mutuo e riduce notevolmente la spesa in interessi, aumentando spesso il rendimento interno del progetto (IRR), a scapito però di un ritorno di cassa nullo per l'investitore nei primi anni.
* Alla chiusura anticipata del debito (Exit), i dividendi bloccati vengono sbloccati e distribuiti liberamente alla Holding.

### Separazione Flussi SPV vs Holding
Il software mappa separatamente la SPV e la Holding (Sponsor).
* Alcuni costi (come l'**OPEX Asset Management**) vengono dedotti dalla SPV ma risultano un "ricavo intra-gruppo" o flusso positivo nel consolidato della Holding, valorizzando correttamente il lavoro svolto dalla società veicolo.

---

## 5. Integrazione Normativa e M&A

L'applicazione dispone di logiche pre-programmate per aderire alle normative GSE e ARERA italiane.
* **CER (Comunità Energetiche Rinnovabili):** Modellazione del Decreto CACER, calcolo degli incentivi tariffari MISE/MASE, calcolo del contributo in conto capitale PNRR (che riduce l'incentivo proporzionalmente).
* **Regole GME e Sbilanciamento:** L'energia immessa viene decurtata dei costi di sbilanciamento di sistema in base alla dispersione oraria preventivata dal Trader.
* **Contratti Earn-Out e Intermediazione PPA:** Il modello mappa i costi per i developer originali e l'eventuale intermediario bancario (Service PPA) sul lungo termine, sottraendoli dall'EBITDA e riducendo il FCF.

---

## 6. Deployment in Produzione (OVHCloud VPS)

La versione di produzione è ospitata sul server VPS Linux OVHCloud:
* **Host / IP:** `164.132.103.235` (percorso `ubuntu@vps-b0473dd5:~/Asset$`)
* **Porta Web:** `3000` (`http://164.132.103.235:3000`)
* **Process Manager:** **PM2** (`asset-app`, static server `pm2 serve ~/Asset 3000`).
* **Autonomia e H24:** Il servizio è configurato con `pm2 save` e `pm2 startup` systemd per garantire la permanenza online h24 automatica senza la necessità di eseguire script `.bat` locali o mantenere sessioni aperte.
* **Backup automatico:** cron giornaliero `0 3 * * *` → `node tools/backup.mjs run prod --keep 14` (dump JSONL + manifest sha256 in `scratch/backups/`, log in `scratch/backups/cron.log`). Verifica integrità: `node tools/backup.mjs verify <dir> prod`; restore: `node tools/backup.mjs restore <dir> prod [--only t1,t2] [--dry-run]`.

---

## 6.1 Novità della versione corrente

* **Aliquote IRES/IRAP configurabili** dalla scheda FINANZA (default 24% / 3,9%), con fallback sicuro nel worker.
* **DSCR Sculpting**: opzione in FINANZA → Cash Sweep che sagoma la quota capitale sul CFADS per un target DSCR (eventuale residuo rimborsato balloon a scadenza).
* **Ricavi Servizi Ancillari BESS (MSD / Capacity Market)**: parametro €/MW/anno nella scheda RID, indicizzato all'inflazione, con riga dedicata in P&L ed export Excel.
* **Monte Carlo P50/P90**: nuova sezione nella scheda Sensibilità (shock lognormale mean-preserving sul PUN + gaussiano sulla produzione) con percentili P10/P50/P90 di IRR, NPV e DSCR.
* **Import PVGIS da API**: nella scheda Impianti è possibile scaricare la curva oraria direttamente dalle API JRC PVGIS 5.2 (lat/lon/picco/perdite) senza file CSV.
* **PWA offline shell**: manifest + service worker (cache app shell e CDN; API Supabase/PVGIS mai cachate).
* **Grace period senior oltre 12 mesi** (slider fino a 24 mesi), **SoC Min/Max BESS effettivi** nel dispatch, perdite di rete configurabili coerenti tra dashboard e simulazione.
* **Undo & Audit Log**: registro attività (icona orologio nella header) con ultimi 200 eventi (CRUD impianti/stabilimenti, import GME, scenari, config, PDF) persistito su `simulation_config` (chiavi `audit::*`). **Banner di annullamento** (12s) per le azioni distruttive (eliminazione impianto/stabilimento/scenario, import GME) con ripristino completo anche delle curve 8760h. **Ctrl+Z** per annullare l'ultima modifica di configurazione (storico 10 stati).
* **i18n IT/EN**: toggle lingua in navbar (persistente su localStorage + config Supabase). Motore a dizionario (`src/i18n.js`, ~350 voci) applicato via TreeWalker al DOM statico e via MutationObserver al contenuto dinamico (tabelle P&L, liste, dropdown) senza modifiche ai template. Fallback trasparente in italiano per le stringhe non coperte. Limite noto: label dei grafici canvas e report PDF restano in italiano; i dialoghi nativi sono stati sostituiti dal sistema notifiche corporate (`src/notify.js`: toast + modali conferma/input, anch'essi IT).
* **Tornado deterministico reale**: nuova sezione nella scheda Sensibilità (pulsante "Tornado") — IRR ricalcolato a ±Δ di 6 driver (CAPEX, OPEX, PUN, WACC, Inflazione, Tasso Debito) con grafico a barre divergenti ordinato per impatto. Il **report PDF Sensibilità** ora include i dati reali: tabella tornado (calcolata al volo se mai eseguita), percentili Monte Carlo (se eseguito) e ultima matrice 1D/2D. Fix incluso: la variabile "euribor" della sensitivity prima era un no-op (ora mappa correttamente sul tasso debito).
* **DSRA (Debt Service Reserve Account)**: parametro "Mesi di Debt Service" in FINANZA. La riserva è integrata dal CFADS fino al target (N mesi di servizio debito), utilizzata automaticamente per coprire shortfall sul servizio (protegge il DSCR) e rilasciata a estinzione/exit. Righe dedicate in P&L (draw/funding/release), saldo nel piano di ammortamento e export Excel.
* **Refinancing / Miniperm**: all'anno configurato il debito residuo viene rifinanziato (payoff balloon + nuova erogazione, netto cassa zero) con nuovo tasso e nuovo piano di ammortamento. Compatibile con sculpting, cash sweep e DSRA.
* **Autenticazione Supabase (email/password)**: schermata di login all'avvio se non c'è sessione attiva (badge utente + badge ruolo + logout nel pannello Sincronizzazione). In produzione l'accesso è **solo autenticato** (RLS restrittive + gate applicativo): la modalità anonima resta disponibile unicamente su host locali o con `ALLOW_ANONYMOUS: true` nel config di ambiente. Gestione utenti nella scheda Utenti (visibile solo admin): semaforo sessioni, colonna Ruolo e toggle viewer/editor via `admin_set_role`. Per nuovi utenti: crearli in Supabase Dashboard (o "Registra nuovo utente", poi disabilitare i signup pubblici); conferma email attiva. Migrazioni di riferimento: `migration_auth_rls.sql`, `migration_per_user.sql`, `migration_admin_users.sql`, `migration_roles_viewer.sql`, `migration_anon_least_privilege.sql`, `migration_plant_custom_costs.sql`, `migration_cf7_viewer_gate.sql` (tutte con rollback).
* **Gestione Scenari Nominati**: nella scheda FINANZA è possibile salvare snapshot della configurazione finanziaria (salva/applica/elimina) e **confrontare fino a 3 scenari** su KPI (IRR, NPV, MOIC, DSCR, LCOE, payback) calcolati dal worker. Persistenza su `simulation_config` con chiavi `scenario::<id>::*` (chunking a 200 char per compatibilità varchar(255), nessuna migrazione DB richiesta).
* **Ottimizzatore BESS LP globale (HiGHS WASM)**: in FINANZA è possibile selezionare il motore "LP Globale HiGHS" al posto della DP giornaliera. Il solver (caricato lazy da CDN pinnata `highs@1.15.2`, fallback automatico su DP) ottimizza il dispatch sull'intero orizzonte 8760h senza discretizzazione del SoC: nei test con carico PPA on-site l'uplift annuo migliora fino al +35% rispetto alla DP 2D (~1,7 s/impianto).
* **Cash flow mensile anni 1-5**: schedule a **72 mesi** (Anno 0 + Anni 1-5, àncora = COD più antico) con ricavi per stream e stagionalità reale, **COD dinamico per impianto**, lag di incasso per regime di mercato, OPEX/imposte/servizio debito, cassa apertura/chiusura, e quadratura esatta sui totali annui. Card dedicata in Dashboard con vista **SPV/Holding**, **funding dates** dei capitali (equity/soci/debito) con serie "Cassa con Funding" e **XIRR equity datato**, foglio Excel "CASH FLOW MENSILE" e pagina nel report Rendiconto Finanziario.
* **Voci CAPEX/OPEX personalizzate per impianto**: tabella `plant_custom_costs` per dichiarare costi extra (€ totale o €/kWp), integrati in CAPEX/OPEX/ammortamenti/EBITDA e nel cash flow. Nel modello budget della card Cash Flow: contatori **Totale/Allocato/Residuo** per CAPEX e OPEX Anno 1 con categorie (EPC FV/BESS, connessione, sviluppo, SPV, terreno / O&M, assicurazione, IMU, ecc.); il residuo CAPEX va al COD, il residuo OPEX si spalma /12.
* **IVA nel solo Cash Flow**: IVA di cassa come pass-through (a debito sui ricavi incassati, a credito su CAPEX+OPEX, liquidazione mensile/trimestrale con credito portato a nuovo). Incide solo sul timing della cassa, **non su P&L né IRR**. Configurabile in FINANZA (abilita, aliquota, % ricavi imponibili, frequenza liquidazione).
* **Qualità Dati & Copertura**: tab dedicato con check automatici (copertura PUN 8760h per zona, NaN/negativi/zeri, integrità e yield curve impianti, carichi stabilimenti, quadratura energetica Y1) con riepilogo OK/avvisi/errori + export CSV del report.
* **Reportistica brandizzata**: ragione sociale/tagline/logo configurabili nella card Report (persistiti per utente, logo chunkato); copertina corporate nei PDF portrait, watermark e intestazioni brandizzate, foglio COPERTINA negli export Excel.
* **Export audit log**: dal modale Registro Attività, export CSV (BOM UTF-8, attribuzione utente) e PDF brandizzato con gli ultimi 200 eventi.
* **Sicurezza & hardening (2026-08)**: dipendenze CDN pinnate con SRI (SheetJS 0.20.3 da CDN ufficiale, Tailwind vendored localmente), escaping uniforme innerHTML/XSS (suite `test:xss`), sostituzione di tutti i dialoghi nativi con toast/modali corporate, GRANT residui `anon` revocati, Monte Carlo seedato e riproducibile, fee BRP dinamiche anche nelle decisioni di dispatch (media su vita utile).
* **Test automatici**: `npm test` → `tests/test_worker.mjs` (**136 assertion** sul motore: fisco, SoC, grace, sculpting, MSD, Monte Carlo seedato, BRP per anno, CER, quadrature mensili, cash flow 72 mesi, IVA di cassa, edge case); `npm run test:e2e` → harness Playwright/Chromium for Testing su app live (KPI, tab, gate anonimi, notifiche); `npm run test:xss` → 13 check di escaping con payload reali.

## 7. Flusso di Esecuzione (Workflow)

1. **Configurazione Scenario:** L'utente accede alla scheda *FINANZA* per impostare Tassi di Interesse, Inflazione, Struttura della Leva (Cash Sweep) e Scenari Energetici Futuri (Floor/Cap dei prezzi zonali).
2. **Caricamento Asset:** Nella scheda *IMPIANTI*, l'utente carica o importa CSV di PVGIS, configura Inverter e BESS, e imposta tutti gli OPEX dettagliati. Tutte queste informazioni sono sincronizzate istantaneamente nel backend.
3. **Associazione Off-Taker:** Nella scheda *STABILIMENTI*, si modellano i carichi industriali e le utenze in autoconsumo, CER o PPA off-site.
4. **Calcolo e Reportistica:** Al clic su "Ricalcola Scenario" (o in automatico dopo una modifica), il Worker Web preleva tutto lo stato serializzato dal Main Thread, applica i 20 anni di formule orarie e annuali e risponde con `simResults`.
5. **Dashboard UI:** I grafici Chart.js e i cruscotti dei KPI (IRR, LCOE, NPV, Payback) si aggiornano reattivamente, evidenziando criticità tramite indicatori (es. DSCR < 1.3 evidenziato in rosso).

