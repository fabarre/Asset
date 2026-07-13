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

> **Nota di Sicurezza (RLS):** Le tabelle possiedono policy Row Level Security (RLS) configurate (attualmente permissive in modalità anonima per sviluppo, da stringere in produzione).

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
* **Art. 96 TUIR (Interessi Passivi):** Limitazione della deducibilità degli interessi passivi entro il 30% del ROL (Reddito Operativo Lordo) e riporto a nuovo degli interessi eccedenti.
* **Art. 84 TUIR (Riporto Perdite - NOL):** Le perdite fiscali maturate nei primi 3 anni della SPV sono utilizzabili per compensare il 100% del reddito futuro. Dallo spegnimento del terzo anno in poi, la compensazione segue il tetto massimo dell'80% del reddito imponibile.
* **Imposte Differite (Deferred Taxes):** Il disallineamento tra ammortamento civilistico e ammortamento fiscale genera passività differite. È integrato un meccanismo di *reversal* (storno) che riassorbe i fondi accantonati una volta che l'ammortamento civilistico eccede quello fiscale, garantendo quadratura nello Stato Patrimoniale a fine vita dell'asset.

### Debito, Ammortamento e Indici di Copertura
* **Leva Finanziaria (LTV):** Il debito erogato (Senior Debt) è calcolato in base alla percentuale massima del CAPEX totale investito.
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

## 6. Flusso di Esecuzione (Workflow)

1. **Configurazione Scenario:** L'utente accede alla scheda *FINANZA* per impostare Tassi di Interesse, Inflazione, Struttura della Leva (Cash Sweep) e Scenari Energetici Futuri (Floor/Cap dei prezzi zonali).
2. **Caricamento Asset:** Nella scheda *IMPIANTI*, l'utente carica o importa CSV di PVGIS, configura Inverter e BESS, e imposta tutti gli OPEX dettagliati. Tutte queste informazioni sono sincronizzate istantaneamente nel backend.
3. **Associazione Off-Taker:** Nella scheda *STABILIMENTI*, si modellano i carichi industriali e le utenze in autoconsumo, CER o PPA off-site.
4. **Calcolo e Reportistica:** Al clic su "Ricalcola Scenario" (o in automatico dopo una modifica), il Worker Web preleva tutto lo stato serializzato dal Main Thread, applica i 20 anni di formule orarie e annuali e risponde con `simResults`.
5. **Dashboard UI:** I grafici Chart.js e i cruscotti dei KPI (IRR, LCOE, NPV, Payback) si aggiornano reattivamente, evidenziando criticità tramite indicatori (es. DSCR < 1.3 evidenziato in rosso).
