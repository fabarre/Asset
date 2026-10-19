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
console.log("🧪 TEST AUTOMATIZZATO: EXCEL EXPORT FULL VS SPV-ONLY");
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
    load: new Float64Array(8760).fill(600),
    ppaPrice: 95, ppaIndexation: 0.015, ppaType: 'standard',
    exciseAllocation: 'off-taker'
};

const inputs = {
    keVal: 0.08, wacc: 0.06, inflation: 0.02,
    fiscalDeprRate: 0.09, leverage: 0.70, interestRate: 0.045,
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
    vatRateOpex: 22,
    discountRate: 0.06,
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

const state = {
    inputs,
    plants: [plant],
    stabilimenti: [stab],
    zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
    selectedBessPlantIds: null,
    previouslySeenPlantIds: null
};

console.log("▶ Esecuzione calcolo simulazione 20 anni + 72 mesi con il Worker...");
sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
if (!lastMessage || lastMessage.status !== 'success') {
    throw new Error('Worker calculation error: ' + (lastMessage ? lastMessage.error : 'nessuna risposta'));
}
const results = lastMessage.results;
console.log(`✓ Simulazione completata: orizzonte ${results.monthlyCashflow.months.length} mesi.`);

// Setup sandbox export
let lastDownloadedFile = null;
let lastCapturedBuffer = null;

class CustomBlob extends NodeBlob {
    constructor(buffers, opts) {
        super(buffers, opts);
        if (buffers && buffers[0]) lastCapturedBuffer = buffers[0];
    }
}
global.Blob = CustomBlob;
global.window = {
    _currentProjectName: undefined, // Test default fallback to 'Solans Srl'
    State: {
        branding: {},
        inputs: state.inputs,
        plants: state.plants,
        stabilimenti: state.stabilimenti,
        results: results
    },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }
};
global.document = {
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({
        set download(val) { lastDownloadedFile = val; },
        get download() { return lastDownloadedFile; },
        click: () => {},
        style: {}
    })
};
global.showToast = (msg, type) => console.log(`[Toast ${type}] ${msg}`);

const excelCode = fs.readFileSync(path.join(rootDir, 'src', 'excelExport.js'), 'utf8');
const runExport = new Function('ExcelJS', 'window', 'showToast', 'Blob', 'URL', 'document', `${excelCode}\nreturn exportPnlToExcel;`);
const exportPnlToExcel = runExport(ExcelJS, global.window, global.showToast, global.Blob, global.URL, global.document);

// -------------------------------------------------------------
// TEST 1: Esportazione Completa (SPV + Holding)
// -------------------------------------------------------------
console.log("\n▶ TEST 1: Esportazione Completa exportPnlToExcel()...");
lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel();

if (!lastCapturedBuffer) throw new Error("Buffer XLSX full non generato!");
console.log(`✓ File generato: ${lastDownloadedFile} (${lastCapturedBuffer.length} byte)`);
if (lastDownloadedFile !== 'PL_Driver_Operativi.xlsx') {
    throw new Error(`Filename errato: atteso PL_Driver_Operativi.xlsx, ottenuto ${lastDownloadedFile}`);
}

const wbFull = new ExcelJS.Workbook();
await wbFull.xlsx.load(lastCapturedBuffer);
const fullSheets = wbFull.worksheets.map(w => w.name);
console.log(`✓ Fogli generati (${fullSheets.length}): ${fullSheets.join(' | ')}`);

const expectedFullSheets = [
    'COPERTINA', 'DRIVER OPERATIVI', 'CAPEX', 'OPEX', 'CONTO ECONOMICO',
    'RENDICONTO FINANZIARIO SPV', 'CONTO ECONOMICO HOLDING', 'RENDICONTO FINANZIARIO HOLDING',
    'FINANZA', 'AMMORTAMENTO', 'STATO PATRIMONIALE SPV', 'STATO PATRIMONIALE HOLDING', 'CASH FLOW MENSILE'
];
if (fullSheets.length !== 13 || !expectedFullSheets.every(s => fullSheets.includes(s))) {
    throw new Error(`Lista fogli full errata! Attesi 13 fogli, trovati: ${fullSheets.join(', ')}`);
}

// Verifica COPERTINA cella B5
const coverFull = wbFull.getWorksheet('COPERTINA');
const cellB5Full = coverFull.getCell('B5').value;
console.log(`✓ Copertina cella B5 (Full): "${cellB5Full}"`);
if (cellB5Full !== 'Progetto: Solans Srl') {
    throw new Error(`Cella B5 errata in Full! Atteso 'Progetto: Solans Srl', ottenuto '${cellB5Full}'`);
}

// Verifica CASH FLOW MENSILE (21 colonne)
const cfFull = wbFull.getWorksheet('CASH FLOW MENSILE');
const cfFullColCount = cfFull.columns.length;
console.log(`✓ CASH FLOW MENSILE colonne (Full): ${cfFullColCount}`);
if (cfFullColCount !== 21) {
    throw new Error(`Numero colonne Cash Flow errato in Full: attese 21, trovate ${cfFullColCount}`);
}
const lastHeaderFull = cfFull.getRow(4).getCell(21).value;
console.log(`✓ Colonna 21 header (Full): "${lastHeaderFull}"`);
if (lastHeaderFull !== 'Cassa Holding (€)') {
    throw new Error(`Ultimo header errato in Full: atteso 'Cassa Holding (€)', ottenuto '${lastHeaderFull}'`);
}

// -------------------------------------------------------------
// TEST 2: Esportazione Sola SPV (exportPnlToExcel({ spvOnly: true }))
// -------------------------------------------------------------
console.log("\n▶ TEST 2: Esportazione Sola SPV exportPnlToExcel({ spvOnly: true })...");
lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel({ spvOnly: true });

if (!lastCapturedBuffer) throw new Error("Buffer XLSX SPV-only non generato!");
console.log(`✓ File generato: ${lastDownloadedFile} (${lastCapturedBuffer.length} byte)`);
if (lastDownloadedFile !== 'PL_Driver_Operativi_SPV.xlsx') {
    throw new Error(`Filename errato: atteso PL_Driver_Operativi_SPV.xlsx, ottenuto ${lastDownloadedFile}`);
}

const wbSpv = new ExcelJS.Workbook();
await wbSpv.xlsx.load(lastCapturedBuffer);
const spvSheets = wbSpv.worksheets.map(w => w.name);
console.log(`✓ Fogli generati (${spvSheets.length}): ${spvSheets.join(' | ')}`);

const expectedSpvSheets = [
    'COPERTINA', 'DRIVER OPERATIVI', 'CAPEX', 'OPEX', 'CONTO ECONOMICO',
    'RENDICONTO FINANZIARIO SPV', 'FINANZA', 'AMMORTAMENTO', 'STATO PATRIMONIALE SPV', 'CASH FLOW MENSILE'
];
if (spvSheets.length !== 10 || !expectedSpvSheets.every(s => spvSheets.includes(s))) {
    throw new Error(`Lista fogli SPV-only errata! Attesi 10 fogli, trovati: ${spvSheets.join(', ')}`);
}

// Verifica ASSENZA categorica dei fogli Holding
if (spvSheets.includes('CONTO ECONOMICO HOLDING') ||
    spvSheets.includes('RENDICONTO FINANZIARIO HOLDING') ||
    spvSheets.includes('STATO PATRIMONIALE HOLDING')) {
    throw new Error("❌ Errore critico: i fogli Holding sono presenti nel file SPV-only!");
}
console.log("✓ Nessun foglio Holding presente nel file SPV-only.");

// Verifica COPERTINA cella B5 in SPV-only
const coverSpv = wbSpv.getWorksheet('COPERTINA');
const cellB5Spv = coverSpv.getCell('B5').value;
console.log(`✓ Copertina cella B5 (SPV-only): "${cellB5Spv}"`);
if (cellB5Spv !== 'Progetto: Solans Srl') {
    throw new Error(`Cella B5 errata in SPV-only! Atteso 'Progetto: Solans Srl', ottenuto '${cellB5Spv}'`);
}

// Verifica CASH FLOW MENSILE in SPV-only (17 colonne)
const cfSpv = wbSpv.getWorksheet('CASH FLOW MENSILE');
const cfSpvColCount = cfSpv.columns.length;
console.log(`✓ CASH FLOW MENSILE colonne (SPV-only): ${cfSpvColCount}`);
if (cfSpvColCount !== 17) {
    throw new Error(`Numero colonne Cash Flow errato in SPV-only: attese 17, trovate ${cfSpvColCount}`);
}
const lastHeaderSpv = cfSpv.getRow(4).getCell(17).value;
console.log(`✓ Colonna 17 header (SPV-only): "${lastHeaderSpv}"`);
if (lastHeaderSpv !== 'Cassa con Funding (€)') {
    throw new Error(`Ultimo header errato in SPV-only: atteso 'Cassa con Funding (€)', ottenuto '${lastHeaderSpv}'`);
}

// Verifica che colonna 18 sia vuota/inesistente in SPV-only
const col18Val = cfSpv.getRow(4).getCell(18).value;
if (col18Val !== null && col18Val !== undefined) {
    throw new Error(`Colonna 18 inattesa trovata in SPV-only: ${col18Val}`);
}
console.log("✓ Colonne 18-21 (Holding) omesse con successo in CASH FLOW MENSILE.");

// -------------------------------------------------------------
// TEST 3: Verifica formule e assenza di errori (#REF!, #VALUE!, #NAME!, etc.)
// -------------------------------------------------------------
console.log("\n▶ TEST 3: Scansione formule e verifica HyperFormula su file SPV-only...");
let formulaCount = 0;
let errorCount = 0;
wbSpv.eachSheet((ws) => {
    ws.eachRow((row) => {
        row.eachCell((cell) => {
            if (cell.formula) {
                formulaCount++;
                const f = cell.formula;
                if (f.includes('#REF!') || f.includes('#VALUE!') || f.includes('#NAME!') || f.includes('HOLDING')) {
                    console.error(`❌ Formula errata in foglio ${ws.name} ${cell.address}: ${f}`);
                    errorCount++;
                }
            }
        });
    });
});
console.log(`✓ Formule analizzate nel file SPV-only: ${formulaCount}, formule con riferimenti a Holding o #REF: ${errorCount}`);
if (errorCount > 0) throw new Error(`Trovate ${errorCount} formule errate nel file SPV-only!`);

// Valutazione HyperFormula del file SPV-only
const hfData = {};
wbSpv.eachSheet((ws) => {
    const sheetMatrix = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const rowVals = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            if (cell.formula) {
                rowVals[colNumber - 1] = `=${cell.formula}`;
            } else {
                rowVals[colNumber - 1] = cell.value !== undefined ? cell.value : null;
            }
        });
        sheetMatrix[rowNumber - 1] = rowVals;
    });
    hfData[ws.name] = sheetMatrix;
});

const hf = HyperFormula.buildFromSheets(hfData, {
    licenseKey: 'gpl-v3',
    useColumnIndex: false
});

let hfErrors = 0;
wbSpv.eachSheet((ws) => {
    const sheetId = hf.getSheetId(ws.name);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            if (cell.formula) {
                const val = hf.getCellValue({ sheet: sheetId, col: colNumber - 1, row: rowNumber - 1 });
                if (val && typeof val === 'object' && val.value && String(val.value).startsWith('#')) {
                    console.error(`❌ HyperFormula error in ${ws.name}!${cell.address}: ${val.value} (formula: =${cell.formula})`);
                    hfErrors++;
                }
            }
        });
    });
});
console.log(`✓ Valutazione HyperFormula: ${hfErrors} errori riscontrati su ${formulaCount} formule.`);
if (hfErrors > 0) throw new Error(`HyperFormula ha riscontrato ${hfErrors} errori di calcolo!`);

console.log("\n========================================================");
console.log("🎉 TUTTI I TEST SU EXPORT FULL E SPV-ONLY SUPERATI CON SUCCESSO!");
console.log("========================================================");
