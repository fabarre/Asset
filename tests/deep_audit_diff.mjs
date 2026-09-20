import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';
const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';

// 1. Inizializza Worker in sandbox
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

async function runDeepAudit() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

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

    const hf = HyperFormula.buildFromSheets(hfSheets, {
        licenseKey: 'gpl-v3',
        useColumnIndex: true,
        precisionRounding: 6
    });

    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    console.log('=== VERIFICA DISCREPANZE FORMULE EXCEL (FORMULA VS GENITORE) ===');

    // 1. Audit FINANZA
    const sFin = wb.getWorksheet('FINANZA');
    console.log('\n>>> 1. AUDIT FINANZA (Usi & Fonti e Parametri Padre)');
    sFin.eachRow((row, rNum) => {
        const lbl = String(row.getCell(1).value || '').trim();
        const cell = row.getCell(2);
        const f = cell.formula;
        const hfVal = getHf('FINANZA', rNum, 2);
        if (f) {
            console.log(`R${rNum} [${lbl}]: Formula=${f} | Valore=${hfVal}`);
        }
    });

    // 2. Audit CONTO ECONOMICO
    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    console.log('\n>>> 2. AUDIT CONTO ECONOMICO (Ricavi, OPEX, Ammortamenti, Imposte, Utile)');
    const ceRows = {};
    sCe.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl) ceRows[lbl] = rNum;
    });

    // 3. Audit RENDICONTO FINANZIARIO SPV
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    console.log('\n>>> 3. AUDIT RENDICONTO FINANZIARIO SPV');
    const rfRows = {};
    sRf.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl) rfRows[lbl] = rNum;
    });

    // 4. Audit RENDICONTO FINANZIARIO HOLDING
    const sRfHc = wb.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    console.log('\n>>> 4. AUDIT RENDICONTO FINANZIARIO HOLDING');
    const rfHcRows = {};
    sRfHc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl) rfHcRows[lbl] = rNum;
    });

    // Check all rows of CONTO ECONOMICO for all 20 years
    console.log('\n--- SCANNING ALL ROWS FOR SUSPICIOUS VALUES OR ZEROES ---');
    
    // Check CONTO ECONOMICO
    for (const [lbl, rNum] of Object.entries(ceRows)) {
        const y1 = getHf('CONTO ECONOMICO', rNum, 2);
        const y2 = getHf('CONTO ECONOMICO', rNum, 3);
        const y20 = getHf('CONTO ECONOMICO', rNum, 21);
        const row = sCe.getRow(rNum);
        const fY1 = row.getCell(2).formula;
        if (fY1) {
            // Check if formula references correct cells
            // console.log(`CE R${rNum} [${lbl}]: Y1=${Math.round(y1||0)}, Y2=${Math.round(y2||0)}, Y20=${Math.round(y20||0)} | fY1=${fY1.substring(0, 50)}`);
        }
    }

    // Check RENDICONTO FINANZIARIO SPV
    for (const [lbl, rNum] of Object.entries(rfRows)) {
        const y1 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 2);
        const y2 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 3);
        const y20 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 21);
        const row = sRf.getRow(rNum);
        const fY1 = row.getCell(2).formula;
        if (fY1) {
            console.log(`RF SPV R${rNum} [${lbl}]: Y1=${Math.round(y1||0)}, Y2=${Math.round(y2||0)}, Y20=${Math.round(y20||0)} | fY1=${fY1.substring(0, 50)}`);
        }
    }

    // Check RENDICONTO FINANZIARIO HOLDING
    for (const [lbl, rNum] of Object.entries(rfHcRows)) {
        const y1 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 2);
        const y2 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 3);
        const y20 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 21);
        const row = sRfHc.getRow(rNum);
        const fY1 = row.getCell(2).formula;
        const fY20 = row.getCell(21).formula;
        console.log(`RF HOLDING R${rNum} [${lbl}]: Y1=${Math.round(y1||0)}, Y2=${Math.round(y2||0)}, Y20=${Math.round(y20||0)} | fY20=${(fY20||'').substring(0, 50)}`);
    }

    // Check CASH FLOW MENSILE
    const sMc = wb.getWorksheet('CASH FLOW MENSILE');
    console.log('\n>>> 5. AUDIT CASH FLOW MENSILE (KPI e Subtotali)');
    sMc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl.includes('SUBTOTALE') || lbl.includes('TOTALE') || lbl.includes('Cassa') || lbl.includes('Budget') || lbl.includes('Residuo')) {
            const c4 = r.getCell(4).value;
            const f4 = r.getCell(4).formula;
            const hf4 = getHf('CASH FLOW MENSILE', rNum, 4);
            const c16 = r.getCell(16).value;
            const f16 = r.getCell(16).formula;
            const hf16 = getHf('CASH FLOW MENSILE', rNum, 16);
            console.log(`MC R${rNum} [${lbl}]: C4=${hf4 !== null ? Math.round(hf4||0) : JSON.stringify(c4)} (f=${f4||'none'}) | C16=${hf16 !== null ? Math.round(hf16||0) : JSON.stringify(c16)} (f=${f16||'none'})`);
        }
    });
}

runDeepAudit().catch(console.error);
