---
name: frontend-development
description: Premium Single Page Application (SPA) design, Chart.js GPU optimization (data decimation), and Supabase SDK batch synchronization with exponential backoff.
trigger: when_developing_frontend
---

# SKILL: Premium Frontend Engineering & Real-Time Visualization

Questa skill descrive gli standard di design e di sviluppo dell'interfaccia utente interattiva (dashboard) per la visualizzazione delle performance fisiche e dei flussi finanziari dell'impianto.

## 1. Architettura Single Page Application (SPA) Premium
- **Tecnologie:** HTML5 semantico, CSS Vanilla e Tailwind CSS (palette scura premium ad alto contrasto per un look enterprise), Vanilla JavaScript (ES6+).
- **Struttura:** Unico file `index.html` frameless, completamente responsive, privo di framework pesanti (No React, Angular o Vue) per massimizzare la velocità di caricamento iniziale.
- **CDN e CSP:** Utilizzare esclusivamente link CDN stabili ed HTTPS verificati per le risorse esterne (Tailwind CSS, Chart.js, Supabase SDK, FontAwesome). Configurare il codice per evitare blocchi dovuti a criteri CSP (Content Security Policy).

## 2. Visualizzazione Grafica ad Alte Prestazioni (Chart.js)
- **Visualizzazione Real-Time:** Grafici interattivi per mostrare:
  - Flussi di potenza fisici: Generazione Fotovoltaica, Curva di Carico, Immissione in Rete, Stato di Carica (SoC) del BESS.
  - Parametri ambientali e chimici: Temperatura di cella e SoH.
  - Flussi finanziari: Prezzi del PUN ed evoluzione dei ricavi duali.
- **GPU Optimization (60 FPS):** Per garantire animazioni e scorrimenti fluidi a 60 frame al secondo su grafici densi (8760 punti orari), applicare algoritmi di decimazione dei dati (*data decimation*) prima del rendering in Chart.js, lasciando alla GPU il calcolo dei vettori grafici.

## 3. Sincronizzazione Database Supabase SDK in Batch
- **Chunking dei Dati:** Non inviare mai l'intero anno (8760 record orari) in un'unica richiesta HTTP POST. Dividere i dati in blocchi (chunk) da massimo **1000 record** per chiamata.
- **Resilienza di Rete (Retry Logic):** Implementare una funzione di caricamento batch asincrona dotata di:
  - Riconnessione automatica in caso di timeout.
  - Algoritmo di *exponential backoff* (ritardi crescenti tra i tentativi: 1s, 2s, 4s, 8s...) con aggiunta di jitter casuale per non sovraccaricare il server.
  - Gestione degli errori client-side con notifica visiva non bloccante per l'utente.
- **Persistenza UI/Database (1-to-1 Mapping):** Garantire che ogni singolo campo input della UI (sia metriche `Finanza` che campi config di `Impianti` o `Stabilimenti`) venga rigorosamente tracciato e memorizzato su Supabase (tabelle `plants`, `simulation_config`, `stabilimenti`). All'avvio della dashboard o in caso di aggiornamento pagina, tutti i valori salvati devono essere ricaricati in modo deterministico nei form, onde prevenire la perdita di configurazione da parte dell'utente.
