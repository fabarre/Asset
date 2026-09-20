---
name: frontend-architecture-perf
description: Single Page Application (SPA) architecture, Chart.js GPU decimation (60 FPS), Web Worker lifecycle validation, PWA cache invalidation, and real-time Supabase 1-to-1 data binding.
---

# SKILL: Frontend Architecture, Performance & Web Worker Engine

Questa skill definisce gli standard architetturali, di performance e di resilienza per l'interfaccia utente Single Page Application (SPA) e per il thread di calcolo Web Worker del simulatore.

---

## 1. Architettura SPA Premium Frameless

### A. Stack Tecnologico e Principi di Design
* **Nessun Framework Pesante**: HTML5 semantico, Tailwind CSS (palette scura ad alto contrasto per finanza e ingegneria energetica), Vanilla JavaScript (ES6+).
* **Struttura Monofilo**: Unico file `index.html` reattivo e frameless, progettato per tempi di caricamento istantanei ($< 300\text{ms}$).
* **Risorse CDN**: Tutte le librerie esterne (Chart.js, Supabase SDK, Tailwind CSS, FontAwesome) devono essere collegate tramite link CDN HTTPS stabili e compatibili con i criteri di Content Security Policy (CSP).

---

## 2. Ciclo di Vita del Web Worker & Prevenzione Fallimenti Silenziosi

### A. Esecuzione del Calcolo su Thread Separato
Tutti i calcoli complessi (simulazione oraria su 8760 ore, ottimizzazione carica/scarica BESS, ammortamento debito, cash flow mensile) girano all'interno del Web Worker dedicato (`src/worker/simulation.worker.js`), mantenendo il thread principale della UI completamente reattivo a 60 FPS.

### B. Validazione Sintattica Obbligatoria (Gate Pre-Commit)
> [!CAUTION]
> **Worker Silent Failure Prevention**: Qualsiasi errore di sintassi (anche una sola parentesi non chiusa o un typo in una costante) all'interno di `simulation.worker.js` fa fallire il worker **silenziosamente**, bloccando la Dashboard con valori a 0 o spinner infinito senza loggare errori nella console UI.
> **Regola Tassativa**: Prima di validare o testare qualsiasi modifica al worker, è OBBLIGATORIO eseguire da terminale:
> ```bash
> node -c src/worker/simulation.worker.js
> ```
> Se il comando restituisce qualsiasi errore di parsing, il codice NON deve essere rilasciato.

---

## 3. Cache Invalidation & PWA Service Worker (Shell Cache Bump)

### A. Regola di Cache-Bust Atomica
Il browser memorizza la shell dell'applicazione tramite il Service Worker (`sw.js`). Qualsiasi modifica a `index.html`, `main.js` o `sw.js` deve **tassativamente invalidare la cache**, altrimenti gli utenti continueranno a caricare la versione precedente con conseguenti regressioni o comportamenti fantasma.

**Procedura di Aggiornamento Obbligatoria**:
1. Incrementare il parametro di query in `index.html`:
   ```html
   <script src="main.js?v=42"></script>
   ```
2. Incrementare la costante `CACHE_NAME` in `sw.js`:
   ```javascript
   const CACHE_NAME = 'asset-shell-v42';
   ```
3. Effettuare le due modifiche nello stesso commit logico.

---

## 4. Visualizzazione Real-Time & Ottimizzazione GPU (Chart.js)

### A. Decimazione dei Dati (Data Decimation a 60 FPS)
Con 8.760 punti orari (o 35.040 quart'orari), il rendering di curve sovrapposte (FV, Carico, Immissione, SoC) satura la memoria canvas se non ottimizzato.
* Applicare l'algoritmo di decimazione dati (*LTTB - Largest Triangle Three Buckets* o *min-max decimation*) prima del passaggio a Chart.js quando lo zoom è sull'intero anno.
* Abilitare l'accelerazione hardware GPU sul canvas e disattivare le animazioni pesanti sui grafici densi (`animation: false` per serie $> 1000$ punti).

---

## 5. Persistenza Supabase Real-Time (1-to-1 Input Binding)

### A. Binding Bidirezionale Deterministo
Tutti i parametri di input nelle schede `Impianti`, `Finanza`, `CER/RID` e `Stabilimenti` devono essere sincronizzati con Supabase:
1. **Mapping Bidirezionale**: Registrare ogni nuovo input nell'oggetto `domMap` in `main.js`.
2. **Event Listeners Reattivi**: Aggiungere l'ID dell'input nell'array di ascoltatori di eventi in `setupEventListeners()` affinché ogni modifica dell'utente scateni il ricalcolo e l'upsert su database.
3. **Righe di Dettaglio Budget (CAPEX / OPEX)**:
   - Aggiornamento immediato dei contatori al cambio riga.
   - Salvare in tempo reale nel database senza richiedere bottoni di conferma separati.
   - Trattare sempre il budget al netto con calcolo automatico di IVA e lordo basato sull'aliquota di categoria.
