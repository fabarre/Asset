/**
 * TEST AUTOMATICO DI STRESS-TEST, REATTIVITÀ FORMULE & COLLAUDO FINALE WORKBOOK EXCEL (STEP 10)
 * 
 * Obiettivi:
 * 1. Scansione statica e sintattica al 100% di tutte le celle di tutti gli 11 fogli generati.
 * 2. Rilevamento a tolleranza zero di errori formula (#REF!, #VALUE!, #NAME?, #DIV/0!, #N/A, NaN, undefined).
 * 3. Verifica integrità riferimenti incrociati inter-foglio ('SHEET'!Cell).
 * 4. Caricamento del modello nell'engine di calcolo matematico HyperFormula (Handsontable).
 * 5. Stress test di sensibilità e cascata reattiva modificando 5 parametri chiave:
 *    - Leva Finanziaria (Leverage: 70% -> 60%)
 *    - Tasso Debito Senior (Interest Rate: 4.5% -> 5.5%)
 *    - Inflazione Macro (Inflation: 2% -> 3.5%)
 *    - Prezzo PPA (PPA Price: +15%)
 *    - Aliquota Ammortamento Fiscale (Fiscal Depr Rate: 9% -> 12%)
 * 6. Verifica variazione coerente e deterministica dei KPI a valle (Debito, Flussi, Imposte, Utile, FCFE).
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { Blob as NodeBlob } from 'node:buffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("========================================================");
console.log("🚀 AVVIO STEP 10: STRESS TEST GLOBALE REATTIVITÀ & COLLAUDO FORMULE");
console.log("========================================================\n");

// 1. Esecuzione del Worker di simulazione per produrre il dataset reale
const workerPath = path.join(rootDir, 'src', 'worker', 'simulation.worker.js');
const workerCode = fs.readFileSync(workerPath, 'utf8');

let lastMessage = null;
const sandbox = {
    self: {
        postMessage: (msg) => { lastMessage = msg; }
    },
    console,
    structuredClone: global.structuredClone,
    Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
    Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
};
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox);

// Profilo e impianto sintetico
const profile = sandbox.generateDefaultSolarProfile(5, 1350); // 5 MWp
const zonal = new Float64Array(8760).fill(110); // PUN 110 €/MWh
const plant = {
    id: 'p1', name: 'FV Tuscania 5MW', capacity: 5000, zone: 'CNOR',
    capex: 750, opex: 85000, enabled: true,
    generation: profile,
    codDate: '2026-06-01',
    bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
    bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
    bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
    gridVoltage: 'mt', gridConnectionKw: 5000,
    developmentCost: 150000, spvAcquisitionCost: 50000,
    marketType: 'rid', traderContractType: 'pun_orario',
    traderSpread: 2, traderDisp: 1
};

const stab = {
    id: 's1', name: 'Stabilimento Alpha', enabled: true,
    load: new Float64Array(8760).fill(600), // 600 kW base load
    ppaPrice: 95, ppaIndexation: 0.015, ppaType: 'standard',
    exciseAllocation: 'off-taker'
};

const inputs = {
    keVal: 0.08, wacc: 0.06, inflation: 0.02,
    fiscalDeprRate: 0.09, leverage: 0.75, interestRate: 0.045,
    loanTerm: 12, debtBasis: 'enterprise_value',
    sweepType: 'none', sweepValue: 0, sweepYears: 0,
    seniorGracePeriodMonths: 6, constructionMonths: 6, idcDrawdownFactor: 50,
    sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
    exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
    holdcoCapital: 10000,
    priceScenarioType: 'base',
    vatQuarterlyRefund: true,
    vatRefundLagMonths: 6,
    vatRateEpcPv: 10,
    vatRateOpex: 22
};

const state = {
    inputs,
    plants: [plant],
    stabilimenti: [stab],
    zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
    selectedBessPlantIds: null,
    previouslySeenPlantIds: null
};

state.inputs = {
    ...state.inputs,
    leverage: 0.70,
    interestRate: 0.045,
    inflation: 0.02,
    discountRate: 0.06,
    fiscalDeprRate: 0.09,
    durationYears: 20,
    enableFinanziamentoSoci: true,
    sociLoanInterestRate: 0.06,
    sociLoanGracePeriodMonths: 12,
    sociLoanRepaymentTermMonths: 60,
    sociShareholderLoanQuota: 10,
    spvDividendDistributionPolicy: 'strict_legal',
    mraAnnualPercentage: 0.015,
    taxRateIres: 0.24,
    taxRateIrap: 0.039,
    bessAugmentationCapex: 250000,
    enablePrivateDebt: false,
    enablePrivateEquity: false,
    enableAltraForma: false,
    datedCapexSchedule: [
        { date: '2026-03-15', amount: 1500000, category: 'epc_solare', description: 'Acconto EPC Fotovoltaico' },
        { date: '2026-06-30', amount: 1500000, category: 'epc_solare', description: 'Avanzamento EPC Fotovoltaico' },
        { date: '2026-09-15', amount: 2000000, category: 'bess', description: 'Fornitura Moduli BESS NMC' },
        { date: '2026-11-30', amount: 1300000, category: 'grid_connection', description: 'Allaccio Cabina MT Enel' }
    ],
    datedFundingSchedule: [
        { date: '2026-02-01', amount: 1890000, type: 'equity', description: 'Versamento Equity Iniziale' },
        { date: '2026-02-01', amount: 630000, type: 'soci', description: 'Finanziamento Soci Iniziale' },
        { date: '2026-06-01', amount: 3780000, type: 'debt', description: 'Tiraggio Finanziamento Bancario' }
    ],
    previouslySeenPlantIds: null
};

console.log("▶ Esecuzione calcolo simulazione 20 anni + 72 mesi con il Worker...");
sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
if (!lastMessage || lastMessage.status !== 'success') {
    throw new Error('Worker calculation error: ' + (lastMessage ? lastMessage.error : 'nessuna risposta'));
}
const results = lastMessage.results;
console.log(`✓ Simulazione completata: cashflow mensile=${results.monthlyCashflow.months.length} mesi.\n`);

// 2. Setup ambiente per exportPnlToExcel()
let capturedBuffer = null;
class CustomBlob extends NodeBlob {
    constructor(buffers, opts) {
        super(buffers, opts);
        if (buffers && buffers[0]) capturedBuffer = buffers[0];
    }
}
global.Blob = CustomBlob;
global.window = {
    _currentProjectName: 'Parco Solare & BESS Tuscania 5MW',
    State: {
        branding: { company: 'Green Energy Holding SPV' },
        inputs: state.inputs,
        plants: state.plants,
        stabilimenti: state.stabilimenti,
        results: results
    },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }
};
global.document = {
    body: {
        appendChild: () => {},
        removeChild: () => {}
    },
    createElement: () => ({
        click: () => {},
        style: {}
    })
};

// Carica ed esegui src/excelExport.js
const excelCode = fs.readFileSync(path.join(rootDir, 'src', 'excelExport.js'), 'utf8');
const runExport = new Function('ExcelJS', 'window', 'showToast', 'Blob', 'URL', 'document', `${excelCode}\nreturn exportPnlToExcel;`);
const exportPnlToExcel = runExport(ExcelJS, global.window, global.showToast, global.Blob, global.URL, global.document);

console.log("▶ Generazione del Workbook Excel multi-foglio tramite exportPnlToExcel()...");
await exportPnlToExcel();

if (!capturedBuffer) {
    throw new Error("❌ Nessun buffer XLSX generato!");
}
console.log(`✓ Workbook XLSX generato: ${capturedBuffer.length} byte.\n`);

// 3. Caricamento del Workbook generato in ExcelJS per audit statico approfondito
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(capturedBuffer);

const expectedSheets = [
    'COPERTINA',
    'FINANZA',
    'CAPEX',
    'OPEX',
    'DRIVER OPERATIVI',
    'AMMORTAMENTO',
    'CONTO ECONOMICO',
    'RENDICONTO FINANZIARIO SPV',
    'CONTO ECONOMICO HOLDING',
    'RENDICONTO FINANZIARIO HOLDING',
    'CASH FLOW MENSILE'
];

console.log("▶ [FASE 1] Audit statico strutturale e scansione sintassi formule...");
const existingSheetNames = workbook.worksheets.map(w => w.name);
console.log(`✓ Fogli generati (${existingSheetNames.length}):`, existingSheetNames.join(' | '));

expectedSheets.forEach(es => {
    if (!existingSheetNames.includes(es)) {
        throw new Error(`❌ Foglio atteso mancante nel Workbook: "${es}"`);
    }
});
console.log("✓ Tutti gli 11 fogli modello FAST sono presenti nel Workbook.");

let totalCellsScanned = 0;
let totalFormulasScanned = 0;
const crossSheetRefs = new Set();
const syntaxErrors = [];

workbook.worksheets.forEach(ws => {
    ws.eachRow((row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            totalCellsScanned++;
            let formulaStr = null;

            if (cell.formula) {
                formulaStr = cell.formula;
            } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                formulaStr = cell.value.formula;
            }

            if (formulaStr) {
                totalFormulasScanned++;

                // 1. Controllo errori noti in formato stringa
                const errPatterns = ['#REF!', '#VALUE!', '#NAME?', '#DIV/0!', '#N/A', 'NaN', 'undefined', '[object Object]'];
                errPatterns.forEach(err => {
                    if (formulaStr.includes(err)) {
                        syntaxErrors.push({
                            sheet: ws.name,
                            cell: `${cell.address}`,
                            error: `Contiene token di errore "${err}"`,
                            formula: formulaStr
                        });
                    }
                });

                // 2. Controllo bilanciamento parentesi
                let depth = 0;
                for (let ch of formulaStr) {
                    if (ch === '(') depth++;
                    if (ch === ')') depth--;
                    if (depth < 0) break;
                }
                if (depth !== 0) {
                    syntaxErrors.push({
                        sheet: ws.name,
                        cell: `${cell.address}`,
                        error: `Parentesi sbilanciate (delta=${depth})`,
                        formula: formulaStr
                    });
                }

                // 3. Controllo riferimenti inter-foglio
                const refMatches = formulaStr.match(/'([^']+)'!|[A-Za-z0-9_]+!/g);
                if (refMatches) {
                    refMatches.forEach(ref => {
                        const targetSheet = ref.replace(/['!]/g, '');
                        crossSheetRefs.add(targetSheet);
                        if (!existingSheetNames.includes(targetSheet)) {
                            syntaxErrors.push({
                                sheet: ws.name,
                                cell: `${cell.address}`,
                                error: `Riferimento a foglio inesistente: "${targetSheet}"`,
                                formula: formulaStr
                            });
                        }
                    });
                }
            }
        });
    });
});

console.log(`✓ Scansione completata: ${totalCellsScanned} celle totali, ${totalFormulasScanned} formule analizzate.`);
console.log(`✓ Riferimenti inter-foglio censiti (${crossSheetRefs.size}):`, Array.from(crossSheetRefs).join(', '));

if (syntaxErrors.length > 0) {
    console.error("❌ ERRORI SINTATTICI RILEVATI NELLE FORMULE:");
    syntaxErrors.forEach(e => console.error(`   [${e.sheet}!${e.cell}] ${e.error} in: ${e.formula}`));
    throw new Error(`Rilevati ${syntaxErrors.length} errori sintattici nelle formule Excel.`);
}
console.log("✓ Zero errori di sintassi, zero token #REF!/#VALUE!/#NAME!/#DIV/0!/NaN/undefined nel Workbook.\n");

// 4. [FASE 2] Costruzione del modello di calcolo in HyperFormula (Handsontable Engine)
console.log("▶ [FASE 2] Inizializzazione HyperFormula Engine per verifica di ricalcolo dinamico...");

// Convertiamo tutti i fogli del Workbook in matrici 2D per HyperFormula
const hfSheets = {};

workbook.worksheets.forEach(ws => {
    const maxRow = ws.rowCount || 1;
    const maxCol = ws.columnCount || 1;
    const matrix = [];

    for (let r = 1; r <= maxRow; r++) {
        const rowData = [];
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
            const cell = row.getCell(c);
            let val = null;

            if (cell.formula) {
                val = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
            } else if (cell.value && typeof cell.value === 'object') {
                if (cell.value.formula) {
                    val = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
                } else if (cell.value.result !== undefined) {
                    val = cell.value.result;
                } else {
                    val = null;
                }
            } else if (cell.value !== undefined && cell.value !== null) {
                val = cell.value;
            }
            rowData.push(val);
        }
        matrix.push(rowData);
    }
    hfSheets[ws.name] = matrix;
});

// HyperFormula supporta opzioni di localizzazione e licenza gpl-v3 per testing
const hf = HyperFormula.buildFromSheets(hfSheets, {
    licenseKey: 'gpl-v3',
    useColumnIndex: true,
    precisionRounding: 6
});

console.log(`✓ HyperFormula Engine inizializzato con successo: ${Object.keys(hfSheets).length} fogli integrati.`);

// 5. Scansione degli errori di calcolo in HyperFormula su tutti i fogli
let calculationErrors = 0;
Object.keys(hfSheets).forEach(sheetName => {
    const sheetId = hf.getSheetId(sheetName);
    const dimensions = hf.getSheetDimensions(sheetId);
    
    for (let r = 0; r < dimensions.height; r++) {
        for (let c = 0; c < dimensions.width; c++) {
            const cellVal = hf.getCellValue({ col: c, row: r, sheet: sheetId });
            if (cellVal && typeof cellVal === 'object' && cellVal.type && cellVal.type.includes('ERROR')) {
                // Ignore empty or trivial errors on unpopulated trailing cells if any
                calculationErrors++;
                const rawFormula = hf.getCellFormula({ col: c, row: r, sheet: sheetId });
                console.error(`   ❌ [${sheetName}!R${r+1}C${c+1}] Errore di calcolo: ${cellVal.type} (${cellVal.message}) - Formula: ${rawFormula}`);
            }
        }
    }
});

if (calculationErrors > 0) {
    throw new Error(`Rilevati ${calculationErrors} errori di calcolo nell'engine HyperFormula.`);
}
console.log("✓ Valutazione HyperFormula completata: 0 errori (#VALUE!, #REF!, #DIV/0!, #CYCLE!) su tutti i fogli.\n");

// 6. [FASE 3] Stress-Test di Reattività e Propagazione a Cascata (5 Macro-Parametri)
console.log("▶ [FASE 3] Esecuzione Stress-Test di Reattività e Sensibilità Macro-Finanziaria...");

const finSheetId = hf.getSheetId('FINANZA');
const debtSheetId = hf.getSheetId('AMMORTAMENTO');
const ceSheetId = hf.getSheetId('CONTO ECONOMICO');
const rfSheetId = hf.getSheetId('RENDICONTO FINANZIARIO SPV');
const drvSheetId = hf.getSheetId('DRIVER OPERATIVI');
const capexSheetId = hf.getSheetId('CAPEX');

// Helper per trovare riga in FINANZA dato il nome del parametro
function findRowInSheet(sheetName, labelPattern, colIndex = 0) {
    const sheetId = hf.getSheetId(sheetName);
    const dim = hf.getSheetDimensions(sheetId);
    for (let r = 0; r < dim.height; r++) {
        const val = String(hf.getCellValue({ col: colIndex, row: r, sheet: sheetId }) || '');
        if (val.includes(labelPattern)) {
            return r;
        }
    }
    return -1;
}

// -------------------------------------------------------------
// TEST SENSITIVITY 1: Leva Finanziaria (Leverage: 75% -> 60%)
// -------------------------------------------------------------
console.log("▶ [Test 1/5] Alterazione Leva Finanziaria (Leverage: 75% -> 60%)...");
const rowLeverage = findRowInSheet('FINANZA', 'Leverage');
const rowDebt = findRowInSheet('FINANZA', 'Debito Bancario');
const rowEquity = findRowInSheet('FINANZA', 'Totale Equity SPV');
if (rowLeverage === -1 || rowDebt === -1 || rowEquity === -1) {
    throw new Error(`Parametri FINANZA per Test 1 non trovati: rowLeverage=${rowLeverage}, rowDebt=${rowDebt}, rowEquity=${rowEquity}`);
}

const initialLeverage = hf.getCellValue({ col: 1, row: rowLeverage, sheet: finSheetId });
const initialDebt = hf.getCellValue({ col: 1, row: rowDebt, sheet: finSheetId });
const initialEquity = hf.getCellValue({ col: 1, row: rowEquity, sheet: finSheetId });
// In AMMORTAMENTO: riga "Debito Residuo Inizio Anno" (colonna 2 = Anno 1, colonna 1 è Anno 0)
const rowDebtBegin = findRowInSheet('AMMORTAMENTO', 'Debito Residuo Inizio Anno');
if (rowDebtBegin === -1) throw new Error("Riga Debito Residuo Inizio Anno non trovata in AMMORTAMENTO!");
const initialSeniorDebtInSchedule = hf.getCellValue({ col: 2, row: rowDebtBegin, sheet: debtSheetId });

console.log(`   Stato Iniziale: Leverage=${(initialLeverage * 100).toFixed(1)}%, Debito=${Math.round(initialDebt).toLocaleString()} €, Equity=${Math.round(initialEquity).toLocaleString()} €, Inizio Debito AMMORTAMENTO=${Math.round(initialSeniorDebtInSchedule).toLocaleString()} €`);

// Modifica cella valore leverage a 0.60
hf.setCellContents({ col: 1, row: rowLeverage, sheet: finSheetId }, [[0.60]]);

const updatedDebt = hf.getCellValue({ col: 1, row: rowDebt, sheet: finSheetId });
const updatedEquity = hf.getCellValue({ col: 1, row: rowEquity, sheet: finSheetId });
const updatedSeniorDebtInSchedule = hf.getCellValue({ col: 2, row: rowDebtBegin, sheet: debtSheetId });

console.log(`   Stato Ricalcolato: Leverage=60.0%, Debito=${Math.round(updatedDebt).toLocaleString()} €, Equity=${Math.round(updatedEquity).toLocaleString()} €, Inizio Debito AMMORTAMENTO=${Math.round(updatedSeniorDebtInSchedule).toLocaleString()} €`);

if (updatedDebt >= initialDebt) throw new Error("Il debito non è diminuito dopo la riduzione della leva!");
if (updatedEquity <= initialEquity) throw new Error("L'equity non è aumentata per compensare la riduzione del debito!");
if (Math.abs(updatedSeniorDebtInSchedule - updatedDebt) > 1) {
    throw new Error(`Disallineamento cascata AMMORTAMENTO: atteso ${updatedDebt}, trovato ${updatedSeniorDebtInSchedule}`);
}
console.log("   ✓ Test 1 Superato: Cascata FINANZA -> Usi/Fonti -> AMMORTAMENTO reattiva e coerente al 100%.\n");

// Ripristina leverage iniziale per isolare i test successivi
hf.setCellContents({ col: 1, row: rowLeverage, sheet: finSheetId }, [[initialLeverage]]);

// -------------------------------------------------------------
// TEST SENSITIVITY 2: Tasso di Interesse Senior (activeRate: 4.5% -> 5.5%)
// -------------------------------------------------------------
console.log("▶ [Test 2/5] Alterazione Tasso Debito Senior (Interest Rate: 4.5% -> 5.5%)...");
const rowRate = findRowInSheet('FINANZA', 'Tasso Interesse Debito Senior');
if (rowRate === -1) throw new Error("Parametro tasso debito non trovato in FINANZA!");

const initialRate = hf.getCellValue({ col: 1, row: rowRate, sheet: finSheetId });
// Leggiamo la quota interessi Anno 2 in AMMORTAMENTO (colonna 3 = Anno 2, colonna 2 è Anno 1)
const rowIntAccrued = findRowInSheet('AMMORTAMENTO', 'Quota Interessi Mutuo');
if (rowIntAccrued === -1) throw new Error("Riga Quota Interessi Mutuo non trovata in AMMORTAMENTO!");
const initialIntY2 = hf.getCellValue({ col: 3, row: rowIntAccrued, sheet: debtSheetId });

// Leggiamo oneri finanziari in CONTO ECONOMICO Anno 2 (colonna 3 = Anno 2)
const rowCeInterest = findRowInSheet('CONTO ECONOMICO', 'Interessi Passivi Mutuo Bancario');
const rowCeEbt = findRowInSheet('CONTO ECONOMICO', 'EBT — Utile ante Imposte');
if (rowCeInterest === -1 || rowCeEbt === -1) throw new Error(`Righe CE per oneri o EBT non trovate: interest=${rowCeInterest}, ebt=${rowCeEbt}`);
const initialCeIntY2 = hf.getCellValue({ col: 3, row: rowCeInterest, sheet: ceSheetId });
const initialCeEbtY2 = hf.getCellValue({ col: 3, row: rowCeEbt, sheet: ceSheetId });

console.log(`   Stato Iniziale: Tasso=${(initialRate * 100).toFixed(2)}%, Interessi Y2 AMMORTAMENTO=${Math.round(initialIntY2).toLocaleString()} €, CE Oneri=${Math.round(initialCeIntY2).toLocaleString()} €, CE EBT=${Math.round(initialCeEbtY2).toLocaleString()} €`);

// Modifica cella tasso a 0.055
hf.setCellContents({ col: 1, row: rowRate, sheet: finSheetId }, [[0.055]]);

const updatedIntY2 = hf.getCellValue({ col: 3, row: rowIntAccrued, sheet: debtSheetId });
const updatedCeIntY2 = hf.getCellValue({ col: 3, row: rowCeInterest, sheet: ceSheetId });
const updatedCeEbtY2 = hf.getCellValue({ col: 3, row: rowCeEbt, sheet: ceSheetId });

console.log(`   Stato Ricalcolato: Tasso=5.50%, Interessi Y2 AMMORTAMENTO=${Math.round(updatedIntY2).toLocaleString()} €, CE Oneri=${Math.round(updatedCeIntY2).toLocaleString()} €, CE EBT=${Math.round(updatedCeEbtY2).toLocaleString()} €`);

if (Math.abs(updatedIntY2) <= Math.abs(initialIntY2)) throw new Error("Gli interessi passivi non sono aumentati con l'aumento del tasso!");
if (updatedCeEbtY2 >= initialCeEbtY2) throw new Error("L'EBT non è diminuito dopo l'aumento degli oneri finanziari!");
if (Math.abs(updatedCeIntY2 - updatedIntY2) > 1) {
    throw new Error(`Disallineamento tra AMMORTAMENTO e CONTO ECONOMICO: ${updatedIntY2} vs ${updatedCeIntY2}`);
}
console.log("   ✓ Test 2 Superato: Cascata FINANZA -> AMMORTAMENTO -> CONTO ECONOMICO (Oneri ed EBT) reattiva al 100%.\n");

// Ripristina tasso
hf.setCellContents({ col: 1, row: rowRate, sheet: finSheetId }, [[initialRate]]);

// -------------------------------------------------------------
// TEST SENSITIVITY 3: Inflazione Macroeconomica (Inflation: 2% -> 3.5%)
// -------------------------------------------------------------
console.log("▶ [Test 3/5] Alterazione Tasso di Inflazione Macro (2.0% -> 3.5%)...");
const rowInf = findRowInSheet('FINANZA', 'Inflazione Media Attesa');
if (rowInf === -1) throw new Error("Parametro Inflazione non trovato in FINANZA!");

const initialInf = hf.getCellValue({ col: 1, row: rowInf, sheet: finSheetId });
// Controlliamo OPEX Totale in CONTO ECONOMICO ad Anno 5 (colonna 6 = Anno 5)
const rowOpexTot = findRowInSheet('CONTO ECONOMICO', 'COSTI OPERATIVI (OPEX) TOTALE');
if (rowOpexTot === -1) throw new Error("Riga COSTI OPERATIVI (OPEX) TOTALE non trovata in CONTO ECONOMICO!");
const initialOpexY5 = hf.getCellValue({ col: 6, row: rowOpexTot, sheet: ceSheetId });

console.log(`   Stato Iniziale: Inflazione=${(initialInf * 100).toFixed(1)}%, OPEX Anno 5=${Math.round(initialOpexY5).toLocaleString()} €`);

// Modifica inflazione a 0.035
hf.setCellContents({ col: 1, row: rowInf, sheet: finSheetId }, [[0.035]]);

const updatedOpexY5 = hf.getCellValue({ col: 6, row: rowOpexTot, sheet: ceSheetId });
console.log(`   Stato Ricalcolato: Inflazione=3.5%, OPEX Anno 5=${Math.round(updatedOpexY5).toLocaleString()} €`);

if (Math.abs(updatedOpexY5) <= Math.abs(initialOpexY5)) {
    throw new Error("L'OPEX non è aumentato all'aumentare del tasso di inflazione!");
}
console.log("   ✓ Test 3 Superato: Cascata FINANZA -> DRIVER OPERATIVI -> Escalation OPEX pluriennale reattiva al 100%.\n");

// Ripristina inflazione
hf.setCellContents({ col: 1, row: rowInf, sheet: finSheetId }, [[initialInf]]);

// -------------------------------------------------------------
// TEST SENSITIVITY 4: Prezzo Energia Rete / RID (+15%)
// -------------------------------------------------------------
console.log("▶ [Test 4/5] Alterazione Prezzo Energia Rete / RID (+15%)...");
let rowEnergyPrice = findRowInSheet('DRIVER OPERATIVI', 'Prezzo Unitario RID FV');
if (rowEnergyPrice === -1) rowEnergyPrice = findRowInSheet('DRIVER OPERATIVI', 'Prezzo Unitario PPA');
if (rowEnergyPrice === -1) throw new Error("Tariffa RID/PPA non trovata in DRIVER OPERATIVI!");

// In DRIVER OPERATIVI, Anno 1 è colonna 2
const initialEnergyPrice = hf.getCellValue({ col: 2, row: rowEnergyPrice, sheet: drvSheetId });
let rowRevEnergy = findRowInSheet('CONTO ECONOMICO', 'Ricavi da RID');
if (rowRevEnergy === -1) rowRevEnergy = findRowInSheet('CONTO ECONOMICO', 'Ricavi da PPA');
const rowCfads = findRowInSheet('RENDICONTO FINANZIARIO SPV', 'CFADS SPV');
if (rowRevEnergy === -1 || rowCfads === -1) throw new Error(`Righe Ricavi Energia o CFADS non trovate: rev=${rowRevEnergy}, cfads=${rowCfads}`);

const initialRevEnergyY1 = hf.getCellValue({ col: 2, row: rowRevEnergy, sheet: ceSheetId });
const initialCfadsY1 = hf.getCellValue({ col: 2, row: rowCfads, sheet: rfSheetId });

console.log(`   Stato Iniziale: Prezzo Energia=${initialEnergyPrice} €/MWh, Ricavi Y1=${Math.round(initialRevEnergyY1).toLocaleString()} €, CFADS Y1=${Math.round(initialCfadsY1).toLocaleString()} €`);

const newEnergyPrice = Math.round(initialEnergyPrice * 1.15 * 100) / 100;
// Impostiamo il nuovo prezzo su tutti gli anni operativi (da col 1 a 21)
for (let y = 1; y <= 21; y++) {
    hf.setCellContents({ col: y, row: rowEnergyPrice, sheet: drvSheetId }, [[newEnergyPrice]]);
}

const updatedRevEnergyY1 = hf.getCellValue({ col: 2, row: rowRevEnergy, sheet: ceSheetId });
const updatedCfadsY1 = hf.getCellValue({ col: 2, row: rowCfads, sheet: rfSheetId });

console.log(`   Stato Ricalcolato: Prezzo Energia=${newEnergyPrice} €/MWh, Ricavi Y1=${Math.round(updatedRevEnergyY1).toLocaleString()} €, CFADS Y1=${Math.round(updatedCfadsY1).toLocaleString()} €`);

if (updatedRevEnergyY1 <= initialRevEnergyY1) throw new Error("I ricavi energia non sono aumentati con l'aumento del prezzo!");
if (updatedCfadsY1 <= initialCfadsY1) throw new Error("Il CFADS non è aumentato coerentemente con l'incremento di ricavi!");
console.log("   ✓ Test 4 Superato: Cascata DRIVER OPERATIVI -> Ricavi P&L -> CFADS Rendiconto Finanziario reattiva al 100%.\n");

// Ripristina prezzo
for (let y = 1; y <= 21; y++) {
    hf.setCellContents({ col: y, row: rowEnergyPrice, sheet: drvSheetId }, [[initialEnergyPrice]]);
}

// -------------------------------------------------------------
// TEST SENSITIVITY 5: Aliquota Ammortamento Fiscale (9% -> 12%)
// -------------------------------------------------------------
console.log("▶ [Test 5/5] Alterazione Aliquota Ammortamento Fiscale (9% -> 12%)...");
const rowFiscalDeprRate = findRowInSheet('FINANZA', 'Tasso di Ammortamento Fiscale');
if (rowFiscalDeprRate === -1) throw new Error("Aliquota ammortamento fiscale non trovata in FINANZA!");

const initialDeprRate = hf.getCellValue({ col: 1, row: rowFiscalDeprRate, sheet: finSheetId });
const rowCapexDepr = findRowInSheet('CAPEX', 'Quota Ammortamento EPC Solar');
if (rowCapexDepr === -1) throw new Error("Riga Quota Ammortamento EPC Solar non trovata in CAPEX!");
// In CAPEX la colonna del totale portafoglio è prima dell'aliquota
const capexDim = hf.getSheetDimensions(capexSheetId);
const totCapexCol = capexDim.width - 2;
const initialCapexDepr = hf.getCellValue({ col: totCapexCol, row: rowCapexDepr, sheet: capexSheetId });

const rowCeDepr = findRowInSheet('CONTO ECONOMICO', 'di cui: Ammortamento Impianti Solari');
if (rowCeDepr === -1) throw new Error("Riga Ammortamento Impianti Solari non trovata in CONTO ECONOMICO!");
// Anno 1 è colonna 2
const initialCeDeprY1 = hf.getCellValue({ col: 2, row: rowCeDepr, sheet: ceSheetId });

console.log(`   Stato Iniziale: Aliquota=${(initialDeprRate * 100).toFixed(1)}%, Quota CAPEX=${Math.round(initialCapexDepr).toLocaleString()} €, CE Amm. Solare Y1=${Math.round(initialCeDeprY1).toLocaleString()} €`);

// Modifica aliquota a 12%
hf.setCellContents({ col: 1, row: rowFiscalDeprRate, sheet: finSheetId }, [[0.12]]);

const updatedCapexDepr = hf.getCellValue({ col: totCapexCol, row: rowCapexDepr, sheet: capexSheetId });
const updatedCeDeprY1 = hf.getCellValue({ col: 2, row: rowCeDepr, sheet: ceSheetId });

console.log(`   Stato Ricalcolato: Aliquota=12.0%, Quota CAPEX=${Math.round(updatedCapexDepr).toLocaleString()} €, CE Amm. Solare Y1=${Math.round(updatedCeDeprY1).toLocaleString()} €`);

if (updatedCapexDepr <= initialCapexDepr) throw new Error("La quota ammortamento CAPEX non è aumentata con l'aumento dell'aliquota!");
if (Math.abs(updatedCeDeprY1) <= Math.abs(initialCeDeprY1)) throw new Error("L'ammortamento a conto economico non è aumentato!");
console.log("   ✓ Test 5 Superato: Cascata FINANZA -> CAPEX -> CONTO ECONOMICO (Ammortamenti e Base Fiscale) reattiva al 100%.\n");

// Ripristina aliquota
hf.setCellContents({ col: 1, row: rowFiscalDeprRate, sheet: finSheetId }, [[initialDeprRate]]);

// -------------------------------------------------------------
// TEST SENSITIVITY 6: Tendina Base Computo Debito Senior (debtBasis)
// -------------------------------------------------------------
console.log("▶ [Test 6/8] Alterazione Tendina Base di Computo Debito Senior (debtBasis)...");
const rowDebtBasis = findRowInSheet('FINANZA', 'Base di Computo Debito Senior');
const rowBankable = findRowInSheet('FINANZA', 'Base Finanziabile Effettiva');
const rowCheck = findRowInSheet('FINANZA', 'Controllo Squadratura (Usi - Fonti)');
if (rowDebtBasis === -1 || rowBankable === -1 || rowCheck === -1) {
    throw new Error(`Parametri debtBasis non trovati in FINANZA: basis=${rowDebtBasis}, bankable=${rowBankable}, check=${rowCheck}`);
}

const initialDebtBasis = hf.getCellValue({ col: 1, row: rowDebtBasis, sheet: finSheetId });
const initialBankable = hf.getCellValue({ col: 1, row: rowBankable, sheet: finSheetId });
const initialDebt6 = hf.getCellValue({ col: 1, row: rowDebt, sheet: finSheetId });
console.log(`   Stato Iniziale: debtBasis='${initialDebtBasis}', Base Finanziabile=${Math.round(initialBankable).toLocaleString()} €, Debito=${Math.round(initialDebt6).toLocaleString()} €`);

// Commuta su 'Solo Hard Costs (EPC FV + BESS + Connessione)'
hf.setCellContents({ col: 1, row: rowDebtBasis, sheet: finSheetId }, [['Solo Hard Costs (EPC FV + BESS + Connessione)']]);

const updatedBankable6 = hf.getCellValue({ col: 1, row: rowBankable, sheet: finSheetId });
const updatedDebt6 = hf.getCellValue({ col: 1, row: rowDebt, sheet: finSheetId });
const checkVal6 = hf.getCellValue({ col: 1, row: rowCheck, sheet: finSheetId });
console.log(`   Stato Ricalcolato: debtBasis='Solo Hard Costs', Base Finanziabile=${Math.round(updatedBankable6).toLocaleString()} €, Debito=${Math.round(updatedDebt6).toLocaleString()} €, Squadratura=${Math.round(checkVal6)} €`);

if (updatedBankable6 >= initialBankable) throw new Error("La base finanziabile non si è ridotta selezionando Solo Hard Costs!");
if (updatedDebt6 >= initialDebt6) throw new Error("Il debito non è diminuito all'esclusione di sviluppo e altre voci!");
if (Math.abs(checkVal6) > 0.01) throw new Error(`Squadratura fonti rilevata: ${checkVal6}`);
console.log("   ✓ Test 6 Superato: Tendina debtBasis reattiva su bankableBase, debito senior e pareggio Usi=Fonti al 100%.\n");

// Ripristina debtBasis
hf.setCellContents({ col: 1, row: rowDebtBasis, sheet: finSheetId }, [[initialDebtBasis]]);

// -------------------------------------------------------------
// TEST SENSITIVITY 7: Tendina Private Debt Attivo e Fonti Mezzanine (pdEnabled)
// -------------------------------------------------------------
console.log("▶ [Test 7/8] Alterazione Tendina Private Debt Attivo (pdEnabled SÌ -> NO)...");
const rowPdEnabled = findRowInSheet('FINANZA', 'Private Debt Attivo');
const rowPdAmountType = findRowInSheet('FINANZA', 'Modalità Importo Private Debt');
const rowPdAmountValue = findRowInSheet('FINANZA', 'Valore Importo Private Debt');
const rowPdFonti = findRowInSheet('FINANZA', 'Private Debt (Holding Level)');
const rowOtherEq = findRowInSheet('FINANZA', 'Sponsor Pure Equity');
if (rowPdEnabled === -1 || rowPdAmountType === -1 || rowPdAmountValue === -1 || rowPdFonti === -1 || rowOtherEq === -1) {
    throw new Error("Parametri Private Debt non trovati in FINANZA!");
}

// Imposta PD attivo al 2% della base finanziabile (103.000 €, capiente rispetto a pure equity)
hf.setCellContents({ col: 1, row: rowPdEnabled, sheet: finSheetId }, [['SÌ']]);
hf.setCellContents({ col: 1, row: rowPdAmountType, sheet: finSheetId }, [['% Base Finanziabile']]);
hf.setCellContents({ col: 1, row: rowPdAmountValue, sheet: finSheetId }, [[0.02]]);

const pdValActive = hf.getCellValue({ col: 1, row: rowPdFonti, sheet: finSheetId });
const otherEqActive = hf.getCellValue({ col: 1, row: rowOtherEq, sheet: finSheetId });
const checkVal7Active = hf.getCellValue({ col: 1, row: rowCheck, sheet: finSheetId });
console.log(`   Stato con PD Attivo: pdFonti=${Math.round(pdValActive).toLocaleString()} €, Sponsor Equity=${Math.round(otherEqActive).toLocaleString()} €, Squadratura=${Math.round(checkVal7Active)} €`);

if (pdValActive <= 0) throw new Error("pdFonti non è stato calcolato positivamente con pdEnabled=SÌ!");
if (Math.abs(checkVal7Active) > 0.01) throw new Error(`Squadratura Usi=Fonti con PD attivo: ${checkVal7Active}`);

// Spegni PD impostando 'NO' da tendina
hf.setCellContents({ col: 1, row: rowPdEnabled, sheet: finSheetId }, [['NO']]);

const pdValOff = hf.getCellValue({ col: 1, row: rowPdFonti, sheet: finSheetId });
const otherEqOff = hf.getCellValue({ col: 1, row: rowOtherEq, sheet: finSheetId });
const checkVal7Off = hf.getCellValue({ col: 1, row: rowCheck, sheet: finSheetId });
console.log(`   Stato con PD Disattivato: pdFonti=${Math.round(pdValOff).toLocaleString()} €, Sponsor Equity=${Math.round(otherEqOff).toLocaleString()} €, Squadratura=${Math.round(checkVal7Off)} €`);

if (pdValOff !== 0) throw new Error(`pdFonti atteso 0 dopo pdEnabled=NO, trovato: ${pdValOff}`);
if (otherEqOff <= otherEqActive) throw new Error("Lo sponsor equity non ha compensato l'azzeramento del Private Debt!");
if (Math.abs(checkVal7Off) > 0.01) throw new Error(`Squadratura Usi=Fonti con PD spento: ${checkVal7Off}`);
console.log("   ✓ Test 7 Superato: Tendina pdEnabled e formula dinamica pdFonti/otherEq reattiva con quadratura perfetta al 100%.\n");

// -------------------------------------------------------------
// TEST SENSITIVITY 8: Tendina Strategia di Uscita (exitOption)
// -------------------------------------------------------------
console.log("▶ [Test 8/8] Alterazione Tendina Strategia di Uscita (exitOption) su Holding Exit EV...");
const rfHcSheetId = hf.getSheetId('RENDICONTO FINANZIARIO HOLDING');
const rowExitOption = findRowInSheet('FINANZA', 'Opzione di Uscita');
const rowExitMultiple = findRowInSheet('FINANZA', 'Multiplo EBITDA di Uscita');
const rowExitMwp = findRowInSheet('FINANZA', 'Valutazione di Uscita per MWp');
const rowExitFixed = findRowInSheet('FINANZA', 'Valutazione Enterprise Value Fissa');
const rowRfHcExitEv = findRowInSheet('RENDICONTO FINANZIARIO HOLDING', 'di cui: Enterprise Value di Exit');

if (rowExitOption === -1 || rowExitMultiple === -1 || rowExitMwp === -1 || rowExitFixed === -1 || rowRfHcExitEv === -1) {
    throw new Error(`Parametri Exit non trovati: opt=${rowExitOption}, mult=${rowExitMultiple}, mwp=${rowExitMwp}, fixed=${rowExitFixed}, rfHc=${rowRfHcExitEv}`);
}

// Configura parametri numerici
hf.setCellContents({ col: 1, row: rowExitMultiple, sheet: finSheetId }, [[10]]);
hf.setCellContents({ col: 1, row: rowExitMwp, sheet: finSheetId }, [[1200000]]);
hf.setCellContents({ col: 1, row: rowExitFixed, sheet: finSheetId }, [[7500000]]);

// Test 8.a: Valore per MWp (5 MWp * 1.200.000 €/MWp = 6.000.000 €)
hf.setCellContents({ col: 1, row: rowExitOption, sheet: finSheetId }, [['Valore per MWp']]);
// Anno 20 è colonna 21 (colonna 1 è Anno 0)
const exitEvMwp = hf.getCellValue({ col: 21, row: rowRfHcExitEv, sheet: rfHcSheetId });
console.log(`   Stato con exitOption='Valore per MWp': Exit EV Y20=${Math.round(exitEvMwp).toLocaleString()} €`);
if (Math.abs(exitEvMwp - 6000000) > 100) {
    throw new Error(`Exit EV per MWp errato: atteso ~6,000,000 €, trovato ${exitEvMwp}`);
}

// Test 8.b: Enterprise Value Fissa (7.500.000 €)
hf.setCellContents({ col: 1, row: rowExitOption, sheet: finSheetId }, [['Enterprise Value Fissa']]);
const exitEvFixed = hf.getCellValue({ col: 21, row: rowRfHcExitEv, sheet: rfHcSheetId });
console.log(`   Stato con exitOption='Enterprise Value Fissa': Exit EV Y20=${Math.round(exitEvFixed).toLocaleString()} €`);
if (Math.abs(exitEvFixed - 7500000) > 100) {
    throw new Error(`Exit EV Fissa errato: atteso ~7,500,000 €, trovato ${exitEvFixed}`);
}

// Test 8.c: Multiplo EBITDA (10x EBITDA Y20)
hf.setCellContents({ col: 1, row: rowExitOption, sheet: finSheetId }, [['Multiplo EBITDA']]);
const rowEbitda = findRowInSheet('CONTO ECONOMICO', 'MARGINE OPERATIVO LORDO (EBITDA)');
const ebitdaY20 = hf.getCellValue({ col: 21, row: rowEbitda, sheet: ceSheetId });
const exitEvMultiple = hf.getCellValue({ col: 21, row: rowRfHcExitEv, sheet: rfHcSheetId });
console.log(`   Stato con exitOption='Multiplo EBITDA': EBITDA Y20=${Math.round(ebitdaY20).toLocaleString()} €, Exit EV Y20=${Math.round(exitEvMultiple).toLocaleString()} €`);
if (Math.abs(exitEvMultiple - (ebitdaY20 * 10)) > 100) {
    throw new Error(`Exit EV Multiplo errato: atteso ${ebitdaY20 * 10}, trovato ${exitEvMultiple}`);
}
console.log("   ✓ Test 8 Superato: Tendina exitOption reattiva su Enterprise Value Holding (EBITDA, MWp, EV Fissa) al 100%.\n");

console.log("========================================================");
console.log("🎉 TUTTI GLI 8 STRESS TEST DI REATTIVITÀ DINAMICA & TENDINE SUPERATI AL 100%!");
console.log("========================================================\n");
