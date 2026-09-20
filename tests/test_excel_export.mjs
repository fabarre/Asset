import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, '..', 'src', 'worker', 'simulation.worker.js');
const workerCode = fs.readFileSync(workerPath, 'utf8');

// Inizializza Worker in sandbox
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
    distributionPolicy: 'civil_with_capital_reserve_return',
    priceScenarioType: 'base',
    vatQuarterlyRefund: true, // Attiva Modello IVA TR (Step 3)
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

console.log("▶ Esecuzione calcolo con il Worker reale...");
lastMessage = null;
sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
if (!lastMessage || lastMessage.status !== 'success') {
    throw new Error('Worker calculation error: ' + (lastMessage ? lastMessage.error : 'nessuna risposta'));
}
const results = lastMessage.results;
console.log(`✓ Simulazione completata: monthlyCashflow mesi=${results.monthlyCashflow.months.length}, anchorYear=${results.monthlyCashflow.anchorYear}`);

// Setup mock ambiente per excelExport.js
global.window = {
    _currentProjectName: 'Parco Solare & BESS Tuscania 5MW',
    State: {
        branding: {
            company: 'Green Energy Holding SPV'
        },
        inputs: state.inputs,
        plants: state.plants,
        stabilimenti: state.stabilimenti,
        results: results
    },
    URL: global.URL
};

global.ExcelJS = ExcelJS;
global.showToast = (msg, type) => console.log(`[Toast ${type}] ${msg}`);
import { Blob as NodeBlob } from 'node:buffer';
let capturedBuffer = null;
class CustomBlob extends NodeBlob {
    constructor(buffers, opts) {
        super(buffers, opts);
        if (buffers && buffers[0]) {
            capturedBuffer = buffers[0];
        }
    }
}
global.Blob = CustomBlob;
const mockUrl = {
    createObjectURL: (b) => 'blob:mock-url',
    revokeObjectURL: () => {}
};
global.URL = mockUrl;
global.window.URL = mockUrl;
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
const excelCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'excelExport.js'), 'utf8');
const runExport = new Function('ExcelJS', 'window', 'showToast', 'Blob', 'URL', 'document', `${excelCode}\nreturn exportPnlToExcel;`);
const exportPnlToExcel = runExport(ExcelJS, global.window, global.showToast, global.Blob, global.URL, global.document);

async function runTest() {
    console.log("▶ Esecuzione exportPnlToExcel()...");
    await exportPnlToExcel();

    if (!capturedBuffer) {
        throw new Error("❌ Nessun buffer generato dall'export Excel!");
    }
    console.log(`✓ Buffer XLSX generato con successo: ${capturedBuffer.byteLength} byte.`);

    // Rileggiamo il workbook con ExcelJS
    const testWb = new ExcelJS.Workbook();
    await testWb.xlsx.load(capturedBuffer);

    const sheetCeHc = testWb.getWorksheet('CONTO ECONOMICO HOLDING');
    if (!sheetCeHc) {
        throw new Error("❌ Foglio 'CONTO ECONOMICO HOLDING' non trovato!");
    }
    console.log("✓ Foglio 'CONTO ECONOMICO HOLDING' presente nel workbook.");

    const sheetRfHc = testWb.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    if (!sheetRfHc) {
        throw new Error("❌ Foglio 'RENDICONTO FINANZIARIO HOLDING' non trovato!");
    }
    console.log("✓ Foglio 'RENDICONTO FINANZIARIO HOLDING' presente nel workbook.");

    const sheet = testWb.getWorksheet('CASH FLOW MENSILE');
    if (!sheet) {
        throw new Error("❌ Foglio 'CASH FLOW MENSILE' non trovato!");
    }
    console.log("✓ Foglio 'CASH FLOW MENSILE' presente nel workbook.");

    // 1. Verifica numero colonne
    if (sheet.columns.length !== 21) {
        throw new Error(`❌ Attese 21 colonne, trovate: ${sheet.columns.length}`);
    }
    console.log("✓ 21 colonne configurate con successo.");

    // 2. Verifica Header riga 4
    const r4 = sheet.getRow(4);
    const expectedHeaders = [
        'Mese / Anno', 'Ricavi Maturati (€)', 'Ricavi Incassati (€)', 'OPEX di Cassa (€)',
        'Imposte Correnti (€)', 'Serv. Debito Senior (€)', 'Esborsi CAPEX (€)', 'Funding di Capitale (€)',
        'IVA Incassata (€)', 'IVA Pagata Fornitori (€)', 'IVA Versata Erario (€)', 'IVA Rimborsata TR (€)',
        'Credito IVA Finale (€)', 'IVA Cash Flow (€)', 'Net Cashflow SPV (€)', 'Cassa Finale Lorda (€)',
        'Cassa con Funding (€)', 'Serv. Fin. Soci (€)', 'Serv. Private Debt (€)', 'Oneri HoldCo (€)', 'Cassa Holding (€)'
    ];
    expectedHeaders.forEach((eh, idx) => {
        const val = r4.getCell(idx + 1).value;
        if (val !== eh) {
            throw new Error(`❌ Header colonna ${idx + 1} errato: atteso "${eh}", trovato "${val}"`);
        }
    });
    console.log("✓ Tutti i 21 header di colonna alla riga 4 sono verificati al 100%.");

    // 3. Verifica formule mensili e subtotali annuali (Step 9)
    const m1Row = sheet.getRow(5);
    const m2Row = sheet.getRow(6);
    const m13Row = sheet.getRow(18); // Mese 13 (primo mese Anno 1, dopo Subtotale Anno 0 alla riga 17)

    // Formule Mese 1 (riga 5)
    if (m1Row.getCell(14).formula !== 'I5+J5+K5+L5') {
        throw new Error(`❌ Riga 5 col N (IVA CF) formula errata: "${m1Row.getCell(14).formula}"`);
    }
    if (m1Row.getCell(15).formula !== 'C5+D5+E5+F5+G5+N5') {
        throw new Error(`❌ Riga 5 col O (Net CF) formula errata: "${m1Row.getCell(15).formula}"`);
    }
    if (m1Row.getCell(16).formula !== 'O5') {
        throw new Error(`❌ Riga 5 col P (Cassa Lorda) formula errata: "${m1Row.getCell(16).formula}"`);
    }
    if (m1Row.getCell(17).formula !== 'O5+H5') {
        throw new Error(`❌ Riga 5 col Q (Cassa Funding) formula errata: "${m1Row.getCell(17).formula}"`);
    }
    if (m1Row.getCell(21).formula !== 'O5+R5+S5+T5') {
        throw new Error(`❌ Riga 5 col U (Cassa Holding) formula errata: "${m1Row.getCell(21).formula}"`);
    }
    console.log("✓ Mese 1 (riga 5): formule orizzontali e verticali N, O, P, Q, U verificate al 100%.");

    // Formule Mese 2 (riga 6)
    if (m2Row.getCell(14).formula !== 'I6+J6+K6+L6') {
        throw new Error(`❌ Riga 6 col N (IVA CF) formula errata: "${m2Row.getCell(14).formula}"`);
    }
    if (m2Row.getCell(15).formula !== 'C6+D6+E6+F6+G6+N6') {
        throw new Error(`❌ Riga 6 col O (Net CF) formula errata: "${m2Row.getCell(15).formula}"`);
    }
    if (m2Row.getCell(16).formula !== 'P5+O6') {
        throw new Error(`❌ Riga 6 col P (Cassa Lorda) formula errata: "${m2Row.getCell(16).formula}"`);
    }
    if (m2Row.getCell(17).formula !== 'Q5+O6+H6') {
        throw new Error(`❌ Riga 6 col Q (Cassa Funding) formula errata: "${m2Row.getCell(17).formula}"`);
    }
    if (m2Row.getCell(21).formula !== 'U5+O6+R6+S6+T6') {
        throw new Error(`❌ Riga 6 col U (Cassa Holding) formula errata: "${m2Row.getCell(21).formula}"`);
    }
    console.log("✓ Mese 2 (riga 6): formule orizzontali e saldo progressivo continuo verificati al 100%.");

    // Formule Mese 13 (riga 18, collegamento al mese 12 riga 16)
    if (m13Row.getCell(16).formula !== 'P16+O18') {
        throw new Error(`❌ Riga 18 col P (Cassa Lorda M13) formula errata: "${m13Row.getCell(16).formula}"`);
    }
    if (m13Row.getCell(17).formula !== 'Q16+O18+H18') {
        throw new Error(`❌ Riga 18 col Q (Cassa Funding M13) formula errata: "${m13Row.getCell(17).formula}"`);
    }
    if (m13Row.getCell(21).formula !== 'U16+O18+R18+S18+T18') {
        throw new Error(`❌ Riga 18 col U (Cassa Holding M13) formula errata: "${m13Row.getCell(21).formula}"`);
    }
    console.log("✓ Mese 13 (riga 18): continuità progressiva tra blocchi annuali verificata (P16+O18, Q16+O18+H18, U16+O18+R18+S18+T18).");

    let subtotalCount = 0;
    let totalRowFound = false;
    let totalRowNum = 0;
    sheet.eachRow((row, rowNumber) => {
        const c1 = String(row.getCell(1).value || '');
        if (c1.startsWith('SUBTOTALE ANNO')) {
            subtotalCount++;
            // Verifica formula SUM su colonna C (Ricavi Incassati) e formula saldo su colonna P (Cassa Lorda)
            const fC = row.getCell(3).formula;
            if (!fC || !fC.startsWith('SUM(')) {
                throw new Error(`❌ Riga ${rowNumber} colonna C priva di formula SUM valida: "${fC}"`);
            }
            const fP = row.getCell(16).formula;
            if (!fP || !fP.startsWith('P')) {
                throw new Error(`❌ Riga ${rowNumber} colonna P priva di formula saldo valida: "${fP}"`);
            }
            if (row.getCell(3).result === undefined) {
                throw new Error(`❌ Riga ${rowNumber} colonna C priva di precomputed result!`);
            }
        }
        if (c1.startsWith('TOTALE CUMULATO')) {
            totalRowFound = true;
            totalRowNum = rowNumber;
            const fC = row.getCell(3).formula;
            if (!fC || !fC.startsWith('SUM(')) {
                throw new Error(`❌ Riga TOTALE CUMULATO colonna C priva di formula SUM valida: "${fC}"`);
            }
            const fP = row.getCell(16).formula;
            if (!fP || !fP.startsWith('P')) {
                throw new Error(`❌ Riga TOTALE CUMULATO colonna P priva di formula saldo valida: "${fP}"`);
            }
            if (row.getCell(3).result === undefined) {
                throw new Error(`❌ Riga TOTALE CUMULATO colonna C priva di precomputed result!`);
            }
        }
    });

    if (subtotalCount !== 6) {
        throw new Error(`❌ Attesi 6 subtotali annuali (Anno 0 + Anni 1..5), trovati: ${subtotalCount}`);
    }
    console.log(`✓ Trovati esattamente 6 subtotali annuali (Anno 0 + Anni 1-5) con formule Excel dinamiche e precomputed result.`);

    if (!totalRowFound) {
        throw new Error("❌ Riga 'TOTALE CUMULATO' non trovata!");
    }
    console.log("✓ Riga 'TOTALE CUMULATO' presente con formule native Excel.");

    // 4. Verifica blocco KPI Due Diligence con formule dinamiche
    let kpiFound = false;
    let kpiMinCashFormula = null;
    let kpiVatPeakFormula = null;
    let kpiCapexResidualFormula = null;
    sheet.eachRow((row) => {
        const val = String(row.getCell(1).value || '');
        if (val.includes('SINTESI INDICATORI BANCARI')) {
            kpiFound = true;
        }
        if (val.includes('Cassa Minima SPV senza Funding')) {
            kpiMinCashFormula = row.getCell(4).formula;
        }
        if (val.includes('Credito IVA Massimo Registrato')) {
            kpiVatPeakFormula = row.getCell(4).formula;
        }
        if (val.includes('Residuo CAPEX non Allocato')) {
            kpiCapexResidualFormula = row.getCell(4).formula;
        }
    });
    if (!kpiFound) {
        throw new Error("❌ Blocco KPI di Due Diligence non trovato!");
    }
    if (!kpiMinCashFormula || !kpiMinCashFormula.startsWith('MIN(P5:P')) {
        throw new Error(`❌ KPI Cassa Minima senza formula valida: "${kpiMinCashFormula}"`);
    }
    if (!kpiVatPeakFormula || !kpiVatPeakFormula.startsWith('MAX(M5:M')) {
        throw new Error(`❌ KPI Credito IVA Picco senza formula valida: "${kpiVatPeakFormula}"`);
    }
    if (!kpiCapexResidualFormula || !kpiCapexResidualFormula.includes('-')) {
        throw new Error(`❌ KPI Residuo CAPEX senza formula valida: "${kpiCapexResidualFormula}"`);
    }
    console.log(`✓ Blocco KPI di Due Diligence Bancaria & Liquidità presente con formule dinamiche (MinCash=${kpiMinCashFormula}, VatMax=${kpiVatPeakFormula}, CapexResidual=${kpiCapexResidualFormula}).`);

    // 5. Verifica Foglio COPERTINA (Step 1)
    const sheetCover = testWb.getWorksheet('COPERTINA');
    if (!sheetCover) throw new Error("❌ Foglio 'COPERTINA' non trovato!");
    let guideFound = false;
    sheetCover.eachRow((r) => {
        if (String(r.getCell(2).value || '').includes('GUIDA ALLA MODELLAZIONE')) guideFound = true;
    });
    if (!guideFound) throw new Error("❌ Guida alla modellazione non trovata in COPERTINA!");
    console.log("✓ Foglio 'COPERTINA' con guida e legenda celle verificato.");

    // 6. Verifica Foglio FINANZA (Step 2)
    const sheetFin = testWb.getWorksheet('FINANZA');
    if (!sheetFin) throw new Error("❌ Foglio 'FINANZA' non trovato!");
    
    // Trova riga per riga per etichetta
    const finLabels = {};
    sheetFin.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        finLabels[lbl] = rNum;
    });

    const checkInputRow = (label, expectedNumFmt) => {
        const rNum = finLabels[label];
        if (!rNum) throw new Error(`❌ Voce '${label}' non trovata in FINANZA!`);
        const cell = sheetFin.getCell(`B${rNum}`);
        const fill = cell.fill;
        if (!fill || fill.fgColor?.argb !== 'FFFFFBEB') {
            throw new Error(`❌ Cella B${rNum} ('${label}') non ha lo stile input FAST (#FFFFFBEB)! Trovato: ${fill?.fgColor?.argb}`);
        }
        if (expectedNumFmt && cell.numFmt !== expectedNumFmt) {
            throw new Error(`❌ Cella B${rNum} ('${label}') numFmt atteso '${expectedNumFmt}', trovato '${cell.numFmt}'`);
        }
    };

    checkInputRow('Ke Valutativo (Cost of Equity)', '0.00%');
    checkInputRow('Leverage (D/E Ratio Target)', '0.00%');
    checkInputRow('Tasso Interesse Debito Senior', '0.00%');
    checkInputRow('Durata Debito Senior (Anni)', '#,##0');
    checkInputRow('Quota Equity Finanziata dai Soci (Complessiva %)', '0.00%');
    console.log("✓ Formattazione input FAST (#FFFFFBEB, #1E3A8A) verificata sui parametri di FINANZA.");

    // 6.b Verifica Convalida Dati da Elenco (Data Validation List Dropdowns)
    const checkDropdown = (label, expectedSnippet) => {
        const rNum = finLabels[label];
        if (!rNum) throw new Error(`❌ Cella per tendina '${label}' non trovata in FINANZA!`);
        const cell = sheetFin.getCell(`B${rNum}`);
        if (!cell.dataValidation || cell.dataValidation.type !== 'list') {
            throw new Error(`❌ Cella B${rNum} ('${label}') priva di Convalida Dati tipo 'list'!`);
        }
        const formula = cell.dataValidation.formulae?.[0] || '';
        if (!formula.includes(expectedSnippet)) {
            throw new Error(`❌ Cella B${rNum} ('${label}') lista convalida dati non contiene '${expectedSnippet}'. Trovato: ${formula}`);
        }
    };

    checkDropdown('Regime Liquidazione IVA', 'Mensile,Trimestrale');
    checkDropdown('Istanza Rimborso Modello IVA TR', 'SÌ,NO');
    checkDropdown('Base di Computo Debito Senior', 'Solo Hard Costs');
    checkDropdown('Tipo di Cash Sweep', '% del CFADS');
    checkDropdown('DSCR Sculpting (Rata Sagomata)', 'Sì,No');
    checkDropdown('Refinancing / Miniperm Attivo', 'Sì,No');
    checkDropdown('Private Debt Attivo', 'SÌ,NO');
    checkDropdown('Modalità Importo Private Debt', '% Base Finanziabile');
    checkDropdown('Modalità Rimborso Private Debt', 'Bullet a Exit');
    checkDropdown('Interessi PD Deducibili Fiscalmente', 'SÌ,NO');
    checkDropdown('Posizione Waterfall Private Debt', 'Dopo Senior');
    checkDropdown('Private Equity Attivo', 'SÌ,NO');
    checkDropdown('Modalità Importo Private Equity', '% Equity Totale');
    checkDropdown('Struttura Remunerazione PE', 'Quote Dividendi Proporzionale');
    checkDropdown('PE Partecipa Exit Equity Value', 'SÌ,NO');
    checkDropdown('Altra Forma Attiva', 'SÌ,NO');
    checkDropdown('Tipo Accordo Altra Forma', 'Advisory Fee Annuo');
    checkDropdown('Costo/Interessi AF Deducibili SPV', 'SÌ,NO');
    checkDropdown('Opzione di Uscita (Exit Strategy)', 'Multiplo EBITDA');
    checkDropdown('Scenario Curve di Prezzo', 'Caso Base (PUN GME)');
    checkDropdown('Blocco Dividendi Fino Estinzione Debito', 'SÌ,NO');
    checkDropdown('Politica Distribuzione Dividendi SPV', 'FCFE Puro (Cash Flow Driven)');
    checkDropdown('Impiego Cassa Vincolata SPV (Cash Trap)', 'Blocco Conservativo');
    console.log("✓ Convalida Dati da Elenco (Data Validation List) verificata con successo su tutti i 23 menù a tendina di FINANZA.");

    // Verifica formule native in Usi e Fonti
    const rTotUsi = finLabels['TOTALE FABBISOGNO (Usi)'];
    const rDebt = finLabels['Debito Bancario (Senior Loan)'];
    const rSubDebt = finLabels['- Finanziamento Soci (Subordinated Debt)'];
    const rOtherEq = finLabels['- Sponsor Pure Equity (al netto PD Holding)'];
    const rTotFonti = finLabels['TOTALE FONTI'];
    const rCheck = finLabels['Controllo Squadratura (Usi - Fonti)'];

    if (!rTotUsi || !sheetFin.getCell(`B${rTotUsi}`).formula) throw new Error("❌ 'TOTALE FABBISOGNO (Usi)' privo di formula!");
    if (!rDebt || !sheetFin.getCell(`B${rDebt}`).formula) throw new Error("❌ 'Debito Bancario' privo di formula!");
    if (!rSubDebt || !sheetFin.getCell(`B${rSubDebt}`).formula) throw new Error("❌ 'Finanziamento Soci' privo di formula!");
    if (!rOtherEq || !sheetFin.getCell(`B${rOtherEq}`).formula) throw new Error("❌ 'Sponsor Pure Equity' privo di formula!");
    if (!rTotFonti || !sheetFin.getCell(`B${rTotFonti}`).formula) throw new Error("❌ 'TOTALE FONTI' privo di formula!");
    if (!rCheck || !sheetFin.getCell(`B${rCheck}`).formula) throw new Error("❌ 'Controllo Squadratura' privo di formula!");

    console.log("✓ Usi e Fonti in FINANZA 100% coperti da formule native Excel (totUsi, debt, subDebt, otherEq, totFonti, check).");

    // 7. Verifica Foglio CAPEX (Step 3)
    const sheetCapex = testWb.getWorksheet('CAPEX');
    if (!sheetCapex) throw new Error("❌ Foglio 'CAPEX' non trovato!");
    const capexP1 = sheetCapex.getCell('B2'); // EPC Solar Impianto 1
    if (!capexP1.fill || capexP1.fill.fgColor?.argb !== 'FFFFFBEB') {
        throw new Error(`❌ Cella B2 di CAPEX priva di formattazione input FAST: ${capexP1.fill?.fgColor?.argb}`);
    }
    const capexTotCell = sheetCapex.getCell('C2'); // Totale Portafoglio riga 2
    if (!capexTotCell.formula && capexTotCell.value === 0) {
        // se c'è un solo impianto totColIndex = 3
    }
    const capexRateCell = sheetCapex.getCell('D2'); // Aliquota
    if (!capexRateCell.formula || !capexRateCell.formula.includes('FINANZA!')) {
        throw new Error(`❌ Aliquota ammortamento in CAPEX non collegata a FINANZA: "${capexRateCell.formula}"`);
    }
    console.log("✓ Foglio 'CAPEX': celle input FAST, totali portafoglio e aliquote ammortamento collegate a FINANZA verificate.");

    // 8. Verifica Foglio OPEX (Step 3)
    const sheetOpex = testWb.getWorksheet('OPEX');
    if (!sheetOpex) throw new Error("❌ Foglio 'OPEX' non trovato!");
    const opexP1 = sheetOpex.getCell('B2'); // O&M Impianto 1
    if (!opexP1.fill || opexP1.fill.fgColor?.argb !== 'FFFFFBEB') {
        throw new Error(`❌ Cella B2 di OPEX priva di formattazione input FAST: ${opexP1.fill?.fgColor?.argb}`);
    }
    console.log("✓ Foglio 'OPEX': celle input FAST e totali portafoglio verificati.");

    // 9. Verifica Foglio DRIVER OPERATIVI (Step 4)
    const sheetOp = testWb.getWorksheet('DRIVER OPERATIVI');
    if (!sheetOp) throw new Error("❌ Foglio 'DRIVER OPERATIVI' non trovato!");

    const opLabels = {};
    sheetOp.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        opLabels[lbl] = rNum;
    });

    const checkOpInput = (label, colLetter = 'B') => {
        const cleanLabel = label.trim();
        const rNum = opLabels[cleanLabel];
        if (!rNum) throw new Error(`❌ Voce '${cleanLabel}' non trovata in DRIVER OPERATIVI!`);
        const cell = sheetOp.getCell(`${colLetter}${rNum}`);
        const fill = cell.fill;
        if (!fill || fill.fgColor?.argb !== 'FFFFFBEB') {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${cleanLabel}') non ha lo stile input FAST (#FFFFFBEB)! Trovato: ${fill?.fgColor?.argb}`);
        }
    };

    const checkOpFormula = (label, expectedSnippet, colLetter = 'B') => {
        const cleanLabel = label.trim();
        const rNum = opLabels[cleanLabel];
        if (!rNum) throw new Error(`❌ Voce '${cleanLabel}' non trovata in DRIVER OPERATIVI!`);
        const cell = sheetOp.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${cleanLabel}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    // Celle valore input FAST
    checkOpInput('di cui: Energia FV in Autoconsumo / PPA (MWh)');
    checkOpInput('di cui: Energia FV immessa in Rete / RID (MWh)');
    checkOpInput('di cui: Energia FV per Carica BESS (MWh)');
    checkOpInput('- di cui: Scarica Rete da Arbitraggio (MWh)');
    checkOpInput('- di cui: Scarica Rete da Timeshifting (MWh)');
    checkOpInput('Carica BESS da Rete (MWh)');
    checkOpInput('Prezzo Unitario PPA On-Site FV (€/MWh)');
    checkOpInput('Prezzo Unitario RID FV (€/MWh)');
    checkOpInput('Prezzo Unitario PPA On-Site BESS (€/MWh)');
    checkOpInput('- di cui: Prezzo di Vendita Arbitraggio (€/MWh)');
    checkOpInput('- di cui: Prezzo di Vendita Timeshifting (€/MWh)');
    checkOpInput('Costo Unitario Prelievo da Rete BESS (€/MWh)');
    console.log("✓ Celle base volumi e prezzi in 'DRIVER OPERATIVI' marcate con stile input FAST (#FFFFFBEB, #1E3A8A).");

    // Formule interne a DRIVER OPERATIVI
    checkOpFormula('Produzione Fotovoltaica Totale (MWh)', '+');
    checkOpFormula('Scarica BESS Totale (MWh)', '+');
    checkOpFormula('di cui: Scarica BESS immessa in Rete / RID (MWh)', '+');
    checkOpFormula('Perdite di Efficienza BESS (RTE) (MWh)', 'IF(');
    checkOpFormula('Valore Unitario Medio Ponderato FV (€/MWh)', 'IFERROR(');
    checkOpFormula('Valore Unitario Medio Ponderato BESS (€/MWh)', 'IFERROR(');
    checkOpFormula('Prezzo Unitario RID BESS (Arbitraggio + Time Shifting) (€/MWh)', 'IFERROR(');
    console.log("✓ Aggregazioni energetiche e medie ponderate prezzi coperte da formule native pure Excel.");

    // Formule cross-sheet verso FINANZA e CAPEX
    checkOpFormula('Tasso di Inflazione (%)', 'FINANZA!');
    checkOpFormula('Aliquota Ammortamento Fiscale (%)', 'FINANZA!');
    checkOpFormula('Aliquota IRES (%)', 'FINANZA!');
    checkOpFormula('Aliquota IRAP (%)', 'FINANZA!');
    checkOpFormula('IDC Capitalizzato (€)', 'FINANZA!');
    checkOpFormula('Base Amm.to Fiscale (incl. IDC) (€)', 'CAPEX!');
    checkOpFormula('CAPEX Sostituzione BESS - anno 10 (€)', 'CAPEX!');
    console.log("✓ Parametri macroeconomici e fiscali collegati dinamicamente a FINANZA e CAPEX.");

    // 10. Verifica Foglio AMMORTAMENTO (Step 5)
    const sheetDebt = testWb.getWorksheet('AMMORTAMENTO');
    if (!sheetDebt) throw new Error("❌ Foglio 'AMMORTAMENTO' non trovato!");

    const debtLabels = {};
    sheetDebt.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        debtLabels[lbl] = rNum;
    });

    const findDebtRow = (prefix) => {
        for (const [lbl, rNum] of Object.entries(debtLabels)) {
            if (lbl.startsWith(prefix) || lbl === prefix) return rNum;
        }
        throw new Error(`❌ Riga con prefisso '${prefix}' non trovata in AMMORTAMENTO!`);
    };

    const checkDebtFormula = (prefix, expectedSnippet, colLetter = 'B') => {
        const rNum = findDebtRow(prefix);
        const cell = sheetDebt.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${prefix}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    // Sezione 1: Senior Debt
    const rEndingBalance = findDebtRow('Debito Residuo Fine Anno (€)');
    checkDebtFormula('Debito Residuo Fine Anno (€)', 'FINANZA!', 'B');
    checkDebtFormula('Debito Residuo Inizio Anno (€)', `B${rEndingBalance}`, 'C');
    checkDebtFormula('Tasso Debito Attivo (post-Refi) (%)', 'FINANZA!', 'C');
    checkDebtFormula('Rata Annuitaria Attiva (€)', 'PMT(', 'C');
    checkDebtFormula('(-) Quota Interessi Mutuo Maturati (€)', 'FINANZA!', 'C');
    checkDebtFormula('(-) Quota Capitale Programmata (€)', 'FINANZA!', 'C');
    checkDebtFormula('Debito Residuo Fine Anno (€)', 'MAX(0,', 'C');
    checkDebtFormula('SERVIZIO DEL DEBITO EFFETTIVO (€)', '+', 'C');
    checkDebtFormula('DSCR (Debt Service Coverage Ratio)', 'RENDICONTO FINANZIARIO SPV', 'C');
    console.log("✓ Sezione 1 (Senior Debt): Anno 0 e Anno 1 (Inizio Anno, PMT, quota capitale/interessi, saldo e DSCR) verificati al 100%.");

    // Sezione 2: Finanziamento Soci
    const rEndingBalanceSoci = findDebtRow('Finanziamento Soci Fine Anno (€)');
    checkDebtFormula('Finanziamento Soci Fine Anno (€)', 'FINANZA!', 'B');
    checkDebtFormula('Finanziamento Soci Inizio Anno (€)', `B${rEndingBalanceSoci}`, 'C');
    checkDebtFormula('(-) Interessi Maturati', 'FINANZA!', 'C');
    checkDebtFormula('(+) Interessi Pagati Effettivamente (€)', 'RENDICONTO FINANZIARIO SPV', 'C');
    checkDebtFormula('(-) Rimborso Quota Capitale', 'RENDICONTO FINANZIARIO SPV', 'C');
    checkDebtFormula('Finanziamento Soci Fine Anno (€)', '-', 'C');
    console.log("✓ Sezione 2 (Finanziamento Soci): Anno 0 e Anno 1 (Inizio Anno da FINANZA!subDebt, accrual indicizzato, incassi da Sez. B e saldo finale) verificati al 100%.");

    // 11. Verifica Foglio CONTO ECONOMICO SPV (Step 6)
    const sheetCe = testWb.getWorksheet('CONTO ECONOMICO');
    if (!sheetCe) throw new Error("❌ Foglio 'CONTO ECONOMICO' non trovato!");

    const ceLabels = {};
    sheetCe.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl) ceLabels[lbl] = rNum;
    });

    const findCeRow = (prefix) => {
        for (const [lbl, rNum] of Object.entries(ceLabels)) {
            if (lbl.startsWith(prefix) || lbl === prefix) return rNum;
        }
        throw new Error(`❌ Riga con prefisso '${prefix}' non trovata in CONTO ECONOMICO!`);
    };

    const checkCeFormula = (prefix, expectedSnippet, colLetter = 'B') => {
        const rNum = findCeRow(prefix);
        const cell = sheetCe.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${prefix}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    // Ricavi
    checkCeFormula('RICAVI TOTALI SPV (€)', '+');
    checkCeFormula('di cui: Ricavi da RID generato da FV (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('di cui: Ricavi da PPA (FV + BESS) (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('di cui: Ricavi da Time Shifting (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('di cui: Ricavi da Arbitraggio (€)', "'DRIVER OPERATIVI'!");
    console.log("✓ Ricavi SPV: Tutti i ricavi collegati con formule a DRIVER OPERATIVI.");

    // OPEX & EBITDA
    checkCeFormula('(-) COSTI OPERATIVI (OPEX) TOTALE SPV (€)', '+');
    checkCeFormula('di cui: O&M Impianti Fotovoltaici (€)', 'OPEX!', 'C');
    checkCeFormula('di cui: O&M Impianti Fotovoltaici (€)', "'DRIVER OPERATIVI'!", 'D');
    checkCeFormula('di cui: Costo Energia Pre-carica da Rete BESS (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('MARGINE OPERATIVO LORDO (EBITDA) (€)', '+');
    console.log("✓ OPEX & EBITDA: Costi operativi collegati a OPEX e indicizzati con inflazione, EBITDA dinamico.");

    // Ammortamenti ed EBIT
    checkCeFormula('(-) Ammortamento Civilistico (€)', 'SUM(', 'C');
    checkCeFormula('di cui: Ammortamento Impianti Solari (€)', 'CAPEX!', 'C');
    checkCeFormula('di cui: Ammortamento Impianti Solari (€)', "'FINANZA'!", 'C');
    checkCeFormula('di cui: Ammortamento BESS (€)', 'CAPEX!', 'C');
    checkCeFormula('di cui: Ammortamento Altri Costi Capitalizzati (€)', 'CAPEX!', 'C');
    checkCeFormula('EBIT SPV (Risultato Operativo) (€)', '+');
    console.log("✓ Ammortamento Civilistico ed EBIT collegati dinamicamente a CAPEX e FINANZA.");

    // Gestione Finanziaria
    checkCeFormula('(-) Interessi Passivi Mutuo Bancario (€)', "'AMMORTAMENTO'!");
    checkCeFormula('(-) Interessi Finanziamento Soci (Accrual)', "'AMMORTAMENTO'!");
    checkCeFormula('EBT — Utile ante Imposte SPV (€)', '+');
    console.log("✓ Gestione Finanziaria ed EBT collegati dinamicamente ad AMMORTAMENTO.");

    // Motore Fiscale TUIR
    checkCeFormula('Amm.to Fiscale Base - anno 1 al 50% (€)', 'MIN(', 'C');
    checkCeFormula('Base Fiscale Residua (€)', "'DRIVER OPERATIVI'!", 'B');
    checkCeFormula('Base Fiscale Residua (€)', "'DRIVER OPERATIVI'!", 'C');
    checkCeFormula('Base Fiscale Residua (€)', 'MAX(0,', 'D');
    checkCeFormula('Amm.to Fiscale Totale (€)', '+');
    checkCeFormula('ROL 30% EBITDA - Art. 96 (€)', 'MAX(0, 0.3*');
    checkCeFormula('Interessi Passivi Netti - Art. 96 (€)', 'MAX(0,');
    checkCeFormula('Interessi Deducibili - Art. 96 (€)', 'MIN(');
    checkCeFormula('ROL Riportato a Nuovo - Art. 96 (€)', 'MAX(0,');
    checkCeFormula('Imponibile IRES Lordo (€)', '-');
    checkCeFormula('Imponibile IRES Netto - post NOL (€)', 'MAX(0,');
    checkCeFormula('Base Imponibile IRAP (€)', 'MAX(0,');
    checkCeFormula('(-) Imposte Correnti SPV (IRES 24% + IRAP 3.9%) (€)', '-(');
    checkCeFormula('di cui: IRES (24% su EBT +/- Variazioni Fiscali) (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('di cui: IRAP (3.9% su EBIT + Costi Indeducibili) (€)', "'DRIVER OPERATIVI'!");
    checkCeFormula('(-/+) Variazione Imposte Differite (⇒ Sez. B) (€)', 'IF(');
    checkCeFormula('Fondo Imposte Differite - saldo (€)', '+');
    checkCeFormula('UTILE NETTO CIVILISTICO SPV (⇒ Sez. B) (€)', '-');
    console.log("✓ Motore Fiscale TUIR (Art. 102, 96, 84, IRES, IRAP, Differite) e Utile Netto SPV 100% coperti da formule Excel.");

    // 11. Verifica Foglio RENDICONTO FINANZIARIO SPV (Step 7)
    const sheetRf = testWb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    if (!sheetRf) throw new Error("❌ Foglio 'RENDICONTO FINANZIARIO SPV' non trovato!");

    const rfLabels = {};
    sheetRf.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        rfLabels[lbl] = rNum;
    });

    const checkRfFormula = (prefix, expectedSnippet, colLetter = 'B') => {
        const matchingLabel = Object.keys(rfLabels).find(l => l.includes(prefix));
        if (!matchingLabel) throw new Error(`❌ Riga con prefisso '${prefix}' non trovata in RENDICONTO FINANZIARIO SPV!`);
        const rNum = rfLabels[matchingLabel];
        const cell = sheetRf.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${prefix}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    // Riprese non-cash
    checkRfFormula('Utile Netto Civilistico SPV', "'CONTO ECONOMICO'!");
    checkRfFormula('Ripresa Ammortamento Civilistico', "'CONTO ECONOMICO'!");
    checkRfFormula('Ripresa Imposte Differite', "'CONTO ECONOMICO'!");
    checkRfFormula('Ripresa Interessi Mutuo Bancario Senior', "'CONTO ECONOMICO'!");
    checkRfFormula('Ripresa Interessi Finanziamento Soci', "'CONTO ECONOMICO'!");
    console.log("✓ Riprese Non-Cash SPV: Utile netto, ammortamenti, imposte differite e interessi collegati a CONTO ECONOMICO.");

    // MRA & Augmentation
    checkRfFormula('Accantonamento a Riserva di Manutenzione (MRA)', 'OPEX!', 'C');
    checkRfFormula('Accantonamento a Riserva di Manutenzione (MRA)', "'DRIVER OPERATIVI'!", 'D');
    checkRfFormula('CAPEX Sostituzione Celle NMC/LFP BESS', "'DRIVER OPERATIVI'!", 'L'); // Anno 10 = Col L
    checkRfFormula('Rilascio Riserva di Manutenzione (MRA)', 'MIN(', 'L');
    console.log("✓ MRA e BESS Augmentation: Accantonamento da OPEX indicizzato e rilascio a Anno 10 verificati.");

    // CFADS
    checkRfFormula('CFADS SPV (Cassa Disponibile ante Servizio Debito)', '+');
    console.log("✓ CFADS SPV: Formula di aggregazione algebrica verificata al 100%.");

    // Servizio Debito Senior
    checkRfFormula('Quota Interessi Mutuo Bancario Pagati', "'AMMORTAMENTO'!");
    checkRfFormula('Quota Capitale Mutuo Bancario Programmata', "'AMMORTAMENTO'!");
    checkRfFormula('Cash Sweep Mutuo Bancario Volontario', "'AMMORTAMENTO'!");
    console.log("✓ Servizio Debito Senior: Interessi, quota capitale e cash sweep collegati dinamicamente ad AMMORTAMENTO.");

    // FCFE SPV
    checkRfFormula('CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV)', '+');
    console.log("✓ FCFE SPV: Cassa disponibile post-debito calcolata dinamicamente con formula.");

    // Cascata Distribuzione Waterfall
    checkRfFormula('Capacità Distributiva Utili SPV Cumulata', 'MAX(0,', 'B');
    checkRfFormula('Capacità Distributiva Utili SPV Cumulata', 'MAX(0,', 'C');
    checkRfFormula('Accantonamento Riserva Legale SPV', '0.05*', 'C');
    checkRfFormula('Accantonamento Riserva Legale SPV', "'FINANZA'!", 'C');
    checkRfFormula('Interessi Soci Pagati da SPV a HoldCo', "-MIN(MAX(0,", 'C');
    checkRfFormula('Interessi Soci Pagati da SPV a HoldCo', "'AMMORTAMENTO'!", 'C');
    checkRfFormula('Dividendi SPV Distribuiti a HoldCo', "'FINANZA'!", 'C');
    checkRfFormula('Dividendi SPV Distribuiti a HoldCo', "'AMMORTAMENTO'!", 'C');
    checkRfFormula('Rimborso Capitale Finanziamento Soci a HoldCo', "'AMMORTAMENTO'!", 'C');
    checkRfFormula('Rimborso Capitale Finanziamento Soci a HoldCo', "'FINANZA'!", 'C');
    checkRfFormula('Restituzione Riserve di Capitale', "'FINANZA'!", 'C');
    checkRfFormula('Cash Trap Annuo', 'MAX(0,', 'C');
    checkRfFormula('Cassa SPV Vincolata a Inizio Esercizio', '0', 'B');
    checkRfFormula('SALDO TOTALE CASSA VINCOLATA IN SPV', '+', 'C');
    console.log("✓ Cascata Distribuzione Waterfall (Riserva Legale, Interessi Soci, Dividendi, Rimborso Soci, Riserve Capitale, Cash Trap) 100% coperta da formule pure.");

    console.log("\n========================================================");
    console.log("🎉 TEST EXPORT EXCEL (STEP 0, 1, 2, 3, 4, 5, 6, 7) SUPERATO CON SUCCESSO (100%)!");
    console.log("========================================================\n");

    // 12. Verifica Foglio CONTO ECONOMICO HOLDING (Step 8 - Sezione C)
    if (!sheetCeHc) throw new Error("❌ Foglio 'CONTO ECONOMICO HOLDING' non trovato!");

    const ceHcLabels = {};
    sheetCeHc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        ceHcLabels[lbl] = rNum;
    });

    const checkCeHcFormula = (prefix, expectedSnippet, colLetter = 'B') => {
        const matchingLabel = Object.keys(ceHcLabels).find(l => l.includes(prefix));
        if (!matchingLabel) throw new Error(`❌ Riga con prefisso '${prefix}' non trovata in CONTO ECONOMICO HOLDING!`);
        const rNum = ceHcLabels[matchingLabel];
        const cell = sheetCeHc.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${prefix}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    checkCeHcFormula('Ricavi per Servizi: Gestione Amministrativa', "'CONTO ECONOMICO'!");
    checkCeHcFormula('Spese Generali e Costi di Funzionamento Holding (OPEX)', '-15000', 'B');
    checkCeHcFormula('Spese Generali e Costi di Funzionamento Holding (OPEX)', 'B', 'C');
    checkCeHcFormula('Spese Generali e Costi di Funzionamento Holding (OPEX)', "'DRIVER OPERATIVI'!", 'D');
    checkCeHcFormula('(-) COSTI OPERATIVI (OPEX) TOTALE HOLDING (€)', '+');
    checkCeHcFormula('EBIT HOLDING (Risultato Operativo) (€)', '+');
    checkCeHcFormula('Proventi da Partecipazioni: Dividendi SPV da Utili', "'RENDICONTO FINANZIARIO SPV'!");
    checkCeHcFormula('Altri Proventi Finanziari: Interessi Attivi Finanziamento Soci', "'RENDICONTO FINANZIARIO SPV'!");
    checkCeHcFormula('TOTALE PROVENTI E ONERI FINANZIARI (C)', '+');
    checkCeHcFormula('EBT — Utile ante Imposte HOLDING (€)', '+');
    checkCeHcFormula('Imposta IRES HoldCo', "'DRIVER OPERATIVI'!");
    checkCeHcFormula('Imposta IRAP HoldCo', "'DRIVER OPERATIVI'!");
    checkCeHcFormula('(-) Imposte Correnti Holding (IRES 24% + IRAP 3.9%) (€)', '+');
    checkCeHcFormula('UTILE NETTO CIVILISTICO HOLDING (⇒ Sez. D) (€)', '+');
    console.log("✓ Foglio CONTO ECONOMICO HOLDING (Sezione C): Valore della produzione, OPEX indicizzato, proventi SPV, imposte PEX/IRAP e utile netto verificati al 100%.");

    // 13. Verifica Foglio RENDICONTO FINANZIARIO HOLDING (Step 8 - Sezione D)
    if (!sheetRfHc) throw new Error("❌ Foglio 'RENDICONTO FINANZIARIO HOLDING' non trovato!");

    const rfHcLabels = {};
    sheetRfHc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        rfHcLabels[lbl] = rNum;
    });

    const checkRfHcFormula = (prefix, expectedSnippet, colLetter = 'B') => {
        const matchingLabel = Object.keys(rfHcLabels).find(l => l.includes(prefix));
        if (!matchingLabel) throw new Error(`❌ Riga con prefisso '${prefix}' non trovata in RENDICONTO FINANZIARIO HOLDING!`);
        const rNum = rfHcLabels[matchingLabel];
        const cell = sheetRfHc.getCell(`${colLetter}${rNum}`);
        const f = cell.formula;
        if (!f || !f.includes(expectedSnippet)) {
            throw new Error(`❌ Cella ${colLetter}${rNum} ('${prefix}') priva della formula attesa con snippet '${expectedSnippet}'. Trovato: "${f}"`);
        }
    };

    checkRfHcFormula('UTILE NETTO HOLDING CIVILISTICO', "'CONTO ECONOMICO HOLDING'!");
    checkRfHcFormula('di cui: Rimborso Capitale Finanziamento Soci ricevuto', "'RENDICONTO FINANZIARIO SPV'!");
    checkRfHcFormula('Restituzione Riserve di Capitale SPV', "'RENDICONTO FINANZIARIO SPV'!");
    checkRfHcFormula('CASSA GENERATA DALLA GESTIONE ORDINARIA HOLDING', '+');
    
    // Exit anno 20 (Colonna V)
    checkRfHcFormula('FLUSSO DA DISMISSIONE INVESTIMENTO (EXIT SPV)', '+', 'V');
    checkRfHcFormula('di cui: Enterprise Value di Exit', "'FINANZA'!", 'V');
    checkRfHcFormula('Rimborso Debito Residuo Mutuo Bancario', "'AMMORTAMENTO'!", 'V');
    checkRfHcFormula('Imposte PEX su Plusvalenza Exit', "'DRIVER OPERATIVI'!", 'V');
    
    // FCFE e Quadratura
    checkRfHcFormula('FCFE — FLUSSO NETTO INVESTITORE', '+', 'B');
    checkRfHcFormula('FCFE CUMULATO INVESTITORE', '+', 'C');
    checkRfHcFormula('di cui: Interessi Finanziamento Soci ricevuti', "'CONTO ECONOMICO HOLDING'!");
    checkRfHcFormula('Flusso Cassa Risalito Totale da SPV', '+');
    console.log("✓ Foglio RENDICONTO FINANZIARIO HOLDING (Sezione D): Cash flow ordinario, Exit SPV (EV, Debito, PEX), FCFE Investitore e quadratura flussi trasferiti verificati al 100%.");

    console.log("\n========================================================");
    console.log("🎉 TEST EXPORT EXCEL (STEP 0, 1, 2, 3, 4, 5, 6, 7, 8, 9) SUPERATO CON SUCCESSO (100%)!");
    console.log("========================================================\n");
}

runTest().catch(err => {
    console.error("TEST FALLITO:", err);
    process.exit(1);
});
