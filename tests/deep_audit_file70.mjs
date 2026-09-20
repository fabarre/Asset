import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (70).xlsx';
const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';

// 1. Worker setup
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

async function deepAuditFile70() {
    console.log('=== AUDIT FORENSE COMPARATIVO FILE 70: WEB APP VS EXCEL ===');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    // Build HyperFormula
    const hfSheets = {};
    wb.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let c = 1; c <= ws.columnCount; c++) {
                const cell = row.getCell(c);
                let val = null;
                let rawF = cell.formula;
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    rawF = cell.value.formula;
                }
                if (rawF) {
                    val = rawF.startsWith('=') ? rawF : '=' + rawF;
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

    // 1. Extract exact inputs from FINANZA, CAPEX, DRIVER OPERATIVI
    console.log('\n>>> 1. ESTRAZIONE PARAMETRI DA FILE 70');
    const sFin = wb.getWorksheet('FINANZA');
    const finParams = {};
    sFin.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        const v = r.getCell(2).value;
        const hfV = getHf('FINANZA', rNum, 2);
        if (lbl) finParams[lbl] = { rNum, v, hfV };
    });

    console.log('Anno di Uscita:', finParams['Anno di Uscita (Exit Year)']?.v);
    console.log('Opzione di Uscita (Metodo):', finParams['Opzione di Uscita (Exit Strategy)']?.v);
    console.log('Multiplo EBITDA:', finParams['Multiplo EBITDA di Uscita (x)']?.v);
    console.log('Valore Vendita per MWp:', finParams['Valutazione di Uscita per MWp (€)']?.v);
    console.log('Enterprise Value Fissa:', finParams['Valutazione Enterprise Value Fissa (€)']?.v);
    console.log('Tasso Interesse Senior:', finParams['Tasso Interesse Debito Senior']?.v);
    console.log('Durata Debito Senior:', finParams['Durata Debito Senior (Anni)']?.v);
    console.log('Preammortamento Senior (Mesi):', finParams['Preammortamento Senior (Mesi)']?.v);
    console.log('Debito Bancario Senior (Fonti):', finParams['Debito Bancario (Senior Loan)']?.hfV);
    console.log('Finanziamento Soci (Fonti):', finParams['- Finanziamento Soci (Subordinated Debt)']?.hfV);
    console.log('Totale Fonti:', finParams['TOTALE FONTI']?.hfV);
    console.log('Totale Usi:', finParams['TOTALE FABBISOGNO (Usi)']?.hfV);

    // 2. Scan each row in CONTO ECONOMICO and verify formula vs HyperFormula
    console.log('\n>>> 2. AUDIT DETTAGLIATO CONTO ECONOMICO (Formule vs Cella Padre)');
    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    sCe.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (!lbl || lbl.includes('DRIVER')) return;

        const fY1 = r.getCell(2).formula;
        const fY2 = r.getCell(3).formula;
        const vY1 = getHf('CONTO ECONOMICO', rNum, 2);
        const vY2 = getHf('CONTO ECONOMICO', rNum, 3);
        const vY20 = getHf('CONTO ECONOMICO', rNum, 21);

        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(42).substring(0, 42)}]: Y1=${typeof vY1 === 'number' ? Math.round(vY1).toLocaleString('it-IT') : vY1} | Y2=${typeof vY2 === 'number' ? Math.round(vY2).toLocaleString('it-IT') : vY2} | Y20=${typeof vY20 === 'number' ? Math.round(vY20).toLocaleString('it-IT') : vY20} | fY1=${(fY1||'').substring(0, 30)} | fY2=${(fY2||'').substring(0, 30)}`);
    });

    // 3. Scan RENDICONTO FINANZIARIO SPV
    console.log('\n>>> 3. AUDIT DETTAGLIATO RENDICONTO FINANZIARIO SPV');
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    sRf.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (!lbl || lbl.includes('DRIVER') || lbl.includes('CASCATA') || lbl.includes('SERVIZIO')) return;

        const fY1 = r.getCell(2).formula;
        const vY1 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 2);
        const vY2 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 3);
        const vY20 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 21);

        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(42).substring(0, 42)}]: Y1=${typeof vY1 === 'number' ? Math.round(vY1).toLocaleString('it-IT') : vY1} | Y2=${typeof vY2 === 'number' ? Math.round(vY2).toLocaleString('it-IT') : vY2} | Y20=${typeof vY20 === 'number' ? Math.round(vY20).toLocaleString('it-IT') : vY20}`);
    });

    // 4. Scan RENDICONTO FINANZIARIO HOLDING
    console.log('\n>>> 4. AUDIT DETTAGLIATO RENDICONTO FINANZIARIO HOLDING');
    const sRfHc = wb.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    sRfHc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (!lbl || lbl.includes('DRIVER') || lbl.includes('RENDICONTO') || lbl.includes('RIEPILOGO')) return;

        const fY20 = r.getCell(21).formula;
        const vY1 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 2);
        const vY2 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 3);
        const vY20 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 21);

        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(42).substring(0, 42)}]: Y1=${typeof vY1 === 'number' ? Math.round(vY1).toLocaleString('it-IT') : vY1} | Y2=${typeof vY2 === 'number' ? Math.round(vY2).toLocaleString('it-IT') : vY2} | Y20=${typeof vY20 === 'number' ? Math.round(vY20).toLocaleString('it-IT') : vY20} | fY20=${(fY20||'').substring(0, 40)}`);
    });
}

deepAuditFile70().catch(console.error);
