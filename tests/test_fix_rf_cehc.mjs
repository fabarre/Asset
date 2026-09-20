import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function run() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile('PL_Driver_Operativi (73).xlsx');
    
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    const sCeHc = wb.getWorksheet('CONTO ECONOMICO HOLDING');
    
    // Fix R21 in RF: cap is 0.2 * ('FINANZA'!$B$107 + 'FINANZA'!$B$109)
    for (let c = 2; c <= 21; c++) {
        const colLetter = String.fromCharCode(65 + c - 1);
        if (c === 2) {
            sRf.getRow(21).getCell(c).value = { formula: `IF(B2>0, MIN(0.05*B2, MAX(0, 0.2*('FINANZA'!$B$107+'FINANZA'!$B$109))), 0)` };
        } else {
            const prevCol = String.fromCharCode(65 + c - 2);
            sRf.getRow(21).getCell(c).value = { formula: `IF(${colLetter}2>0, MIN(0.05*${colLetter}2, MAX(0, 0.2*('FINANZA'!$B$107+'FINANZA'!$B$109)-SUM($B$21:${prevCol}21))), 0)` };
        }
    }

    // Fix R26 in RF: available reserve is ('FINANZA'!$B$107 + 'FINANZA'!$B$109)
    for (let c = 2; c <= 21; c++) {
        const colLetter = String.fromCharCode(65 + c - 1);
        const cashPostDiv = `MAX(0, ${colLetter}18+${colLetter}23+${colLetter}24+${colLetter}25)`;
        if (c === 2) {
            sRf.getRow(26).getCell(c).value = { formula: `-IF(AND('FINANZA'!$B$90="SÌ", 'AMMORTAMENTO'!B10>1), 0, IF(ISNUMBER(SEARCH("Riserve Capitale", 'FINANZA'!$B$91)), MIN(${cashPostDiv}, 'FINANZA'!$B$107+'FINANZA'!$B$109), 0))` };
        } else {
            const prevCol = String.fromCharCode(65 + c - 2);
            const avail = `MAX(0, 'FINANZA'!$B$107+'FINANZA'!$B$109+SUM($B$26:${prevCol}26))`;
            sRf.getRow(26).getCell(c).value = { formula: `-IF(AND('FINANZA'!$B$90="SÌ", 'AMMORTAMENTO'!${colLetter}10>1), 0, IF(ISNUMBER(SEARCH("Riserve Capitale", 'FINANZA'!$B$91)), MIN(${cashPostDiv}, ${avail}), 0))` };
        }
    }

    // Fix R7 in CE HC: 2% of 'CONTO ECONOMICO'!{col}3
    for (let c = 2; c <= 21; c++) {
        const colLetter = String.fromCharCode(65 + c - 1);
        const yr = c - 1;
        if (yr <= 5) {
            sCeHc.getRow(7).getCell(c).value = { formula: `-ROUND('CONTO ECONOMICO'!${colLetter}3 * 0.02, 0)` };
        } else {
            sCeHc.getRow(7).getCell(c).value = { formula: '0' };
        }
    }

    const hfSheets = {};
    wb.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let col = 1; col <= ws.columnCount; col++) {
                const cell = row.getCell(col);
                let val = null;
                let rawF = cell.formula;
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) rawF = cell.value.formula;
                if (rawF) val = rawF.startsWith('=') ? rawF : '=' + rawF;
                else if (cell.value !== undefined && cell.value !== null) val = cell.value;
                rowData.push(val);
            }
            matrix.push(rowData);
        }
        hfSheets[ws.name] = matrix;
    });

    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true });
    const getHf = (s, r, c) => {
        const raw = hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });
        if (typeof raw === 'object' && raw && raw.value !== undefined) return raw.value;
        return raw;
    };

    console.log('=== CONTO ECONOMICO HOLDING ===');
    console.log('R7 (Earn-out) Y1:', getHf('CONTO ECONOMICO HOLDING', 7, 2));
    console.log('R7 (Earn-out) Y2:', getHf('CONTO ECONOMICO HOLDING', 7, 3));
    console.log('R8 (Costi Prod B) Y1:', getHf('CONTO ECONOMICO HOLDING', 8, 2));
    console.log('R8 (Costi Prod B) Y2:', getHf('CONTO ECONOMICO HOLDING', 8, 3));
    console.log('R9 (EBIT HoldCo) Y1:', getHf('CONTO ECONOMICO HOLDING', 9, 2));
    console.log('R9 (EBIT HoldCo) Y2:', getHf('CONTO ECONOMICO HOLDING', 9, 3));
    console.log('R11 (Dividendi SPV) Y1:', getHf('CONTO ECONOMICO HOLDING', 11, 2));
    console.log('R11 (Dividendi SPV) Y2:', getHf('CONTO ECONOMICO HOLDING', 11, 3));
    console.log('R13 (Proventi Fin C) Y1:', getHf('CONTO ECONOMICO HOLDING', 13, 2));
    console.log('R13 (Proventi Fin C) Y2:', getHf('CONTO ECONOMICO HOLDING', 13, 3));
    console.log('R14 (EBT HoldCo) Y1:', getHf('CONTO ECONOMICO HOLDING', 14, 2));
    console.log('R14 (EBT HoldCo) Y2:', getHf('CONTO ECONOMICO HOLDING', 14, 3));
    console.log('R16 (IRES HoldCo) Y1:', getHf('CONTO ECONOMICO HOLDING', 16, 2));
    console.log('R16 (IRES HoldCo) Y2:', getHf('CONTO ECONOMICO HOLDING', 16, 3));
    console.log('R20 (Utile Netto HoldCo) Y1:', getHf('CONTO ECONOMICO HOLDING', 20, 2));
    console.log('R20 (Utile Netto HoldCo) Y2:', getHf('CONTO ECONOMICO HOLDING', 20, 3));

    console.log('\n=== RENDICONTO FINANZIARIO SPV ===');
    console.log('R21 (Riserva Legale) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 21, 2));
    console.log('R21 (Riserva Legale) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 21, 3));
    console.log('R22 (Capacità Utili Cum) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 22, 2));
    console.log('R22 (Capacità Utili Cum) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 22, 3));
    console.log('R24 (Rimborso Soci) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 24, 2));
    console.log('R24 (Rimborso Soci) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 24, 3));
    console.log('R25 (Dividendi SPV) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 25, 2));
    console.log('R25 (Dividendi SPV) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 25, 3));
    console.log('R26 (Restituz Riserve) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 26, 2));
    console.log('R26 (Restituz Riserve) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 26, 3));
    console.log('R28 (Cash Trap Annuo) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 28, 2));
    console.log('R28 (Cash Trap Annuo) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 28, 3));
    console.log('R30 (Cash Trap Saldo) Y1:', getHf('RENDICONTO FINANZIARIO SPV', 30, 2));
    console.log('R30 (Cash Trap Saldo) Y2:', getHf('RENDICONTO FINANZIARIO SPV', 30, 3));
}
run().catch(console.error);
