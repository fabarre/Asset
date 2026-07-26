// ═══════════════════════════════════════════════════════════════════════════
// i18n (IT/EN) — AntiGravity Hybrid FV + BESS Simulator
// Strategia: dizionario sul testo sorgente (IT → EN), applicato via TreeWalker
// a tutto il DOM e via MutationObserver al contenuto dinamico (tabelle P&L,
// liste, dropdown renderizzati da JS). Le stringhe non presenti nel dizionario
// restano in italiano (fallback trasparente).
// Limite noto: grafici canvas (Chart.js), alert() e PDF restano in italiano.
// ═══════════════════════════════════════════════════════════════════════════

const I18N_EN = {
    // ── Navbar & chrome ──
    'DASHBOARD': 'DASHBOARD',
    'FINANZA': 'FINANCE',
    'IMPIANTI': 'PLANTS',
    'LISTINI': 'PRICES',
    'ANALISI': 'ANALYSIS',
    'CONSUMI': 'OFF-TAKERS',
    'SENSITIVITY': 'SENSITIVITY',
    'Simulazione Fisica Oraria 8760 Ore': 'Hourly Physical Simulation 8760 Hours',
    'M&A Hybrid Deal Intelligence': 'M&A Hybrid Deal Intelligence',
    'Calcolo in corso...': 'Calculation in progress...',
    'Calcolo in corso…': 'Calculation in progress…',
    'Accesso Richiesto': 'Login Required',
    'Accedi': 'Sign In',
    'Registra nuovo utente': 'Register new user',
    'Continua senza autenticazione (modalità sviluppo)': 'Continue without authentication (development mode)',

    // ── Dashboard KPI ──
    'Valore Deal (EV)': 'Deal Value (EV)',
    'Enterprise Value Consolidato': 'Consolidated Enterprise Value',
    'Fabbisogno Equity': 'Equity Requirement',
    '0% Quota Sponsor': '0% Sponsor Share',
    'Debito Senior': 'Senior Debt',
    '0% di Leva': '0% Leverage',
    'Project IRR (Unlevered)': 'Project IRR (Unlevered)',
    'TIR di Progetto (FCFF)': 'Project IRR (FCFF)',
    'IRR Equity (HoldCo)': 'Equity IRR (HoldCo)',
    'Al netto delle tasse di Holding': 'Net of Holding taxes',
    'NPV @ Ke (HoldCo)': 'NPV @ Ke (HoldCo)',
    'Discounted @ Cost of Equity': 'Discounted @ Cost of Equity',
    'Copertura DSCR Media': 'Average DSCR Coverage',
    'Minimo registrato: -': 'Minimum recorded: -',
    'LCOE Medio': 'Average LCOE',
    'Costo Livellato Energia': 'Levelized Cost of Energy',
    'LCOS Medio': 'Average LCOS',
    'Costo Livellato Storage': 'Levelized Cost of Storage',
    'Payback Equity': 'Equity Payback',
    'Levered Payback Period': 'Levered Payback Period',
    'Conto Economico & Covenant DSCR': 'Income Statement & DSCR Covenant',
    '20 Anni Previsionali': '20 Forecast Years',
    'Riepilogo Impianti & Generazione': 'Plants & Generation Summary',
    'Impianti Attivi': 'Active Plants',
    'Potenza FV Totale': 'Total PV Power',
    'Produzione Annua': 'Annual Production',
    'Resa Specifica': 'Specific Yield',
    'Riepilogo Storage BESS': 'BESS Storage Summary',
    'Potenza Totale': 'Total Power',
    'Capacità Totale': 'Total Capacity',
    'Parametri configurati singolarmente per impianto nella scheda': 'Parameters configured per plant in the tab',
    'Portafoglio Impianti': 'Plant Portfolio',
    'Consumi & PPA — Autoconsumo': 'Off-takers & PPA — Self-Consumption',
    'Carico Consumi': 'Consumption Load',
    'Autoconsumo': 'Self-Consumption',
    'Copertura Media': 'Average Coverage',
    'Ricavo PPA Y1': 'PPA Revenue Y1',
    'Violazione Covenant DSCR:': 'DSCR Covenant Breach:',

    // ── Report / Config / Sync ──
    'Stampa Report (PDF)': 'Print Report (PDF)',
    'Tipologia Report': 'Report Type',
    'Executive Summary (KPI & Raccomandazioni)': 'Executive Summary (KPIs & Recommendations)',
    'Relazione Tecnica & Descrittiva (Impianti e Consumi)': 'Technical Report (Plants & Off-takers)',
    'Conto Economico SPV (20 Anni)': 'SPV Income Statement (20 Years)',
    'Rendiconto Finanziario SPV (CFADS & Waterfall)': 'SPV Cash Flow Statement (CFADS & Waterfall)',
    'Piano Ammortamento Debito (Senior + Soci + PD)': 'Debt Amortization Schedule (Senior + Shareholder + PD)',
    'Struttura Finanziaria & Fonti/Impieghi': 'Financial Structure & Sources/Uses',
    'Report Exit & Valutazione': 'Exit & Valuation Report',
    'Analisi di Sensibilità (Tornado)': 'Sensitivity Analysis (Tornado)',
    'Due Diligence Completa (Full Report)': 'Full Due Diligence (Full Report)',
    'Genera e Scarica PDF': 'Generate & Download PDF',
    'Configurazione (CSV)': 'Configuration (CSV)',
    'Esporta CSV': 'Export CSV',
    'Importa CSV': 'Import CSV',
    'Sincronizzazione Database': 'Database Synchronization',
    'Sincronizza': 'Sync',
    'Offline': 'Offline',

    // ── Fonti & Impieghi ──
    'Fonti e Impieghi dell\'Operazione (Sponsor & HoldCo Level)': 'Sources & Uses (Sponsor & HoldCo Level)',
    'Consolidato Holding (€)': 'Holding Consolidated (€)',
    'IMPIEGHI (Investment Uses)': 'USES (Investment Uses)',
    'Acquisizione Quote SPV (Purchase Price)': 'SPV Share Acquisition (Purchase Price)',
    'CAPEX Costruzione Impianti (Hard & Soft Costs)': 'Plant Construction CAPEX (Hard & Soft Costs)',
    'Capitale Costituzione Holding': 'Holding Setup Capital',
    'TOTALE IMPIEGHI': 'TOTAL USES',
    'FONTI (Financing Sources)': 'SOURCES (Financing Sources)',
    'Debito Senior Bancario (Senior Debt)': 'Bank Senior Debt (Senior Debt)',
    'Private Debt (Mezzanine)': 'Private Debt (Mezzanine)',
    'Private Equity (Co-Investitore)': 'Private Equity (Co-Investor)',
    'Finanziamento Soci Subordinato (Sponsor Loan)': 'Subordinated Shareholder Loan (Sponsor Loan)',
    'Capitale Proprio Sponsor (Sponsor Pure Equity)': 'Sponsor Pure Equity (Sponsor Pure Equity)',
    'TOTALE FONTI': 'TOTAL SOURCES',
    'Rapporto Leva / Equity Totale': 'Leverage / Total Equity Ratio',
    'Nota Metodologica:': 'Methodological Note:',
    'Ripartizione del Valore Deal (Enterprise Value)': 'Deal Value Breakdown (Enterprise Value)',
    'Ripartizione Costi per Impianto (€)': 'Cost Breakdown per Plant (€)',

    // ── FINANZA tab ──
    'Struttura Deal & Finanza (Parametri Globali)': 'Deal Structure & Finance (Global Parameters)',
    'Gestione Scenari': 'Scenario Manager',
    'Snapshot configurazione finanziaria (portfolio condiviso)': 'Financial configuration snapshot (shared portfolio)',
    'Salva': 'Save',
    'Applica': 'Apply',
    'Confronta Selezionati': 'Compare Selected',
    '- Nessuno scenario salvato -': '- No saved scenarios -',
    '- Seleziona scenario -': '- Select scenario -',
    'Macroeconomia & Rendimento Atteso': 'Macroeconomics & Expected Return',
    'Costo dell\'Equity (Ke) (%)': 'Cost of Equity (Ke) (%)',
    'WACC di Progetto (%)': 'Project WACC (%)',
    'Inflazione Annua (%)': 'Annual Inflation (%)',
    'Ammortamento Fiscale (%)': 'Fiscal Depreciation (%)',
    'Aliquota IRES (%)': 'IRES Rate (%)',
    'Aliquota IRAP (%)': 'IRAP Rate (%)',
    'Struttura Finanziaria & Leva': 'Financial Structure & Leverage',
    'Quota Debito (%)': 'Debt Share (%)',
    'Tasso Debito (%)': 'Debt Rate (%)',
    'Basi di Calcolo Debito': 'Debt Calculation Basis',
    'Sola Costruzione (Hard Costs)': 'Construction Only (Hard Costs)',
    'Valore Deal senza Acquisizione SPV (EV Ex SPV)': 'Deal Value excl. SPV Acquisition (EV Ex SPV)',
    'Intero Enterprise Value (EV)': 'Full Enterprise Value (EV)',
    'Durata Mutuo (Anni)': 'Loan Term (Years)',
    'Preammortamento': 'Grace Period',
    'Durata Costruzione': 'Construction Duration',
    'Tiraggio IDC Medio': 'Average IDC Drawdown',
    'DSRA (Mesi di Debt Service)': 'DSRA (Months of Debt Service)',
    'Refinancing / Miniperm (nuovo finanziamento a metà vita)': 'Refinancing / Miniperm (new loan mid-life)',
    'Anno Refinancing': 'Refinancing Year',
    'Nuovo Tasso (%)': 'New Rate (%)',
    'Nuova Durata (Anni)': 'New Term (Years)',
    'Blocco Distribuzione Dividendi (Cash Sweep Bancario)': 'Dividend Distribution Lock (Bank Cash Sweep)',
    'Holding & Strategia di Exit': 'Holding & Exit Strategy',
    'Capitale Holding (€)': 'Holding Capital (€)',
    'Opzione di Exit': 'Exit Option',
    'Moltiplicatore EBITDA': 'EBITDA Multiple',
    'Valore Vendita (€/MWp)': 'Sale Value (€/MWp)',
    'Enterprise Value (€)': 'Enterprise Value (€)',
    'Cash Sweep (Rimborso Anticipato Facoltativo)': 'Cash Sweep (Optional Early Repayment)',
    'Tipo Sweep': 'Sweep Type',
    'Nessuno': 'None',
    '% del CFADS': '% of CFADS',
    '€ Fisso/Anno': '€ Fixed/Year',
    'Valore (% o €)': 'Value (% or €)',
    'Durata (Anni, 0=illimitato)': 'Duration (Years, 0=unlimited)',
    'DSCR Sculpting (rata sagomata)': 'DSCR Sculpting (sculpted instalment)',
    'Target DSCR (x)': 'Target DSCR (x)',
    'Finanziamento Soci (Shareholder Loan)': 'Shareholder Loan',
    'Quota Finanziamento Soci': 'Shareholder Loan Share',
    'Tasso Interessi Soci': 'Shareholder Interest Rate',
    'Periodo Grazia Interessi (Anni)': 'Interest Grace Period (Years)',
    'Periodo Grazia Capitale (Anni)': 'Principal Grace Period (Years)',
    'Private Debt (SPV Mezzanine)': 'Private Debt (SPV Mezzanine)',
    'Modalità Importo': 'Amount Mode',
    'Importo Fisso (€)': 'Fixed Amount (€)',
    '% Base Finanziabile': '% Bankable Base',
    '% Totale Fabbisogno': '% Total Requirement',
    'Importo (€)': 'Amount (€)',
    'Modalità Rimborso': 'Repayment Mode',
    'Interessi Annuari + Capitale': 'Annual Interest + Principal',
    'Bullet a Exit (PIK Composto)': 'Bullet at Exit (Compound PIK)',
    'Ammortamento Rateale': 'Amortizing Instalments',
    'Tasso PD': 'PD Rate',
    'Grazia Interessi (Anni)': 'Interest Grace (Years)',
    'Grazia Capitale (Anni)': 'Principal Grace (Years)',
    'Durata (se Ammortamento)': 'Term (if Amortizing)',
    'Posizione Waterfall': 'Waterfall Position',
    'Dopo Senior, prima Soci': 'After Senior, before Shareholder',
    'Dopo Soci (più subordinato)': 'After Shareholder (more subordinated)',
    'Interessi PD deducibili fiscalmente (Holding)': 'Tax-deductible PD interest (Holding)',
    '  (-) Imposta IRAP HoldCo (3,9% su Valore Produzione Netta) (€)': '  (-) HoldCo IRAP Tax (3.9% on Net Production Value) (€)',
    '% Equity Totale': '% Total Equity',
    'Struttura Remunerazione': 'Remuneration Structure',
    'Quote Dividendi Proporzionale': 'Proportional Dividend Share',
    'Preferred Return (Hurdle Composto)': 'Preferred Return (Compound Hurdle)',
    'Bullet a Exit (Multiplo Garantito)': 'Bullet at Exit (Guaranteed Multiple)',
    'Royalty % Ricavi (Parasociale)': 'Royalty % Revenues (Quasi-equity)',
    'Hurdle Rate (composto)': 'Hurdle Rate (compound)',
    '% Dividendi Preferred': '% Preferred Dividends',
    'Multiplo Exit Garantito (x)': 'Guaranteed Exit Multiple (x)',
    'Royalty % Ricavi SPV': 'Royalty % SPV Revenues',
    'Partecipa all\'Exit Equity Value (dividend/preferred)': 'Participates in Exit Equity Value (dividend/preferred)',
    'Altra Forma (Parasociale/Convertibile)': 'Other Form (Quasi-equity/Convertible)',
    'Tipo Accordo': 'Agreement Type',
    'Advisory Fee Annuo': 'Annual Advisory Fee',
    'Success Fee a Exit (% EV)': 'Success Fee at Exit (% EV)',
    'Warrant Kicker (% Equity Exit)': 'Warrant Kicker (% Exit Equity)',
    'Convertibile (PIK + %EV)': 'Convertible (PIK + %EV)',
    'Importo Annuo (€)': 'Annual Amount (€)',
    'Quota % Ricavi (0 = solo importo fisso)': '% Revenue Share (0 = fixed amount only)',
    'Scenario Prezzi': 'Price Scenario',
    'Scenario Base (Standard)': 'Base Scenario (Standard)',
    'Scenario Ribassista con Floor': 'Bearish Scenario with Floor',
    'Floor PUN Zonale Ponderato (€/MWh)': 'Weighted Zonal PUN Floor (€/MWh)',
    'Decadimento Bearish PUN/RID (%/a)': 'Bearish Decay PUN/RID (%/y)',
    'Decadimento Bearish Time Shifting (%/a)': 'Bearish Decay Time Shifting (%/y)',
    'Decadimento Bearish Arbitraggio (%/a)': 'Bearish Decay Arbitrage (%/y)',
    'Motore Ottimizzazione BESS': 'BESS Optimization Engine',
    'DP Giornaliera (Standard)': 'Daily DP (Standard)',
    'LP Globale HiGHS (Sperimentale)': 'Global LP HiGHS (Experimental)',

    // ── IMPIANTI tab ──
    'Riepilogo Portafoglio Impianti': 'Plant Portfolio Summary',
    'N° Impianti': 'No. of Plants',
    'Produzione Stimata': 'Estimated Production',
    'CAPEX Totale': 'Total CAPEX',
    'Aggiungi Impianto': 'Add Plant',
    'Dati Impianto': 'Plant Data',
    'Nome Impianto': 'Plant Name',
    'Capacità (kWp)': 'Capacity (kWp)',
    'Zona Geografica': 'Geographic Zone',
    '— Nessuna —': '— None —',
    'CENTRO-NORD (CNOR)': 'CENTRE-NORTH (CNOR)',
    'CENTRO-SUD (CSUD)': 'CENTRE-SOUTH (CSUD)',
    'SUD': 'SOUTH',
    'SICILIA (SICI)': 'SICILY (SICI)',
    'SARDEGNA (SARD)': 'SARDINIA (SARD)',
    'CAPEX EPC (€/kWp)': 'EPC CAPEX (€/kWp)',
    'O&M Impianto (FV) (€/a)': 'Plant O&M (PV) (€/y)',
    'Costo Connessione (€)': 'Connection Cost (€)',
    'Costo Sviluppo (€)': 'Development Cost (€)',
    'Tipologia Terreno': 'Land Type',
    'Acquisto Terreno': 'Land Purchase',
    'DDS Attualizzato': 'Discounted Leasehold (DDS)',
    'DDS Annuo (Canone)': 'Annual Leasehold (DDS)',
    'Costo Terreno (€ o €/a)': 'Land Cost (€ or €/y)',
    'Acquisto SPV (€)': 'SPV Acquisition (€)',
    'Connessione Rete': 'Grid Connection',
    'Pot. Immissione (kW)': 'Injection Power (kW)',
    'Livello Tensione': 'Voltage Level',
    'BT — Bassa Tensione': 'LV — Low Voltage',
    'MT — Media Tensione': 'MV — Medium Voltage',
    'AT — Alta Tensione': 'HV — High Voltage',
    'KPI Impianto (Calcolati)': 'Plant KPIs (Computed)',
    'Rendimento': 'Yield',
    'Produzione': 'Production',
    'Dettaglio OPEX Aggiuntivi': 'Additional OPEX Detail',
    'O&M Sistemi BESS (€/a)': 'BESS O&M (€/y)',
    'Assicurazione (€/a)': 'Insurance (€/y)',
    'Tasse Locali / IMU (€/a)': 'Local Taxes / IMU (€/y)',
    'Vigilanza & Security (€/a)': 'Surveillance & Security (€/y)',
    'Gestione Amministrativa & Asset Mgt (€/a)': 'Admin & Asset Management (€/y)',
    'Earn-Out & Servizi Commerciali': 'Earn-Out & Commercial Services',
    'Configurazione Earn-Out (Livello Holding)': 'Earn-Out Configuration (Holding Level)',
    'Tipo di Earn-Out': 'Earn-Out Type',
    'Fisso (€/anno)': 'Fixed (€/year)',
    '% su Ricavi RID / FER X': '% on RID / FER X Revenues',
    '% su Ricavi Totali': '% on Total Revenues',
    '€/MWh su immessa in rete': '€/MWh on grid-fed energy',
    '€/MWh su totale prodotta': '€/MWh on total production',
    'Valore Earn-Out (€, % o €/MWh)': 'Earn-Out Value (€, % or €/MWh)',
    'Durata (Anni)': 'Duration (Years)',
    'Contratto Servizio/Intermediazione PPA (Deducibile SPV)': 'PPA Service/Brokerage Contract (SPV Deductible)',
    'Struttura Costo Servizio': 'Service Cost Structure',
    '% su Ricavi PPA': '% on PPA Revenues',
    '€/MWh su Energia Condivisa PPA': '€/MWh on PPA Shared Energy',
    'Valore Costo (% o €/MWh)': 'Cost Value (% or €/MWh)',
    'Dati PVGIS': 'PVGIS Data',
    '(sola lettura)': '(read-only)',
    'Latitudine (°)': 'Latitude (°)',
    'Longitudine (°)': 'Longitude (°)',
    'Inclinazione (°)': 'Slope (°)',
    'Elevazione (m s.l.m.)': 'Elevation (m a.s.l.)',
    'Perdite Sistema (%)': 'System Losses (%)',
    'Database Radiazione': 'Radiation Database',
    'Inverter PV': 'PV Inverter',
    'Accoppiamento': 'Coupling',
    'Marca Inverter': 'Inverter Brand',
    'Modello': 'Model',
    'Pot. Nom. Inverter (kW)': 'Nominal Inverter Power (kW)',
    'Efficienza (%)': 'Efficiency (%)',
    'Tensione Max DC (V)': 'Max DC Voltage (V)',
    'Accumulo BESS': 'BESS Storage',
    '(Opzionale)': '(Optional)',
    'Tecnologia BESS': 'BESS Technology',
    'LFP (Standard)': 'LFP (Standard)',
    'NMC (Alta Densità)': 'NMC (High Density)',
    'Grafene (Supercap.)': 'Graphene (Supercap.)',
    'Potenza BESS (MW)': 'BESS Power (MW)',
    'Capacità BESS (MWh)': 'BESS Capacity (MWh)',
    'Decadimento Annuo (%)': 'Annual Degradation (%)',
    'CAPEX BESS (€/kWh)': 'BESS CAPEX (€/kWh)',
    'Temp. Min Oper. (°C)': 'Min Operating Temp. (°C)',
    'Temp. Max Oper. (°C)': 'Max Operating Temp. (°C)',
    'Cicli Garantiti': 'Warranted Cycles',
    'Garanzia (anni)': 'Warranty (years)',
    'Mercato e Incentivi': 'Market & Incentives',
    'Mercato di Riferimento': 'Reference Market',
    'RID GSE (Mercato Libero / PUN)': 'GSE RID (Free Market / PUN)',
    'Decreto FER X (Tariffa Incentivante)': 'FER X Decree (Incentive Tariff)',
    'Parametri Contratto Trader (RID)': 'Trader Contract Parameters (RID)',
    'Tipo Contratto Trader': 'Trader Contract Type',
    'PUN Orario': 'Hourly PUN',
    'PUN Medio Mensile': 'Monthly Average PUN',
    'Spread Trader (€/MWh)': 'Trader Spread (€/MWh)',
    'Dispacciamento (€/MWh)': 'Dispatching (€/MWh)',
    'Contributo PNRR (%)': 'PNRR Contribution (%)',
    'Parametri Decreto FER X': 'FER X Decree Parameters',
    'Tariffa di Aggiudicazione (€/MWh)': 'Awarded Tariff (€/MWh)',
    'Nota FER X:': 'FER X Note:',
    'Decadimento Listini Annuo (Anni 2-20)': 'Annual Price Decay (Years 2-20)',
    'Decadimento RID (%/a)': 'RID Decay (%/y)',
    'Time Shifting (%/a)': 'Time Shifting (%/y)',
    'Arbitraggio (%/a)': 'Arbitrage (%/y)',
    'Dati PVGIS (CSV orario)': 'PVGIS Data (hourly CSV)',
    'Scarica da PVGIS API (lat/lon)': 'Download from PVGIS API (lat/lon)',
    'Impianti Fotovoltaici Attivi': 'Active Photovoltaic Plants',
    'Portafoglio di Generazione': 'Generation Portfolio',
    'Capacità': 'Capacity',
    'Zona': 'Zone',
    'Connessione': 'Connection',
    'Terreno': 'Land',
    'Sviluppo': 'Development',
    'Acq. SPV': 'SPV Acq.',
    'PUN Zonale Ponderato': 'Weighted Zonal PUN',
    'Azioni': 'Actions',

    // ── LISTINI (GME) tab ──
    'Importazione Listino GME': 'GME Price List Import',
    'Scegli file XLSX GME': 'Choose GME XLSX file',
    'Filtri Analisi GME': 'GME Analysis Filters',
    'Filtro Impianti:': 'Plant Filter:',
    'Tutti': 'All',
    'Seleziona Periodo:': 'Select Period:',
    'Tutto l\'anno (2025)': 'Whole year (2025)',
    'Gennaio': 'January', 'Febbraio': 'February', 'Marzo': 'March', 'Aprile': 'April',
    'Maggio': 'May', 'Giugno': 'June', 'Luglio': 'July', 'Agosto': 'August',
    'Settembre': 'September', 'Ottobre': 'October', 'Novembre': 'November', 'Dicembre': 'December',
    'Medione Ponderato FV': 'Weighted PV Average Price',
    'Produzione totale oraria': 'Total hourly production',
    'PUN Imm. Diretta': 'Direct Feed-in PUN',
    'Cessioni orarie RID (No BESS)': 'Hourly RID sales (No BESS)',
    'Cessione Stab.': 'Off-taker Sales',
    'Costo opp. se immessa in rete': 'Opportunity cost if grid-fed',
    'Uplift Time Shifting': 'Time Shifting Uplift',
    'Margine netto BESS per MWh': 'Net BESS margin per MWh',
    'Margine Arbitraggio': 'Arbitrage Margin',
    'Margine acquisti BESS da rete': 'BESS grid purchase margin',
    'Andamento Mensile Medie Ponderate (€/MWh)': 'Monthly Weighted Averages Trend (€/MWh)',
    'Sintesi Ponderata delle Performance (€/MWh)': 'Weighted Performance Summary (€/MWh)',
    'Impianti Selezionati': 'Selected Plants',
    'Periodo / Mese': 'Period / Month',
    'Medione FV': 'PV Average',
    'Imm. Diretta': 'Direct Feed-in',
    'Medie Mensili Benchmark del PUN Zonale (€/MWh)': 'Monthly Zonal PUN Benchmark Averages (€/MWh)',
    'Prezzi Storici di Borsa': 'Historical Exchange Prices',
    'Mese': 'Month',

    // ── RID / CER tabs ──
    'Configurazione Rete & Ritiro Dedicato (RID)': 'Grid & Dedicated Withdrawal (RID) Configuration',
    'Perdite di Rete convenzionali per Tensione': 'Conventional Grid Losses by Voltage',
    'Tensione Connessione': 'Connection Voltage',
    'Iniezione (RID) (%)': 'Injection (RID) (%)',
    'Prelievo (ARERA) (%)': 'Withdrawal (ARERA) (%)',
    'Bassa Tensione (BT)': 'Low Voltage (LV)',
    'Media Tensione (MT)': 'Medium Voltage (MV)',
    'Alta Tensione (AT)': 'High Voltage (HV)',
    'Costi di Sbilanciamento': 'Imbalance Costs',
    'Costo Sbilanciamento GSE (€/MWh)': 'GSE Imbalance Cost (€/MWh)',
    'Configurazione Comunità Energetiche Rinnovabili (CER)': 'Renewable Energy Communities (CER) Configuration',
    'Valorizzazione TIAD': 'TIAD Valorization',
    'Componente TRAS (€/MWh)': 'TRAS Component (€/MWh)',
    'Incentivo MASE (Quota Fissa e Cap) per Taglia': 'MASE Incentive (Fixed Quota and Cap) by Size',
    'Piccola Taglia (≤20 kW)': 'Small Size (≤20 kW)',
    'Quota Fissa (€/MWh)': 'Fixed Quota (€/MWh)',
    'Cap Incentivo (€/MWh)': 'Incentive Cap (€/MWh)',
    'Quota Variabile MASE': 'MASE Variable Quota',
    'Prezzo Riferimento Prif (€/MWh)': 'Reference Price Prif (€/MWh)',
    'Quota Variabile Max (€/MWh)': 'Max Variable Quota (€/MWh)',
    'Correzione Geografica (maggiorazione)': 'Geographic Correction (uplift)',
    'Zona NORD (€/MWh)': 'NORTH Zone (€/MWh)',
    'Zona CENTRO (€/MWh)': 'CENTRE Zone (€/MWh)',
    'Zona SUD (€/MWh)': 'SOUTH Zone (€/MWh)',

    // ── ANALISI (hourly) tab ──
    'Profilo di Dispacciamento & BESS (Giorno Selezionato)': 'Dispatch & BESS Profile (Selected Day)',
    'Risoluzione:': 'Resolution:',
    'Giorno (24h)': 'Day (24h)',
    'Settimana (168h)': 'Week (168h)',
    'Trimestre': 'Quarter',
    'Semestre': 'Half-Year',
    'Anno Intero': 'Whole Year',
    'Raggruppamento:': 'Aggregation:',
    'Orario': 'Hourly',
    'Giornaliero (Media)': 'Daily (Avg)',
    'Mensile (Media)': 'Monthly (Avg)',
    'Tabella Dati Dettaglio': 'Detail Data Table',
    'Fascia': 'Band',
    'Valori medi o orari corrispondenti alla selezione attiva sul grafico.': 'Average or hourly values matching the active chart selection.',

    // ── P&L tab ──
    'Prospetti Finanziari & P&L': 'Financial Statements & P&L',
    'Esporta in Excel': 'Export to Excel',
    'Driver Operativi': 'Operating Drivers',
    'Quantitativi di Energia & Ricavi Unitari (€/MWh)': 'Energy Quantities & Unit Revenues (€/MWh)',
    'Trascina lateralmente per scorrere gli anni': 'Drag sideways to scroll years',
    'Sezione A': 'Section A',
    'Conto Economico Civilistico SPV (Portafoglio)': 'SPV Statutory Income Statement (Portfolio)',
    'Sezione B': 'Section B',
    'Rendiconto Finanziario SPV & Servizio Debito (Waterfall)': 'SPV Cash Flow & Debt Service (Waterfall)',
    'Sezione C': 'Section C',
    'Rendiconto Finanziario Holding (HoldCo Level)': 'Holding Cash Flow Statement (HoldCo Level)',
    'Piano di Ammortamento del Debito & Finanziamento Soci (20 Anni)': 'Debt & Shareholder Loan Amortization Schedule (20 Years)',

    // ── P&L row labels (dynamic, Sez. A/B/C) ──
    'RICAVI TOTALI SPV (€)': 'TOTAL SPV REVENUES (€)',
    '(-) COSTI OPERATIVI (OPEX) TOTALE SPV (€)': '(-) TOTAL SPV OPERATING COSTS (OPEX) (€)',
    'EBITDA SPV (€)': 'SPV EBITDA (€)',
    '(-) Ammortamento Civilistico (€)': '(-) Statutory Depreciation (€)',
    'EBIT SPV (Risultato Operativo) (€)': 'SPV EBIT (Operating Result) (€)',
    'EBT - Utile ante Imposte SPV (€)': 'EBT - SPV Pre-Tax Profit (€)',
    'UTILE NETTO CIVILISTICO SPV (-> Sez. B) (€)': 'SPV STATUTORY NET PROFIT (-> Sec. B) (€)',
    'CFADS SPV (Cassa Disponibile ante Servizio Debito) (€)': 'SPV CFADS (Cash Flow Available for Debt Service) (€)',
    'CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV) (€)': 'CASH AVAILABLE AFTER SENIOR DEBT (SPV FCFE) (€)',
    '(=) Cassa Rimanente non distribuita in SPV (Cash Trap) (€)': '(=) Undistributed Cash retained in SPV (Cash Trap) (€)',
    'UTILE NETTO HOLDING CIVILISTICO (€)': 'HOLDING STATUTORY NET PROFIT (€)',
    'FCFE - FLUSSO NETTO INVESTITORE (€)': 'FCFE - INVESTOR NET CASH FLOW (€)',
    'FCFE CUMULATO INVESTITORE (€)': 'CUMULATED INVESTOR FCFE (€)',
    'DSCR (Debt Service Coverage Ratio)': 'DSCR (Debt Service Coverage Ratio)',
    'Debito Residuo Inizio Anno (€)': 'Opening Debt Balance (€)',
    'Debito Residuo Fine Anno (€)': 'Closing Debt Balance (€)',
    'SERVIZIO DEL DEBITO EFFETTIVO (€)': 'EFFECTIVE DEBT SERVICE (€)',
    'QUANTITATIVI DI ENERGIA (MWh)': 'ENERGY QUANTITIES (MWh)',
    'VALORI UNITARI DI RICAVO & COSTO (€/MWh)': 'UNIT REVENUE & COST VALUES (€/MWh)',
    'Produzione Fotovoltaica Totale (MWh)': 'Total Photovoltaic Production (MWh)',
    'Scarica BESS Totale (MWh)': 'Total BESS Discharge (MWh)',
    'Carica BESS da Rete (MWh)': 'BESS Grid Charging (MWh)',
    'Perdite di Efficienza BESS (RTE) (MWh)': 'BESS Efficiency Losses (RTE) (MWh)',

    // ── CONSUMI tab ──
    'Riepilogo Portfolio Consumi / PPA / CER': 'Off-taker / PPA / CER Portfolio Summary',
    'Consumo Totale': 'Total Consumption',
    'Energia Condivisa / PPA': 'Shared Energy / PPA',
    'Ricavo PPA/CER Anno 1': 'PPA/CER Revenue Year 1',
    'Profili Consumo Attivi': 'Active Consumption Profiles',
    'Nessun profilo consumo configurato.': 'No consumption profile configured.',
    'Aggiungi Profilo Consumo': 'Add Consumption Profile',
    'Reset': 'Reset',
    'PROFILO DI CONSUMO': 'CONSUMPTION PROFILE',
    'Nome Profilo Consumo *': 'Consumption Profile Name *',
    'Impianto FV Associato *': 'Associated PV Plant *',
    '(1:1 esclusivo)': '(1:1 exclusive)',
    '— Seleziona impianto —': '— Select plant —',
    'CONTRATTO PPA': 'PPA CONTRACT',
    'Tipologia PPA': 'PPA Type',
    'PPA On-Site (autoconsumo fisico)': 'On-Site PPA (physical self-consumption)',
    'PPA Off-Site (contratto virtuale)': 'Off-Site PPA (virtual contract)',
    'CER (Comunità Energetica)': 'CER (Energy Community)',
    'Prezzo PPA (€/MWh)': 'PPA Price (€/MWh)',
    'Durata Contratto (anni)': 'Contract Duration (years)',
    'Base Condivisione CER': 'CER Sharing Basis',
    'Energia Condivisa (Minimo Prod/Cons)': 'Shared Energy (Min Prod/Cons)',
    'Totalità Energia Immessa': 'Total Grid-Fed Energy',
    'CURVA DI PRELIEVO (8760 ORE/ANNO)': 'WITHDRAWAL CURVE (8760 HOURS/YEAR)',
    'Genera automaticamente': 'Generate automatically',
    'Importa da CSV': 'Import from CSV',
    'Genera da Fasce': 'Generate by Time Bands',
    'Consumi per Fascia (kWh)': 'Consumption by Band (kWh)',
    'Ripartizione Percentuale (%)': 'Percentage Split (%)',
    'Importa CSV kWh': 'Import CSV kWh',
    'Importa CSV %': 'Import CSV %',
    'Modello kWh': 'kWh Template',
    'Modello %': '% Template',
    'Totale calcolato in tempo reale': 'Total computed in real time',
    'Il totale viene pre-ripartito su mesi e fasce in base alla Tipologia Consumo; ogni cella resta poi modificabile (kWh ↔ % sincronizzate).': 'The total is pre-distributed across months and bands based on the Consumption Type; every cell remains editable (kWh ↔ % synchronized).',
    'Consumo Annuo (MWh/anno) *': 'Annual Consumption (MWh/year) *',
    'Tipologia Consumo': 'Consumption Type',
    'Altri Usi - Solo Orario Ufficio (8-18h)': 'Other Uses - Office Hours Only (8am-6pm)',
    'Altri Usi - Due Turni (6-22h)': 'Other Uses - Two Shifts (6am-10pm)',
    'Altri Usi - Tre Turni H24 (Continuo)': 'Other Uses - Three Shifts 24/7 (Continuous)',
    'Domestico': 'Residential',
    'Illuminazione pubblica': 'Public Lighting',
    'Lavora il Sabato': 'Works on Saturdays',
    'Lavora la Domenica': 'Works on Sundays',
    'Lavora i Festivi': 'Works on Holidays',
    'Anteprima — Settimana Tipo': 'Preview — Typical Week',
    'Picco: — kW': 'Peak: — kW',
    'Seleziona file CSV (8760 righe)': 'Choose CSV file (8760 rows)',
    'Scarica Modello': 'Download Template',
    'Annulla Modifica': 'Cancel Edit',

    // ── SENSITIVITY tab ──
    'Analisi di Sensibilità Avanzata': 'Advanced Sensitivity Analysis',
    'Configurazione': 'Configuration',
    'Target KPI': 'Target KPI',
    'Equity IRR (%)': 'Equity IRR (%)',
    'DSCR Medio (x)': 'Average DSCR (x)',
    'DSCR Minimo (x)': 'Minimum DSCR (x)',
    'Variabile X': 'Variable X',
    'CAPEX Variabile (∆%)': 'Variable CAPEX (∆%)',
    'OPEX Variabile (∆%)': 'Variable OPEX (∆%)',
    'Prezzo Energia / PUN (∆%)': 'Energy Price / PUN (∆%)',
    'WACC (Abs %)': 'WACC (Abs %)',
    'Inflazione (Abs %)': 'Inflation (Abs %)',
    'Tasso Euribor (Abs %)': 'Euribor Rate (Abs %)',
    'Variabile Y (2D Matrix)': 'Variable Y (2D Matrix)',
    'Nessuna (Grafico 1D)': 'None (1D Chart)',
    'Esegui Analisi': 'Run Analysis',
    'Risultati': 'Results',
    'Imposta i parametri ed esegui l\'analisi per visualizzare i risultati.': 'Set parameters and run the analysis to view results.',
    'N. Simulazioni': 'No. of Simulations',
    'Volatilità Prezzi PUN (σ %)': 'PUN Price Volatility (σ %)',
    'Volatilità Produzione FV (σ %)': 'PV Production Volatility (σ %)',
    'Esegui Monte Carlo': 'Run Monte Carlo',
    'Distribuzione Risultati': 'Results Distribution',
    'Esegui la simulazione Monte Carlo per visualizzare i percentili.': 'Run the Monte Carlo simulation to view percentiles.',
    'Tornado Deterministico': 'Deterministic Tornado',
    'Tornado (6 variabili)': 'Tornado (6 variables)',
    'Grafico Tornado (IRR)': 'Tornado Chart (IRR)',
    'Esegui il tornado per visualizzare i driver critici dell\'IRR.': 'Run the tornado to view the critical IRR drivers.',

    // ── UTENTI tab (admin) ──
    'UTENTI': 'USERS',
    'Gestione Utenti': 'User Management',
    'Utenti registrati, ultimi accessi e stato sessione. Visibile solo al ruolo admin.': 'Registered users, recent logins and session status. Admin role only.',
    'Aggiorna': 'Refresh',
    'Stato': 'Status',
    'Registrato il': 'Registered on',
    'Confermato': 'Confirmed',
    'Ultimo accesso': 'Last sign-in',
    'Ultima attività': 'Last activity',
    'Sessioni attive': 'Active sessions',
    'Caricamento...': 'Loading...',
    '🟢 Online (attività < 1h)': '🟢 Online (activity < 1h)',
    '🟡 Sessione valida ma inattiva': '🟡 Valid but idle session',
    '⚫ Offline': '⚫ Offline',
};

const I18n = {
    lang: localStorage.getItem('asset_lang') || 'it',
    _orig: new Map(),       // textNode -> original nodeValue
    _origPh: new Map(),     // element -> original placeholder
    _observer: null,
    _applying: false,

    norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); },

    t(src) {
        if (this.lang !== 'en') return src;
        return I18N_EN[this.norm(src)] || src;
    },

    _translateNode(n) {
        const raw = n.nodeValue;
        const key = this.norm(raw);
        if (key.length < 2) return;
        if (!this._orig.has(n)) this._orig.set(n, raw);
        const tr = I18N_EN[key];
        if (tr) {
            const lead = raw.match(/^\s*/)[0];
            const trail = raw.match(/\s*$/)[0];
            const next = lead + tr + trail;
            if (n.nodeValue !== next) n.nodeValue = next;
        }
    },

    apply(root) {
        if (this.lang !== 'en') return;
        this._applying = true;
        try {
            root = root || document.body;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            nodes.forEach(n => this._translateNode(n));
            // Placeholders
            (root.querySelectorAll ? root.querySelectorAll('[placeholder]') : []).forEach(el => {
                if (!this._origPh.has(el)) this._origPh.set(el, el.getAttribute('placeholder'));
                const tr = I18N_EN[this.norm(this._origPh.get(el))];
                if (tr) el.setAttribute('placeholder', tr);
            });
        } finally {
            this._applying = false;
        }
    },

    restore() {
        this._applying = true;
        try {
            this._orig.forEach((raw, n) => { if (n.nodeValue !== undefined) n.nodeValue = raw; });
            this._orig.clear();
            this._origPh.forEach((ph, el) => el.setAttribute('placeholder', ph));
            this._origPh.clear();
        } finally {
            this._applying = false;
        }
    },

    setLang(lang, persist = true) {
        if (lang !== 'it' && lang !== 'en') return;
        const prev = this.lang;
        this.lang = lang;
        if (persist) localStorage.setItem('asset_lang', lang);
        if (lang === 'en') this.apply();
        else if (prev === 'en') this.restore();
        // Sincronizza con config Supabase (chiave 'lang' in State.inputs)
        if (window.State && window.State.inputs) {
            window.State.inputs.lang = lang;
            if (persist && typeof saveConfigDebounced === 'function') saveConfigDebounced();
        }
        // Toggle buttons
        const btnIt = document.getElementById('btn-lang-it');
        const btnEn = document.getElementById('btn-lang-en');
        if (btnIt) btnIt.className = 'px-2 py-0.5 rounded text-[10px] font-bold transition-colors ' + (lang === 'it' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200');
        if (btnEn) btnEn.className = 'px-2 py-0.5 rounded text-[10px] font-bold transition-colors ' + (lang === 'en' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200');
    },

    init() {
        // Osserva il DOM per tradurre automaticamente il contenuto dinamico
        this._observer = new MutationObserver(mutations => {
            if (this.lang !== 'en' || this._applying) return;
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        this._translateNode(node);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        this.apply(node);
                    }
                });
                if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
                    this._translateNode(m.target);
                }
            });
        });
        this._observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        // Lingua salvata in config (vince su localStorage se presente e diversa)
        if (window.State && window.State.inputs && window.State.inputs.lang && window.State.inputs.lang !== this.lang) {
            this.setLang(window.State.inputs.lang, false);
        } else if (this.lang === 'en') {
            this.apply();
        }
        this.setLang(this.lang, false);
    }
};

window.I18n = I18n;
