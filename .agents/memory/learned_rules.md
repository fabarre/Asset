# Regole Procedurali e Invarianti Apprese (Learned Procedural Memory)

Questo documento elenca le regole vincolanti estratte dall'esperienza operativa e dai post-mortem sui bug storici.
Tutti gli agenti operativi (Worker, Modeler, Developer, Auditor) devono rispettare tassativamente queste regole prima di considerare qualsiasi modifica completata.

---

## 1. Regole del Motore di Calcolo (Web Worker)

### RULE-PROC-01: Validazione Sintattica Obbligatoria (Worker Silent Failure Prevention)
- **Codice Regola:** `worker_syntax_validation_rule`
- **Comando:** `node -c src/worker/simulation.worker.js`
- **Descrizione:** Poiché il Web Worker viene eseguito in un thread isolato nel browser, qualsiasi errore di sintassi provoca un fallimento silenzioso senza errori a console nella UI, bloccando tutti i KPI a zero. È obbligatorio validare la sintassi da CLI prima di qualunque esecuzione di test.

### RULE-PROC-02: Ordine delle Assegnazioni di Flusso Post-Compensazione
- **Codice Regola:** `post_compensation_assignment_rule`
- **Descrizione:** Qualsiasi variabile di flusso di cassa (es. `taxes`, `debtSvc`, `vatRemit`) soggetta a compensazione o abbattimento deve essere valorizzata **strettamente DOPO** l'applicazione della compensazione (`taxesOut[i] -= comp`). Non memorizzare copie locali prima del blocco di calcolo algebrico.

### RULE-PROC-03: Conservazione Patrimoniale del Credito IVA
- **Codice Regola:** `vat_credit_conservation_rule`
- **Descrizione:** Il `vatCredit` NON deve mai essere azzerato alla data di presentazione dell'istanza Modello TR se l'erogazione monetaria avviene con un lag temporale ($L > 0$).
  - Il credito richiesto a rimborso entra in `pendingRefund`.
  - Il `vatCredit` si riduce **esclusivamente nel mese in cui il bonifico entra in cassa** (`refundRec > 0`) o quando viene utilizzato in compensazione F24 (`comp > 0`).
  - Con $L = 0$ (liquidazione contestuale immediata), la richiesta e l'accredito avvengono nel medesimo mese, azzerando il credito e aumentando la cassa contestualmente.

### RULE-PROC-04: Divieto di Hardcoding Finanziario
- **Codice Regola:** `parametric_financial_model_rule`
- **Descrizione:** Nessuna variabile finanziaria (tassi, durate, grazia, IDC, preammortamento, frequenza debito, aliquote IVA) deve mai essere hardcodata nel codice come costante numerica. Ogni parametro deve essere configurabile da UI, salvabile su Supabase (`domMap`), estratto in `collectInputs()` ed elaborato parametricamente nel worker.

---

## 2. Regole dell'Export Excel (ExcelJS)

### RULE-PROC-05: Acyclicity Assoluta dell'Albero delle Formule
- **Codice Regola:** `excel_formula_acyclicity_rule`
- **Descrizione:** Nessuna formula Excel generata in `src/excelExport.js` può referenziare direttamente o indirettamente se stessa o una cella che dipende da essa.
  - Nella quota interessi del debito, referenziare sempre il saldo iniziale (`Beginning Balance`) o il saldo finale del periodo precedente, mai il saldo finale del periodo corrente.
  - Nei subtotali annuali e nel totale cumulato, verificare che gli intervalli (`blockStartRow` : `blockEndRow`) non includano righe di subtotale precedente.

### RULE-PROC-06: Formule Native Pure con Precomputed Result
- **Codice Regola:** `excel_native_formula_precomputed_rule`
- **Descrizione:** Tutte le celle calcolate in Excel devono contenere l'oggetto `{ formula: '...', result: valoreNumerico }`. Questo garantisce sia il calcolo dinamico reattivo in Microsoft Excel, sia la corretta visualizzazione immediata in visualizzatori web o anteprime senza ricalcolo forzato.

---

## 3. Regole dell'App Shell e Database

### RULE-PROC-07: Invalidation Cache PWA (Cache-Bust Sincronizzato)
- **Codice Regola:** `shell_cache_bump_rule`
- **Descrizione:** Ogni modifica a `index.html`, `src/main.js` o `sw.js` deve incrementare `main.js?v=N` in `index.html` e bumpare `CACHE_NAME = 'asset-shell-vM'` in `sw.js` nello stesso identico commit.

### RULE-PROC-08: Salvataggio in Tempo Reale delle Righe di Dettaglio
- **Codice Regola:** `budget_row_realtime_save_rule`
- **Descrizione:** Le righe di dettaglio dichiarate dall'utente (esborsi CAPEX datati, eventi OPEX ricorrenti, voci personalizzate) devono persistere su Supabase immediatamente alla conferma della riga, senza richiedere un salvataggio separato.
