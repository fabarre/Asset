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
console.log("🧪 TEST AUTOMATIZZATO: EXCEL EXPORT FULL VS SPV-ONLY & PLANT PREFIX");
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
    id: 'p1', name: 'Guasticce', capacity: 5000, zone: 'CNOR',
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
    _currentProjectName: undefined,
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
// TEST 1: Esportazione Completa Singolo Impianto (Guasticce)
// -------------------------------------------------------------
console.log("\n▶ TEST 1: Esportazione Completa Singolo Impianto (Guasticce)...");
lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel();

if (!lastCapturedBuffer) throw new Error("Buffer XLSX full non generato!");
console.log(`✓ File generato: ${lastDownloadedFile} (${lastCapturedBuffer.length} byte)`);
if (lastDownloadedFile !== 'Guasticce_PL_Driver_Operativi.xlsx') {
    throw new Error(`Filename errato: atteso Guasticce_PL_Driver_Operativi.xlsx, ottenuto ${lastDownloadedFile}`);
}

const wbFull = new ExcelJS.Workbook();
await wbFull.xlsx.load(lastCapturedBuffer);
const coverFull = wbFull.getWorksheet('COPERTINA');

// Verifica COPERTINA cella B3 e B5
const cellB3Full = coverFull.getCell('B3').value;
const cellB5Full = coverFull.getCell('B5').value;
console.log(`✓ Copertina cella B3 (Full): "${cellB3Full}"`);
console.log(`✓ Copertina cella B5 (Full): "${cellB5Full}"`);

if (cellB3Full !== 'SOLANS SRL') {
    throw new Error(`Cella B3 errata in Full! Atteso 'SOLANS SRL', ottenuto '${cellB3Full}'`);
}
if (cellB5Full !== 'Progetto: Guasticce') {
    throw new Error(`Cella B5 errata in Full! Atteso 'Progetto: Guasticce', ottenuto '${cellB5Full}'`);
}

// -------------------------------------------------------------
// TEST 2: Esportazione Sola SPV Singolo Impianto (Guasticce)
// -------------------------------------------------------------
console.log("\n▶ TEST 2: Esportazione Sola SPV Singolo Impianto (Guasticce)...");
lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel({ spvOnly: true });

if (!lastCapturedBuffer) throw new Error("Buffer XLSX SPV-only non generato!");
console.log(`✓ File generato: ${lastDownloadedFile} (${lastCapturedBuffer.length} byte)`);
if (lastDownloadedFile !== 'Guasticce_PL_Driver_Operativi_SPV.xlsx') {
    throw new Error(`Filename errato: atteso Guasticce_PL_Driver_Operativi_SPV.xlsx, ottenuto ${lastDownloadedFile}`);
}

const wbSpv = new ExcelJS.Workbook();
await wbSpv.xlsx.load(lastCapturedBuffer);
const coverSpv = wbSpv.getWorksheet('COPERTINA');
const cellB3Spv = coverSpv.getCell('B3').value;
const cellB5Spv = coverSpv.getCell('B5').value;
console.log(`✓ Copertina cella B3 (SPV): "${cellB3Spv}"`);
console.log(`✓ Copertina cella B5 (SPV): "${cellB5Spv}"`);

if (cellB3Spv !== 'SOLANS SRL') {
    throw new Error(`Cella B3 errata in SPV! Atteso 'SOLANS SRL', ottenuto '${cellB3Spv}'`);
}
if (cellB5Spv !== 'Progetto: Guasticce') {
    throw new Error(`Cella B5 errata in SPV! Atteso 'Progetto: Guasticce', ottenuto '${cellB5Spv}'`);
}

// -------------------------------------------------------------
// TEST 3: Multi-Impianto (Guasticce + Collesalvetti)
// -------------------------------------------------------------
console.log("\n▶ TEST 3: Esportazione Multi-Impianto (Guasticce + Collesalvetti)...");
global.window.State.plants = [
    { id: 'p1', name: 'Guasticce', enabled: true },
    { id: 'p2', name: 'Collesalvetti', enabled: true }
];

lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel({ spvOnly: true });

console.log(`✓ File generato (Multi-Plant SPV): ${lastDownloadedFile}`);
if (lastDownloadedFile !== 'Guasticce_Collesalvetti_PL_Driver_Operativi_SPV.xlsx') {
    throw new Error(`Filename errato: atteso Guasticce_Collesalvetti_PL_Driver_Operativi_SPV.xlsx, ottenuto ${lastDownloadedFile}`);
}

const wbMulti = new ExcelJS.Workbook();
await wbMulti.xlsx.load(lastCapturedBuffer);
const coverMulti = wbMulti.getWorksheet('COPERTINA');
const cellB3Multi = coverMulti.getCell('B3').value;
const cellB5Multi = coverMulti.getCell('B5').value;
console.log(`✓ Copertina cella B3 (Multi): "${cellB3Multi}"`);
console.log(`✓ Copertina cella B5 (Multi): "${cellB5Multi}"`);

if (cellB3Multi !== 'SOLANS SRL') {
    throw new Error(`Cella B3 errata in Multi! Atteso 'SOLANS SRL', ottenuto '${cellB3Multi}'`);
}
if (cellB5Multi !== 'Progetto: Guasticce / Collesalvetti') {
    throw new Error(`Cella B5 errata in Multi! Atteso 'Progetto: Guasticce / Collesalvetti', ottenuto '${cellB5Multi}'`);
}

// Verifica anche esportazione Full Multi-Plant
lastCapturedBuffer = null;
lastDownloadedFile = null;
await exportPnlToExcel();

console.log(`✓ File generato (Multi-Plant Full): ${lastDownloadedFile}`);
if (lastDownloadedFile !== 'Guasticce_Collesalvetti_PL_Driver_Operativi.xlsx') {
    throw new Error(`Filename errato: atteso Guasticce_Collesalvetti_PL_Driver_Operativi.xlsx, ottenuto ${lastDownloadedFile}`);
}

// -------------------------------------------------------------
// TEST 4: Verifica assenza errori formule in HyperFormula
// -------------------------------------------------------------
console.log("\n▶ TEST 4: Scansione formule e verifica HyperFormula...");
let formulaCount = 0;
let errorCount = 0;
wbMulti.eachSheet((ws) => {
    ws.eachRow((row) => {
        row.eachCell((cell) => {
            if (cell.formula) {
                formulaCount++;
                const f = cell.formula;
                if (f.includes('#REF!') || f.includes('#VALUE!') || f.includes('#NAME!')) {
                    console.error(`❌ Formula errata in foglio ${ws.name} ${cell.address}: ${f}`);
                    errorCount++;
                }
            }
        });
    });
});
console.log(`✓ Formule analizzate: ${formulaCount}, formule con errori: ${errorCount}`);
if (errorCount > 0) throw new Error(`Trovate ${errorCount} formule errate!`);

console.log("\n========================================================");
console.log("🎉 TUTTI I TEST SU B3, B5, PREFISSO NOME FILE E MULTI-PLANT SUPERATI!");
console.log("========================================================");
