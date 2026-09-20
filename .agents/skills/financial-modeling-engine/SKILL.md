---
name: financial-modeling-engine
description: Project finance modeling, debt structuring (sculpted/French amortization, preamortization Act/360, IDC), DSCR/LLCR/DSRA covenants, Unlevered/Levered IRR, cash sweep mechanics, and SPV vs HoldCo waterfall.
---

# SKILL: Financial Modeling & Project Finance Engine

Questa skill definisce le metodologie quantitative di modellazione finanziaria, strutturazione del debito e calcolo della redditività per impianti fotovoltaici e sistemi BESS in Project Finance.

---

## 1. Struttura del Capitale e Servizio del Debito

### A. Fabbisogno Finanziario e Fonti di Finanziamento
Il fabbisogno complessivo comprende:
$$\text{Fabbisogno Totale} = \text{CAPEX Totale} + \text{Interessi in Costruzione (IDC)} + \text{Spese Finanziamento Upfront} + \text{Dotazione Iniziale DSRA}$$
Ripartizione tra le fonti:
* **Senior Debt (Debito Bancario)**: $\text{Debito} = \text{Fabbisogno Totale} \times \text{LTV}$
* **Equity / Finanziamento Soci**: $\text{Equity} = \text{Fabbisogno Totale} \times (1 - \text{LTV})$

### B. Piano di Ammortamento del Debito
1. **Periodo di Preammortamento (Interest-Only)**:
   - Durata: da 3 a 12 mesi pre-COD o a cavallo del COD.
   - Si corrispondono unicamente gli interessi sul capitale erogato:
     $$I_{pre} = D_{erogato} \times r_{tasso} \times \frac{\text{Giorni Effettivi}}{360}$$
   - Nessun rimborso di quota capitale in questa fase.
2. **Ammortamento a Rata Costante (Metodo Francese)**:
   - Rata periodica:
     $$R = D_0 \times \frac{i \cdot (1 + i)^N}{(1 + i)^N - 1}$$
   - Scomposizione periodica:
     $$I_t = D_{t-1} \times i \times \frac{\text{Giorni}}{360}, \quad C_t = R - I_t, \quad D_t = D_{t-1} - C_t$$
3. **Ammortamento a Quota Capitale Costante (Metodo Italiano)**:
   - Quota capitale: $C_t = \frac{D_0}{N}$
   - Quota interessi decrescente: $I_t = D_{t-1} \times i \times \frac{\text{Giorni}}{360}$

---

## 2. Indici Bancari di Bancabilità (Covenants)

### A. DSCR (Debt Service Coverage Ratio)
Misura la capacità del flusso di cassa operativo di coprire il servizio del debito di periodo:
$$\text{DSCR}_t = \frac{\text{CFADS}_t}{\text{Quota Capitale}_t + \text{Quota Interessi}_t}$$
dove:
$$\text{CFADS}_t = \text{EBITDA}_t - \text{Imposte Correnti}_t \pm \Delta \text{CCN}_t$$
* **DSCR Minimo Contrattuale**: Tipicamente compreso tra $1,15\times$ e $1,30\times$.
* Se $\text{DSCR}_t < \text{DSCR Target}$, scatta il blocco temporaneo della distribuzione dei dividendi.

### B. LLCR (Loan Life Coverage Ratio)
Valuta la copertura complessiva lungo l'intera vita residua del finanziamento:
$$\text{LLCR}_t = \frac{\sum_{s=t}^{T_{debt}} \frac{\text{CFADS}_s}{(1 + WACC_{debt})^{s-t}} + \text{DSRA}_t}{D_t}$$

### C. DSRA (Debt Service Reserve Account)
Riserva vincolata a garanzia delle banche, dimensionata su:
$$\text{DSRA Target} = \text{Servizio del Debito dei successivi 6 mesi} = (C_{t+1} + I_{t+1}) + (C_{t+2} + I_{t+2})$$
L'alimentazione della riserva avviene a monte della distribuzione dei dividendi alla Holding.

---

## 3. Calcolo dei Rendimenti: Project IRR vs Equity IRR

### A. Project IRR (Unlevered)
Rendimento intrinseco del progetto, indipendente dalla struttura finanziaria:
* **Flusso Iniziale ($t=0$)**: $-\text{CAPEX Totale}$
* **Flussi di Cassa ($t \ge 1$)**: $\text{FCFF}_t = \text{EBITDA}_t - \text{Imposte Senza Debito}_t - \text{CAPEX Manutenzione Straordinaria}_t \pm \Delta \text{CCN}_t$
* Risoluzione dell'IRR:
  $$\sum_{t=0}^{T} \frac{\text{FCFF}_t}{(1 + \text{Project IRR})^t} = 0$$

### B. Equity IRR (Levered)
Rendimento per gli azionisti (Holding), calcolato sui flussi effettivamente immessi e distribuiti:
* **Flusso Iniziale ($t=0$)**: $-(\text{Equity Iniziale} + \text{Finanziamento Soci})$
* **Flussi di Cassa ($t \ge 1$)**: Dividendi distribuiti + Rimborso Finanziamento Soci + Interessi su Finanziamento Soci
* Condizione di distribuzione dividendi:
  $$\text{Dividendi Distribuiti}_t = \max(0, \text{Cassa Finale}_t - \text{Cassa Minima Operativa} - \text{Accantonamento DSRA})$$
* **Regola del Cash Sweep**: Se attivo il meccanismo di Cash Sweep per anticipare l'estinzione del debito bancario, il $100\%$ della cassa eccedente il normale servizio del debito viene impiegato per rimborsare anticipatamente il debito bancario, bloccando i dividendi alla Holding fino alla totale estinzione della linea di credito.

---

## 4. Separazione dei Flussi Intra-Gruppo (SPV vs HoldCo)

I bilanci e i conti economici tra SPV e Holding devono essere rigidamente separati:
* **Conto Gestione Amministrativa & Asset Management**:
  - Per la SPV: Voce di costo (OPEX in uscita).
  - Per la HoldCo: Voce di ricavo imponibile (flusso di cassa in entrata).
* **Dividendi e Rimborso Finanziamento Soci**:
  - Per la SPV: Uscita finanziaria da utile distribuibile (post-imposte).
  - Per la HoldCo: Entrata finanziaria (dividendi esenti al $95\%$ ex Art. 89 TUIR, rimborso quota capitale finanziamento soci esente da imposte).
