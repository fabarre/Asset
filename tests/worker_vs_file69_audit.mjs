import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';
const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';

// 1. Initialize Worker sandbox
const workerCode = fs.readFileSync(workerPath, 'utf8');
let workerResponse = null;
const sandbox = {
    self: {
        postMessage: (msg) => { workerResponse = msg; }
    },
    console,
    structuredClone: global.structuredClone,
    Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
    Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
};
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox);

async function runAudit() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    // Read plants from CAPEX & DRIVER OPERATIVI
    const sCapex = wb.getWorksheet('CAPEX');
    const sFin = wb.getWorksheet('FINANZA');
    const sDrv = wb.getWorksheet('DRIVER OPERATIVI');

    // Plant 1: Guasticce (C2)
    // Plant 2: Castenaso (C3)
    const plant1Capacity = 4140.68; // kWp
    const plant2Capacity = 4045.52; // kWp
    console.log(`Total Capacity: ${plant1Capacity + plant2Capacity} kWp = 8186.2 kWp`);

    // Build HyperFormula
    const hfSheets = {};
    wb.worksheets.forEach(ws => {
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
                    let f = cell.formula;
                    if (f.startsWith('=')) f = f.substring(1);
                    val = '=' + f;
                } else if (cell.value && typeof cell.value === 'object') {
                    if (cell.value.formula) {
                        let f = cell.value.formula;
                        if (f.startsWith('=')) f = f.substring(1);
                        val = '=' + f;
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

    const hf = HyperFormula.buildFromSheets(hfSheets, {
        licenseKey: 'gpl-v3',
        useColumnIndex: true,
        precisionRounding: 6
    });

    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    console.log('\n--- SCANNING EXCEL FORMULAS & RESULTS IN FILE 69 ---');

    // Audit 1: Check FINANZA Usi e Fonti
    console.log('\n>>> 1. FINANZA: Usi e Fonti');
    const finTotalUsi = getHf('FINANZA', 96, 2);
    const finSenior = getHf('FINANZA', 101, 2);
    const finEquitySpv = getHf('FINANZA', 104, 2);
    const finSoci = getHf('FINANZA', 106, 2);
    const finFonti = getHf('FINANZA', 109, 2);
    const finSquadr = getHf('FINANZA', 111, 2);
    console.log(`Usi: ${finTotalUsi} | Senior: ${finSenior} | Equity SPV: ${finEquitySpv} | Soci: ${finSoci} | Fonti: ${finFonti} | Squadratura: ${finSquadr}`);

    // Audit 2: Check CONTO ECONOMICO vs AMMORTAMENTO
    console.log('\n>>> 2. CONTO ECONOMICO: Riconciliazione con AMMORTAMENTO e OPEX');
    for (let yi = 1; yi <= 20; yi++) {
        const col = yi + 1;
        const colLetter = wb.getWorksheet('CONTO ECONOMICO').getColumn(col).letter;
        
        // Ricavi
        const rev = getHf('CONTO ECONOMICO', 2, col);
        // OPEX
        const opex = getHf('CONTO ECONOMICO', 9, col);
        // EBITDA
        const ebitda = getHf('CONTO ECONOMICO', 20, col);
        // Amm.to
        const depr = getHf('CONTO ECONOMICO', 22, col);
        // EBIT
        const ebit = getHf('CONTO ECONOMICO', 27, col);
        // Interessi Mutuo
        const intMutuo = getHf('CONTO ECONOMICO', 30, col);
        const intMutuoAmm = getHf('AMMORTAMENTO', 7, col);
        // Interessi Soci
        const intSoci = getHf('CONTO ECONOMICO', 31, col);
        const intSociAmm = getHf('AMMORTAMENTO', 17, col);
        // EBT
        const ebt = getHf('CONTO ECONOMICO', 33, col);
        // Imposte
        const taxes = getHf('CONTO ECONOMICO', 55, col);
        // Utile Netto
        const netInc = getHf('CONTO ECONOMICO', 61, col);

        if (yi === 1 || yi === 2 || yi === 15 || yi === 20) {
            console.log(`Y${yi} (${colLetter}): Rev=${Math.round(rev)} | OPEX=${Math.round(opex)} | EBITDA=${Math.round(ebitda)} | Depr=${Math.round(depr)} | IntMutuo=${Math.round(intMutuo)} (Amm=${Math.round(intMutuoAmm)}) | IntSoci=${Math.round(intSoci)} (Amm=${Math.round(intSociAmm)}) | EBT=${Math.round(ebt)} | Taxes=${Math.round(taxes)} | NetIncome=${Math.round(netInc)}`);
        }
    }

    // Audit 3: Check RENDICONTO FINANZIARIO SPV
    console.log('\n>>> 3. RENDICONTO FINANZIARIO SPV');
    for (let yi = 1; yi <= 20; yi++) {
        const col = yi + 1;
        const colLetter = wb.getWorksheet('RENDICONTO FINANZIARIO SPV').getColumn(col).letter;
        const cfads = getHf('RENDICONTO FINANZIARIO SPV', 11, col);
        const debtServ = (getHf('RENDICONTO FINANZIARIO SPV', 14, col) || 0) + (getHf('RENDICONTO FINANZIARIO SPV', 15, col) || 0);
        const fcfeSpv = getHf('RENDICONTO FINANZIARIO SPV', 18, col);
        const intSociPaid = getHf('RENDICONTO FINANZIARIO SPV', 23, col);
        const divPaid = getHf('RENDICONTO FINANZIARIO SPV', 24, col);
        const princSociPaid = getHf('RENDICONTO FINANZIARIO SPV', 25, col);
        const restRiserve = getHf('RENDICONTO FINANZIARIO SPV', 26, col);
        const totTrasferito = (intSociPaid || 0) + (divPaid || 0) + (princSociPaid || 0) + (restRiserve || 0);

        if (yi === 1 || yi === 2 || yi === 15 || yi === 20) {
            console.log(`Y${yi} (${colLetter}): CFADS=${Math.round(cfads)} | SeniorDebtServ=${Math.round(debtServ)} | FCFE_SPV=${Math.round(fcfeSpv)} | Div=${Math.round(divPaid)} | IntSoci=${Math.round(intSociPaid)} | PrincSoci=${Math.round(princSociPaid)} | RestRiserve=${Math.round(restRiserve)} | TotTrasf=${Math.round(totTrasferito)}`);
        }
    }

    // Audit 4: Check RENDICONTO FINANZIARIO HOLDING & EXIT
    console.log('\n>>> 4. RENDICONTO FINANZIARIO HOLDING & EXIT');
    for (let yi = 1; yi <= 20; yi++) {
        const col = yi + 1;
        const colLetter = wb.getWorksheet('RENDICONTO FINANZIARIO HOLDING').getColumn(col).letter;
        const netIncHold = getHf('RENDICONTO FINANZIARIO HOLDING', 3, col);
        const cassaOrd = getHf('RENDICONTO FINANZIARIO HOLDING', 6, col);
        const exitSpv = getHf('RENDICONTO FINANZIARIO HOLDING', 8, col);
        const exitEv = getHf('RENDICONTO FINANZIARIO HOLDING', 9, col);
        const exitDebt = getHf('RENDICONTO FINANZIARIO HOLDING', 10, col);
        const exitPex = getHf('RENDICONTO FINANZIARIO HOLDING', 11, col);
        const fcfeHold = getHf('RENDICONTO FINANZIARIO HOLDING', 13, col);
        const fcfeCumul = getHf('RENDICONTO FINANZIARIO HOLDING', 14, col);

        if (yi === 1 || yi === 2 || yi === 15 || yi === 20) {
            console.log(`Y${yi} (${colLetter}): NetIncHold=${Math.round(netIncHold)} | CassaOrd=${Math.round(cassaOrd)} | ExitSPV=${Math.round(exitSpv)} (EV=${Math.round(exitEv)}, Debt=${Math.round(exitDebt)}, PEX=${Math.round(exitPex)}) | FCFE=${Math.round(fcfeHold)} | FCFE_Cumul=${Math.round(fcfeCumul)}`);
        }
    }
}

runAudit().catch(console.error);
