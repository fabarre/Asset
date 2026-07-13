---
name: financial-modeling
description: Profitability analysis (IRR, NPV, LCOE/LCOS), GME imbalance cost modeling, Supabase DDL database design, and project finance due diligence.
trigger: when_developing_model
---

# SKILL: Financial Modeling & Quantitative M&A Valuation

Questa skill raccoglie le formule e le linee guida per la modellazione economico-finanziaria, la strutturazione del debito e la contabilità del progetto ibrido.

## 1. Indicatori di Sostenibilità Finanziaria (Due Diligence M&A)
- **Struttura del Capitale:** Calcolare il fabbisogno finanziario e strutturare la combinazione ottimale tra debito (Senior Debt) ed Equity (finanziamento soci e capitale sociale).
  - Parametri chiave: LTV (Loan-to-Value) target, DSCR (Debt Service Coverage Ratio) target minimo, LLCR (Loan Life Coverage Ratio).
  - Ammortamento debito a tasso fisso con periodo di preammortamento (grazia capitale) di 6-12 mesi.
- **Rendimenti Strategici:**
- **Project IRR (Unlevered):** Rendimento intrinseco dell'asset senza l'effetto della leva finanziaria.
  - **Equity IRR (Levered):** Rendimento effettivo per gli azionisti (HoldCo) al netto del servizio del debito bancario e fiscale.
  - **Accantonamento Riserva Sostituzione (BESS Replacement):** Calcolare la riserva annua non deducibile per coprire il costo straordinario di ripristino delle celle (Battery Augmentation) previsto intorno all'anno 10-12, in base alle curve di degrado SoH simulate dall'ingegnere energetico.
  - **Cash Sweep e Blocco Dividendi:** Modellazione della "coda del debito". Durante il periodo di rimborso del debito bancario, l'eventuale abilitazione del *Cash Sweep* prevede che tutto il CFADS residuo, al netto del normale servizio del debito, venga utilizzato per il prepagamento del capitale. Questo blocca la distribuzione dei dividendi alla SPV. Tali dividendi tornano disponibili per la Holding solo alla data di estinzione anticipata del debito (Exit).
  - **Flussi Intra-Gruppo (SPV vs Holding):** Separazione rigorosa tra la contabilità della SPV (società di progetto) e quella della Holding (società madre). Ad esempio, la voce "Gestione Amministrativa & Asset Mgt" è una voce di costo (OPEX) in uscita per la SPV, ma si traduce in un flusso di cassa positivo (ricavo intra-gruppo) per la Holding.

## 2. Calcoli Quantitativi di Redditività
- **Valutazione Netta:** Calcolare flussi di cassa orari e annuali, Net Present Value (NPV), Profitability Index (PI), Levelized Cost of Energy (LCOE) e Levelized Cost of Storage (LCOS).
  - Formula per LCOE depurato:
    $$LCOE = \frac{\sum_{t=0}^{N} \frac{CAPEX_t + OPEX_t}{(1 + WACC)^t}}{\sum_{t=1}^{N} \frac{Energy_t}{(1 + WACC)^t}}$$
- **Modellazione dei Costi di Sbilanciamento (Imbalance Cost):**
  - Calcolare la penalità oraria applicata dal GME sulle deviazioni tra l'energia effettivamente immessa in rete $E_{actual}(t)$ e quella precedentemente dichiarata/nominata sul mercato $E_{declared}(t)$:
    $$\text{Imbalance Penalty}(t) = \text{Price}_{penalty}(t) \cdot |E_{declared}(t) - E_{actual}(t)|$$
- **Allineamento Prezzi PUN:** Calcolo del prezzo orario medio ponderato per l'energia solare e arbitraggio BESS basato sui tracciati storici del PUN zona Centro Nord.

## 3. Database Architecture (Supabase / PostgreSQL)
- **Strutturazione DDL:** Progettazione dello schema relazionale per archiviare i dati di simulazione e la telemetria oraria (8760 righe per anno).
- **Ottimizzazione Tipi di Dato:** Per garantire la massima accuratezza contabile ed evitare errori di arrotondamento da virgola mobile (floating-point issues), utilizzare sempre tipi di dato `DECIMAL(12,4)` o `NUMERIC` per variabili finanziarie e flussi di potenza.
- **Performance Query:** Creazione di indici composti su `(simulation_id, year, hour)` per velocizzare il caricamento e l'aggregazione dei dati storici nel dashboard.
