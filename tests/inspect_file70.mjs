import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (70).xlsx';

async function inspectFile70() {
    console.log(`=== AUDIT GLOBALE DI PL_Driver_Operativi (70).xlsx ===`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    console.log('Fogli trovati:', wb.worksheets.map(w => w.name));

    // 1. Sintassi Formule e Errori Strutturali
    const hfSheets = {};
    const syntaxErrors = [];

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
                    if (rawF.startsWith('=')) {
                        syntaxErrors.push({ sheet: ws.name, cell: `${ws.getColumn(c).letter}${r}`, formula: rawF, issue: 'LEADING_EQUAL' });
                        val = rawF; // HyperFormula handles it
                    } else {
                        val = '=' + rawF;
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

    console.log(`\n--- 1. AUDIT SINTASSI FORMULE (Doppio uguale) ---`);
    console.log(`Errori di sintassi leading = trovati: ${syntaxErrors.length}`);
    syntaxErrors.forEach(err => console.log(`❌ [${err.sheet}!${err.cell}] ${err.formula}`));

    // 2. HyperFormula Engine
    const hf = HyperFormula.buildFromSheets(hfSheets, {
        licenseKey: 'gpl-v3',
        useColumnIndex: true,
        precisionRounding: 6
    });

    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    // Scan for calculation errors in HyperFormula
    const calcErrors = [];
    wb.worksheets.forEach(ws => {
        const sId = hf.getSheetId(ws.name);
        const dim = hf.getSheetDimensions(sId);
        for (let r = 0; r < dim.height; r++) {
            for (let c = 0; c < dim.width; c++) {
                const hfVal = hf.getCellValue({ col: c, row: r, sheet: sId });
                if (hfVal && typeof hfVal === 'object' && hfVal.type && hfVal.type.includes('ERROR')) {
                    const formula = hf.getCellFormula({ col: c, row: r, sheet: sId });
                    calcErrors.push({ sheet: ws.name, cell: `${ws.getColumn(c + 1).letter}${r + 1}`, type: hfVal.type, message: hfVal.message, formula });
                }
            }
        }
    });

    console.log(`\n--- 2. ERRORI DI CALCOLO FORMULA (#VALUE!, #REF!, #NAME?, #DIV/0!) ---`);
    console.log(`Errori di calcolo trovati: ${calcErrors.length}`);
    calcErrors.forEach(err => console.log(`❌ [${err.sheet}!${err.cell}] ${err.type} (${err.message}): ${err.formula}`));

    // 3. Informazioni Portafoglio & Parametri Chiave
    console.log(`\n--- 3. PORTAFOGLIO & USI/FONTI ---`);
    const sCapex = wb.getWorksheet('CAPEX');
    const capexHeader = [];
    sCapex.getRow(1).eachCell((c, colNum) => { if (c.value) capexHeader.push(`C${colNum}: ${c.value}`); });
    console.log('CAPEX Header:', capexHeader.join(' | '));
    const capexTotRow = sCapex.getRow(11);
    console.log('CAPEX Totali:', `Impianto 1=${sCapex.getRow(11).getCell(2).value}, Impianto 2=${sCapex.getRow(11).getCell(3).value}, Totale Portafoglio=${sCapex.getRow(11).getCell(4).value}`);

    const sFin = wb.getWorksheet('FINANZA');
    console.log('\nParametri FINANZA:');
    sFin.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        const val = r.getCell(2).value;
        const f = r.getCell(2).formula;
        const hfVal = getHf('FINANZA', rNum, 2);
        if (lbl && (lbl.includes('Exit') || lbl.includes('Debito') || lbl.includes('Equity') || lbl.includes('Usi') || lbl.includes('Fonti') || lbl.includes('Multiplo') || lbl.includes('Valutazione') || lbl.includes('Base') || lbl.includes('Tasso') || lbl.includes('Preammortamento'))) {
            console.log(`R${String(rNum).padStart(3)} [${lbl}]: raw=${JSON.stringify(val)} (f=${f || 'none'}) | hf=${JSON.stringify(hfVal)}`);
        }
    });

    // 4. Dettaglio Foglio OPEX
    console.log(`\n--- 4. FOGLIO OPEX ---`);
    const sOpex = wb.getWorksheet('OPEX');
    sOpex.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        const vals = [];
        for (let c = 2; c <= r.cellCount; c++) {
            vals.push(`C${c}=${getHf('OPEX', rNum, c)}`);
        }
        if (lbl) console.log(`R${String(rNum).padStart(2)} [${lbl}]: ${vals.join(' | ')}`);
    });

    // 5. CONTO ECONOMICO: Righe Chiave
    console.log(`\n--- 5. CONTO ECONOMICO (Righe Chiave) ---`);
    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    const checkCeRows = [2, 3, 4, 9, 10, 11, 15, 20, 22, 27, 30, 31, 33, 40, 41, 42, 43, 45, 51, 53, 55, 56, 57, 58, 61];
    checkCeRows.forEach(rNum => {
        const row = sCe.getRow(rNum);
        const lbl = String(row.getCell(1).value || '').trim();
        const y1 = getHf('CONTO ECONOMICO', rNum, 2);
        const y2 = getHf('CONTO ECONOMICO', rNum, 3);
        const y5 = getHf('CONTO ECONOMICO', rNum, 6);
        const y15 = getHf('CONTO ECONOMICO', rNum, 16);
        const y20 = getHf('CONTO ECONOMICO', rNum, 21);
        const f1 = row.getCell(2).formula;
        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(35).substring(0, 35)}]: Y1=${Math.round(y1||0).toLocaleString('it-IT')} | Y2=${Math.round(y2||0).toLocaleString('it-IT')} | Y5=${Math.round(y5||0).toLocaleString('it-IT')} | Y15=${Math.round(y15||0).toLocaleString('it-IT')} | Y20=${Math.round(y20||0).toLocaleString('it-IT')} | fY1=${(f1||'none').substring(0, 35)}`);
    });

    // 6. RENDICONTO FINANZIARIO SPV: Righe Chiave
    console.log(`\n--- 6. RENDICONTO FINANZIARIO SPV ---`);
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    const checkRfRows = [2, 3, 4, 5, 6, 11, 14, 15, 18, 21, 22, 23, 24, 25, 26, 28, 30];
    checkRfRows.forEach(rNum => {
        const row = sRf.getRow(rNum);
        const lbl = String(row.getCell(1).value || '').trim();
        const y1 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 2);
        const y2 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 3);
        const y20 = getHf('RENDICONTO FINANZIARIO SPV', rNum, 21);
        const f1 = row.getCell(2).formula;
        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(35).substring(0, 35)}]: Y1=${Math.round(y1||0).toLocaleString('it-IT')} | Y2=${Math.round(y2||0).toLocaleString('it-IT')} | Y20=${Math.round(y20||0).toLocaleString('it-IT')} | fY1=${(f1||'none').substring(0, 35)}`);
    });

    // 7. RENDICONTO FINANZIARIO HOLDING: Righe Chiave & Exit
    console.log(`\n--- 7. RENDICONTO FINANZIARIO HOLDING & EXIT ---`);
    const sRfHc = wb.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    const checkRfHcRows = [3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 17];
    checkRfHcRows.forEach(rNum => {
        const row = sRfHc.getRow(rNum);
        const lbl = String(row.getCell(1).value || '').trim();
        const y1 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 2);
        const y2 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 3);
        const y20 = getHf('RENDICONTO FINANZIARIO HOLDING', rNum, 21);
        const f20 = row.getCell(21).formula;
        console.log(`R${String(rNum).padStart(2)} [${lbl.padEnd(35).substring(0, 35)}]: Y1=${Math.round(y1||0).toLocaleString('it-IT')} | Y2=${Math.round(y2||0).toLocaleString('it-IT')} | Y20=${Math.round(y20||0).toLocaleString('it-IT')} | fY20=${(f20||'none').substring(0, 45)}`);
    });

    // 8. CASH FLOW MENSILE: Righe Chiave e KPI
    console.log(`\n--- 8. CASH FLOW MENSILE ---`);
    const sMc = wb.getWorksheet('CASH FLOW MENSILE');
    sMc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '').trim();
        if (lbl.includes('SUBTOTALE') || lbl.includes('TOTALE') || lbl.includes('Budget') || lbl.includes('Allocato') || lbl.includes('Residuo') || lbl.includes('Cassa Minima')) {
            const c4 = getHf('CASH FLOW MENSILE', rNum, 4);
            const f4 = r.getCell(4).formula;
            const c16 = getHf('CASH FLOW MENSILE', rNum, 16);
            console.log(`R${String(rNum).padStart(3)} [${lbl.padEnd(45).substring(0, 45)}]: Col D=${Math.round(c4||0).toLocaleString('it-IT')} (f=${f4||'none'}) | Col P=${Math.round(c16||0).toLocaleString('it-IT')}`);
        }
    });
}

inspectFile70().catch(console.error);
