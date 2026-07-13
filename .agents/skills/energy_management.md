---
name: energy-management
description: Procedure for solar PV simulation, industrial load curves, electro-thermal BESS modeling, LFP/NMC aging, and optimization algorithms.
trigger: when_developing_model
---

# SKILL: Energy Management, BESS Modeling & Optimization

Questa skill descrive le procedure e i parametri per l'implementazione dei modelli fisici ed energetici del simulatore ibrido fotovoltaico + BESS.

## 1. Analisi dei Tracciati Fisici e PVGIS
- **Input:** Serie storiche di radiazione solare reale da PVGIS (versione 5.3 o 5.4) per la localizzazione geografica target (es: Toscana, Latitudine, Longitudine).
- **Elaborazione:**
  - Mappare temporalmente i dati orari sull'intero anno **2025** (8760 ore).
  - Effettuare la conversione del vettore di potenza solare generata $P_{pv}$ da Watt (W) a kilowatt (kW).

## 2. Generatore delle Curve di Carico Industriale
- **Modellazione:** Definire matematicamente il profilo orario di consumo elettrico industriale dello stabilimento $L(t)$ combinando:
  - Consumo energetico annuo complessivo espresso in MWh.
  - Profilo lavorativo feriale con turni definiti (es. ore 8:00 - 18:00).
  - Carico base di fondo (base-load) sempre attivo.
  - Profilo ridotto o nullo per i fine settimana (weekend).

## 3. Modellazione Elettro-Termica del BESS (3D-MILP)
- **Fisica della Batteria NMC/LFP:**
  - Calcolare dinamicamente la resistenza interna equivalente basata sullo Stato di Carica (SoC), la temperatura di cella e la degradazione fisica del pacco.
  - Implementare modelli di invecchiamento semi-empirici e dinamiche termiche basati sulla letteratura scientifica (modelli Grimaldi/Polito e Kumtepeli/TUM).
- **Stima del Degrado dello Stato di Salute (SoH):**
  - Calcolo orario del degrado da calendario (Calendar Aging) basato su temperatura e SoC medio.
  - Calcolo orario del degrado da ciclaggio (Cycle Aging) basato sui cicli equivalenti (throughput energetico) e profondità di scarica (DoD).
  - Riduzione progressiva della capacità utile nominale dello storage in base al decremento del SoH.

## 4. Sviluppo degli Algoritmi di Ottimizzazione (MILP/MINLP)
- **Vincoli Matematici:** Sviluppare le equazioni di ottimizzazione lineare/non-lineare intera mista (MILP/MINLP) per la gestione della carica e scarica del BESS:
  - Garantire l'esclusione reciproca oraria tra la carica e la scarica della batteria tramite variabile binaria $u(t) \in \{0, 1\}$:
    $$P_{charge}(t) \cdot P_{discharge}(t) = 0$$
  - Ottimizzare la cassa minimizzando le penali di sbilanciamento e massimizzando l'arbitraggio dei prezzi zonali (carica con surplus solare o rete a prezzo minimo, scarica per time shifting su picchi serali).
- **Esecuzione:** Scrivere le funzioni in JavaScript ES6+ puro, altamente ottimizzato sull'allocazione della memoria heap per elaborare matrici di 8760 punti in meno di **100ms** sul thread principale del browser.
