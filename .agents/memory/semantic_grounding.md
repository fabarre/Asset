# Grounding Semantico di Dominio: Regole Fisiche, Fiscali e Finanziarie

Questo documento costituisce la **sorgente di verità primaria (Ground Truth)** del simulatore ibrido Fotovoltaico + BESS.
Tutti i subagenti (Fisico, Fiscale, Finanziario, Sviluppatore e Auditor) devono allinearsi rigorosamente a queste definizioni matematiche e normative per azzerare le allucinazioni.

---

## 1. Diritto Tributario e Contabilità SPV (Italia)

### A. Regime IVA (DPR 633/1972)
1. **Natura dell'IVA:** L'IVA è un tributo finanziario a "partita di giro" (*pass-through*). Non costituisce né ricavo né costo d'esercizio nel Conto Economico (P&L), né altera l'IRR di progetto/equity. Ha impatto unicamente sul Cash Flow mensile.
2. **IVA sui Ricavi (a Debito):**
   - **Ritiro Dedicato (RID GSE):** Regime di *reverse charge* ex Art. 17 c. 6 lett. a-quinquies DPR 633/72. L'IVA è assolta dal GSE. La SPV emette fattura senza rivalsa IVA $\rightarrow$ Aliquota a debito **0%**.
   - **PPA On-Site (Cessione a Cliente Industriale Finale):** Cessione con applicazione dell'aliquota ordinaria per usi industriali $\rightarrow$ Aliquota di default **10%** con rivalsa.
   - **Operazioni di Mercato via BRP (Arbitraggio / Time-Shifting):** Operazioni all'ingrosso su borsa elettrica/controparte all'ingrosso in *reverse charge* $\rightarrow$ Aliquota a debito **0%**.
   - **Corrispettivi CER (Incentivo GSE + PPA Virtuale CER):** Soggetti ad aliquota ordinaria $\rightarrow$ **22%**.
   - **Tariffa FER X:** Cessione sul mercato con liquidazione a due vie $\rightarrow$ Aliquota di default **0%** (*reverse charge*).
3. **IVA sugli Esborsi CAPEX e OPEX (a Credito):**
   - **EPC Fotovoltaico:** Aliquota agevolata **10%** ex Tab. A parte III n. 127-quinquies DPR 633/72.
   - **EPC BESS, Connessione di Rete, Spese di Sviluppo, Sicurezza, Asset Management:** Aliquota ordinaria **22%**.
   - **Acquisizione Quote SPV:** Esente da IVA ex Art. 10 c. 1 n. 4 DPR 633/72 $\rightarrow$ **0%**.
   - **Terreno:** Cessione o diritto di superficie su terreni agricoli/non edificabili $\rightarrow$ Tipicamente esente da IVA ex Art. 10 c. 1 n. 8 DPR 633/72 $\rightarrow$ **0%**.
   - **Assicurazione:** Esente da IVA ex Art. 10 c. 1 n. 2 DPR 633/72 $\rightarrow$ **0%**.
   - **IMU e Imposte Locali:** Fuori campo IVA ex Art. 2 e 3 DPR 633/72 $\rightarrow$ **0%**.
   - **Voci Personalizzate:** Aliquota specifica definita per riga (`plant_custom_costs.vat_rate`), con fallback al 22% se non valorizzata.
4. **Liquidazione Periodica e Modello IVA TR (Art. 38-bis DPR 633/72):**
   - L'eccedenza detraibile trimestrale superiore a **€ 2.582,28** può essere:
     a) Compensata in F24 contro altre imposte e contributi (IRES, IRAP, ritenute).
     b) Chiesto a rimborso trimestrale tramite Modello IVA TR.
   - **Invariante di Conservazione Patrimoniale:** Il credito IVA verso l'Erario rimane iscritto tra le attività dello Stato Patrimoniale per tutto il tempo di attesa (*lag*). Si estingue nel Cash Flow **solo quando il bonifico viene effettivamente incassato** o quando avviene la compensazione F24:
     $$\text{Credito IVA}_t = \text{Credito IVA}_{t-1} + \text{IVA a Credito}_t - \text{IVA a Debito}_t - \text{IVA Versata}_t - \text{IVA Rimborsata}_t - \text{IVA Compensata F24}_t$$
     $$\text{IVA Cash Flow}_t = \text{IVA a Debito}_t - \text{IVA a Credito}_t - \text{IVA Versata}_t + \text{IVA Rimborsata}_t$$

### B. Ammortamento Fiscale e Civilistico (OIC 16 / Art. 102 TUIR)
1. **Decorrenza Ammortamento:** Gli ammortamenti civilistici e fiscali decorrono **dal momento della messa in funzione dell'asset (COD)**. Durante l'Anno 0 (fase di costruzione pre-COD), la quota di ammortamento è pari a **0 €**.
2. **Interessi Capitalizzati (IDC - Interest During Construction):**
   - Gli interessi passivi maturati sul debito prima del COD sono oneri accessori di fabbricazione capitalizzati nel costo dell'impianto (OIC 16 e Art. 110 c. 1 lett. b TUIR).
   - Incrementano la base ammortizzabile complessiva del cespite e non transitano nel P&L dell'Anno 0.
3. **Aliquota Fiscale Impianti Fotovoltaici (Art. 102 TUIR / Circolare 36/E/2013):**
   - Impianti accatastati come immobili (D/1 o D/10): aliquota ordinaria **9%** annuo (coefficiente ministeriale D.M. 31/12/1988).
   - Nel primo esercizio post-COD, l'aliquota ordinaria è ridotta alla metà (4,5%) ex Art. 102 c. 2 TUIR se non diversamente specificato.
4. **Deducibilità Interessi Passivi (Art. 96 TUIR):**
   - Gli interessi passivi netti sono deducibili nel limite del 30% del ROL (Reddito Operativo Lordo) fiscale della SPV.
   - L'eccedenza di ROL è riportabile agli esercizi successivi senza limiti temporali.
   - L'eccedenza di interessi passivi indeducibili è riportabile e deducibile in presenza di capienza ROL futura.
5. **Riporto delle Perdite Fiscali (Art. 84 TUIR):**
   - **Primi 3 Anni di Imposta (Art. 84 c. 2):** Le perdite generate nei primi tre periodi di imposta dalla costituzione sono computate in diminuzione del reddito complessivo dei periodi successivi **senza limiti di importo (100%)**.
   - **Anni Successivi (Art. 84 c. 1):** Le perdite sono computabili in diminuzione nella misura dell'**80%** del reddito di ciascun periodo, preservando una tassazione minima sul 20% della base imponibile.

---

## 2. Project Finance e Modellazione Bancaria

### A. Servizio del Debito Senior Datato
1. **Decorrenza:** Il servizio del debito (interessi + quota capitale) decorre dalla data di erogazione/messa a disposizione oppure dal COD (a seconda delle condizioni contrattuali pattuite con il pool bancario).
2. **Preammortamento (Senior Grace Period):**
   - Durante il preammortamento, la rata è composta **esclusivamente da quota interessi**; la quota capitale è pari a **0 €**.
   - Calcolo pro-rata temporis convenzione **Act/360**:
     $$\text{Interessi}_m = \text{Debito Residuo} \times \text{Tasso Annuo} \times \frac{\text{Giorni del Mese}}{360}$$
3. **Ammortamento Francese Post-Grazia:**
   - La rata periodica costante $A$ su $N$ periodi residui è:
     $$A = P \times \frac{i_m \times (1 + i_m)^{N}}{(1 + i_m)^{N} - 1}$$
   - In ciascun periodo, la quota capitale è:
     $$\text{Quota Capitale}_p = \min(P, \max(0, A - \text{Quota Interessi}_p))$$
4. **DSRA (Debt Service Reserve Account):**
   - Riserva a garanzia del debito pari a 6 mesi di servizio debito senior (interessi + quota capitale).
   - Viene finanziata al COD (tramite cassa o funding dedicato) e rilasciata integralmente al termine del rimborso del finanziamento bancario.

### B. Indicatori di Bancabilità e Copertura
1. **DSCR (Debt Service Coverage Ratio):**
   $$\text{DSCR}_t = \frac{\text{CFADS}_t}{\text{Servizio Debito Senior}_t}$$
   - Soglia minima bancabile per fotovoltaico + BESS: $\text{DSCR} \ge 1.15x - 1.25x$.
2. **LLCR (Loan Life Coverage Ratio):**
   $$\text{LLCR}_t = \frac{\text{NPV}_{\text{WACC}}(\text{CFADS}_{t \dots T}) + \text{DSRA}_t}{\text{Debito Residuo}_t}$$

---

## 3. Fisica del Fotovoltaico e Storage Elettrochimico (BESS)

1. **Risoluzione Temporale:**
   - Supporto nativo a risoluzione oraria (8.760 ore/anno) e quart'oraria (35.040 quarti/anno ex delibere ARERA TIDE 2026).
2. **Vincoli Termici e Degradazione BESS (Conflict Resolution):**
   - Il degrado delle celle al litio (NMC/LFP) segue il modello empirico di Arrhenius:
     $$k_{\text{deg}} = A \times \exp\left(-\frac{E_a}{R \cdot T_{\text{cell}}}\right) \times (\text{C-rate})^{\alpha}$$
   - **Regola Assoluta di Risoluzione Conflitti:** Se il tasso di decadimento dello State of Health (SoH) supera il **3,5% annuo** o la temperatura media di cella supera costantemente i **35°C**, l'algoritmo di ottimizzazione deve tagliare o rimodulare i cicli di carica/scarica, anteponendo la vita utile della batteria all'arbitraggio di borsa.
3. **Perdite Convenzionali di Rete:**
   - Allacciamento Media Tensione (MT): $+2,3\%$
   - Allacciamento Bassa Tensione (BT): $+5,2\%$

