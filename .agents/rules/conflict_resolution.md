---
trigger: always_on
description: Conflict resolution protocols for Solar & BESS models, and data integrity checks before Supabase integration.
---

# Conflict Resolution & Data Integrity Rules

1. **Protocollo di Risoluzione Conflitti: Degradazione Termica vs Arbitraggio di Cassa**
   - **ID:** `thermal_degradation_vs_revenue_arbitrage`
   - **Regola:** Si applica la priorità assoluta al vincolo termico-degradativo se il SoH (State of Health) del BESS decade ad un tasso annuo superiore al **3.5%** o se la temperatura di cella eccede costantemente i **35°C**.
   - **Azione:** L'algoritmo di ottimizzazione MILP/MINLP deve rimodulare o tagliare i cicli di carica/scarica forzata (anche se economicamente profittevoli) per riportare la temperatura e il degrado del pacco batterie entro i limiti di sicurezza fisici.

2. **Verifica e Integrità dei Dati Orari**
   - **ID:** `data_integrity_checking`
   - **Regola:** Prima di abilitare o procedere con l'invio batch dei dati di telemetria a Supabase, assicurarsi che il **100% delle 8760 ore** del vettore annuale sia completamente popolato, privo di valori nulli/NaN e perfettamente sincronizzato sull'anno temporale **2025**.
   - **Azione:** Qualsiasi deviazione o buco nei dati deve bloccare la pipeline di caricamento batch per evitare disallineamenti o corruzioni sul database PostgreSQL remoto.
