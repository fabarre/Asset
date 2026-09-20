---
name: cer-regulatory-framework
description: Italian CACER regulatory framework (ARERA Delibera 727/2022 TIAD, Delibera 268/2025 TIDE 15-min settlement, MASE premium tariffs), PNRR 2026 40% capital grants, and SPV vs CER cash flow isolation.
---

# SKILL: CER & CACER Regulatory Framework (Italy 2026)

Questa skill formalizza le regole tecniche, normative e tariffarie per le Comunità Energetiche Rinnovabili (CER) e i gruppi di Autoconsumo Diffuso (CACER) in Italia secondo il quadro regolatorio 2026.

---

## 1. Architettura Temporale a Risoluzione Duale

### A. Settlement Quart'orario (Default TIDE 2026)
* **Quadro Regolatorio**: Riforma del settlement TIDE (Delibere ARERA 268/2025/R/eel e 270/2025/R/eel).
* **Intervallo di Settlement (ISP)**: 15 minuti ($t \in [1, 96]$ giornalieri, 35.040 periodi/anno).
* **Calcolo Energia Condivisa ($E_{cond, t}$)**: Minimo, rilevato a livello di Cabina Primaria per ciascun quarto d'ora, tra la somma delle immissioni orarie dei produttori e la somma dei prelievi dei consumatori:
  $$E_{cond, t} = \min\left(\sum_{i} E_{imm, i, t}, \sum_{j} E_{prel, j, t}\right)$$

### B. Risoluzione Oraria (Fallback di Simulazione)
* Da utilizzare quando i dati di input sono storici (TMY, PVGIS orario) o in Business Plan semplificati ($h \in [1, 8760]$).
* > [!WARNING]
  > **Gap di Sovrastima**: Il calcolo su base oraria compensa gli sbilanciamenti interni all'ora e **sovrastima l'energia condivisa reale di circa il $3\% - 7\%$** rispetto al calcolo quart'orario TIDE. Gli agenti devono evidenziare questo scostamento nei report.

---

## 2. Formule Tariffarie e Valorizzazione Economica

### A. Ritiro Dedicato (RID) per Impianto Terzo Produttore
L'energia immessa netta misurata al contatore ($E_{mis}$) viene valorizzata in capo alla SPV proprietaria con maggiorazione convenzionale per le perdite di rete evitate (Tabella 9 TIV):
* **Media Tensione (MT)**: $+2,3\%$ (Moltiplicatore $1,023$)
* **Bassa Tensione (BT)**: $+5,2\%$ (Moltiplicatore $1,052$)
Formula oraria/quart'oraria:
$$R_{RID}(t) = E_{mis}(t) \times (1 + k_{perdite}) \times P_{z}(t)$$

### B. Corrispettivo di Valorizzazione ARERA (TIAD)
Liquidato dal GSE sul conto della **CER (Soggetto Giuridico)** per i corrispettivi di rete evitati sull'energia condivisa:
$$CACV(t) = TRAS + (cPR \times P_{z}(t))$$
* $TRAS$: Quota fissa di trasmissione ($8,4 \text{ \euro/MWh} = 0,0084 \text{ \euro/kWh}$).
* $cPR$: Coefficiente di perdita evitato (MT = $1,2\%$, BT = $2,6\%$).
* $P_{z}(t)$: Prezzo zonale dell'energia nell'ora/quarto d'ora.
Ricavo complessivo TIAD:
$$\text{Ricavo}_{TIAD} = \sum_{t} \left[ E_{cond}(t) \times \left( TRAS + cPR \cdot P_{z}(t) \right) \right]$$

### C. Tariffa Premio MASE (Incentivo CACER)
Liquidato dal GSE alla CER per 20 anni sull'energia condivisa:
$$TIP(t) = \text{Quota Fissa} + \text{Quota Variabile}(P_{z}(t)) + \text{Correzione Geografica}$$
* **Tetti Massimi di Tariffa**:
  - Impianti $\le 20 \text{ kW}$: Max $150 \text{ \euro/MWh}$
  - Impianti $> 20 \text{ kW}$ e $\le 200 \text{ kW}$: Max $140 \text{ \euro/MWh}$
  - Impianti $> 200 \text{ kW}$ e $\le 1 \text{ MW}$: Max $130 \text{ \euro/MWh}$
* **Fattore Correttivo Geografico**:
  - Regioni del Nord (es. Lombardia, Piemonte, Veneto): $+10 \text{ \euro/MWh}$
  - Regioni del Centro (es. Toscana, Lazio, Marche): $+4 \text{ \euro/MWh}$
  - Regioni del Sud / Isole: $+0 \text{ \euro/MWh}$

---

## 3. Agevolazioni PNRR (Facility 2026) e Separazione dei Flussi

### A. Vincoli PNRR per Comuni sotto i 50.000 Abitanti
* **Contributo in Conto Capitale**: Fino al **$40\%$ delle spese ammissibili**.
* **Decurtazione Tariffa MASE**: Se si beneficia del $40\%$ PNRR, la tariffa premio MASE subisce una riduzione automatica tramite il fattore $F$.
* **Scadenze Perentorie 2026**:
  - Stipula accordo di concessione con GSE entro il **30 Giugno 2026**.
  - Entrata in esercizio (COD) entro 24 mesi dall'accordo e **non oltre il 31 Dicembre 2027**.

### B. Separazione Rigida dei Flussi Finanziari
* **Flussi SPV (Società di Progetto proprietaria dell'impianto)**:
  - Incasso del RID per l'intera energia immessa.
  - Ricavi da vendita su mercato libero (PPA).
  - Gestione del debito bancario e del P&L dell'impianto.
* **Flussi CER (Soggetto Giuridico Comunità Energetica)**:
  - Incasso della tariffa premio MASE e del corrispettivo TIAD.
  - Distribuzione interna dei benefici economici secondo lo statuto/regolamento interno della CER (es. quota riservata a consumatori deboli, spese di gestione CER, retrocessione parziale ai produttori).
