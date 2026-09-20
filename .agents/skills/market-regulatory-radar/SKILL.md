---
name: market-regulatory-radar
description: Autonomous online market and regulatory intelligence radar. Formulates targeted web searches for ARERA/MASE/GSE delibere, macroeconomic indicators (EURIBOR, PUN), and BESS cell degradation parameters, enforcing strict verification gates before updating semantic memory.
---

# SKILL: Autonomous Market & Regulatory Intelligence Radar

Questa skill guida l'attività di acquisizione autonoma e validazione continua delle informazioni esterne (mercato, regolazione energetica, fisco e tecnologia BESS).

---

## 1. Mappa delle Query di Ricerca Target

L'agente deve utilizzare il tool di ricerca web (`search_web`) formulando query mirate e strutturate:

### A. Regolazione ARERA, GSE & CACER (Italia)
* **TIDE 2026 & Settlement Quart'orario**:
  `"Delibera ARERA 268/2025/R/eel TIDE settlement 15 minuti"`  
  `"Delibera ARERA 270/2025/R/eel corrispettivi sbilanciamento"`
* **TIAD & Energia Condivisa**:
  `"Delibera ARERA 727/2022/R/eel TIAD corrispettivo unitario valorizzazione"`
* **Incentivi MASE & PNRR**:
  `"Decreto CACER MASE tariffe premio aggiornate 2026"`  
  `"GSE regole operative PNRR comuni sotto 50000 abitanti"`
* **Ritiro Dedicato (RID)**:
  `"GSE prezzi minimi garantiti e zonali Ritiro Dedicato 2026"`

### B. Parametri Macroeconomici e Finanziari
* **Tassi di Riferimento Interbancari**:
  `"Tasso EURIBOR 6M settembre 2026 valore medio"`  
  `"Tassi IRS Euribor 10Y 15Y benchmark project finance 2026"`
* **Prezzi Zonali PUN**:
  `"GME prezzo unico nazionale PUN media mensile Centro Nord 2026"`  
  `"Prezzi zonali orari energia elettrica Centro Nord GME"`

### C. Tecnologia Celle BESS (NMC / LFP)
* **Degrado ed Elettro-Termica**:
  `"CATL 314Ah LFP cell cycle aging Arrhenius activation energy"`  
  `"BYD Blade battery thermal degradation model Kumtepeli TUM"`  
  `"LFP calendar aging capacity fade temperature Arrhenius"`

---

## 2. Protocollo di Validazione "Verification Gate"

Qualsiasi informazione o dato recuperato online **NON PUÒ** essere inserito direttamente nei file del simulatore o nella memoria semantica senza superare il seguente cancello di validazione:

1. **Autorevolezza della Fonte**:
   - Fonti Regolatorie Ammesse: `arera.it`, `gse.it`, `mercatoelettrico.org` (GME), `mase.gov.it`, `agenziaentrate.gov.it`.
   - Fonti Tecnico-Scientifiche Ammesse: `ieee.org`, `sciencedirect.com`, datasheet ufficiali dei produttori (CATL, BYD, Tesla, Sungrow).
   - Fonti Finanziarie Ammesse: `bancaditalia.it`, `ecb.europa.eu`, `euribor-rates.eu`.
2. **Tripla Verifica dei Dati**:
   - Valore numerico esatto con unità di misura esplicita (es. `€/MWh`, `kJ/mol`, `%`).
   - Data di decorrenza ed eventuale periodo transitorio (es. decorrenza TIDE dal 1° gennaio 2026).
   - Valutazione dell'impatto percentuale sui modelli esistenti.
3. **Approvazione dell'Agente di Competenza**:
   - Dati fiscali $\rightarrow$ approvati da [`fiscal_expert`](file:///home/ubuntu/Asset/.agents/agents/fiscal_expert/agent.md).
   - Dati fisici/chimici $\rightarrow$ approvati da [`energy_expert`](file:///home/ubuntu/Asset/.agents/agents/energy_expert/agent.md).
   - Dati bancari/tassi $\rightarrow$ approvati da [`finance_modeler`](file:///home/ubuntu/Asset/.agents/agents/finance_modeler/agent.md).

---

## 3. Procedura di Sincronizzazione con la Memoria Semantica

Quando un nuovo parametro viene validato, l'agente esegue lo script di sincronizzazione:
```bash
node .agents/scripts/radar_grounding_sync.mjs --section "Macro" --key "EURIBOR_6M" --value "3.15" --source "https://www.euribor-rates.eu" --impact "Aggiornamento costo del debito senior"
```
Lo script:
1. Registra la provenienza nella tabella delle fonti verificate.
2. Aggiorna deterministicamente [`.agents/memory/semantic_grounding.md`](file:///home/ubuntu/Asset/.agents/memory/semantic_grounding.md).
3. Genera un commit logico con riferimento normativo.
