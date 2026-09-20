---
name: excel-native-audit
description: ExcelJS financial model generation, acyclic formula graph validation (DAG), circular reference elimination, and dual-layer reconciliation (Worker/UI vs Excel formula results).
---

# SKILL: Excel Native Financial Audit & Generation

Questa skill definisce gli standard per la generazione, validazione formale e audit dei fogli di calcolo Excel complessi esportati dal simulatore tramite la libreria `ExcelJS`.

---

## 1. Standard di Generazione Formule con ExcelJS

### A. Sintassi Formule e Naming Convention
* **Nomi Funzioni in Inglese Maiuscolo**: Utilizzare esclusivamente funzioni Excel native in lingua inglese:
  - `SUM`, `AVERAGE`, `MAX`, `MIN`, `IF`, `AND`, `OR`, `NPV`, `IRR`, `PMT`, `PPMT`, `IPMT`.
* **Separatori di Argomenti**: Nelle definizioni di formule per ExcelJS utilizzare la virgola `,` come separatore standard (es. `IF(B5>0, B5*0.22, 0)`), lasciando a Excel la localizzazione automatica in base alla lingua dell'utente.
* **Parentesi e Priorità Operatori**: Raggruppare sempre esplicitamente i sotto-calcoli per evitare ambiguità di precedenza:
  - Corretto: `(B10 + B11) * (1 + $B$2)`
  - Sconsigliato: `B10 + B11 * 1 + $B$2`

### B. Oggetto Valore a Doppio Livello (Formula + Risultato Precalcolato)
Per evitare che Excel mostri celle vuote, errori `#VALUE!` o richieda un ricalcolo manuale forzato all'apertura, ogni cella formula **DEVE** essere popolata con l'oggetto a doppio livello:
```javascript
cell.value = {
  formula: `SUM(B${row}:M${row})`,
  result: Number(precomputedAnnualSum.toFixed(2))
};
```
Il valore `result` precalcolato **deve coincidere deterministicamente** (tolleranza $< 0,01 \text{ \euro}$) con il valore generato dal Web Worker per la Dashboard UI.

---

## 2. Validazione Aciclica delle Dipendenze (DAG)

### A. Prevenzione Formule Circolari
Una formula circolare (es. Cella $A$ dipende da $B$, che a sua volta dipende da $A$) blocca il motore di ricalcolo di Excel o genera risultati divergenti.
* **Regola del Lag Temporale**: Nei modelli finanziari ricorsivi (es. Cassa Iniziale mese $m$ = Cassa Finale mese $m-1$), il riferimento deve essere rigidamente orientato all'indietro:
  - Cassa Iniziale Mese $m$: `=N{row_prev}`
  - Cassa Finale Mese $m$: `=B{row_init} + B{row_entrate} - B{row_uscite}`
* Nessuna formula di riga riassuntiva (es. Totale Anno in colonna `N`) può essere referenziata all'interno delle colonne mensili (`B` - `M`) dello stesso anno.

### B. Grafo Orientato Diretto (DAG)
Prima di confermare modifiche alla pipeline di export Excel (`excel_export.js`), il supervisore [`adversarial_auditor`](file:///home/ubuntu/Asset/.agents/agents/adversarial_auditor/agent.md) deve verificare che le relazioni tra fogli:
$$\text{P&L} \longrightarrow \text{Cash Flow} \longrightarrow \text{Stato Patrimoniale}$$
non contengano archi bidirezionali o cicli chiusi non risolti.

---

## 3. Checklist di Riconciliazione (Dashboard UI vs Excel)

| Metrica | Foglio Excel | Dashboard Web / Worker | Tolleranza Ammessa |
| :--- | :--- | :--- | :--- |
| **EBITDA Anno 1** | P&L Colonna Totale | Card KPI Dashboard | $\pm 1,00 \text{ \euro}$ |
| **Credito IVA Finale Mese 12** | Cash Flow Cella M12 | Tabella Cash Flow UI | $\pm 0,05 \text{ \euro}$ |
| **Cassa Finale con Funding** | Cash Flow Cella M15 | Grafico Cash Flow UI | $\pm 1,00 \text{ \euro}$ |
| **Debito Residuo Anno 1** | Servizio Debito | Sezione Struttura Capitale | $\pm 1,00 \text{ \euro}$ |
| **Project IRR (Unlevered)** | Foglio Metriche / Formula `IRR()` | Card IRR Dashboard | $\pm 0,05\%$ |
| **Equity IRR (Levered)** | Foglio Metriche / Formula `IRR()` | Card Equity IRR Dashboard | $\pm 0,05\%$ |

Se viene riscontrata una discrepanza superiore alla tolleranza, la build dell'export viene respinta con allarme di regressione.
