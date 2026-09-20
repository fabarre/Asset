import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';

async function analyze() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    console.log('=== WORKBOOK ANALYSIS FOR: PL_Driver_Operativi (69).xlsx ===');
    console.log('Sheets found:', wb.worksheets.map(w => w.name));

    // 1. Inputs from FINANZA
    const sFin = wb.getWorksheet('FINANZA');
    console.log('\n--- FINANZA ROWS ---');
    const finRows = {};
    sFin.eachRow((r, rNum) => {
        const label = String(r.getCell(1).value || '').trim();
        const cellB = r.getCell(2);
        const valB = cellB.value;
        const formB = cellB.formula;
        const resB = cellB.result;
        if (label) {
            finRows[label] = { row: rNum, value: valB, formula: formB, result: resB };
            console.log(`R${rNum} | ${label} = ${JSON.stringify(valB)} (f: ${formB || 'none'}, res: ${resB !== undefined ? JSON.stringify(resB) : 'none'})`);
        }
    });

    // 2. CAPEX Sheet
    const sCapex = wb.getWorksheet('CAPEX');
    console.log('\n--- CAPEX PLANTS & TOTALS ---');
    sCapex.eachRow((r, rNum) => {
        const label = String(r.getCell(1).value || '').trim();
        const vals = [];
        for (let c = 2; c <= r.cellCount; c++) {
            const v = r.getCell(c).value;
            if (v !== null && v !== undefined) vals.push(`C${c}: ${JSON.stringify(v)}`);
        }
        if (label || vals.length) {
            console.log(`R${rNum} [${label}]: ${vals.join(' | ')}`);
        }
    });

    // 3. DRIVER OPERATIVI
    const sDrv = wb.getWorksheet('DRIVER OPERATIVI');
    console.log('\n--- DRIVER OPERATIVI SUMMARY ---');
    sDrv.eachRow((r, rNum) => {
        const label = String(r.getCell(1).value || '').trim();
        if (label && (label.includes('Totale') || label.includes('Prezzo') || label.includes('Produzione') || label.includes('MWp') || label.includes('kWp'))) {
            const y1 = r.getCell(2).value;
            const y1Form = r.getCell(2).formula;
            const y20 = r.getCell(21).value;
            console.log(`R${rNum} [${label}]: Y1=${JSON.stringify(y1)} (f=${y1Form || 'none'}), Y20=${JSON.stringify(y20)}`);
        }
    });

    // 4. Build HyperFormula
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

    let calcErrors = [];
    wb.worksheets.forEach(ws => {
        const sheetId = hf.getSheetId(ws.name);
        const dim = hf.getSheetDimensions(sheetId);
        for (let r = 0; r < dim.height; r++) {
            for (let c = 0; c < dim.width; c++) {
                const cellVal = hf.getCellValue({ col: c, row: r, sheet: sheetId });
                if (cellVal && typeof cellVal === 'object' && cellVal.type && cellVal.type.includes('ERROR')) {
                    const formula = hf.getCellFormula({ col: c, row: r, sheet: sheetId });
                    calcErrors.push({ sheet: ws.name, cell: `R${r+1}C${c+1}`, type: cellVal.type, message: cellVal.message, formula });
                }
            }
        }
    });

    console.log(`\n--- HyperFormula Errors: ${calcErrors.length} ---`);
    calcErrors.slice(0, 30).forEach(e => {
        console.log(`❌ [${e.sheet}!${e.cell}] ${e.type} (${e.message}): ${e.formula}`);
    });
    if (calcErrors.length > 30) {
        console.log(`... and ${calcErrors.length - 30} more errors`);
    }

    // Check key outputs evaluated by HyperFormula
    console.log('\n--- KEY VALUES EVALUATED BY HYPERFORMULA ---');
    const getHfVal = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    // FINANZA Usi e Fonti
    for (const [k, v] of Object.entries(finRows)) {
        if (k.includes('TOTALE') || k.includes('Debito') || k.includes('Base Finanziabile') || k.includes('Equity') || k.includes('Controllo') || k.includes('Private Debt') || k.includes('Private Equity')) {
            const hfVal = getHfVal('FINANZA', v.row, 2);
            console.log(`FINANZA R${v.row} [${k}]: excelResult=${JSON.stringify(v.result || v.value)} | hyperFormula=${JSON.stringify(hfVal)}`);
        }
    }
}

analyze().catch(console.error);
