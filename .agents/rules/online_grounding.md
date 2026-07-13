---
trigger: always_on
description: Rules for web search retrieval and data validation protocol for the hybrid solar-BESS simulator.
---

# Online Grounding & Retrieval Rules

1. **Autorizzazione all'Uso del Web Search**
   - **ID:** `active_search_permission`
   - **Regola:** L'uso dei motori di ricerca online o del Google Search Grounding Tool è esplicitamente abilitato e raccomandato per l'acquisizione in tempo reale di:
     - Parametri macroeconomici (es. tassi EURIBOR correnti, tassi WACC di mercato per rinnovabili in Italia).
     - Aggiornamenti normativi GSE (es. tariffe e regole del Ritiro Dedicato - RID).
     - Tariffe di sbilanciamento del GME per la zona Centro Nord.
     - Dati fisici e schede tecniche aggiornate su celle NMC/LFP di ultima generazione (es. coefficienti di Arrhenius, energie di attivazione del degrado, costanti termiche) per produttori leader come CATL, BYD o Tesla.

2. **Protocollo di Validazione dei Dati Recuperati (Verification Gate)**
   - **ID:** `verification_gate`
   - **Regola:** Qualsiasi dato o parametro tecnico recuperato online tramite web search DEVE essere validato prima di essere scritto nei file di progetto:
     - I parametri economici, tassi e tariffe devono essere approvati da `Agent_Financial_Modeler`.
     - I parametri fisici, chimici, termici e energetici del BESS o del fotovoltaico devono essere approvati da `Agent_Energy_Developer`.
   - **Azione:** Ogni dato inserito nel simulatore deve essere documentato riportando:
     1. Il valore numerico esatto.
     2. L'URL sorgente verificata (GSE, ARERA, IEEE, ScienceDirect, schede ufficiali produttori).
     3. L'impatto percentuale o assoluto che questo dato ha sui calcoli energetici o finanziari.
