---
name: energy-bess-physics
description: Solar PV simulation (PVGIS 5.3/5.4), industrial load profiling, electro-thermal BESS modeling (LFP/NMC chemistries), Arrhenius semi-empirical aging, and charge/discharge optimization constraints.
---

# SKILL: Energy & BESS Physics Engine

Questa skill standardizza le procedure di simulazione fisica, modellazione elettro-termica dei sistemi di accumulo elettrochimico (BESS) e algoritmi di dispacciamento energetico per impianti ibridi fotovoltaico + batterie.

---

## 1. Analisi dei Tracciati Fisici e PVGIS

### A. Acquisizione e Normalizzazione Dati Solari
* **Sorgente**: Serie storiche orarie di irraggiamento solare reale da PVGIS (versione 5.3 o 5.4) per la localizzazione geografica target (es. Toscana, Italia: Latitudine, Longitudine).
* **Vettore Temporale**: Mappatura deterministica sull'anno solare **2025** (8.760 ore, da ora 1 del 1° Gennaio a ora 8.760 del 31 Dicembre).
* **Unità di Misura**: Conversione della potenza solare prodotta $P_{pv}$ da Watt (W) a kilowatt (kW):
  $$P_{pv, kW}(t) = \frac{P_{pv, W}(t)}{1.000}$$
* **Degrado Moduli FV**: Applicazione del tasso di degrado annuale delle prestazioni dei moduli FV (default: $0,5\%$ annuo progressivo):
  $$P_{pv}(y, t) = P_{pv}(1, t) \times (1 - \delta_{pv})^{y-1}$$

---

## 2. Generatore delle Curve di Carico Industriale

### A. Profilazione Oraria dei Consumi
Il profilo di carico orario dello stabilimento $L(t)$ viene generato a partire da:
1. **Consumo Annuo Totale ($E_{tot}$ in MWh)**.
2. **Profilo Lavorativo Feriale**: Turni definiti (es. ore 08:00 - 18:00, lunedì-venerdì) con assorbimento a pieno regime.
3. **Carico Base di Fondo (Base-Load)**: Frazione minima sempre attiva (es. $15\% - 25\%$ del picco) per servizi ausiliari, server, refrigerazione o illuminazione.
4. **Fine Settimana (Weekend)**: Profilo ridotto al solo carico di fondo o turnazione minima.
Normalizzazione integrale:
$$\sum_{t=1}^{8760} L(t) = E_{tot} \times 1.000 \text{ kWh}$$

---

## 3. Modellazione Elettro-Termica del BESS (3D-MILP)

### A. Parametri Fisici e Chimici (LFP vs NMC)
* **LFP (Litio-Ferro-Fosfato)**: Maggiore stabilità termica, range operativo SoC $5\% - 95\%$, efficienza round-trip $\eta_{rt} \approx 90\% - 92\%$, energia di attivazione Arrhenius $E_a \approx 25 - 35 \text{ kJ/mol}$.
* **NMC (Nichel-Manganese-Cobalto)**: Maggiore densità energetica, range operativo SoC $10\% - 90\%$, efficienza round-trip $\eta_{rt} \approx 88\% - 90\%$, energia di attivazione Arrhenius $E_a \approx 45 - 55 \text{ kJ/mol}$.

### B. Resistenza Interna e Dinamica Termica
* La resistenza interna equivalente $R_{int}(SoC, T_{cell})$ viene modellata in funzione dello Stato di Carica e della temperatura di cella (modelli Kumtepeli/TUM e Grimaldi/Polito).
* La temperatura della cella $T_{cell}(t)$ evolve secondo il bilancio termico tra calore dissipato per effetto Joule e dissipazione termica del sistema HVAC ausiliario:
  $$\Delta T_{cell}(t) = \frac{I(t)^2 \cdot R_{int}(t) \cdot \Delta t - Q_{cooling}(t)}{C_{thermal}}$$

### C. Invecchiamento Semi-Empirico (Calendar & Cycle Aging)
Lo Stato di Salute (State of Health - SoH) si calcola per ciascuna ora $t$:
1. **Degrado da Calendario ($SoH_{cal}$)**: Funzione della temperatura di cella e del SoC medio (legge di Arrhenius):
   $$\Delta SoH_{cal}(t) = A_{cal} \cdot \exp\left(-\frac{E_a}{R \cdot T_{cell}(t)}\right) \cdot f(SoC(t)) \cdot t^{0.5}$$
2. **Degrado da Ciclaggio ($SoH_{cyc}$)**: Funzione del throughput energetico cumulato, della profondità di scarica (Depth of Discharge - DoD) e del C-rate:
   $$\Delta SoH_{cyc}(t) = B_{cyc} \cdot (\text{DoD}(t))^{k_{dod}} \cdot \frac{P_{batt}(t) \cdot \Delta t}{2 \cdot C_{nom}}$$
3. **Capacità Utile Aggiornata**:
   $$C_{utile}(t) = C_{nom} \times SoH(t) = C_{nom} \times (1 - \Delta SoH_{cal}(t) - \Delta SoH_{cyc}(t))$$

---

## 4. Vincoli di Ottimizzazione e Risoluzione Conflitti

### A. Vincolo di Mutua Esclusione Carica/Scarica
La batteria non può caricare e scaricare contemporaneamente nella stessa ora/periodo $t$:
$$P_{ch}(t) \cdot P_{dis}(t) = 0, \quad \forall t$$
Implementato tramite variabile binaria $u(t) \in \{0, 1\}$:
$$0 \le P_{ch}(t) \le u(t) \cdot P_{ch, max}, \quad 0 \le P_{dis}(t) \le (1 - u(t)) \cdot P_{dis, max}$$

### B. Priorità Assoluta: Salvaguardia Termica vs Arbitraggio
* **Regola di Sicurezza**: Se il tasso annuo di degrado del SoH eccede il **$3,5\%$ annuo** o se la temperatura di cella supera stabilmente i **$35^\circ\text{C}$**:
  - L'algoritmo di ottimizzazione deve **ridurre o bloccare i cicli di carica/scarica forzata** per arbitraggio di prezzo.
  - La salvaguardia della vita utile dell'asset (Replacement Capex prevention) prevale sempre sui marginali ricavi orari da differenziale PUN.
