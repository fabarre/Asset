---
name: tax-corporate-accounting
description: Italian corporate taxation (IRES, IRAP), TUIR compliance (Art. 84, 96, 102), DPR 633/72 VAT management (Modello TR reimbursement, F24 horizontal compensation, annual declaration), and VAT cash flow conservation.
---

# SKILL: Tax & Corporate Accounting Engine (Italy)

Questa skill definisce gli standard contabili e fiscali italiani applicabili alla Società di Progetto (SPV) e alla Holding per impianti ibridi Fotovoltaico + BESS.

---

## 1. Gestione IVA (DPR 633/72) e Conservazione della Cassa

### A. Principio di Conservazione dell'IVA
L'IVA è una partita di giro finanziaria: non influenza il Conto Economico (P&L) né l'IRR dell'asset, ma impatta direttamente la dinamica della liquidità mensile nel Cash Flow.
Ogni mese $m$:
$$\text{IVA a Credito Maturata}_m = \sum (\text{CAPEX}_m \times \tau_{vat}) + \sum (\text{OPEX}_m \times \tau_{vat})$$
$$\text{IVA a Debito Maturata}_m = \sum (\text{Ricavi Incassati}_m \times \tau_{vat})$$
$$\text{Saldo IVA Netto di Periodo}_m = \text{IVA a Credito Maturata}_m - \text{IVA a Debito Maturata}_m$$

Il credito IVA cumulato alla fine del mese $m$ rispetta rigidamente l'equazione di conservazione:
$$\text{Credito IVA Finale}_m = \text{Credito IVA Iniziale}_m + \text{Saldo IVA Netto}_m - \text{IVA Liquidata/Compensata}_m$$

> [!CAUTION]
> **Divieto di Azzeramento Ingiustificato**: Se $\text{Credito IVA Finale}$ viene ridotto o azzerato nel mese $m$, l'importo decurtato **DEVE**:
> 1. Confluire integralmente nelle entrate di cassa come rimborso ricevuto ($\text{Cassa con Funding} \mathrel{+}= \text{Rimborso IVA}$), OPPURE
> 2. Essere utilizzato in compensazione orizzontale F24 a copertura di debiti tributari/previdenziali effettivi.

### B. Le 3 Modalità di Liquidazione IVA
L'utente può selezionare tre modalità operative per il recupero del credito IVA:

1. **Liquidazione Trimestrale (Modello TR)**:
   - Istanza presentata all'Agenzia delle Entrate alla fine di ogni trimestre (Q1: 30 Aprile, Q2: 31 Luglio, Q3: 31 Ottobre).
   - **Timing di Cassa**: Il rimborso effettivo sul conto corrente della SPV viene accreditato con un ritardo fisiologico (default: 2 mesi dopo l'istanza, es. Q1 incassato a Giugno, Q2 a Settembre, Q3 a Dicembre, Q4 tramite dichiarazione annuale a primavera).
   - Nel mese di incasso, il credito IVA si riduce esattamente della somma incassata, che entra come flusso positivo nel Cash Flow.

2. **Dichiarazione Annuale IVA**:
   - Presentazione annuale (febbraio/aprile dell'anno $t+1$).
   - Erogazione del rimborso da parte dell'Erario tipicamente entro il secondo semestre dell'anno successivo.
   - Il credito IVA rimane parcheggiato a bilancio fino all'effettivo accredito bancario.

3. **Compensazione Orizzontale F24**:
   - Utilizzo del credito IVA per compensare altri tributi (es. IRES, IRAP, contributi dipendenti/amministratori, IMU ove consentito).
   - Limite legale annuale di compensazione (attualmente 2.000.000 €/anno con visto di conformità per importi > 5.000 €).
   - La compensazione abbatte le uscite di cassa per imposte dello stesso mese, riducendo di pari passo il credito IVA residuo.

---

## 2. Fiscalità d'Impresa: IRES e IRAP (TUIR)

### A. Ammortamenti Fiscali Impianto (Art. 102 TUIR)
I coefficienti di ammortamento ordinario (D.M. 31/12/1988) da applicare al costo storico netto di realizzo:
* **Impianto Fotovoltaico**: $9\%$ annuo (durata fiscale 11,1 anni).
* **Sistema di Accumulo (BESS)**: $15\%$ annuo (durata fiscale 6,7 anni).
* **Opere Civili / Terreno**: Terreno non ammortizzabile ($0\%$), Opere civili al $4\%$.

Regola del primo esercizio: se l'impianto entra in esercizio in corso d'anno, la quota di ammortamento è rapportata ai mesi effettivi di funzionamento post-COD (oppure ridotta al $50\%$ secondo la prassi civilistica/fiscale ordinaria).

### B. Deducibilità Interessi Passivi (Art. 96 TUIR)
Gli interessi passivi bancari sono deducibili:
1. Fino a concorrenza degli interessi attivi maturati nel periodo.
2. L'eccedenza è deducibile nel limite del **$30\%$ del ROL fiscale** (Reddito Operativo Lordo = Valore della produzione - Costi della produzione, al netto di ammortamenti e canoni di leasing).
3. La quota di interessi passivi indeducibile nel periodo è riportabile a nuovo senza limiti di tempo negli esercizi successivi.

### C. Riporto delle Perdite Fiscali (Art. 84 TUIR)
* Le perdite IRES maturate nei primi 3 anni di attività (start-up) possono essere computate in diminuzione del reddito dei periodi successivi per l'intero importo ($100\%$).
* Le perdite a regime sono deducibili fino all'**$80\%$ del reddito imponibile** di ciascun esercizio successivo, garantendo una tassazione minima sul residuo $20\%$.

### D. Aliquote d'Imposta
* **IRES**: $24,0\%$.
* **IRAP**: $3,9\%$ ordinaria (modulabile su base regionale, es. $4,82\%$ o aliquote specifiche regionali). Base imponibile IRAP = Valore della produzione (A) - Costi della produzione (B) con esclusione di costo del lavoro, oneri finanziari e perdite su crediti.

---

## 3. Regole di Verifica Contabile (Audit Checklist)
Ogni agente deve verificare:
1. `Cassa Finale == Cassa Iniziale + Entrate - Uscite + Rimborsi IVA` (nessun disavanzo di bilancio).
2. Se `Credito IVA Finale == 0` a fine anno, verificare che l'importo sia transitato nelle entrate del Cash Flow o abbia compensato debiti d'imposta.
3. Nessuna aliquota IVA negativa o superiore al $22\%$.
