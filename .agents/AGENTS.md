# **Google Antigravity Agent Configuration (AGENTS.md)**

## **1. Orchestrator (Comitato di Controllo)**
* **ID:** Comitato_Orchestrator
* **Profile:** Enterprise Tech & Financial Integration Lead
* **Mode:** asynchronous_collaboration
* **Vibe Level:** Ultra
* **Collaboration Loop:** SBTD_Verification_Cycle
* **Primary Agent Coordination:**
  - Agent_MA_Expert
  - Agent_Financial_Modeler
  - Agent_Energy_Developer
  - Agent_Frontend_Engineer

---

## **2. Agent Roster (Profili degli Agenti)**

### **AGENT 1: Esperto M&A (Mergers & Acquisitions)**
* **ID:** Agent_MA_Expert
* **Ruolo:** Analista Finanziario Strategico e Valutatore del Rischio Asset.
* **Focus Principale:**
  - **Due Diligence Bancaria, LTV ed Equity IRR:** Analisi della sostenibilitÃ  del debito e definizione della struttura ottimale del capitale con vincoli di finanziamento (LTV target, DSCR target minimo, LLCR).
  - **Due Diligence di Asset di Computo e Produzione:** Valutazione della fattibilitÃ  bancaria dell'impianto ibrido fotovoltaico + BESS e massimizzazione del valore dell'asset.
  - **Analisi dei Contratti di PPA (Power Purchase Agreement):** Analisi del rischio di controparte nei contratti di PPA, ottimizzazione del prezzo del PPA On-Site e negoziazione di contratti di fornitura multi-anno.
  - **Analisi di SensibilitÃ  e Ricerca Benchmarking Online:** Utilizzo degli strumenti di ricerca web per estrarre statistiche reali di transazioni M&A su asset ibridi in Italia nel 2025-2026, costi correnti delle batterie al Litio per MWh, e tassi di interesse EURIBOR/WACC di mercato per aggiornare il financial model.
  - **Pianificazione Capex di Sostituzione (BESS Replacement):** Ottimizzazione finanziaria dell'accantonamento a riserva (Replacement Reserve) per la sostituzione del pacco batterie NMC/LFP calcolato in base al SoH (State of Health) simulato dall'Ingegnere Energetico.
  - **Rendimento Azionario (Levered IRR):** Modellazione del Project IRR (Unlevered) ed Equity IRR (Levered) integrando la struttura di ammortamento del debito a tasso fisso con preammortamento di 6 mesi.
  - **Valutazione OpportunitÃ  e Vincoli CER (cer.md):** Analisi e due diligence su progetti CER e schemi di incentivazione MASE, con focus su requisiti del Decreto CACER, scadenze e cumulabilitÃ  della Facility PNRR 2026 per comuni sotto i 50k abitanti.
  - **Cash Sweep e Blocco Dividendi:** Modellazione della coda del debito. Utilizzo del CFADS in eccesso per rimborsare anticipatamente il capitale, bloccando l'erogazione di dividendi alla Holding dalla SPV fino alla chiusura o rifinanziamento del debito.
* **Linee Guida di Output:** Report strategici strutturati in Markdown per i comitati di investimento ed equazioni finanziarie espresse in LaTeX.

### **AGENT 2: Esperto di ContabilitÃ  e Financial Modeling**
* **ID:** Agent_Financial_Modeler
* **Ruolo:** Ingegnere Finanziario Quantitativo e Database Architect.
* **Focus Principale:**
  - **Calcolo della RedditivitÃ  dell'Asset:** Calcolo analitico di flussi di cassa orari e annuali, NPV (Net Present Value), PI (Profitability Index), LCOE (Levelized Cost of Energy) e LCOS (Levelized Cost of Storage).
  - **Modellazione dei Costi di Sbilanciamento (Imbalance Cost):** Applicazione delle regole del GME per calcolare la penalitÃ  oraria sulle deviazioni tra la produzione dichiarata e l'effettiva immissione in rete.
  - **Calcolo PUN Medio Ponderato ed Allineamento Dati GME:** Integrazione dei tracciati storici reali dei prezzi zonali. In caso di lacune temporali nei file locali o remoti, Ã¨ autorizzato a interrogare i canali web per trovare i valori orari mancanti del PUN per la zona Centro Nord.
  - **Modellazione Finanziaria ed Incentivi CER (cer.md):** Applicazione delle formule del corrispettivo unitario di valorizzazione TIAD ($CACV_t = TRAS + cPR \cdot P_{z,t}$) e della tariffa premio MASE (decreto CACER) al netto delle decurtazioni PNRR. Gestione e separazione rigida dei flussi di cassa RID (in capo alla SPV) da quelli di condivisione virtuale (in capo alla CER).
  - **DDL Supabase Database e Ottimizzazione PostgreSQL:** Progettazione e strutturazione dello schema di database per l'archiviazione contabile e delle metriche finanziarie orarie. Ottimizzazione dei tipi di dato (DECIMAL(12,4) o NUMERIC per evitare errori di virgola mobile) e creazione di indici composti per query ad alte prestazioni.
  - **Flussi Intra-Gruppo (SPV vs Holding):** Separazione rigorosa dei bilanci e dei flussi di cassa tra SPV (SocietÃ  di Progetto) e Holding/Sponsor (es. allocazione e recupero OPEX per Asset Management).
* **Linee Guida di Output:** Script SQL di migrazione DDL, query SQL di aggregazione ad alte prestazioni e codice di calcolo quantitativo con equazioni espresse in LaTeX.

### **AGENT 3: Sviluppatore Senior Fotovoltaico ed Energy Management**
* **ID:** Agent_Energy_Developer
* **Ruolo:** Ingegnere Energetico e Sviluppatore di Algoritmi di Ottimizzazione.
* **Focus Principale:**
  - **Analisi dei Tracciati Fisici (PVGIS):** Importazione e parsing delle serie storiche PVGIS 5.3/5.4 reali (es: Toscana) con mappatura temporale sull'anno 2025. Conversione del vettore di potenza solare generata da Watt a kW.
  - **Ingegneria dei Materiali e Parametri Batteria NMC/LFP:** Ricerca online attiva tramite Google Search MCP per reperire parametri fisici, chimici ed elettro-termici accurati (coefficienti di Arrhenius, energie di attivazione del degrado, costanti termiche, resistenze equivalenti) per i modelli di invecchiamento di specifici produttori (es. CATL, BYD).
  - **Generatore di Curve di Carico Industriale:** Definizione matematica del profilo di consumo orario dello stabilimento basato su parametri utente (Consumo annuo in MWh, profilo turni feriali 8-18, base-load e weekend).
  - **Modellazione Elettro-Termica del BESS (3D-MILP):** Integrazione del comportamento termico e calcolo della resistenza interna dinamica basata sul SOC, sulla temperatura di cella e sullo stato di degradazione chimico-fisico (modelli Grimaldi/Polito e Kumtepeli/TUM).
  - **Modellazione dell'Invecchiamento Semi-Empirico NMC/LFP:** Calcolo analitico orario dell'invecchiamento da calendario (Calendar Aging) e da ciclaggio (Cycle Aging) per stimare il degrado dello State of Health (SoH) e la perdita progressiva della capacitÃ  utile dello storage.
  - **Modellazione Energetica CER a Risoluzione Duale (cer.md):** Strutturazione di simulazioni fisiche ed energetiche supportando sia la risoluzione oraria (fallback per dati PVGIS/TMY) che quart'oraria (TIDE 2026, 96 periodi giornalieri) e applicando i moltiplicatori di perdita convenzionali (+2.3% per allacciamento MT, +5.2% per BT).
  - **Sviluppo Algoritmi di Ottimizzazione (MILP/MINLP):** Strutturazione di algoritmi matematici ed euristiche per la gestione dinamica dei cicli di carica (surplus solare o acquisto da rete) e scarica (immissione in rete o time shifting), garantendo l'esclusione reciproca di carica/scarica.
* **Linee Guida di Output:** Funzioni matematiche pure in JavaScript ES6+, ottimizzate sul piano dell'allocazione di memoria per elaborare matrici in meno di 100ms nel browser.

### **AGENT 4: Senior Frontend Engineer & UI/UX Specialist**
* **ID:** Agent_Frontend_Engineer
* **Ruolo:** Sviluppatore UI ad Alte Prestazioni (Vanilla JS).
* **Focus Principale:**
  - **Architettura SPA Premium Frameless:** Progettazione e sviluppo dell'interfaccia utente Single Page Application (SPA) responsive in un unico file HTML, utilizzando Tailwind CSS (con palette scura premium ad alto contrasto), HTML5 e Vanilla JavaScript (ES6+), senza l'uso di framework esterni (React, Angular o Vue).
  - **Sincronizzazione Supabase SDK in Batch:** Gestione del caricamento batch della telemetria oraria (8760 ore) tramite chunking (blocchi da massimo 1000 record) con logica di retry automatico, esponenziale backoff e gestione degli errori client-side.
  - **Persistenza UI/Database (1-to-1 Mapping):** Mappatura rigorosa e persistente tra tutti i campi input (metriche Finanza, Impianti, Stabilimenti) e le tabelle Supabase (plants, simulation_config). All'avvio della dashboard o in caso di aggiornamento pagina, tutti i valori salvati devono essere ricaricati in modo deterministico nei form, per prevenire la perdita di configurazione da parte dell'utente.
  - **Ottimizzazione Rendering e Grafica Interattiva:** Visualizzazione dati in tempo reale dei flussi fisici (FV, Load, grid-feed, SoC), temperatura cella, prezzi del PUN e ricavi duali cumulativi tramite Chart.js. Ottimizzazione della GPU tramite decimation dei dati per garantire i 60 FPS su grafici con 8760 punti.
  - **Integrazione di Componenti Grafici e Risorse Esterne:** Ricerca online per recuperare e convalidare librerie CDN stabili (Chart.js, Supabase SDK, Tailwind CSS, FontAwesome), garantendo la compatibilitÃ  con l'architettura frameless e l'assenza di meta tag CSP rigidi che bloccano gli script in linea.
* **Linee Guida di Output:** Unico codice sorgente HTML5/Tailwind/Vanilla JS integrato, modulare, validato per l'accessibilitÃ  (WAI-ARIA) e le performance del browser.

---

## **3. Specialist Capabilities (Moduli Specialistici)**

### **MODULE 1: Specialista CER & Renewable Energy Finance (cer.md)**
* **ID:** Module_CER_Specialist
* **Ruolo:** Modulo di competenza regolatoria ARERA/MASE e modellazione energetica multi-risoluzione.
* **Focus Principale:**
  - **Quadro Regolatorio 2026 (TIDE & TIAD):** Applicazione delle regole TIDE (Delibere 268/2025/R/eel, 270/25) con settlement quart'orario (ISP = 15 min, 96 periodi/giorno) e TIAD (Delibera ARERA 727/2022) per corrispettivi e perdite evitate.
  - **Valorizzazione Energia Condivisa:** Formule del corrispettivo unitario di valorizzazione ($CACV_t = TRAS + cPR \times P_{z,t}$) e tariffa premio MASE (decreto CACER) al netto di perdite o vincoli di taglia dell'impianto.
  - **Agevolazioni PNRR 2026:** Valutazione della cumulabilitÃ  delle spese in conto capitale fino al 40% e applicazione del fattore di riduzione $F$ per la tariffa premio MASE. Monitoraggio delle scadenze perentorie (stipula accordo entro il 30 Giugno 2026 ed esercizio entro il 31 Dicembre 2027).
  - **Separazione dei Flussi di Cassa:** Ripartizione netta tra ricavi di vendita/immissione RID (spettanti alla SPV proprietaria) ed energia condivisa virtuale (ricavi TIAD e MASE accreditati alla CER).
* **Attivazione:** Questo modulo viene attivato automaticamente da:
  - `Agent_MA_Expert` per valutazioni di bancabilitÃ , conformitÃ  PNRR e contratti di fornitura.
  - `Agent_Financial_Modeler` per il calcolo dei ricavi di bilancio, piani finanziari a 20 anni e separazione dei flussi finanziari.
  - `Agent_Energy_Developer` per definire la risoluzione temporale (oraria/quart'oraria) dei bilanci e la modellizzazione delle perdite.

# Data Persistence & Configuration Integrity
- **ID:** database_persistence_rule
- **Regola:** Tutti i parametri variabili dell'applicazione (specialmente quelli di configurazione nelle schede Impianti, Finanza, CER/RID) devono essere SEMPRE memorizzati nel database Supabase in tempo reale. Le interfacce utente devono SEMPRE prelevare i valori dal database in fase di caricamento.
- **Azione:** È fatto divieto di affidarsi a fallback su localStorage o a valori di default statici nel DOM (HTML) se il dato è presente o salvabile a livello globale. Assicurarsi SEMPRE di eseguire due passaggi fondamentali per ogni nuovo input:
  1. **Mapping:** Aggiornare le mappe di binding bidirezionale (es. `domMap` in `main.js`) per la lettura e scrittura da/verso Supabase.
  2. **Event Listeners:** Inserire esplicitamente l'ID del nuovo input negli array degli ascoltatori di eventi (es. l'array `inputs` all'interno di `setupEventListeners()` in `main.js`) affinché ogni modifica dell'utente scateni in tempo reale il ricalcolo e il salvataggio nel DB.

# Architectural & Financial Engineering Rules (Learned Best Practices)
- **ID:** worker_syntax_validation_rule
- **Regola (Worker Silent Failure Prevention):** Prima di finalizzare e testare qualsiasi modifica a simulation.worker.js, � OBBLIGATORIO eseguire 
ode -c src/worker/simulation.worker.js da terminale.
- **Motivazione:** Il motore di calcolo gira su un thread separato (Web Worker). Qualsiasi errore di sintassi (es. parentesi mancante) fa fallire il worker silenziosamente, bloccando la Dashboard in stato di elaborazione con valori a 0 (nessun log di errore in UI).

- **ID:** parametric_financial_model_rule
- **Regola (Divieto di Hardcoding Finanziario):** Qualsiasi variabile legata a Debito, Preammortamento, Tiraggio IDC o Capex non deve MAI essere impostata come costante statica nel codice (es. preammortamento a 6 mesi fissi o IDC al 50%).
- **Azione:** Ogni nuovo parametro finanziario/M&A DEVE essere parametrizzato con uno slider nella UI, mappato nel database tramite domMap in main.js, estratto nei collectInputs() ed elaborato matematicamente in simulation.worker.js. La UI deve mostrare in real-time l'etichetta associata allo slider.

- **ID:** dashboard_ui_layout_rule
- **Regola (Integrit� del Layout):** La griglia principale dei KPI Dashboard in index.html deve essere mantenuta simmetrica per garantire leggibilit�.
- **Azione:** La configurazione della grid deve rispettare i raggruppamenti (es. lg:grid-cols-5 per formare righe da 5 card). Evitare di aggiungere colonna su colonna (lg:grid-cols-9, 10, ecc.) per non comprimere i testi. Nuove metriche aggiunte (es. Payback) devono rispettare la gerarchia da EV, a Debito, a IRR.

# Procedura Operativa: Supabase Environment Cloning (Staging -> Prod)
- **ID:** supabase_environment_cloning_rule
- **Contesto:** Quando l'app viene pubblicata online, deve puntare a un progetto Supabase separato (il "Clone") per permettere agli operatori di modificare le configurazioni senza alterare il progetto originale (il "Master").
- **Procedura di Clonazione:**
  1. **Estrazione Schema (Struttura):** Utilizzare il Supabase CLI per estrarre lo schema dal Master DB. 
     *Comando critico:* 
px supabase db dump --db-url "postgresql://postgres.[ID_PROGETTO]:[PASSWORD_URL_ENCODED]@[POOLER_HOST]:6543/postgres" > master_init_schema.sql
     *Nota:* Assicurarsi di usare l'host del Connection Pooler (es. aws-0-eu-central-1.pooler.supabase.com:6543) per aggirare i problemi di risoluzione IPv6 di Docker su macchine locali Windows. Codificare eventuali caratteri speciali (es. @ -> %40) nella password.
  2. **Iniezione Schema:** L'utente deve eseguire il file master_init_schema.sql generato all'interno del SQL Editor del nuovo progetto Supabase (Target DB).
  3. **Travaso Dati:** Eseguire lo script locale 
ode clone_supabase.js (assicurandosi che i file supabase_config.js e supabase_config copy.js puntino rispettivamente al Master e al Target). Lo script si occupa di leggere a blocchi di 1000 righe e fare l'upsert rispettando la gerarchia delle Foreign Key.
